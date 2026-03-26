# Army System — Unity Client Instructions

## Overview

Players command armies of up to 100 AI recruits organized into a Roman-style military hierarchy. The player communicates with their army through an army chat interface. A server-side dispatcher routes messages to the right units, and only the appropriate leaders respond.

## 1. Army Hierarchy

```
Player (Commander)
└── Centurion (1) — AI army commander, leads all 100 units
    ├── Maniple 1 "Iron Guard" (10) — led by a Decurion
    │   ├── Squad A (5) — led by a Sergeant
    │   └── Squad B (5) — led by a Sergeant
    ├── Maniple 2 "Wolf Pack" (10) — led by a Decurion
    │   ├── Squad A (5) — led by a Sergeant
    │   └── Squad B (5) — led by a Sergeant
    ... (up to 10 maniples)
```

### Ranks

| Rank | Title | Role | Grok Model | Think Interval |
|------|-------|------|------------|----------------|
| 4 | Centurion | Commands entire army (100) | grok-reasoning | 3-5s |
| 3 | Decurion | Commands 1 maniple (10), also leads own squad | grok-code | 5-10s |
| 2 | Sergeant | Commands 1 squad (5) | grok-code | 10-15s |
| 1 | Soldier | Follows orders, pure behavior tree | none | never |

- **Centurion**: 1 per army. The strategist. Most expensive recruit. Only NPC that uses full reasoning model.
- **Decurion**: 10 per army. Mid-level officers. They ARE Sergeants who also coordinate their maniple's other squad.
- **Sergeant**: 20 per army. Squad leaders. Relay orders to their 4 soldiers.
- **Soldier**: 80 per army. Never call Grok. Pure behavior tree with weights set by their Sergeant.

## 2. Army Chat UI

### Location
Add an "ARMY" tab to the existing chat panel (alongside Global/Party/Say). Or create a separate army command panel accessible from the action bar.

### Layout
- **Left side**: Chat messages (scrollable)
  - Player messages in white
  - Centurion responses in gold
  - Decurion responses in blue
  - Sergeant responses in green
  - Soldier responses in grey (rare — only when directly addressed)
- **Right side** (optional): Army overview minimap showing unit positions as colored dots
- **Bottom**: Text input for commands/conversation
- **Top**: Army status bar — total units alive, current formation, army morale

### Message Display Format
```
[You]: Decurions, report status
[Decurion Marcus the Grim — Maniple 1 "Iron Guard"]: All ten accounted for, Commander. No injuries. Ready to move.
[Decurion Aldric Ironside — Maniple 2 "Wolf Pack"]: Lost two in the last skirmish. Eight remaining. Morale is shaky.
```

Each message shows:
- Rank icon (star for Centurion, shield for Decurion, sword for Sergeant, helmet for Soldier)
- Name
- Unit assignment (Maniple name / Squad letter)
- Message text
- Emotion-colored text tint (same as speech bubble emotions)

### Addressing Units

The player can address units by:
- **Name**: "Bob, what's your status?"
- **Rank**: "Sergeants, tighten ranks" — all 20 Sergeants listen, most verbal one responds
- **Squad**: "Squad 3A, advance" — Sergeant of Squad 3A responds, squad soldiers execute
- **Maniple**: "Maniple 2, hold position" — Decurion of Maniple 2 responds, all 10 execute
- **Maniple name**: "Wolf Pack, flank left" — same as above but using the name
- **Army**: "Everyone, form up" — Centurion responds, all execute
- **Role**: "Centurion, what do you recommend?" — Centurion responds

### Quick Command Buttons

Below the chat input, show context-aware quick command buttons:
- When no unit selected: Army-wide commands
  - **Form Up** — all units rally to player
  - **Advance** — army moves forward
  - **Hold** — everyone stops
  - **Retreat** — fall back to player

- When a maniple/squad is selected (clicked in the army overview):
  - **Attack** — selected group engages nearest enemy
  - **Defend** — selected group holds position and blocks
  - **Flank Left** / **Flank Right** — selected group circles
  - **Protect Me** — selected group surrounds player

These send `POST /api/v1/army/command` (or the chat dispatcher handles them).

## 3. Army Overview Panel

A dedicated panel (toggleable, maybe bound to a key like 'O' for Overview):

### Army Tree View
```
▼ Centurion Theron the Bold          HP: 130/130  ⚔ 24 🛡 20
  ▼ Maniple 1 "Iron Guard" (10/10)   [Decurion: Marcus the Grim]
    ▼ Squad A (5/5)                   [Sgt: Finn the Quick]
      • Soldier: Baldric Redhelm       HP: 60/60
      • Soldier: Conrad the Steady     HP: 60/60
      • Soldier: Dunstan Oakheart      HP: 45/60
      • Soldier: Egbert Warborn        HP: 60/60
    ▼ Squad B (5/5)                   [Sgt: Gareth Stonewall]
      • Soldier: Hector Ironside       HP: 80/80
      • Soldier: Ivan the Silent       HP: 80/80
      • Soldier: Jarvis Battleborn     HP: 80/80
      • Soldier: Kendrick Hammerfall   HP: 80/80
  ▼ Maniple 2 "Wolf Pack" (8/10)     [Decurion: Aldric Ironside]
    ...
```

### Features
- Click any unit to see their detail panel (stats, personality, instructions, chat)
- Click a maniple/squad header to select the group for quick commands
- Dead units shown greyed out with skull icon
- Color-coded HP bars (green > 50%, yellow 25-50%, red < 25%)
- Current action shown as small icon (⚔ attacking, 🛡 blocking, 🏃 moving, 💀 dead)
- Drag units between squads to reorganize (sends API call to reassign)

## 4. Army Formation Display (In-World)

When the player has an army, show unit positions in the game world:

### Formation Markers
- Each unit has a colored circle/ring on the ground beneath them:
  - **Gold ring**: Centurion
  - **Blue ring**: Decurion
  - **Green ring**: Sergeant
  - **No ring**: Soldier (too many, would clutter)
- Maniple groups are connected by faint colored lines between members
- Selected group (from overview panel) gets highlighted rings

### Name Plates
- Officers (Centurion, Decurion, Sergeant) always show floating name + rank
- Soldiers only show name when hovered or selected
- All show HP bar when damaged

## 5. Recruit Purchase Flow (Updated)

When buying recruits from Commander Roderick, the shop UI should show:

### New Recruit Types
```
OFFICERS (Special — limited stock)
  Centurion (5000g) — Army commander, strategic AI, reasoning model

ENLISTED
  Peasant Levy (50g) — Rank: Soldier
  Militia Swordsman (150g) — Rank: Soldier
  Man-at-Arms (500g) — Rank: Soldier/Sergeant eligible
  Veteran Knight (2000g) — Rank: Sergeant/Decurion eligible
  Elite Champion (5000g) — Rank: Decurion eligible
  Crossbowman (400g) — Rank: Soldier
  Shield Bearer (600g) — Rank: Soldier
```

### Auto-Assignment
When a recruit is purchased:
1. Server creates the player_character with rank and personality
2. Server auto-assigns to the first available slot:
   - If no Centurion exists and buying one → assign as Centurion
   - If a squad needs a Sergeant → promote eligible recruit
   - Otherwise → assign as Soldier to the smallest squad
3. Client receives the recruit data + assignment info
4. Client spawns the model and adds to the army overview

## 6. Client → Server API

### Army Chat
```
POST /api/v1/army/chat
{ "message": "Bob, what's your status?" }
→ {
    "responses": [
      { "unit_id": "uuid", "name": "Bob the Bold", "rank": "sergeant", "unit": "Maniple 1, Squad A", "response": "All good here, Commander.", "emotion": "neutral" }
    ],
    "listeners_notified": 4,
    "commands_issued": []
  }
```

### Army Quick Command
```
POST /api/v1/army/command
{
  "command": "advance",
  "target": "maniple_1"  // or "all", "squad_2a", unit UUID
}
→ { "success": true, "affected": 10 }
```

### Get Army Structure
```
GET /api/v1/army
→ {
    "centurion": { "id": "uuid", "name": "...", "rank": "centurion", ... },
    "maniples": [
      {
        "id": 1,
        "name": "Iron Guard",
        "decurion": { "id": "uuid", "name": "...", ... },
        "squads": [
          {
            "id": "a",
            "sergeant": { "id": "uuid", "name": "...", ... },
            "soldiers": [ { "id": "uuid", "name": "...", ... }, ... ]
          }
        ]
      }
    ],
    "total": 100,
    "alive": 98
  }
```

### Reassign Unit
```
PUT /api/v1/army/reassign
{ "unit_id": "uuid", "target_maniple": 2, "target_squad": "b" }
→ { "success": true }
```

### Rename Maniple
```
PUT /api/v1/army/maniple/{id}/rename
{ "name": "Death's Head" }
→ { "success": true }
```

## 7. Server → Client WebSocket Messages (via game-sync)

### `army_chat_response`
```json
{
  "type": "army_chat_response",
  "responses": [
    {
      "unit_id": "uuid",
      "name": "Marcus the Grim",
      "rank": "decurion",
      "unit_name": "Iron Guard",
      "text": "Ten strong, Commander. Ready on your word.",
      "emotion": "determined"
    }
  ]
}
```

### `army_structure_update`
Sent when units die, are recruited, promoted, or reassigned:
```json
{
  "type": "army_structure_update",
  "maniple_id": 1,
  "squad_id": "a",
  "change": "unit_died",
  "unit_id": "uuid"
}
```

### `unit_promoted`
```json
{
  "type": "unit_promoted",
  "unit_id": "uuid",
  "new_rank": "sergeant",
  "assignment": "Maniple 1, Squad B"
}
```

## 8. File Summary

```
Assets/Scripts/UI/ArmyChatPanel.cs          — Army chat with rank-colored messages
Assets/Scripts/UI/ArmyOverviewPanel.cs      — Tree view of army structure
Assets/Scripts/UI/ArmyQuickCommands.cs      — Context-aware command buttons
Assets/Scripts/Army/ArmyManager.cs          — Manages local army state, syncs with server
Assets/Scripts/Army/FormationDisplay.cs     — In-world formation rings and lines
Assets/Scripts/Army/UnitNameplate.cs        — Rank-aware floating nameplates
```

## 9. Future Considerations

- **Battle mode**: When armies clash, the overview becomes a tactical map
- **Promotion system**: Units gain XP → eligible for promotion → player promotes via UI
- **Permadeath option**: Dead units are gone forever (hardcore mode)
- **Legacy**: Two high-attraction units can produce offspring with blended traits
- **War horns**: Audio cues when commander issues army-wide orders
- **Banners**: Each maniple has a visual banner in the world carried by a designated unit
