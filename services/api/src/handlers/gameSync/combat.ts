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

const ATTACK_RANGE = 2.5;
const LIGHT_DMG = 15;
const HEAVY_DMG = 30;
const LIGHT_STAMINA = 10;
const HEAVY_STAMINA = 25;
const DODGE_STAMINA = 20;
const BLOCK_REDUCTION = 0.8;
const DODGE_WINDOW = 500;
const DAMAGE_COOLDOWN = 300;
const CRITICAL_MULTIPLIER = 1.5;
const XP_PER_KILL = 50;

// ┌──────────────────────────────────────────┐
// │ Combat Resolution                        │
// └──────────────────────────────────────────┘

const resolveAttack = (attacker: PlayerSyncState, attackType: 'light' | 'heavy'): void => {
  const now = Date.now();
  const baseDmg = attackType === 'light' ? LIGHT_DMG : HEAVY_DMG;
  const damage = Math.round(baseDmg * (1 + (attacker.strength - 10) / 100));

  for (const [id, victim] of players) {
    if (id === attacker.userId || victim.isDead) continue;

    // Distance check
    const dx = attacker.pos[0] - victim.pos[0];
    const dz = attacker.pos[2] - victim.pos[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > ATTACK_RANGE) continue;

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
    }

    if (isCritical) hitType = 'critical';

    // Apply damage
    victim.hp = Math.max(0, victim.hp - finalDmg);
    victim.lastDamageTime = now;

    // Knockback
    const kb = (attackType === 'heavy' || isCritical) ? 2 : 1;
    const knockback = [toVictim[0] * kb, toVictim[1] * kb];

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

      // Respawn after 5 seconds
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
export { players, broadcast, broadcastAll, handleMessage, resolveAttack };
