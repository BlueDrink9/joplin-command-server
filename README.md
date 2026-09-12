# Joplin Command Server

A Joplin plugin allowing external applications to trigger Joplin commands by ID, using file-based interprocess communication (RPC).

## How It Works

This plugin uses the standard [Talon Community command client](https://github.com/talonhub/community/tree/main/core/command_client) IPC protocol. This is file based rather than HTTP for security, avoiding exposing a port. It works by writing the request to a file, then sending a hidden keyboard shortcut to notify Joplin to process it.

1. **Write Request:** An external client writes a `request.json` file to the OS temporary directory (`/tmp/joplin-command-server-<uid>` on Linux/macOS or `%TEMP%\joplin-command-server` on Windows).
2. **Signal Process:** The client issues a keyboard shortcut (`CmdOrCtrl+Shift+F17` by default). Because Joplin does not run an exposed background socket server, a hotkey is used to notify the running GUI process that a command is waiting to be processed.
3. **Execute & Respond:** Joplin reads the request file, runs the requested `commandId`, and writes the result to `response.json` (terminated with a newline `\n`).
4. **Cleanup:** The client reads `response.json` and deletes both temporary files.

## Protocol Format

**`request.json`**

```json
{
  "uuid": "unique-request-id",
  "commandId": "focusElementNoteViewer",
  "args": [],
  "waitForFinish": false,
  "returnCommandOutput": false
}

```

**`response.json`**

```json
{
  "uuid": "unique-request-id",
  "returnValue": null,
  "warnings": [],
  "error": null
}

```

## Configuration

If `CmdOrCtrl+Shift+F17` conflicts with another hotkey, rebind it inside Joplin by navigating to **Tools -> Options -> Keyboard Shortcuts** and searching for **Joplin RPC Command Trigger**.

## Integration

For client implementation details, see the [Talon Community command client](https://github.com/talonhub/community/tree/main/core/command_client) repository.
