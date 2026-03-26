// ┌──────────────────────────────────────────┐
// │ Server-Authoritative Combat Resolution   │
// └──────────────────────────────────────────┘

type Vec3 = { x: number; y: number; z: number };

type PlayerAction = 'idle' | 'walk' | 'run' | 'attack_light' | 'attack_heavy' | 'block' | 'dodge' | 'hit' | 'dead';

type PlayerState = {
  userId: string;
  characterId: string;
  username: string;
  socketId: string;
  position: Vec3;
  rotation: Vec3;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  strength: number;
  defense: number;
  speed: number;
  action: PlayerAction;
  actionTimestamp: number;
  lastDamageTime: number;
  lastMoveTime: number;
  isDead: boolean;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
};

type DamageResult = {
  attackerId: string;
  victimId: string;
  damage: number;
  victimHealthAfter: number;
  wasBlocked: boolean;
  wasKill: boolean;
};

// ── Combat Constants ──

const ATTACK_RANGE = 2.5;
const LIGHT_DAMAGE = 15;
const HEAVY_DAMAGE = 30;
const LIGHT_STAMINA = 10;
const HEAVY_STAMINA = 25;
const DODGE_STAMINA = 20;
const BLOCK_REDUCTION = 0.8;
const DODGE_WINDOW_MS = 500;
const DAMAGE_COOLDOWN_MS = 300;
const LIGHT_ATTACK_MS = 400;
const HEAVY_ATTACK_MS = 700;
const RESPAWN_DELAY_MS = 5000;
const STAMINA_REGEN_TICK_MS = 200;
const MAX_SPEED_PER_SEC = 15;
const BROADCAST_INTERVAL_MS = 100;
const XP_PER_KILL = 50;

/** Resolve an attack against all nearby players. Returns damage results for each hit. */
const resolveAttack = (
  attacker: PlayerState,
  attackType: 'light' | 'heavy',
  players: Map<string, PlayerState>,
): DamageResult[] => {
  const results: DamageResult[] = [];
  const baseDamage = attackType === 'light' ? LIGHT_DAMAGE : HEAVY_DAMAGE;

  // Scale with attacker's strength (+1% per point above 10)
  const strengthBonus = (attacker.strength - 10) / 100;
  const damage = Math.round(baseDamage * (1 + strengthBonus));
  const now = Date.now();

  for (const [id, victim] of players) {
    if (id === attacker.userId) continue;
    if (victim.isDead) continue;

    // Distance check
    const dx = attacker.position.x - victim.position.x;
    const dy = attacker.position.y - victim.position.y;
    const dz = attacker.position.z - victim.position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > ATTACK_RANGE) continue;

    // Facing check — attacker must be roughly facing victim
    const attackerYaw = attacker.rotation.y * Math.PI / 180;
    const attackerForward = { x: Math.sin(attackerYaw), z: Math.cos(attackerYaw) };

    const toVictim = { x: victim.position.x - attacker.position.x, z: victim.position.z - attacker.position.z };
    const toVictimLen = Math.sqrt(toVictim.x * toVictim.x + toVictim.z * toVictim.z);
    if (toVictimLen < 0.01) continue;
    toVictim.x /= toVictimLen;
    toVictim.z /= toVictimLen;

    const dot = attackerForward.x * toVictim.x + attackerForward.z * toVictim.z;
    if (dot < 0.5) continue;

    // Damage cooldown
    if (now - victim.lastDamageTime < DAMAGE_COOLDOWN_MS) continue;

    // Dodge i-frames
    if (victim.action === 'dodge' && (now - victim.actionTimestamp) < DODGE_WINDOW_MS) continue;

    // Block check
    let wasBlocked = false;
    let finalDamage = damage;

    if (victim.action === 'block') {
      const victimYaw = victim.rotation.y * Math.PI / 180;
      const victimForward = { x: Math.sin(victimYaw), z: Math.cos(victimYaw) };
      const toAttacker = { x: -toVictim.x, z: -toVictim.z };
      const blockDot = victimForward.x * toAttacker.x + victimForward.z * toAttacker.z;

      if (blockDot > 0.3) {
        wasBlocked = true;
        finalDamage = Math.round(damage * (1 - BLOCK_REDUCTION));
        const defenseReduction = victim.defense / 200;
        finalDamage = Math.round(finalDamage * (1 - defenseReduction));
      }
    }

    // Apply damage
    victim.health = Math.max(0, victim.health - finalDamage);
    victim.lastDamageTime = now;
    victim.action = 'hit';
    victim.actionTimestamp = now;

    const wasKill = victim.health <= 0;
    if (wasKill) {
      victim.isDead = true;
      victim.action = 'dead';
    }

    results.push({
      attackerId: attacker.userId,
      victimId: victim.userId,
      damage: finalDamage,
      victimHealthAfter: victim.health,
      wasBlocked,
      wasKill,
    });
  }

  return results;
};

export type { PlayerState, PlayerAction, DamageResult, Vec3 };
export {
  resolveAttack,
  ATTACK_RANGE, LIGHT_DAMAGE, HEAVY_DAMAGE, LIGHT_STAMINA, HEAVY_STAMINA, DODGE_STAMINA,
  BLOCK_REDUCTION, DODGE_WINDOW_MS, DAMAGE_COOLDOWN_MS, LIGHT_ATTACK_MS, HEAVY_ATTACK_MS,
  RESPAWN_DELAY_MS, STAMINA_REGEN_TICK_MS, MAX_SPEED_PER_SEC, BROADCAST_INTERVAL_MS, XP_PER_KILL,
};
