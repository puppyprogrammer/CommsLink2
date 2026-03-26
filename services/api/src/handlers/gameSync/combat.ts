import { WebSocket } from 'ws';
import Data from '../../../../../core/data';
import addXPAction from '../../../../../core/actions/character/addXPAction';

// ┌──────────────────────────────────────────┐
// │ Game Sync — Types & State                │
// └──────────────────────────────────────────┘

type PlayerSyncState = {
  userId: string;
  characterId: string;
  username: string;
  ws: WebSocket;
  pos: [number, number, number];
  rot: number;
  action: string;
  actionStartTime: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  strength: number;
  defense: number;
  lastDamageTime: number;
  isDead: boolean;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  weaponRange: number;   // Attack reach in meters: fists=1, sword=2.5, halberd=3.5
  weaponName: string;    // For client rendering
};

const players = new Map<string, PlayerSyncState>();

// ┌──────────────────────────────────────────┐
// │ Broadcast Helpers                        │
// └──────────────────────────────────────────┘

const broadcast = (excludeUserId: string, msg: object): void => {
  const json = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== excludeUserId && p.ws?.readyState === WebSocket.OPEN) {
      p.ws.send(json);
    }
  }
};

const broadcastAll = (msg: object): void => {
  const json = JSON.stringify(msg);
  for (const [, p] of players) {
    if (p.ws?.readyState === WebSocket.OPEN) {
      p.ws.send(json);
    }
  }
};

// ┌──────────────────────────────────────────┐
// │ Combat Constants                         │
// └──────────────────────────────────────────┘

const FIST_RANGE = 1.0;
const DEFAULT_ATTACK_RANGE = 2.5;

// Weapon range lookup by item name — server-authoritative, no client input
const WEAPON_RANGES: Record<string, number> = {
  'Iron Broadsword': 2.5,
  'Steel Rapier': 2.0,
  'War Halberd': 3.5,
  'Zweihander': 3.0,
};
const LIGHT_DMG = 5;
const HEAVY_DMG = 12;
const LIGHT_STAMINA = 10;      // 10% of max stamina per swing
const HEAVY_STAMINA = 20;      // 20% per heavy
const DODGE_STAMINA = 15;
const BLOCK_STAMINA_COST = 5;  // 5% stamina to absorb a hit
const BLOCK_REDUCTION = 0.95;  // Blocks absorb 95% — shields are king
const DODGE_WINDOW = 500;
const DAMAGE_COOLDOWN = 800;   // Slower pace — hits land every ~1s minimum
const CRITICAL_MULTIPLIER = 2.0; // Flanking is devastating — the ONLY way to break a shield wall
const XP_PER_KILL = 50;

/** Look up weapon range from DB for a character. Call once at spawn, cache on PlayerSyncState. */
const loadWeaponRange = async (characterId: string): Promise<{ range: number; name: string }> => {
  try {
    const equipped = await Data.inventoryItem.findEquipped(characterId);
    const weapon = equipped.find((e) => e.equip_slot === 'main_hand');
    if (weapon && weapon.item_def) {
      const name = (weapon.item_def as { name: string }).name;
      return { range: WEAPON_RANGES[name] || DEFAULT_ATTACK_RANGE, name };
    }
  } catch { /* ignore */ }
  return { range: FIST_RANGE, name: 'Fists' };
};

// ┌──────────────────────────────────────────┐
// │ Combat Resolution                        │
// └──────────────────────────────────────────┘

const resolveAttack = (attacker: PlayerSyncState, attackType: 'light' | 'heavy'): void => {
  const now = Date.now();
  const baseDmg = attackType === 'light' ? LIGHT_DMG : HEAVY_DMG;
  const damage = Math.round(baseDmg * (1 + (attacker.strength - 10) / 100));

  for (const [id, victim] of players) {
    if (id === attacker.userId || victim.isDead) continue;

    // Distance check — uses attacker's weapon range
    const dx = attacker.pos[0] - victim.pos[0];
    const dz = attacker.pos[2] - victim.pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > (attacker.weaponRange || FIST_RANGE)) continue;

    // Facing check
    const attackerRad = attacker.rot * Math.PI / 180;
    const attackerFwd = [Math.sin(attackerRad), Math.cos(attackerRad)];
    const toVictim = [victim.pos[0] - attacker.pos[0], victim.pos[2] - attacker.pos[2]];
    const len = Math.sqrt(toVictim[0] ** 2 + toVictim[1] ** 2);
    if (len < 0.01) continue;
    toVictim[0] /= len;
    toVictim[1] /= len;
    const dot = attackerFwd[0] * toVictim[0] + attackerFwd[1] * toVictim[1];
    if (dot < 0.5) continue;

    // Damage cooldown
    if (now - victim.lastDamageTime < DAMAGE_COOLDOWN) continue;

    // Dodge check
    if (victim.action === 'dodge' && (now - victim.actionStartTime) < DODGE_WINDOW) continue;

    // Critical check — hit from behind
    const victimRad = victim.rot * Math.PI / 180;
    const victimFwd = [Math.sin(victimRad), Math.cos(victimRad)];
    const toAttacker = [-toVictim[0], -toVictim[1]];
    const victimDot = victimFwd[0] * toAttacker[0] + victimFwd[1] * toAttacker[1];
    const isCritical = victimDot < -0.3;

    // Block check
    let hitType = attackType === 'heavy' ? 'heavy' : 'light';
    let finalDmg = isCritical ? Math.round(damage * CRITICAL_MULTIPLIER) : damage;

    if (!isCritical && victim.action === 'block' && victimDot > 0.3) {
      hitType = 'blocked';
      finalDmg = Math.round(finalDmg * (1 - BLOCK_REDUCTION));
      const defReduction = victim.defense / 200;
      finalDmg = Math.round(finalDmg * (1 - defReduction));
      // Blocking costs stamina — exhaustion breaks the shield wall
      victim.stamina = Math.max(0, victim.stamina - BLOCK_STAMINA_COST);
      // If stamina is 0, block fails — can't hold the shield up
      if (victim.stamina <= 0) {
        hitType = 'heavy'; // Shield dropped — full damage
        finalDmg = isCritical ? Math.round(damage * CRITICAL_MULTIPLIER) : damage;
      }
    }

    if (isCritical) hitType = 'critical';

    // Apply damage
    victim.hp = Math.max(0, victim.hp - finalDmg);
    victim.lastDamageTime = now;

    // Knockback
    const kb = (attackType === 'heavy' || isCritical) ? 2 : 1;
    const knockback = [toVictim[0] * kb, toVictim[1] * kb];

    console.log(`[Combat] ${attacker.username} → ${victim.username}: ${finalDmg} dmg (${hitType}), HP: ${victim.hp}/${victim.maxHp}`);

    broadcastAll({
      type: 'damage',
      attacker: attacker.userId,
      victim: id,
      damage: finalDmg,
      hitType,
      knockback,
      victimHp: victim.hp,
      victimMaxHp: victim.maxHp,
    });

    // Death
    if (victim.hp <= 0) {
      victim.isDead = true;
      victim.action = 'dead';
      broadcastAll({ type: 'player_died', id, killer: attacker.userId });

      // DB updates (fire and forget)
      Data.playerCharacter.recordKill(attacker.characterId).catch(() => {});
      Data.playerCharacter.recordDeath(victim.characterId).catch(() => {});
      addXPAction(attacker.characterId, XP_PER_KILL).catch(() => {});

      // Log death to both armies' speech logs so NPCs have context
      const npcEngine = require('./ai/npcEngine') as {
        activeNPCs: Map<string, { commanderUserId: string; name: string; situationLog: string[]; fear: number; mood: number }>;
        armySpeechLog: Map<string, { name: string; text: string; time: number }[]>;
      };
      const victimBrain = npcEngine.activeNPCs.get(id);
      const attackerBrain = npcEngine.activeNPCs.get(attacker.userId);

      // Notify attacker's army: "We killed [victim]!"
      const attackerArmy = attackerBrain?.commanderUserId || attacker.userId;
      if (!npcEngine.armySpeechLog.has(attackerArmy)) npcEngine.armySpeechLog.set(attackerArmy, []);
      npcEngine.armySpeechLog.get(attackerArmy)!.push({
        name: '[Battle]',
        text: `${attacker.username} killed enemy ${victim.username}!`,
        time: Date.now(),
      });

      // Notify victim's army: "We lost [victim]!"
      const victimArmy = victimBrain?.commanderUserId || id;
      if (victimArmy !== attackerArmy) {
        if (!npcEngine.armySpeechLog.has(victimArmy)) npcEngine.armySpeechLog.set(victimArmy, []);
        npcEngine.armySpeechLog.get(victimArmy)!.push({
          name: '[Battle]',
          text: `${victim.username} has fallen to ${attacker.username}!`,
          time: Date.now(),
        });
      }

      // Add death to nearby allies' personal situation logs (for Grok emotional reaction)
      for (const [npcId, brain] of npcEngine.activeNPCs) {
        if (npcId === id) continue; // Skip the dead one
        const isAlly = brain.commanderUserId === (victimBrain?.commanderUserId || '');
        const isAttackerAlly = brain.commanderUserId === (attackerBrain?.commanderUserId || attacker.userId);
        if (isAlly) {
          brain.situationLog.push(`[Death] Our ally ${victim.username} was killed by ${attacker.username}`);
          // Increase fear for allies
          brain.fear = Math.min(100, brain.fear + 10);
        } else if (isAttackerAlly) {
          brain.situationLog.push(`[Kill] Our side killed enemy ${victim.username}`);
          // Boost morale for attacker's allies
          brain.mood = Math.min(100, brain.mood + 5);
        }
        if (brain.situationLog.length > 20) brain.situationLog.shift();
      }

      if (victimBrain) {
        // NPC permanent death — remove from engine after death animation, then delete from DB
        setTimeout(() => {
          npcEngine.activeNPCs.delete(id);
          players.delete(id);
          broadcastAll({ type: 'player_left', id });

          // Delete from DB (permanent death — gone forever)
          Data.playerCharacter.deleteRecruit(victim.characterId)
            .then(() => Data.playerCharacter.fillLeadershipGaps(victimBrain.commanderUserId))
            .then(() => {
              const { rebuildChainOfCommand } = require('./ai/npcEngine');
              return rebuildChainOfCommand(victimBrain.commanderUserId);
            })
            .catch(() => {});
          console.log(`[Combat] NPC ${victimBrain.name} permanently killed — removed from army`);
        }, 5000);
      } else {
        // Real player — respawn after 5 seconds
        setTimeout(() => {
          if (!players.has(id)) return;
          victim.isDead = false;
          victim.hp = victim.maxHp;
          victim.stamina = victim.maxStamina;
          victim.action = 'idle';
          victim.pos = [victim.spawnX, victim.spawnY, victim.spawnZ];
          broadcastAll({ type: 'player_respawned', id, pos: victim.pos, hp: victim.hp });
        }, 5000);
      }
    }
  }
};

// ┌──────────────────────────────────────────┐
// │ Message Handler                          │
// └──────────────────────────────────────────┘

const handleMessage = (userId: string, msg: { type: string; [key: string]: unknown }): void => {
  const player = players.get(userId);
  if (!player || player.isDead) return;

  switch (msg.type) {
    case 'update': {
      if (Array.isArray(msg.pos) && msg.pos.length === 3) {
        player.pos = msg.pos as [number, number, number];
      }
      if (typeof msg.rot === 'number') player.rot = msg.rot;
      if (msg.action === 'idle' || msg.action === 'walk' || msg.action === 'run') {
        player.action = msg.action;
      }
      broadcast(userId, {
        type: 'player_update',
        id: userId,
        pos: player.pos,
        rot: player.rot,
        action: player.action,
      });

      // Trampling check (throttled — only when walking/running)
      if (msg.action === 'walk' || msg.action === 'run') {
        const { checkTrampling } = require('./vegetation');
        checkTrampling(player.pos[0], player.pos[2]).catch(() => {});
      }
      break;
    }

    case 'attack': {
      const attackType = msg.attackType === 'heavy' ? 'heavy' as const : 'light' as const;
      const staminaCost = attackType === 'heavy' ? HEAVY_STAMINA : LIGHT_STAMINA;
      if (player.stamina < staminaCost) return;
      player.stamina -= staminaCost;
      player.action = attackType === 'heavy' ? 'attack_heavy' : 'attack_light';
      player.actionStartTime = Date.now();
      broadcast(userId, { type: 'player_action', id: userId, action: player.action });
      resolveAttack(player, attackType);
      break;
    }

    case 'block_start':
      player.action = 'block';
      player.actionStartTime = Date.now();
      broadcast(userId, { type: 'player_action', id: userId, action: 'block' });
      break;

    case 'block_end':
      player.action = 'idle';
      broadcast(userId, { type: 'player_action', id: userId, action: 'idle' });
      break;

    case 'dodge': {
      if (player.stamina < DODGE_STAMINA) return;
      player.stamina -= DODGE_STAMINA;
      player.action = 'dodge';
      player.actionStartTime = Date.now();
      broadcast(userId, { type: 'player_action', id: userId, action: 'dodge' });
      setTimeout(() => {
        if (player.action === 'dodge') player.action = 'idle';
      }, DODGE_WINDOW);
      break;
    }
  }
};

export type { PlayerSyncState };
export { players, broadcast, broadcastAll, handleMessage, resolveAttack, loadWeaponRange, WEAPON_RANGES, FIST_RANGE };
