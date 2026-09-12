import joplin from 'api';
import { MenuItemLocation } from 'api/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const COMMAND_NAME = 'commandServerRunCommand';
const MENU_ITEM_NAME = 'commandServerRunMenuItem';
const ACCELERATOR = 'CmdOrCtrl+Alt+Shift+J';

function getCommunicationDir(): string {
    const username = os.userInfo().username || 'default';
    return path.join(os.tmpdir(), `joplin-command-server-${username}`);
}

joplin.plugins.register({
    onStart: async function () {
        const commDir = getCommunicationDir();
        const requestFile = path.join(commDir, 'request.json');

        // Ensure IPC directory exists
        try {
            if (!fs.existsSync(commDir)) {
                fs.mkdirSync(commDir, { recursive: true });
            }
        } catch (err) {
            console.error('[Command Server] Failed to create IPC directory:', err);
            return;
        }

        // Register the execution trigger command
        await joplin.commands.register({
            name: COMMAND_NAME,
            label: 'Command Server: Run Command',
            execute: async () => {
                if (!fs.existsSync(requestFile)) {
                    return;
                }

                try {
                    const content = fs.readFileSync(requestFile, 'utf8').trim();
                    if (!content) return;

                    // Remove file immediately to avoid replay execution
                    try {
                        fs.unlinkSync(requestFile);
                    } catch (_) {}

                    const payload = JSON.parse(content);

                    // Drop requests older than 3 seconds
                    if (payload.timestamp && Date.now() - payload.timestamp > 3000) {
                        console.warn('[Command Server] Expired request ignored');
                        return;
                    }

                    if (payload.commandId) {
                        const args = Array.isArray(payload.args) ? payload.args : [];
                        await joplin.commands.execute(payload.commandId, ...args);
                    }
                } catch (err) {
                    console.error('[Command Server] Error processing command:', err);
                }
            },
        });

        // Register menu item to bind the shortcut accelerator
        await joplin.views.menuItems.create(
            MENU_ITEM_NAME,
            COMMAND_NAME,
            MenuItemLocation.Tools,
            { accelerator: ACCELERATOR }
        );

        console.info(`[Command Server] File RPC ready at ${commDir} via ${ACCELERATOR}`);
    },
});
