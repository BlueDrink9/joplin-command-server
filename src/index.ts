import joplin from "api";
import { MenuItemLocation, SettingItemType } from "api/types";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

const COMMAND_SERVER_DIR_NAME = "joplin-command-server";

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

async function handleCommandExecution() {
  const commDir = getCommunicationDirPath();
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

  const responsePayload = {
    uuid,
    returnValue: returnValue ?? null,
    warnings: warnings ?? [],
    error: error ?? null,
  };

  try {
    // '\n required for Talon's read_json_with_timeout to recognize completion
    const jsonString = JSON.stringify(responsePayload) + "\n";
    await fs.writeFile(responsePath, jsonString, "utf8");
    console.log(`[Joplin Command Server] response.json written successfully.`);
  } catch (err) {
    console.error("[Joplin Command Server] Error writing response.json:", err);
  }
}

joplin.plugins.register({
  onStart: async () => {
    const commDir = getCommunicationDirPath();
    await fs.ensureDir(commDir);
    await fs.ensureDir(path.join(commDir, "signals"));

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
