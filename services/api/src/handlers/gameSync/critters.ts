// ┌──────────────────────────────────────────┐
// │ Critter System — Event-Driven Wildlife  │
// │ Animals are mostly still. They move when │
// │ something happens: food runs out, threat │
// │ appears, hunger builds, mating.          │
// └──────────────────────────────────────────┘

import prisma from '../../../../../core/adapters/prisma';
import { broadcastNearby } from './vegetation';
import { players, broadcastAll } from './combat';
import { activeNPCs, npcStates } from './ai/npcEngine';
import { WebSocket } from 'ws';

// ── Species Config ──

type SpeciesConfig = {
  walkSpeed: number;
  runSpeed: number;
  fleeRange: number;        // Flee if threat within this range (0 = no fleeing, predator)
  fleesFrom: string[];      // Species that scare this critter
  eats: string[];           // Vegetation types (herbivore)
  hunts: string[];          // Critter species it hunts (predator)
  attackDamage: number;     // Damage per attack on prey
  attackRange: number;      // Distance to attack prey
  eatDamage: number;        // Damage per eat (vegetation)
  hungerRestore: number;    // Hunger reduced per eat/kill
  hungerPerMinute: number;
  searchRadius: number;
  matureAgeMinutes: number;
  breedCooldownMinutes: number;
  breedHungerMax: number;
  maxHealth: number;
};

const SPECIES: Record<string, SpeciesConfig> = {
  chicken: {
    walkSpeed: 0.8, runSpeed: 2.5, fleeRange: 8,
    fleesFrom: ['fox', 'bear'], hunts: [],
    eats: ['grass', 'bush'], eatDamage: 10, attackDamage: 0, attackRange: 0,
    hungerRestore: 30, hungerPerMinute: 3, searchRadius: 20,
    matureAgeMinutes: 5, breedCooldownMinutes: 10, breedHungerMax: 40,
    maxHealth: 30,
  },
  deer: {
    walkSpeed: 1.2, runSpeed: 4.0, fleeRange: 15,
    fleesFrom: ['bear'], hunts: [],
    eats: ['grass', 'bush'], eatDamage: 15, attackDamage: 0, attackRange: 0,
    hungerRestore: 40, hungerPerMinute: 2, searchRadius: 40,
    matureAgeMinutes: 8, breedCooldownMinutes: 15, breedHungerMax: 30,
    maxHealth: 80,
  },
  fox: {
    walkSpeed: 1.5, runSpeed: 4.5, fleeRange: 12,
    fleesFrom: ['bear'], hunts: ['chicken'],
    eats: [], eatDamage: 0, attackDamage: 15, attackRange: 2.0,
    hungerRestore: 50, hungerPerMinute: 2, searchRadius: 30,
    matureAgeMinutes: 8, breedCooldownMinutes: 20, breedHungerMax: 35,
    maxHealth: 60,
  },
  bear: {
    walkSpeed: 1.0, runSpeed: 3.5, fleeRange: 0, // Bears don't flee
    fleesFrom: [], hunts: ['deer', 'fox', 'chicken'],
    eats: ['bush'], eatDamage: 20, attackDamage: 40, attackRange: 2.5,
    hungerRestore: 15, hungerPerMinute: 2, searchRadius: 50, // Low veg restore (15) forces hunting, kill gives 60
    matureAgeMinutes: 15, breedCooldownMinutes: 30, breedHungerMax: 30,
    maxHealth: 200,
  },
};

// ── Critter State ──

type BehaviorState = 'idle' | 'eating' | 'walking_to_food' | 'fleeing' | 'walking_to_mate' | 'mating' | 'searching' | 'stalking' | 'chasing' | 'attacking' | 'eating_kill';

type CritterState = {
  id: number;
  species: string;
  x: number; y: number; z: number; rot: number;
  health: number;
  hunger: number;
  isAlive: boolean;
  gender: string;
  parentId: number | null;
  bornAt: number;          // timestamp
  lastAte: number;         // timestamp
  lastBred: number;        // timestamp
  // Behavior
  behavior: BehaviorState;
  targetX: number | null;  // Where they're walking to
  targetZ: number | null;
  foodTargetId: number | null; // Vegetation ID they're eating
  mateId: number | null;       // Critter ID they're approaching to mate
  matingStarted: number | null; // Timestamp when mating contact began
  preyId: number | null;       // Critter ID they're hunting
  killStarted: number | null;  // Timestamp when eating a kill
  lastBroadcast: number;   // timestamp of last position broadcast
  // Genes (0.0-2.0, 1.0 = species default)
  geneBoldness: number;
  geneSpeed: number;
  geneSocial: number;
  geneHungerTolerance: number;
  geneCuriosity: number;
};

const critters = new Map<number, CritterState>();

// ── Helpers ──

const dist2d = (x1: number, z1: number, x2: number, z2: number): number =>
  Math.sqrt((x1 - x2) ** 2 + (z1 - z2) ** 2);

/** Find nearest threat (player, NPC, or predator critter) within range. */
const findNearestThreat = (x: number, z: number, fleeRange: number, fleesFrom: string[]): { dx: number; dz: number; dist: number } | null => {
  let nearest: { dx: number; dz: number; dist: number } | null = null;
  // Check players and NPCs
  for (const [, p] of players) {
    if (p.isDead) continue;
    const d = dist2d(x, z, p.pos[0], p.pos[2]);
    if (d < fleeRange && (!nearest || d < nearest.dist)) {
      nearest = { dx: x - p.pos[0], dz: z - p.pos[2], dist: d };
    }
  }
  // Check predator critters
  if (fleesFrom.length > 0) {
    for (const [, other] of critters) {
      if (!other.isAlive || !fleesFrom.includes(other.species)) continue;
      const d = dist2d(x, z, other.x, other.z);
      if (d < fleeRange && (!nearest || d < nearest.dist)) {
        nearest = { dx: x - other.x, dz: z - other.z, dist: d };
      }
    }
  }
  return nearest;
};

/** Inherit a gene from two parents with mutation. */
const inheritGene = (mom: number, dad: number): number => {
  const avg = (mom + dad) / 2;
  const mutation = (Math.random() - 0.5) * 0.2; // ±10% mutation
  return Math.max(0.1, Math.min(2.0, avg + mutation)); // Clamp 0.1-2.0
};

/** Generate random genes for a seeded (parentless) critter. */
const randomGenes = () => ({
  geneBoldness: 0.8 + Math.random() * 0.4,     // 0.8-1.2
  geneSpeed: 0.8 + Math.random() * 0.4,
  geneSocial: 0.8 + Math.random() * 0.4,
  geneHungerTolerance: 0.8 + Math.random() * 0.4,
  geneCuriosity: 0.8 + Math.random() * 0.4,
});

/** Log a life event for a critter. */
const logLife = (critterId: number, event: string, detail?: string): void => {
  prisma.world_critter_log.create({ data: { critter_id: critterId, event, detail } }).catch(() => {});
};

/** Get age in minutes (for client scaling: baby → adult). */
const getAgeMinutes = (c: CritterState): number => Math.round((Date.now() - c.bornAt) / 60000);

/** Get maturity 0.0-1.0 (0 = newborn, 1 = fully mature). */
const getMaturity = (c: CritterState): number => {
  const config = SPECIES[c.species];
  if (!config) return 1;
  return Math.min(1, getAgeMinutes(c) / config.matureAgeMinutes);
};

/** Find mother (critter with id = parentId). */
const findMother = (c: CritterState): CritterState | null => {
  if (!c.parentId) return null;
  const mom = critters.get(c.parentId);
  return mom?.isAlive ? mom : null;
};

/** Find family members: parent, siblings, offspring. */
const findFamily = (c: CritterState): CritterState[] => {
  const family: CritterState[] = [];
  for (const [, other] of critters) {
    if (other.id === c.id || !other.isAlive || other.species !== c.species) continue;
    // Parent
    if (other.id === c.parentId) { family.push(other); continue; }
    // Sibling (same parent)
    if (c.parentId && other.parentId === c.parentId) { family.push(other); continue; }
    // Offspring
    if (other.parentId === c.id) { family.push(other); continue; }
  }
  return family;
};

/** Get family centroid position. */
const getFamilyCentroid = (c: CritterState): { x: number; z: number } | null => {
  const family = findFamily(c);
  if (family.length === 0) return null;
  let sx = c.x, sz = c.z;
  for (const f of family) { sx += f.x; sz += f.z; }
  return { x: sx / (family.length + 1), z: sz / (family.length + 1) };
};

/** Broadcast a critter movement event to nearby players. */
const broadcastCritterMove = (c: CritterState, action: string): void => {
  broadcastNearby(c.x, c.z, 200, {
    type: 'critter_move',
    id: c.id,
    x: c.x, y: c.y, z: c.z,
    targetX: c.targetX, targetZ: c.targetZ,
    rot: c.rot,
    action,
    speed: (action === 'run' ? SPECIES[c.species]?.runSpeed || 2 : SPECIES[c.species]?.walkSpeed || 0.8) * c.geneSpeed,
    age: getAgeMinutes(c),
    maturity: getMaturity(c),
  });
  c.lastBroadcast = Date.now();
};

/** Broadcast critter stopped / changed state. */
const broadcastCritterState = (c: CritterState, action: string): void => {
  broadcastNearby(c.x, c.z, 200, {
    type: 'critter_state',
    id: c.id,
    x: c.x, y: c.y, z: c.z,
    rot: c.rot,
    action,
    age: getAgeMinutes(c),
    maturity: getMaturity(c),
  });
  c.lastBroadcast = Date.now();
};

// ── Movement (runs frequently but only for moving critters) ──

const movementTick = (): void => {
  for (const [, c] of critters) {
    if (!c.isAlive) continue;

    // Predators chasing: continuously update target to prey's current position
    if (c.behavior === 'chasing' && c.preyId) {
      const prey = critters.get(c.preyId);
      if (prey && prey.isAlive) {
        c.targetX = prey.x;
        c.targetZ = prey.z;
      } else {
        c.preyId = null;
        c.targetX = null;
        c.targetZ = null;
        c.behavior = 'idle';
        broadcastCritterState(c, 'idle');
        continue;
      }
    }

    if (c.targetX === null || c.targetZ === null) continue;

    const config = SPECIES[c.species];
    if (!config) continue;

    const dx = c.targetX - c.x;
    const dz = c.targetZ - c.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // gene_speed modifies movement speed
    const speed = (c.behavior === 'fleeing' ? config.runSpeed : config.walkSpeed) * c.geneSpeed;
    const step = Math.min(speed * 0.2, dist); // 200ms tick = 0.2s

    if (dist < 0.5) {
      // Arrived at target
      c.x = c.targetX;
      c.z = c.targetZ;
      c.targetX = null;
      c.targetZ = null;

      if (c.behavior === 'walking_to_food') {
        c.behavior = 'eating';
        broadcastCritterState(c, 'eat');
      } else if (c.behavior === 'fleeing') {
        c.behavior = 'idle';
        broadcastCritterState(c, 'idle');
      } else if (c.behavior === 'searching') {
        c.behavior = 'idle';
        broadcastCritterState(c, 'idle');
      } else if ((c.behavior === 'stalking' || c.behavior === 'chasing') && c.preyId) {
        // Arrived at prey — attack!
        const prey = critters.get(c.preyId);
        const config = SPECIES[c.species];
        if (prey && prey.isAlive && config) {
          c.behavior = 'attacking';
          c.rot = Math.atan2(prey.x - c.x, prey.z - c.z) * 180 / Math.PI;
          broadcastCritterState(c, 'attack');

          // Deal damage
          prey.health -= config.attackDamage;
          if (prey.health <= 0) {
            prey.health = 0;
            prey.isAlive = false;
            prey.behavior = 'idle';
            broadcastNearby(prey.x, prey.z, 200, { type: 'critter_died', id: prey.id, species: prey.species, cause: 'killed', killerId: c.id, killerSpecies: c.species });
            prisma.world_critter.update({ where: { id: prey.id }, data: { is_alive: false, health: 0 } }).catch(() => {});
            logLife(c.id, 'hunted', `Killed ${prey.species} #${prey.id}`);
            logLife(prey.id, 'killed', `Killed by ${c.species} #${c.id}`);
            console.log(`[Critters] ${c.species} #${c.id} killed ${prey.species} #${prey.id}`);

            // Eat the kill
            c.hunger = Math.max(0, c.hunger - config.hungerRestore);
            c.lastAte = Date.now();
            c.behavior = 'eating_kill';
            c.killStarted = Date.now();
            broadcastCritterState(c, 'eat');
            critters.delete(prey.id);
          } else {
            // Prey survived — it will flee on next behavior tick
            broadcastNearby(prey.x, prey.z, 200, { type: 'critter_hit', id: prey.id, health: prey.health, attackerId: c.id });
            c.behavior = 'chasing'; // Keep chasing
            c.targetX = prey.x;
            c.targetZ = prey.z;
          }
        } else {
          c.preyId = null;
          c.behavior = 'idle';
          broadcastCritterState(c, 'idle');
        }
      } else if (c.behavior === 'walking_to_mate' && c.mateId) {
        // Arrived at mate — face each other and start mating
        const mate = critters.get(c.mateId);
        if (mate && mate.isAlive) {
          // Face toward mate
          const mdx = mate.x - c.x;
          const mdz = mate.z - c.z;
          c.rot = Math.atan2(mdx, mdz) * 180 / Math.PI;
          // Make mate face toward us
          mate.rot = Math.atan2(-mdx, -mdz) * 180 / Math.PI;
          mate.behavior = 'mating';
          mate.targetX = null;
          mate.targetZ = null;
          broadcastCritterState(mate, 'mate');
        }
        c.behavior = 'mating';
        c.matingStarted = Date.now();
        broadcastCritterState(c, 'mate');
      } else {
        c.behavior = 'idle';
        broadcastCritterState(c, 'idle');
      }
    } else {
      c.x += (dx / dist) * step;
      c.z += (dz / dist) * step;
      c.rot = Math.atan2(dx, dz) * 180 / Math.PI;
    }
  }
};

// ── Behavior (runs less frequently — decisions, not movement) ──

const behaviorTick = async (): Promise<void> => {
  const now = Date.now();

  for (const [id, c] of critters) {
    if (!c.isAlive) continue;
    const config = SPECIES[c.species];
    if (!config) continue;

    // ── 1. Threat check (highest priority, every tick) ──
    // gene_boldness: high=shorter flee range (braver), low=longer flee range (more cautious)
    const effectiveFleeRange = config.fleeRange * (2.0 - c.geneBoldness);
    const threat = config.fleeRange > 0 ? findNearestThreat(c.x, c.z, effectiveFleeRange, config.fleesFrom) : null;
    if (threat && c.behavior !== 'fleeing') {
      // Flee! Pick a point away from threat
      const len = Math.sqrt(threat.dx ** 2 + threat.dz ** 2) || 1;
      c.targetX = c.x + (threat.dx / len) * (effectiveFleeRange + 5);
      c.targetZ = c.z + (threat.dz / len) * (effectiveFleeRange + 5);
      c.behavior = 'fleeing';
      c.foodTargetId = null;
      logLife(id, 'fled', `Fled from threat at distance ${effectiveFleeRange.toFixed(0)}m`);
      broadcastCritterMove(c, 'run');
      continue;
    }

    // If fleeing and threat is gone, stop
    if (c.behavior === 'fleeing' && !threat) {
      c.targetX = null;
      c.targetZ = null;
      c.behavior = 'idle';
      broadcastCritterState(c, 'idle');
    }

    // ── 2. Hunger increases over time ──
    const minutesSinceLastAte = (now - c.lastAte) / 60000;
    c.hunger = Math.min(100, Math.round(minutesSinceLastAte * config.hungerPerMinute));

    // ── 3. Starvation ──
    if (c.hunger >= 100) {
      c.isAlive = false;
      c.health = 0;
      broadcastNearby(c.x, c.z, 200, { type: 'critter_died', id, species: c.species, cause: 'starvation' });
      await prisma.world_critter.update({ where: { id }, data: { is_alive: false, health: 0 } }).catch(() => {});
      critters.delete(id);
      logLife(id, 'starved', `Died of starvation at hunger ${c.hunger}`);
      console.log(`[Critters] ${c.species} #${id} starved`);
      continue;
    }

    // ── 4. Eating — consume food at current position ──
    if (c.behavior === 'eating' && c.foodTargetId) {
      try {
        const food = await prisma.world_vegetation.findUnique({ where: { id: c.foodTargetId } });
        if (food && food.health > 0) {
          c.hunger = Math.max(0, c.hunger - config.hungerRestore);
          c.lastAte = now;
          logLife(id, 'ate', `Ate ${food.type} #${food.id}, hunger now ${c.hunger}`);

          const newHealth = Math.max(0, food.health - config.eatDamage);
          const newStage = newHealth <= 0 ? 0 : Math.min(4, Math.floor(newHealth / 20));

          await prisma.world_vegetation.update({
            where: { id: food.id },
            data: { health: newHealth, growth_stage: newStage },
          });

          if (newHealth <= 0) {
            broadcastNearby(food.x, food.z, 200, { type: 'vegetation_died', id: food.id });
            await prisma.vegetation_log.create({ data: {
              veg_id: food.id, veg_type: food.type, event: 'consumed',
              x: food.x, z: food.z, detail: `eaten by ${c.species} #${id}`,
            } }).catch(() => {});
            // Food gone — need to find new food or idle
            c.foodTargetId = null;
            c.behavior = 'idle';
            broadcastCritterState(c, 'idle');
          } else if (newStage !== food.growth_stage) {
            broadcastNearby(food.x, food.z, 200, { type: 'vegetation_grown', id: food.id, growth_stage: newStage });
          }
          // Stay eating until food dies or not hungry
          if (c.hunger <= 5) {
            c.foodTargetId = null;
            c.behavior = 'idle';
            broadcastCritterState(c, 'idle');
          }
          continue;
        } else {
          // Food gone
          c.foodTargetId = null;
          c.behavior = 'idle';
        }
      } catch {
        c.foodTargetId = null;
        c.behavior = 'idle';
      }
    }

    // ── 5. Hungry and idle — predators hunt first, herbivores eat vegetation ──
    const hungerThreshold = 25 * c.geneHungerTolerance;
    const effectiveSearchRadius = config.searchRadius * c.geneCuriosity;

    // ── 5a. Predator hunting — scales with hunger ──
    // At hunger 0: 5% chance to hunt (opportunistic), search radius 20%
    // At hunger 50: 80% chance, full search radius
    // At hunger 80+: 100% chance, 120% search radius (desperate)
    if (c.behavior === 'idle' && config.hunts.length > 0) {
      const huntDrive = Math.min(1, c.hunger / 60); // 0.0 at full → 1.0 at hunger 60+
      const huntChance = 0.05 + huntDrive * 0.95; // 5% → 100%
      const huntRadius = effectiveSearchRadius * (0.2 + huntDrive * 1.0); // 20% → 120% of base

      if (Math.random() < huntChance) {
      // Find nearest prey within hunger-scaled search radius
      let nearestPrey: CritterState | null = null;
      let nearestDist = Infinity;
      for (const [, other] of critters) {
        if (!other.isAlive || !config.hunts.includes(other.species)) continue;
        const d = dist2d(c.x, c.z, other.x, other.z);
        if (d < huntRadius && d < nearestDist) {
          nearestPrey = other;
          nearestDist = d;
        }
      }

      if (nearestPrey) {
        c.preyId = nearestPrey.id;
        c.targetX = nearestPrey.x;
        c.targetZ = nearestPrey.z;
        // Stalk if far, chase if close
        if (nearestDist > 10) {
          c.behavior = 'stalking';
          broadcastCritterMove(c, 'walk');
        } else {
          c.behavior = 'chasing';
          broadcastCritterMove(c, 'run');
        }
        continue;
      }
      } // huntChance
    }

    // Stalking → switch to chase when close enough
    if (c.behavior === 'stalking' && c.preyId) {
      const prey = critters.get(c.preyId);
      if (prey && prey.isAlive) {
        const d = dist2d(c.x, c.z, prey.x, prey.z);
        if (d < 10) {
          c.behavior = 'chasing';
          c.targetX = prey.x;
          c.targetZ = prey.z;
          broadcastCritterMove(c, 'run');
          continue;
        }
      } else {
        c.preyId = null;
        c.behavior = 'idle';
        broadcastCritterState(c, 'idle');
      }
    }

    // Eating a kill — wait 8 seconds then go idle
    if (c.behavior === 'eating_kill' && c.killStarted) {
      if (now - c.killStarted > 8000) {
        c.behavior = 'idle';
        c.killStarted = null;
        c.preyId = null;
        broadcastCritterState(c, 'idle');
      }
      continue;
    }

    // ── 5b. Vegetation eating — scales with hunger like hunting ──
    if (c.behavior === 'idle' && config.eats.length > 0) {
      const feedDrive = Math.min(1, c.hunger / 60);
      const feedChance = 0.05 + feedDrive * 0.95;
      const feedRadius = effectiveSearchRadius * (0.2 + feedDrive * 1.0);

      if (Math.random() < feedChance) {
      const food = await prisma.world_vegetation.findFirst({
        where: {
          x: { gte: c.x - feedRadius, lte: c.x + feedRadius },
          z: { gte: c.z - feedRadius, lte: c.z + feedRadius },
          type: { in: config.eats },
          health: { gt: 0 },
          growth_stage: { gte: 2 },
        },
        orderBy: { health: 'desc' },
      });

      if (food) {
        c.targetX = food.x;
        c.targetZ = food.z;
        c.foodTargetId = food.id;
        c.behavior = 'walking_to_food';
        broadcastCritterMove(c, 'walk');
        continue;
      }

      // No food nearby — search further out when desperate
      if (c.hunger > 50) {
        const angle = Math.random() * Math.PI * 2;
        c.targetX = c.x + Math.cos(angle) * feedRadius;
        c.targetZ = c.z + Math.sin(angle) * feedRadius;
        c.behavior = 'searching';
        broadcastCritterMove(c, 'walk');
        continue;
      }
      } // feedChance
    }

    // ── 6a. Mating in progress — wait 5 seconds then spawn baby ──
    if (c.behavior === 'mating' && c.matingStarted) {
      const MATING_DURATION = 5000; // 5 seconds of mating animation
      if (now - c.matingStarted > MATING_DURATION) {
        // Spawn baby next to mother — inherit genes from both parents
        const dad = c.mateId ? critters.get(c.mateId) : null;
        const babyGenes = {
          gene_boldness: dad ? inheritGene(c.geneBoldness, dad.geneBoldness) : c.geneBoldness + (Math.random() - 0.5) * 0.1,
          gene_speed: dad ? inheritGene(c.geneSpeed, dad.geneSpeed) : c.geneSpeed + (Math.random() - 0.5) * 0.1,
          gene_social: dad ? inheritGene(c.geneSocial, dad.geneSocial) : c.geneSocial + (Math.random() - 0.5) * 0.1,
          gene_hunger_tolerance: dad ? inheritGene(c.geneHungerTolerance, dad.geneHungerTolerance) : c.geneHungerTolerance + (Math.random() - 0.5) * 0.1,
          gene_curiosity: dad ? inheritGene(c.geneCuriosity, dad.geneCuriosity) : c.geneCuriosity + (Math.random() - 0.5) * 0.1,
        };

        const baby = await prisma.world_critter.create({
          data: {
            species: c.species,
            x: c.x + (Math.random() - 0.5) * 1.5,
            y: c.y,
            z: c.z + (Math.random() - 0.5) * 1.5,
            health: config.maxHealth, max_health: config.maxHealth,
            gender: Math.random() < 0.5 ? 'male' : 'female',
            parent_id: id,
            ...babyGenes,
          },
        });

        const babyState: CritterState = {
          id: baby.id, species: c.species,
          x: baby.x, y: baby.y, z: baby.z, rot: 0,
          health: config.maxHealth, hunger: 0,
          isAlive: true, gender: baby.gender, parentId: id,
          bornAt: now, lastAte: now, lastBred: now,
          behavior: 'idle', targetX: null, targetZ: null,
          foodTargetId: null, mateId: null, matingStarted: null, preyId: null, killStarted: null,
          geneBoldness: babyGenes.gene_boldness,
          geneSpeed: babyGenes.gene_speed,
          geneSocial: babyGenes.gene_social,
          geneHungerTolerance: babyGenes.gene_hunger_tolerance,
          geneCuriosity: babyGenes.gene_curiosity,
          lastBroadcast: now,
        };
        critters.set(baby.id, babyState);

        broadcastNearby(baby.x, baby.z, 200, {
          type: 'critter_spawned', id: baby.id, species: c.species,
          x: baby.x, y: baby.y, z: baby.z, gender: baby.gender,
          age: 0, maturity: 0, parentId: id,
        });

        // Both parents return to idle
        const mateRef = c.mateId ? critters.get(c.mateId) : null;
        c.lastBred = now;
        c.behavior = 'idle';
        c.mateId = null;
        c.matingStarted = null;
        broadcastCritterState(c, 'idle');

        if (mateRef) {
          mateRef.lastBred = now;
          mateRef.behavior = 'idle';
          mateRef.mateId = null;
          mateRef.matingStarted = null;
          broadcastCritterState(mateRef, 'idle');
        }

        logLife(baby.id, 'born', `Born to ${c.species} #${id}, gender: ${baby.gender}`);
        logLife(id, 'mated', `Gave birth to ${c.species} #${baby.id}`);
        console.log(`[Critters] ${c.species} #${id} gave birth to #${baby.id}`);
      }
      continue; // Stay in mating state until duration passes
    }

    // ── 6b. Seek mate — walk to nearby male, then mate ──
    if (c.behavior === 'idle' && c.gender === 'female' && c.hunger < config.breedHungerMax) {
      const ageMinutes = (now - c.bornAt) / 60000;
      const breedCooldown = (now - c.lastBred) / 60000;
      if (ageMinutes > config.matureAgeMinutes && breedCooldown > config.breedCooldownMinutes) {
        // Find nearby eligible male (not already mating)
        let mate: CritterState | null = null;
        for (const [, other] of critters) {
          if (other.species === c.species && other.gender === 'male' && other.isAlive
              && other.behavior === 'idle'
              && dist2d(c.x, c.z, other.x, other.z) < 10) {
            mate = other;
            break;
          }
        }

        if (mate) {
          // Walk to the male — get within 1m face to face
          c.targetX = mate.x;
          c.targetZ = mate.z;
          c.mateId = mate.id;
          c.behavior = 'walking_to_mate';
          broadcastCritterMove(c, 'walk');
          continue;
        }
      }
    }

    // ── 7. Family grouping — juveniles follow mother, adults drift toward family ──
    if (c.behavior === 'idle') {
      const maturity = getMaturity(c);

      if (maturity < 1) {
        // Juvenile: follow mother closely
        const mom = findMother(c);
        if (mom) {
          const distToMom = dist2d(c.x, c.z, mom.x, mom.z);
          // gene_social: high=stays closer to mom, low=wanders more
          if (distToMom > 5 / c.geneSocial) {
            c.targetX = mom.x + (Math.random() - 0.5) * 2;
            c.targetZ = mom.z + (Math.random() - 0.5) * 2;
            c.behavior = 'searching';
            broadcastCritterMove(c, 'walk');
            continue;
          }
        }
      } else {
        // Adult: drift toward family centroid if too far
        const centroid = getFamilyCentroid(c);
        if (centroid) {
          const distToFamily = dist2d(c.x, c.z, centroid.x, centroid.z);
          // gene_social: high=tighter family grouping
          if (distToFamily > 12 / c.geneSocial) {
            // Walk toward family, not exactly to centroid (natural spread)
            c.targetX = centroid.x + (Math.random() - 0.5) * 6;
            c.targetZ = centroid.z + (Math.random() - 0.5) * 6;
            c.behavior = 'searching';
            broadcastCritterMove(c, 'walk');
            continue;
          }
        }
      }
    }

    // ── 8. Idle fidget — very rarely shift slightly ──
    if (c.behavior === 'idle' && Math.random() < 0.02) {
      const angle = Math.random() * Math.PI * 2;
      c.targetX = c.x + Math.cos(angle) * (1 + Math.random() * 2);
      c.targetZ = c.z + Math.sin(angle) * (1 + Math.random() * 2);
      c.behavior = 'searching';
      broadcastCritterMove(c, 'walk');
    }
  }
};

// ── Server Performance Tracking ──

type PerfMetric = { samples: number[]; maxSamples: number };
const perfMetrics: Record<string, PerfMetric> = {
  npcBehaviorTick: { samples: [], maxSamples: 60 },
  npcPositionBroadcast: { samples: [], maxSamples: 60 },
  critterBehavior: { samples: [], maxSamples: 60 },
  critterMovement: { samples: [], maxSamples: 60 },
  vegetationTick: { samples: [], maxSamples: 60 },
};

const recordPerfSample = (metric: string, durationMs: number): void => {
  const m = perfMetrics[metric];
  if (!m) return;
  m.samples.push(durationMs);
  if (m.samples.length > m.maxSamples) m.samples.shift();
};

const getPerfSummary = (): Record<string, { avg: number; min: number; max: number; last: number; samples: number }> => {
  const summary: Record<string, { avg: number; min: number; max: number; last: number; samples: number }> = {};
  for (const [name, m] of Object.entries(perfMetrics)) {
    if (m.samples.length === 0) {
      summary[name] = { avg: 0, min: 0, max: 0, last: 0, samples: 0 };
      continue;
    }
    const avg = m.samples.reduce((a, b) => a + b, 0) / m.samples.length;
    summary[name] = {
      avg: Math.round(avg * 100) / 100,
      min: Math.round(Math.min(...m.samples) * 100) / 100,
      max: Math.round(Math.max(...m.samples) * 100) / 100,
      last: Math.round(m.samples[m.samples.length - 1] * 100) / 100,
      samples: m.samples.length,
    };
  }
  return summary;
};

// ── World stats broadcast (every 30s via game-sync WebSocket) ──

let statsBroadcastCounter = 0;

// In-memory vegetation counts — updated by vegetation.ts on spawn/death, loaded on init
const vegCounts: Record<string, number> = {};
const initVegCounts = async (): Promise<void> => {
  try {
    const rows = await prisma.$queryRaw<{ type: string; cnt: bigint }[]>`
      SELECT type, COUNT(*) as cnt FROM world_vegetation WHERE health > 0 GROUP BY type
    `;
    for (const row of rows) vegCounts[row.type] = Number(row.cnt);
    console.log(`[Stats] Loaded vegetation counts: ${JSON.stringify(vegCounts)}`);
  } catch {}
};
const adjustVegCount = (type: string, delta: number): void => {
  vegCounts[type] = (vegCounts[type] || 0) + delta;
  if (vegCounts[type] < 0) vegCounts[type] = 0;
};

const broadcastWorldStats = async (): Promise<void> => {
  statsBroadcastCounter++;
  if (statsBroadcastCounter % 1 !== 0) return; // Every behavior tick = 5s

  const critterStats: Record<string, number> = {};
  for (const [, c] of critters) {
    if (!c.isAlive) continue;
    critterStats[c.species] = (critterStats[c.species] || 0) + 1;
  }

  // Vegetation counts from in-memory tracker (zero DB queries)
  try {
    const vegStats = { ...vegCounts };

    const totalCritters = Object.values(critterStats).reduce((a, b) => a + b, 0);
    const totalVeg = Object.values(vegStats).reduce((a, b) => a + b, 0);

    const perf = getPerfSummary();
    const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    broadcastAll({
      type: 'world_stats',
      critters: critterStats,
      vegetation: vegStats,
      totals: { critters: totalCritters, vegetation: totalVeg },
      performance: perf,
      uptime: Math.round(process.uptime()),
      memoryMB: memMB,
    });

    // Record snapshot to history
    prisma.world_stats_history.create({ data: {
      resolution: 'raw',
      chickens: critterStats.chicken || 0,
      deer: critterStats.deer || 0,
      fox: critterStats.fox || 0,
      bear: critterStats.bear || 0,
      grass: vegStats.grass || 0,
      bush: vegStats.bush || 0,
      tree_oak: vegStats.tree_oak || 0,
      tree_pine: vegStats.tree_pine || 0,
      total_critters: totalCritters,
      total_vegetation: totalVeg,
      memory_mb: memMB,
      npc_tick_avg: perf.npcBehaviorTick?.avg || 0,
      critter_behavior_avg: perf.critterBehavior?.avg || 0,
      veg_tick_avg: perf.vegetationTick?.avg || 0,
    } }).catch(() => {});
  } catch { /* ignore errors for stats */ }
};

// ── Stats downsampling (runs hourly) ──
const downsampleStats = async (): Promise<void> => {
  try {
    // Raw → 1min averages for data older than 1 hour
    const oneHourAgo = new Date(Date.now() - 3600000);
    await prisma.$executeRaw`
      INSERT INTO world_stats_history (timestamp, resolution, chickens, deer, fox, bear, grass, bush, tree_oak, tree_pine, total_critters, total_vegetation, memory_mb, npc_tick_avg, critter_behavior_avg, veg_tick_avg)
      SELECT
        DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00') as timestamp,
        '1min',
        ROUND(AVG(chickens)), ROUND(AVG(deer)), ROUND(AVG(fox)), ROUND(AVG(bear)),
        ROUND(AVG(grass)), ROUND(AVG(bush)), ROUND(AVG(tree_oak)), ROUND(AVG(tree_pine)),
        ROUND(AVG(total_critters)), ROUND(AVG(total_vegetation)), ROUND(AVG(memory_mb)),
        ROUND(AVG(npc_tick_avg), 2), ROUND(AVG(critter_behavior_avg), 2), ROUND(AVG(veg_tick_avg), 2)
      FROM world_stats_history
      WHERE resolution = 'raw' AND timestamp < ${oneHourAgo}
      GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00')
    `;
    await prisma.$executeRaw`DELETE FROM world_stats_history WHERE resolution = 'raw' AND timestamp < ${oneHourAgo}`;

    // 1min → 10min averages for data older than 24 hours
    const oneDayAgo = new Date(Date.now() - 86400000);
    await prisma.$executeRaw`
      INSERT INTO world_stats_history (timestamp, resolution, chickens, deer, fox, bear, grass, bush, tree_oak, tree_pine, total_critters, total_vegetation, memory_mb, npc_tick_avg, critter_behavior_avg, veg_tick_avg)
      SELECT
        DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:00') as timestamp,
        '10min',
        ROUND(AVG(chickens)), ROUND(AVG(deer)), ROUND(AVG(fox)), ROUND(AVG(bear)),
        ROUND(AVG(grass)), ROUND(AVG(bush)), ROUND(AVG(tree_oak)), ROUND(AVG(tree_pine)),
        ROUND(AVG(total_critters)), ROUND(AVG(total_vegetation)), ROUND(AVG(memory_mb)),
        ROUND(AVG(npc_tick_avg), 2), ROUND(AVG(critter_behavior_avg), 2), ROUND(AVG(veg_tick_avg), 2)
      FROM world_stats_history
      WHERE resolution = '1min' AND timestamp < ${oneDayAgo}
      GROUP BY FLOOR(UNIX_TIMESTAMP(timestamp) / 600)
    `;
    await prisma.$executeRaw`DELETE FROM world_stats_history WHERE resolution = '1min' AND timestamp < ${oneDayAgo}`;

    // 10min → 1hour averages for data older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 604800000);
    await prisma.$executeRaw`
      INSERT INTO world_stats_history (timestamp, resolution, chickens, deer, fox, bear, grass, bush, tree_oak, tree_pine, total_critters, total_vegetation, memory_mb, npc_tick_avg, critter_behavior_avg, veg_tick_avg)
      SELECT
        DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') as timestamp,
        '1hour',
        ROUND(AVG(chickens)), ROUND(AVG(deer)), ROUND(AVG(fox)), ROUND(AVG(bear)),
        ROUND(AVG(grass)), ROUND(AVG(bush)), ROUND(AVG(tree_oak)), ROUND(AVG(tree_pine)),
        ROUND(AVG(total_critters)), ROUND(AVG(total_vegetation)), ROUND(AVG(memory_mb)),
        ROUND(AVG(npc_tick_avg), 2), ROUND(AVG(critter_behavior_avg), 2), ROUND(AVG(veg_tick_avg), 2)
      FROM world_stats_history
      WHERE resolution = '10min' AND timestamp < ${sevenDaysAgo}
      GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00')
    `;
    await prisma.$executeRaw`DELETE FROM world_stats_history WHERE resolution = '10min' AND timestamp < ${sevenDaysAgo}`;

    // Delete anything older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 2592000000);
    await prisma.$executeRaw`DELETE FROM world_stats_history WHERE timestamp < ${thirtyDaysAgo}`;

    const remaining = await prisma.world_stats_history.count();
    console.log(`[Stats] Downsampled — ${remaining} rows remaining`);
  } catch (err) {
    console.error('[Stats] Downsample error:', err);
  }
};

// ── Persistence (save to DB periodically) ──

const persistTick = async (): Promise<void> => {
  for (const [id, c] of critters) {
    if (!c.isAlive) continue;
    prisma.world_critter.update({
      where: { id },
      data: { x: c.x, z: c.z, rot: c.rot, health: c.health, hunger: c.hunger },
    }).catch(() => {});
  }
};

// ── Init ──

const initCritterSystem = async (): Promise<void> => {
  const dbCritters = await prisma.world_critter.findMany({ where: { is_alive: true } });
  const now = Date.now();
  for (const c of dbCritters) {
    critters.set(c.id, {
      id: c.id, species: c.species,
      x: c.x, y: c.y, z: c.z, rot: c.rot,
      health: c.health, hunger: c.hunger,
      isAlive: true, gender: c.gender, parentId: c.parent_id,
      bornAt: c.born_at.getTime(), lastAte: c.last_ate.getTime(), lastBred: c.last_bred.getTime(),
      behavior: 'idle', targetX: null, targetZ: null,
      foodTargetId: null, mateId: null, matingStarted: null, preyId: null, killStarted: null, lastBroadcast: now,
      geneBoldness: c.gene_boldness, geneSpeed: c.gene_speed, geneSocial: c.gene_social,
      geneHungerTolerance: c.gene_hunger_tolerance, geneCuriosity: c.gene_curiosity,
    });
  }
  console.log(`[Critters] Loaded ${dbCritters.length} critters from DB`);

  // Load vegetation counts into memory
  await initVegCounts();

  // Movement tick: 200ms — only processes critters that are actively moving
  setInterval(() => {
    const start = performance.now();
    movementTick();
    recordPerfSample('critterMovement', performance.now() - start);
  }, 200);

  // Behavior tick: 5s — decisions
  setInterval(async () => {
    const start = performance.now();
    await behaviorTick().catch((err) => console.error('[Critters] Behavior error:', err));
    recordPerfSample('critterBehavior', performance.now() - start);
    broadcastWorldStats().catch(() => {});
  }, 5000);

  // Persistence: every 60s
  setInterval(() => {
    persistTick().catch((err) => console.error('[Critters] Persist error:', err));
  }, 60000);

  // Downsample stats history: every hour
  setInterval(() => {
    downsampleStats().catch((err) => console.error('[Stats] Downsample error:', err));
  }, 3600000);

  console.log('[Critters] Event-driven system initialized (movement: 200ms, behavior: 5s, persist: 60s, downsample: 1h)');
};

/** Spawn critters. baby=true spawns as newborn, otherwise as adult. */
const seedCritters = async (species: string, count: number, centerX: number, centerZ: number, radius: number, gender?: string, baby?: boolean): Promise<number> => {
  const config = SPECIES[species];
  if (!config) return 0;
  const now = Date.now();

  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius;
    const x = centerX + Math.cos(angle) * dist;
    const z = centerZ + Math.sin(angle) * dist;
    const g = gender || (Math.random() < 0.5 ? 'male' : 'female');

    const genes = randomGenes();
    const critter = await prisma.world_critter.create({
      data: {
        species, x, y: 0, z,
        health: config.maxHealth, max_health: config.maxHealth, gender: g,
        born_at: baby ? new Date(now) : new Date(now - config.matureAgeMinutes * 60000),
        gene_boldness: genes.geneBoldness, gene_speed: genes.geneSpeed,
        gene_social: genes.geneSocial, gene_hunger_tolerance: genes.geneHungerTolerance,
        gene_curiosity: genes.geneCuriosity,
      },
    });

    critters.set(critter.id, {
      id: critter.id, species, x, y: 0, z, rot: 0,
      health: config.maxHealth, hunger: 0,
      isAlive: true, gender: g, parentId: null,
      bornAt: baby ? now : now - (config.matureAgeMinutes * 60000), lastAte: now, lastBred: now,
      behavior: 'idle', targetX: null, targetZ: null,
      foodTargetId: null, mateId: null, matingStarted: null, preyId: null, killStarted: null, lastBroadcast: now,
      ...genes,
    });

    broadcastNearby(x, z, 200, {
      type: 'critter_spawned', id: critter.id, species,
      x, y: 0, z, gender: g,
      age: baby ? 0 : config.matureAgeMinutes, maturity: baby ? 0 : 1.0, parentId: null,
    });
    logLife(critter.id, 'born', `Seeded ${species} (${g}) at (${x.toFixed(0)}, ${z.toFixed(0)})`);
    spawned++;
  }
  return spawned;
};

export { initCritterSystem, seedCritters, critters, recordPerfSample, getPerfSummary, adjustVegCount, vegCounts };
