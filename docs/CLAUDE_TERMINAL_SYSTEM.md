# Claude Terminal Integration System

Technical documentation for CommsLink's remote Claude Code integration. This system allows users and AI agents to interact with Claude Code running on remote machines via the web interface.

## Architecture Overview

```
┌──────────────────┐     Socket.IO      ┌──────────────────┐     PTY      ┌──────────────────┐
│   Web Frontend   │ ◄───────────────► │    API Server    │ ◄──────────► │  Terminal Agent  │
│  (TerminalPanel) │                    │  (chat handler)  │              │  (user machine)  │
└──────────────────┘                    └──────────────────┘              └────────┬─────────┘
                                                                                  │
                                                                            node-pty spawn
                                                                                  │
                                                                         ┌────────▼─────────┐
                                                                         │   Claude Code    │
                                                                         │  (interactive)   │
                                                                         └──────────────────┘
```

Three components work together:

1. **Terminal Agent** (`packages/terminal-agent/`) — standalone Node.js binary running on the user's machine. Spawns Claude Code in a PTY and bridges it to CommsLink via Socket.IO.
2. **API Server** (`services/api/src/handlers/chat/index.ts`) — routes commands between web clients/AI agents and terminal agents. Handles security, logging, and chat integration.
3. **Web Frontend** (`services/web/components/TerminalPanel/`) — React component with two tabs: a basic terminal and a Claude Code viewer using xterm.js.

## Terminal Agent

### Location & Building

```
packages/terminal-agent/
├── src/index.ts          # Main source
├── package.json          # v1.1.0, @commslink/terminal-agent
├── dist/                 # Compiled JS (tsc output)
└── bin/                  # Packaged binaries (@yao-pkg/pkg)
    ├── commslink-agent-win.exe
    ├── commslink-agent-linux
    └── prebuilds/        # node-pty native modules
```

Build commands:
```bash
npm run build       # TypeScript compile
npm run package     # Build standalone binaries (pkg + copy native prebuilds)
```

The `package` script uses `@yao-pkg/pkg` targeting `node18-win-x64` and `node18-linux-x64`, then copies `node-pty` native prebuilds alongside the binary.

### Configuration

The agent supports four config methods (in priority order):

1. **CLI arguments**: `commslink-agent -s wss://commslink.net -t <jwt> -n my-pc`
2. **Setup code**: `commslink-agent --setup <base64>` (generated from Room Settings UI)
3. **Saved config**: `~/.commslink-agent.json` (auto-saved after first login)
4. **Interactive prompt**: asks for username, password, server, machine name

Config file (`~/.commslink-agent.json`):
```json
{
  "server": "wss://commslink.net",
  "token": "<jwt>",
  "machineName": "my-pc",
  "username": "lunaprey"
}
```

Log file: `~/.commslink-agent.log`

### Connection Flow

1. Agent connects via Socket.IO with JWT auth
2. Emits `machine_register` with `{ name, os, version }`
3. Server creates/updates `machine` DB record, sets `status: 'online'`, stores `socket_id`
4. Server responds with `machine_registered` event
5. Agent checks if `claude` CLI is installed, then spawns interactive Claude Code via `node-pty`

### PTY Session

Claude Code is spawned in a real pseudo-terminal:

```typescript
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd: homedir(),
  env: process.env,
});
```

- `shell` = `claude.cmd` on Windows, `claude` on Linux/macOS
- PTY output is written to local stdout AND emitted as `claude_terminal_data` to the server
- Local keyboard input is forwarded to the PTY
- Terminal resize events are propagated

### Socket Events (Agent Side)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `machine_register` | Agent → Server | Register machine with name, OS, version |
| `machine_registered` | Server → Agent | Confirmation with machine ID |
| `terminal_exec` | Server → Agent | Execute a shell command (non-Claude) |
| `terminal_output:{execId}` | Agent → Server | Shell command result |
| `claude_session_input` | Server → Agent | Send text to Claude PTY |
| `claude_terminal_data` | Agent → Server | Raw PTY output (real-time mirror) |
| `claude_session_output` | Agent → Server | Echo of typed input |
| `claude_pty_response:{execId}` | Agent → Server | Collected Claude response (clipboard) |
| `claude_pty_response` | Agent → Server | Generic response event (for web panel) |
| `claude_session_stop` | Server → Agent | Send Ctrl+C to Claude PTY |

### Response Collection (AI Mode)

When `collectResponse: true` is set on `claude_session_input`, the agent enters collection mode:

1. Attaches a temporary `onData` listener to the PTY
2. Writes the user's prompt into the PTY
3. Monitors output chunks — only chunks > 10 bytes count as "real" output (smaller chunks are cursor blink/position sequences)
4. After 5 seconds of inactivity (no substantial output), triggers `finish()`
5. `finish()` sends `/copy` command to the PTY — this is Claude Code's built-in command that copies its last response to the system clipboard
6. Waits 1.5 seconds for clipboard to populate
7. Reads clipboard using platform-specific commands:
   - Windows: `powershell -command "Get-Clipboard"`
   - macOS: `pbpaste`
   - Linux: `xclip -selection clipboard -o` or `xsel --clipboard --output`
8. Emits the clipboard content as `claude_pty_response:{execId}`
9. Also emits generic `claude_pty_response` for web panel listeners

**Why `/copy` instead of parsing PTY output?**

Claude Code's TUI uses ANSI escape sequences, cursor positioning, thinking animations, and screen redraws. Parsing raw PTY output to extract the "final answer" is unreliable — the `/copy` command gives the exact clean response text directly.

### Inactivity Detection

Claude's TUI constantly emits small chunks (cursor blink, position updates — typically 3-6 bytes). These would prevent an inactivity timer from ever expiring. The solution:

- Only chunks > 10 bytes reset the inactivity timer
- 5-second inactivity timeout after real output starts
- 3-minute absolute timeout if no output at all

## API Server (Chat Handler)

### Key Functions

#### `executeClaudePrompt()`

Used by AI agents when they use the `{claude machine prompt}` command:

```typescript
executeClaudePrompt(io, machineSocketId, sessionKey, prompt, roomName, agentName, timeoutMs, approved)
```

1. Generates a unique `execId`
2. Listens for `claude_pty_response:{execId}` on the machine socket
3. Emits `claude_session_input` with `collectResponse: true`
4. When response arrives, posts it as a system message in room chat
5. Returns the response text to the AI agent's command loop

#### `claude_panel_input` handler

Used by the web TerminalPanel:

1. Looks up the machine by owner + name
2. Logs the input to `claude_log` table
3. Sets up PTY output listeners on the machine socket (once per socket):
   - `claude_terminal_data` → forwards raw PTY data to web panel as `claude_panel_output`
   - `claude_session_output` → forwards echo text
   - `claude_pty_response` → posts collected response as system message in chat
4. Emits `claude_session_input` to the agent with `collectResponse: true`
5. Posts the user's input as a system message for AI visibility

### AI Agent Command Syntax

AI agents in chat can invoke Claude using:

```
{claude machine_name prompt text here}     # normal mode
{claude! machine_name prompt text here}    # approved mode (allows file writes)
```

Security checks:
- Machine must exist and be owned by the room creator
- Machine must be online with an active socket connection
- Machine must have permission enabled for the room (`machine_permission` table)

### System Messages

All Claude interactions are posted as system messages in the room chat:

- `[agent_name claude → machine]: prompt` — when an AI agent sends a prompt
- `[username claude → machine]: prompt` — when a user sends from the web panel
- `[Claude machine response]: text` — when Claude's response is captured

This ensures all participants (human and AI) can see Claude's interactions in the conversation history.

## Web Frontend (TerminalPanel)

### Component: `services/web/components/TerminalPanel/index.tsx`

Two-tab interface:

#### Terminal Tab
- Simple structured output: input lines, output lines, error lines
- Uses `terminal_panel_input` / `terminal_panel_output` events
- Executes shell commands via `child_process.exec` on the agent

#### Claude Tab
- **xterm.js** (`@xterm/xterm` v6) renders Claude's full TUI with colors, cursor movements, and formatting
- Dynamic import of `Terminal` and `FitAddon` (client-side only)
- Uses `claude_panel_input` / `claude_panel_output` events

#### Output Debouncing

Claude's thinking animation produces rapid output bursts (write text → erase → rewrite). A 300ms debounce buffer absorbs these cycles:

```typescript
const DEBOUNCE_MS = 300;
ptyBufferRef.current += data.data;
if (ptyFlushTimerRef.current) clearTimeout(ptyFlushTimerRef.current);
ptyFlushTimerRef.current = setTimeout(flushPtyBuffer, DEBOUNCE_MS);
```

On `claude_panel_done`, any pending buffer is flushed immediately.

#### Quick-Action Buttons

Three numbered buttons (1, 2, 3) send single characters to the Claude PTY. These correspond to Claude Code's interactive prompts (e.g., "1. Yes", "2. Yes, always", "3. No").

#### Approved Mode Toggle

A "Full" checkbox sets the `approved` flag on messages. When enabled, Claude Code is allowed to write/edit files and run commands without asking for confirmation.

### Socket Events (Web Panel)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `claude_panel_input` | Web → Server | User sends text to Claude |
| `claude_panel_output` | Server → Web | Raw PTY data for xterm rendering |
| `claude_panel_done` | Server → Web | Claude session ended |
| `claude_panel_stop` | Web → Server | User clicks Stop button |

## Database Schema

### `machine` table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | String | Machine name (e.g., "lunaprey-pc") |
| owner_id | UUID | FK to user who registered it |
| socket_id | String? | Current Socket.IO ID (null when offline) |
| status | String | "online" or "offline" |
| os | String? | OS info (e.g., "Windows_NT win32") |
| last_seen | DateTime? | Last activity timestamp |

Unique constraint: `(owner_id, name)`

### `machine_permission` table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| machine_id | UUID | FK to machine |
| room_id | UUID | FK to room |
| enabled | Boolean | Whether the machine can be used in this room |

Unique constraint: `(machine_id, room_id)`

### `claude_log` table

Debug/audit log for all Claude interactions:

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| direction | String | `user_to_claude`, `claude_to_user`, or `claude_response` |
| session_key | String | Session identifier (e.g., `socketId:machineName`) |
| machine_name | String | Target machine |
| username | String | User who initiated |
| room_name | String | Room context |
| content | Text | Message content (truncated to 2000-4000 chars) |
| created_at | DateTime | Timestamp |

### Room flag

The `room` table has a `cmd_claude_enabled` boolean flag (default false). This must be enabled in Room Settings for Claude commands to work.

## Data Flow Diagrams

### Web Panel → Claude → Chat

```
User types in Claude tab
  → claude_panel_input (web → server)
  → claude_session_input { collectResponse: true } (server → agent)
  → agent writes to PTY
  → Claude processes and responds
  → claude_terminal_data (agent → server → web) [real-time xterm rendering]
  → 5s inactivity detected
  → agent sends /copy to PTY
  → agent reads clipboard
  → claude_pty_response (agent → server)
  → server posts system message in room chat
  → server forwards to web panel
```

### AI Agent → Claude → AI Agent

```
AI generates {claude machine_name prompt}
  → executeClaudePrompt() called
  → claude_session_input { collectResponse: true, execId } (server → agent)
  → agent writes prompt to PTY
  → Claude processes and responds
  → 5s inactivity detected
  → agent sends /copy, reads clipboard
  → claude_pty_response:{execId} (agent → server)
  → server posts system message in room chat
  → response returned to AI agent's command loop
  → AI generates next message using Claude's response
```

## Deployment

### Binary Distribution

Binaries are served from the API server. The Room Settings UI provides download links. The files live at:

```
packages/terminal-agent/bin/commslink-agent-win.exe   # Windows
packages/terminal-agent/bin/commslink-agent-linux      # Linux
```

On EC2, these are mounted as a Docker volume at `/app/terminal-agent-bin`.

### Rebuilding & Deploying

```bash
# 1. Build locally
cd packages/terminal-agent
npm run package

# 2. Upload to EC2
scp -i <key>.pem bin/commslink-agent-win.exe ec2-user@<EC2_IP>:~/CommsLink2/packages/terminal-agent/bin/
scp -i <key>.pem bin/commslink-agent-linux ec2-user@<EC2_IP>:~/CommsLink2/packages/terminal-agent/bin/

# 3. Rebuild API/web containers if code changed
ssh ec2-user@<EC2_IP> "cd ~/CommsLink2 && docker-compose build --no-cache && docker-compose up -d"
```

### Version Tracking

The agent reports its version (`AGENT_VERSION = '1.1.0'`) in:
- Startup banner: `CommsLink Terminal Agent v1.1.0`
- `machine_register` event: `{ name, os, version }`

This helps detect stale binaries when debugging issues.

## Troubleshooting

### Claude not responding
- Check agent is running and shows v1.1.0+ in startup banner
- Check Claude Code is installed: `claude --version`
- Check `claude_log` table for `user_to_claude` entries without matching `claude_response`
- Check agent log file: `~/.commslink-agent.log`

### Response not appearing in chat
- The `/copy` command must work on the agent's machine (clipboard access required)
- On headless Linux servers, `xclip` or `xsel` must be installed
- Check `claude_log` for `claude_response` direction entries

### Garbled terminal output
- Ensure the web client has `@xterm/xterm` v6 installed
- The 300ms debounce buffer should absorb most thinking animation artifacts
- The terminal clears before each new message to prevent accumulation of stale renders

### "Machine not found or offline"
- Machine must be registered via `machine_register` event
- Machine must have `machine_permission` enabled for the room
- Room must have `cmd_claude_enabled` or `cmd_terminal_enabled` flag set

### Inactivity timer never fires
- Tiny cursor blink chunks (< 10 bytes) are filtered out
- If Claude is genuinely still working, the 3-minute absolute timeout will eventually trigger
- Check if Claude is stuck waiting for user input (1/2/3 prompt) — use quick-action buttons

### Disk full on EC2
- Docker build cache accumulates. Run `docker system prune -af && docker builder prune -af` to reclaim space.
