# Army Chat Wiring — Unity Client Instructions

## The Problem

The army chat panel currently sends messages through the global-game Socket.IO room chat. This means commands like "Squad A, hold position" go to the room chat, NOT to the army dispatcher. The server never receives them as army commands, so NPCs ignore them.

## The Fix

Route army chat messages through `POST /api/v1/army/chat` instead of the Socket.IO room chat.

## Flow

### Step 1: Player types a message in the army chat panel

### Step 2: POST to army chat API
```csharp
// In ArmyChatPanel.cs or wherever army messages are sent:
async void SendArmyMessage(string message)
{
    // Show the player's own message immediately in the chat panel
    AddMessage("You", message, Color.white);

    // POST to army chat dispatcher
    var response = await ApiPost("/api/v1/army/chat", new { message });

    // response contains:
    // {
    //   "responders": ["unit-id-1", "unit-id-2"],
    //   "listeners": ["unit-id-3", ...],
    //   "commands_issued": ["hold"]
    // }

    // Show thinking bubbles ONLY on responder units
    foreach (var id in response.responders)
    {
        var recruit = FindRecruitById(id);
        if (recruit != null) recruit.ShowThinkingBubble();
    }
}
```

### Step 3: Listen for responses on game-sync WebSocket

The actual AI responses arrive via the game-sync raw WebSocket (NOT Socket.IO):

```csharp
// In GameSyncClient.cs, add handler for army_chat_response:
case "army_chat_response":
    string unitId = msg["unit_id"];
    string unitName = msg["name"];
    string rank = msg["rank"];
    string unitGroupName = msg["unit_name"];
    string text = msg["text"];
    string emotion = msg["emotion"];

    // Show in army chat panel with rank-colored name
    ArmyChatPanel.AddMessage($"[{rank}] {unitName}", text, GetRankColor(rank));

    // Show speech bubble on the NPC in the world
    var recruit = FindRecruitById(unitId);
    if (recruit != null)
    {
        recruit.HideThinkingBubble();
        recruit.ShowSpeechBubble(text, emotion);
    }
    break;
```

### Step 4: Handle commands_issued

When the API returns `commands_issued`, those commands are ALREADY applied server-side. The client doesn't need to do anything extra — the NPC behavior will change on the next tick. But you can show a system message:

```csharp
foreach (var cmd in response.commands_issued)
{
    AddSystemMessage($"Command issued: {cmd}");
}
```

## What NOT to do

- Do NOT send army messages through `switch_room` / `chat_message` Socket.IO events
- Do NOT show thinking bubbles on ALL units — only the `responders` list
- Do NOT wait for responses in the HTTP response — they come async via WebSocket

## API Reference

### POST /api/v1/army/chat
```
Headers: Authorization: Bearer <JWT>
Body: { "message": "Squad A, hold position" }

Response (immediate, ~200ms):
{
  "responders": ["unit-uuid-1"],
  "listeners": ["unit-uuid-2", "unit-uuid-3", "unit-uuid-4"],
  "commands_issued": ["hold"]
}
```

### WebSocket message: army_chat_response
```json
{
  "type": "army_chat_response",
  "unit_id": "unit-uuid-1",
  "name": "Finn the Quick",
  "rank": "sergeant",
  "unit_name": "Iron Guard",
  "text": "Holding position, Commander. Squad A is locked down.",
  "emotion": "determined"
}
```

### Rank Colors
- Centurion: Gold (#FFD700)
- Decurion: Blue (#4488FF)
- Sergeant: Green (#44DD44)
- Soldier: Grey (#AAAAAA)
