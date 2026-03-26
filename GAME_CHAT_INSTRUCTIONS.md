# Game Chat — CommsLink Instructions

## Context

The Unity game client needs to connect to the existing CommsLink chat system for in-game global chat. The chat system already works — we just need a permanent "global-game" room that all game clients auto-join.

## What's Needed

### 1. Create a permanent "global-game" room

Either via seed script or manually in DB:
- `name`: "global-game"
- `display_name`: "Global Chat"
- `is_permanent`: true
- `memory_enabled`: false
- All cmd_* flags: false (no AI agents, no terminal, no claude, just plain chat)

### 2. Auto-join game players to this room

When a game client connects via Socket.IO (the default `/` namespace, NOT the `/game` namespace), after authentication:
- Auto-add the user as a member of "global-game" room if not already
- Auto-switch them to "global-game" room

The existing `join_room` / `switch_room` events should handle this. The Unity client will:
1. Connect to `wss://commslink.net/socket.io/?EIO=4&transport=websocket`
2. Authenticate with token
3. Emit `switch_room` with `{ roomName: "global-game" }`
4. Listen for `chat_message` events
5. Emit `chat_message` with `{ text: "message" }` to send

### 3. No code changes needed IF

The existing chat handler already:
- Authenticates via JWT middleware on the default namespace
- Handles `switch_room` to join a room
- Handles `chat_message` to send messages
- Broadcasts `chat_message` to all users in the room

So the ONLY thing needed is:
1. Create the "global-game" room in the database (permanent)
2. Ensure the auth middleware on the default `/` namespace works the same as the `/game` namespace (it should — it's the existing chat system)

### 4. Create the room

Run this SQL or create via API:
```sql
INSERT INTO room (id, name, display_name, is_permanent, memory_enabled,
  cmd_recall_enabled, cmd_sql_enabled, cmd_memory_enabled, cmd_selfmod_enabled,
  cmd_autopilot_enabled, cmd_mentions_enabled, cmd_terminal_enabled, cmd_claude_enabled,
  cmd_tokens_enabled, cmd_moderation_enabled, cmd_think_enabled, cmd_effort_enabled,
  cmd_audit_enabled, cmd_continue_enabled, cmd_agent_mgmt_enabled,
  cmd_intent_coherence_enabled, cmd_memory_coherence_enabled)
VALUES (UUID(), 'global-game', 'Global Chat', true, false,
  false, false, false, false, false, false, false, false,
  false, false, false, false, false, false, false, false, false);
```

Or via the existing room creation API if one exists.

### 5. That's it

The existing CommsLink chat infrastructure handles everything else:
- Message persistence to DB
- Broadcasting to all connected users in the room
- Username display
- Message history

The Unity client will handle:
- Connecting to the default namespace
- Joining the room
- Displaying messages
- Sending messages
