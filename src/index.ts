import joplin from "api";
import { MenuItemLocation, SettingItemSubType, SettingItemType } from "api/types";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

const COMMAND_SERVER_DIR_NAME = "joplin-command-server";
const SETTING_TEMP_DIR = "tempDirOverride";
const KEEP_ALIVE_INTERVAL_MS = 60_000;

let configuredBaseTmpDir = "";

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
  const baseDir = configuredBaseTmpDir.trim() || os.tmpdir();
  const suffix =
    typeof process.getuid === "function" ? `-${process.getuid()}` : "";
  return path.join(baseDir, `${COMMAND_SERVER_DIR_NAME}${suffix}`);
}

function ensureCommunicationDirs(): string {
  const commDir = getCommunicationDirPath();
  const signalsDir = path.join(commDir, "signals");

  try {
    fs.ensureDirSync(commDir, { mode: 0o700 });
    fs.ensureDirSync(signalsDir, { mode: 0o700 });

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

  if (!(await fs.pathExists(requestPath))) {
    console.warn(
      `[Joplin Command Server] Trigger received, but request.json does not exist at: ${requestPath}`,
    );
    return;
  }

  let request: CommandRequest;
  try {
    const raw = await fs.readFile(requestPath, "utf8");
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
    const jsonString = JSON.stringify(responsePayload) + "\n";
    await fs.writeFile(responsePath, jsonString, "utf8");
  } catch (err) {
    console.error("[Joplin Command Server] Error writing response.json:", err);
  }
}

// Create default IPC directory immediately at module evaluation
ensureCommunicationDirs();

joplin.plugins.register({
  onStart: async () => {
    await joplin.settings.registerSection("joplinCommandServer", {
      label: "Command Server",
      iconName: "fas fa-terminal",
    });

    await joplin.settings.registerSettings({
      [SETTING_TEMP_DIR]: {
        value: "",
        type: SettingItemType.String,
        subType: SettingItemSubType.DirectoryPath,
        section: "joplinCommandServer",
        public: true,
        advanced: true,
        label: "Temporary directory override",
        description:
          "Base temp directory used to create the joplin-command-server folder (should match Talon's tempfile.gettempdir() if using with talon). Leave blank to use the system default.",
      },
    });

    configuredBaseTmpDir = (await joplin.settings.value(SETTING_TEMP_DIR)) || "";
    const commDir = ensureCommunicationDirs();

    await joplin.settings.onChange(async (event) => {
      if (event.keys.includes(SETTING_TEMP_DIR)) {
        configuredBaseTmpDir =
          (await joplin.settings.value(SETTING_TEMP_DIR)) || "";
        const updatedDir = ensureCommunicationDirs();
        console.info(
          `[Joplin Command Server] Updated communication directory to: ${updatedDir}`,
        );
      }
    });

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
      { accelerator: "CmdOrCtrl+Shift+F17" },
    );
  },
});
