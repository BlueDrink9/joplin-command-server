import joplin from "api";
import { MenuItemLocation } from "api/types";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

const COMMAND_SERVER_DIR_NAME = "joplin-command-server";
const KEEP_ALIVE_INTERVAL_MS = 60_000;

interface CommandRequest {
  uuid: string;
  commandId: string;
  args?: any[];
  waitForFinish?: boolean;
  returnCommandOutput?: boolean;
}

interface CommandResponse {
  uuid: string;
  returnValue: any;
  warnings: string[];
  error: string | null;
}

function getCommunicationDirPath(): string {
  const tmpDir = os.tmpdir();
  const suffix =
    typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  return path.join(tmpDir, `${COMMAND_SERVER_DIR_NAME}${suffix}`);
}

function ensureCommunicationDirs(): string {
  const commDir = getCommunicationDirPath();
  const signalsDir = path.join(commDir, "signals");

  try {
    fs.ensureDirSync(commDir, { mode: 0o700 });
    fs.ensureDirSync(signalsDir, { mode: 0o700 });

    // Enforce 0o700 explicitly on POSIX so default umasks (e.g. 0o002)
    // do not make the directory group-writable, which Talon's command_client rejects.
    if (process.platform !== "win32") {
      fs.chmodSync(commDir, 0o700);
      fs.chmodSync(signalsDir, 0o700);
    }
  } catch (err) {
    console.error(
      `[Joplin Command Server] Failed to create/secure IPC directory at ${commDir}:`,
      err,
    );
  }

  return commDir;
}

async function handleCommandExecution() {
  const commDir = ensureCommunicationDirs();
  const requestPath = path.join(commDir, "request.json");
  const responsePath = path.join(commDir, "response.json");

  console.log(
    `[Joplin Command Server] Trigger received. Looking for request.json at: ${requestPath}`,
  );

  if (!(await fs.pathExists(requestPath))) {
    console.warn(
      `[Joplin Command Server] Warning: Trigger received, but request.json does NOT exist at: ${requestPath}`,
    );
    return;
  }

  let request: CommandRequest;
  try {
    const raw = await fs.readFile(requestPath, "utf8");
    console.log(`[Joplin Command Server] Read request payload: ${raw}`);
    request = JSON.parse(raw);
  } catch (err) {
    console.error("[Joplin Command Server] Failed to read request.json:", err);
    return;
  }

  const {
    uuid,
    commandId,
    args = [],
    waitForFinish = false,
    returnCommandOutput = false,
  } = request;

  console.log(
    `[Joplin Command Server] Invoking Joplin command '${commandId}' (uuid: ${uuid}) with args:`,
    args,
  );

  let returnValue: any = null;
  let error: string | null = null;
  const warnings: string[] = [];

  const executeCmd = () => joplin.commands.execute(commandId, ...args);

  if (waitForFinish || returnCommandOutput) {
    try {
      const res = await executeCmd();
      if (returnCommandOutput) {
        returnValue = res ?? null;
      }
    } catch (err: any) {
      error = err.message || String(err);
    }
  } else {
    executeCmd().catch((err) => {
      console.error(
        `[Joplin Command Server] Async error executing '${commandId}':`,
        err,
      );
    });
  }

  const responsePayload: CommandResponse = {
    uuid,
    returnValue: returnValue ?? null,
    warnings,
    error,
  };

  try {
    // '\n' required for Talon's read_json_with_timeout to recognize completion
    const jsonString = JSON.stringify(responsePayload) + "\n";
    await fs.writeFile(responsePath, jsonString, "utf8");
    console.log(`[Joplin Command Server] response.json written successfully.`);
  } catch (err) {
    console.error("[Joplin Command Server] Error writing response.json:", err);
  }
}

// Create the IPC directory immediately when the plugin bundle is evaluated
ensureCommunicationDirs();

joplin.plugins.register({
  onStart: async () => {
    const commDir = ensureCommunicationDirs();

    // Recreate directories if an OS tmp cleaner (e.g. systemd-tmpfiles) purges /tmp
    const keepAliveTimer = setInterval(() => {
      ensureCommunicationDirs();
    }, KEEP_ALIVE_INTERVAL_MS);
    if (typeof keepAliveTimer.unref === "function") {
      keepAliveTimer.unref();
    }

    console.info(
      `[Joplin Command Server] Initialized communication directory at: ${commDir}`,
    );

    await joplin.commands.register({
      name: "joplinExecuteRpcCommand",
      label: "Joplin RPC Command Trigger",
      iconName: "fas fa-terminal",
      execute: async () => {
        await handleCommandExecution();
      },
    });

    await joplin.views.menuItems.create(
      "joplinRpcTriggerMenuItem",
      "joplinExecuteRpcCommand",
      MenuItemLocation.Tools,
      // Default Talon community RPC shortcut
      { accelerator: "CmdOrCtrl+Shift+F17" },
    );
  },
});
