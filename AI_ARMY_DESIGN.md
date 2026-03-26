# AI Army System — Full Grok-Powered Encounters

## Design

AI armies are identical to player armies — same DB tables, same Grok brain, same behavior tree. The only difference is the "commander" is a system account instead of a real player.

### System Commander Accounts

Create system user accounts that own AI armies:
- `ai-commander-1` through `ai-commander-N`
- Each has a `player_character` (the centurion) and recruits
- Their centurion has `ai_instructions` that define their army's fighting doctrine
- Their troops have real personality traits, memories, XP

### Battle Records

New table: `battle_record`
- Which two armies fought
- Who won
- Casualties on each side
- Duration
- Tactics observed (formations used, aggression levels, etc.)
- The winner's centurion gets XP and a victory memory
- The loser's centurion gets a defeat memory with what went wrong

### Self-Learning Loop

1. AI Army A fights AI Army B
2. A wins — A's centurion remembers "aggressive wedge formation worked against B's shield wall"
3. B loses — B's centurion remembers "shield wall wasn't enough, need to flank"
4. Next fight: B's Grok brain reads the memory and adjusts tactics
5. Over many fights, armies develop emergent strategies

### Encounter Spawning (Revised)

Instead of in-memory throwaway NPCs, spawn a real persistent army:

1. Create (or reuse) a system user account
2. Buy recruits for them (using system gold, or just create directly)
3. Full auto-assignment: centurion, decurions, sergeants, soldiers
4. Give the centurion doctrine instructions based on difficulty tier
5. Register all units in the NPC engine with full Grok brain cycles
6. The army persists — if you don't kill them all, they're still there next session
7. After battle: record results, update memories, adjust instructions

### Difficulty Through Doctrine, Not Stats

Instead of making harder enemies by buffing HP/strength, make them harder by giving their centurion better instructions:

- **Patrol**: "Hold position. Fight anyone who comes close."
- **Warband**: "Advance toward enemies. Protect the commander."
- **Company**: "Use shield wall. Advance slowly. Counter-attack after blocking."
- **Army**: "Send scouts ahead. Flank with maniple 2. Shield wall in front, archers behind."
- **Legion**: "Coordinate all maniples. Wedge formation to break enemy line. Reserve maniple for flanking. Protect the centurion at all costs."

The AI centurion interprets these instructions through Grok and distributes orders to decurions, who distribute to sergeants. The army fights as a thinking organism.

### Tournament Mode (Future)

- Queue up AI armies to fight each other overnight
- Track ELO ratings per army
- Top armies' doctrines get analyzed — what instructions produce winners?
- Players can study winning doctrines and train their own armies accordingly
- Leaderboard: best AI commanders ranked by win rate

## Implementation Plan

### Phase 1: System accounts + persistent AI armies
- Create system user accounts in DB
- Endpoint to spawn a full persistent AI army for a system account
- Army gets real recruits, ranks, personalities, Grok brains

### Phase 2: Battle tracking
- New `battle` table: armies, winner, casualties, duration
- Record results when all units on one side are dead
- Store tactical memories on surviving centurions

### Phase 3: Self-learning
- Centurion Grok prompt includes battle history memories
- After a loss, Grok adjusts doctrine for next fight
- Track improvement over time

### Phase 4: Tournaments
- Scheduled AI vs AI battles
- ELO rating system
- Leaderboard
