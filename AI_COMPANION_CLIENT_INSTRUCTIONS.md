# AI Companion System — Unity Client Instructions

## Overview

Recruits are AI companions that follow the player, fight, talk, and have personalities. The server runs the AI brain (Grok + behavior tree). The client renders them, animates them, shows speech bubbles, and sends player commands.

## 1. Companion Controller — `RecruitAI.cs`

Each recruit in the scene gets this component. It receives behavior commands from the server via the game-sync WebSocket and executes them visually.

### Server → Client Messages (via game-sync WebSocket)

#### `npc_update` — sent every 500ms per NPC
```json
{
  "type": "npc_update",
  "id": "character-uuid",
  "pos": [x, y, z],
  "rot": 90.5,
  "action": "walk",
  "target_pos": [tx, ty, tz],
  "hp": 80,
  "maxHp": 100,
  "stamina": 60,
  "mood": 0.6
}
```

The client should:
- Smoothly interpolate position toward `pos` (don't teleport)
- Set animation based on `action`: idle, walk, run, attack_light, attack_heavy, block, dodge, hit, dead
- Update floating HP bar
- Mood affects facial expression or particle effects (happy = subtle glow, fearful = shaking)

#### `npc_say` — NPC speaks
```json
{
  "type": "npc_say",
  "id": "character-uuid",
  "text": "*adjusts shield* These roads aren't safe, Commander.",
  "emotion": "cautious"
}
```

Display as a speech bubble above the NPC's head. Fade after 4-5 seconds. Emotion can tint the bubble color:
- `neutral` = white
- `happy` = light yellow
- `angry` = light red
- `fearful` = light blue
- `sarcastic` = light purple
- `flirty` = light pink
- `sad` = grey

#### `npc_combat_action` — NPC does a combat move
```json
{
  "type": "npc_combat_action",
  "id": "character-uuid",
  "action": "attack_heavy",
  "target_id": "enemy-uuid"
}
```

Play the attack animation facing the target. The server handles hit detection — don't duplicate it client-side.

#### `npc_died`
```json
{ "type": "npc_died", "id": "character-uuid", "killer": "enemy-uuid" }
```

Play death animation. Grey out the recruit in any UI panels.

#### `npc_respawned`
```json
{ "type": "npc_respawned", "id": "character-uuid", "pos": [x,y,z], "hp": 100 }
```

## 2. Companion Panel UI

### Recruit List (accessed from action bar or Tab menu)

Shows all the player's recruits with:
- Name and title (e.g., "Aldric the Bold")
- Type icon (peasant, knight, crossbow, etc.)
- HP bar
- Mood indicator (emoji or color dot)
- Current agenda text ("Following", "Guarding", "Resting", etc.)
- Click to open Recruit Detail panel

### Recruit Detail Panel

When clicking a recruit:
- **Stats**: STR, DEF, SPD, HP, Level, XP, Kills/Deaths
- **Personality**: Show trait bars (humor, obedience, bravery, curiosity, greed)
- **Disposition**: Show current mood, fear, loyalty, familiarity, attraction, warmth, respect
- **Current Agenda**: What they're doing right now
- **Instructions textarea**: Same as room agent instructions. Player types natural language instructions here. These get saved to the server via `PUT /api/v1/recruits/:id/instructions`
- **Chat**: A small chat panel where the player can talk directly to this recruit. Messages sent to `POST /api/v1/recruits/:id/chat`, response comes back from Grok in-character.
- **Dismiss button**: Red, with confirmation dialog

### Quick Commands (during gameplay)

When the player has recruits, show a command bar or radial menu (hold a key like Q):
- **Follow Me** — recruits follow player
- **Hold Position** — stay where you are
- **Attack Target** — recruits focus the player's current target
- **Defend Me** — recruits prioritize protecting the player
- **Fall Back** — recruits retreat toward player
- **Be Aggressive** — increase aggression weights
- **Be Defensive** — increase defense weights

These send to `POST /api/v1/recruits/command` with `{ command: "follow" }` etc. The server translates to behavior weight changes immediately (no Grok call needed for these — they're instant overrides).

## 3. Client → Server Messages

#### Player talks to recruit (chat)
```
POST /api/v1/recruits/:id/chat
{ "message": "Hey, what do you think of this place?" }
→ { "response": "*looks around nervously* Reminds me of the borderlands. Stay sharp, Commander.", "emotion": "cautious" }
```

#### Player updates recruit instructions
```
PUT /api/v1/recruits/:id/instructions
{ "instructions": "Focus on defense. Always try to circle left. Counter-attack after blocking. Protect me if I'm in danger." }
→ { "success": true }
```

#### Player issues quick command
```
POST /api/v1/recruits/command
{ "command": "follow", "recruit_ids": ["id1", "id2"] }
→ { "success": true }
```

Available commands: `follow`, `hold`, `attack_target`, `defend_me`, `fall_back`, `aggressive`, `defensive`

## 4. Spawning Recruits on Login

When the player enters the world:
1. Call `GET /api/v1/recruits` to get all living recruits
2. For each recruit, spawn a character model near the player
3. Model type based on `npc_type`:
   - `peasant_levy` → yellow soldier
   - `militia_swordsman` → grey soldier
   - `man_at_arms` → blue knight
   - `veteran_knight` → black knight
   - `elite_champion` → orange knight
   - `crossbowman` → green soldier
   - `shield_bearer` → white knight
4. Attach `RecruitAI` component
5. Attach floating name (green) + HP bar
6. The server starts sending `npc_update` messages for each recruit once they're registered

After spawning, send to game-sync WebSocket:
```json
{ "type": "register_npcs", "ids": ["recruit-id-1", "recruit-id-2"] }
```

This tells the server to start running the AI brain for these NPCs and sending updates.

## 5. Speech Bubble System

Create a `SpeechBubble` prefab:
- World-space canvas above character's head (offset Y +2.2 from feet)
- Background panel with rounded corners, tinted by emotion
- Text component (TextMeshPro, ~14pt)
- Fade in over 0.2s, hold for 4s, fade out over 0.5s
- Queue multiple messages if they come fast (show next after current fades)
- Billboard toward camera (always face the player)

## 6. Mood Visual Effects

Based on the `mood` value from `npc_update`:
- **mood > 0.7**: Subtle golden particle effect, upright posture
- **mood 0.3-0.7**: Normal, no effects
- **mood 0-0.3**: Slightly slouched idle animation blend, grey-ish tint
- **mood < 0**: Dark particle wisps, noticeably slower movement

Based on `fear`:
- **fear > 0.7**: Visible shaking (small random position offset), white face tint
- **fear 0.3-0.7**: Occasional nervous look-around animation
- **fear < 0.3**: Normal

## 7. File Summary

```
Assets/Scripts/NPC/RecruitAI.cs              — Main recruit controller, receives server commands
Assets/Scripts/NPC/RecruitSpawner.cs         — Spawns recruits on login from API data
Assets/Scripts/NPC/SpeechBubble.cs           — Speech bubble display + queue
Assets/Scripts/UI/RecruitListPanel.cs        — UI panel showing all recruits
Assets/Scripts/UI/RecruitDetailPanel.cs      — Detail view with stats, instructions, chat
Assets/Scripts/UI/QuickCommandMenu.cs        — Radial/bar menu for quick orders
Assets/Prefabs/NPC/SpeechBubble.prefab       — Speech bubble prefab
```
