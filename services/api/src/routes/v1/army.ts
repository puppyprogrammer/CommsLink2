import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import { dispatchArmyChat, generateUnitResponse } from '../../../../../core/actions/army/chatDispatcherAction';
import Data from '../../../../../core/data';
import { broadcastAll, players } from '../../handlers/gameSync/combat';
import { activeNPCs } from '../../handlers/gameSync/ai/npcEngine';
import { calculateFormationPositions } from '../../handlers/gameSync/ai/formations';
import { getFormationSpacing, setFormationSpacing } from '../../handlers/gameSync/ai/behaviorTree';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';
import type { AuthCredentials } from '../../../../../core/lib/hapi/auth';

const RANK_ORDER: Record<string, number> = { centurion: 4, decurion: 3, sergeant: 2, soldier: 1 };

const armyRoutes: ServerRoute[] = [
  // ── Get army structure ──
  {
    method: 'GET',
    path: '/api/v1/army',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.GET', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const army = await Data.playerCharacter.getArmyStructure(credentials.id);

        const centurion = army.find((u) => u.rank === 'centurion') || null;

        // Group into maniples
        const manipleMap = new Map<number, { name: string; decurion: typeof army[0] | null; squads: Record<string, typeof army> }>();
        for (const unit of army) {
          if (!unit.maniple_id || unit.rank === 'centurion') continue;
          if (!manipleMap.has(unit.maniple_id)) {
            manipleMap.set(unit.maniple_id, { name: unit.maniple_name || `Maniple ${unit.maniple_id}`, decurion: null, squads: {} });
          }
          const maniple = manipleMap.get(unit.maniple_id)!;
          if (unit.rank === 'decurion') maniple.decurion = unit;
          const sq = unit.squad_id || 'a';
          if (!maniple.squads[sq]) maniple.squads[sq] = [];
          maniple.squads[sq].push(unit);
        }

        const maniples = Array.from(manipleMap.entries())
          .sort(([a], [b]) => a - b)
          .map(([id, m]) => ({
            id,
            name: m.name,
            decurion: m.decurion,
            squads: Object.entries(m.squads).sort(([a], [b]) => a.localeCompare(b)).map(([sqId, units]) => ({
              id: sqId,
              sergeant: units.find((u) => u.rank === 'sergeant') || null,
              soldiers: units.filter((u) => u.rank === 'soldier'),
            })),
          }));

        return {
          centurion,
          maniples,
          total: army.length,
          alive: army.filter((u) => u.is_alive).length,
        };
      }),
  },

  // ── Army chat (dispatcher) ──
  {
    method: 'POST',
    path: '/api/v1/army/chat',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({ message: Joi.string().max(500).required() }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.CHAT', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { message } = request.payload as { message: string };

        // Step 1: Fast dispatch — returns immediately with responder/listener lists
        const dispatch = await dispatchArmyChat(credentials.id, message);

        // Step 2: Fire off Grok response generation asynchronously
        // Responses are delivered via game-sync WebSocket as army_chat_response messages
        for (const responderId of dispatch._responderIds) {
          const unit = dispatch._army.find((u) => u.id === responderId);
          if (!unit) continue;

          // Each response fires independently — staggered delivery
          generateUnitResponse(unit, message).then((response) => {
            broadcastAll({
              type: 'army_chat_response',
              unit_id: response.unit_id,
              name: response.name,
              rank: response.rank,
              unit_name: response.unit_name,
              text: response.response,
              emotion: response.emotion,
            });
          }).catch(console.error);
        }

        // Sync dispatched commands to in-memory brains
        if (dispatch.commands_issued.length > 0) {
          const commandMap: Record<string, Record<string, unknown>> = {
            advance: { agenda: 'seek_combat', aggression: 70 },
            retreat: { agenda: 'follow_commander', selfPreservation: 80 },
            hold: { agenda: 'guard_position' },
            attack: { agenda: 'seek_combat', aggression: 85 },
            defend: { agenda: 'protect_commander', defense: 80, commanderProtection: 90 },
            'form up': { agenda: 'follow_commander' },
            'flank left': { flankTendency: 80, flankDirection: 20 },
            'flank right': { flankTendency: 80, flankDirection: 80 },
          };
          // Handle spacing commands
          const spacingPresets: Record<string, { spacing: number; rowDepth: number }> = {
            spacing_tight: { spacing: 0.6, rowDepth: 1.0 },
            spacing_normal: { spacing: 1.0, rowDepth: 1.5 },
            spacing_loose: { spacing: 3.0, rowDepth: 4.0 },
          };
          for (const cmd of dispatch.commands_issued) {
            const preset = spacingPresets[cmd];
            if (preset) {
              setFormationSpacing(credentials.id, preset.spacing, preset.rowDepth);
              console.log(`[Army] Chat spacing command: ${cmd} → spacing=${preset.spacing}, rowDepth=${preset.rowDepth}`);
            }
          }

          for (const cmd of dispatch.commands_issued) {
            const updates = commandMap[cmd.toLowerCase()];
            if (updates) {
              for (const unit of dispatch._army) {
                const brain = activeNPCs.get(unit.id);
                if (brain) {
                  for (const [key, val] of Object.entries(updates)) {
                    (brain as Record<string, unknown>)[key] = val;
                  }
                  if (updates.agenda) brain.agendaLocked = true;
                }
              }
            }
          }
          console.log(`[Army] Chat dispatched commands: ${dispatch.commands_issued.join(', ')}`);
        }

        // Return dispatch result immediately (no responses yet — they come via WebSocket)
        return {
          responders: dispatch.responders,
          listeners: dispatch.listeners,
          commands_issued: dispatch.commands_issued,
        };
      }),
  },

  // ── Army quick command ──
  {
    method: 'POST',
    path: '/api/v1/army/command',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          command: Joi.string().valid('advance', 'retreat', 'hold', 'attack', 'defend', 'form_up', 'flank_left', 'flank_right', 'resume', 'draw_weapons', 'sheathe_weapons', 'move_to', 'formation_line', 'formation_column', 'formation_shield_wall', 'formation_wedge', 'formation_circle', 'formation_square', 'formation_loose').required(),
          target: Joi.string().optional(), // "all", "maniple_1", "squad_2a", or unit UUID
          x: Joi.number().optional(),
          y: Joi.number().optional(),
          z: Joi.number().optional(),
          x1: Joi.number().optional(),
          y1: Joi.number().optional(),
          z1: Joi.number().optional(),
          x2: Joi.number().optional(),
          y2: Joi.number().optional(),
          z2: Joi.number().optional(),
          positions: Joi.array().items(Joi.object({ x: Joi.number().required(), y: Joi.number().required(), z: Joi.number().required() })).optional(),
          facing: Joi.number().optional(), // Rotation in degrees for the formation to face on arrival
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.COMMAND', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { command, target, x, y, z, x1, y1, z1, x2, y2, z2, positions, facing } = request.payload as {
          command: string; target?: string;
          x?: number; y?: number; z?: number;
          x1?: number; y1?: number; z1?: number;
          x2?: number; y2?: number; z2?: number;
          positions?: { x: number; y: number; z: number }[];
          facing?: number;
        };

        // Resume = unlock agenda, let AI decide
        const isResume = command === 'resume';
        const isFormation = command.startsWith('formation_');

        const commandMap: Record<string, Record<string, unknown>> = {
          advance: { ai_agenda: 'march' },
          retreat: { ai_agenda: 'follow_commander', bw_self_preservation: 80 },
          hold: { ai_agenda: 'guard_position' },
          attack: { ai_agenda: 'seek_combat', bw_aggression: 85, bw_defense: 30 },
          defend: { ai_agenda: 'protect_commander', bw_defense: 80, bw_commander_protection: 90 },
          form_up: { ai_agenda: 'follow_commander' },
          flank_left: { bw_flank_tendency: 80, bw_flank_direction: 20 },
          flank_right: { bw_flank_tendency: 80, bw_flank_direction: 80 },
          resume: {},
          move_to: {},
          draw_weapons: {},
          sheathe_weapons: {},
          formation_line: {},
          formation_column: {},
          formation_shield_wall: {},
          formation_wedge: {},
          formation_circle: {},
          formation_square: {},
          formation_loose: {},
        };

        const updates = commandMap[command];
        if (!updates) throw Boom.badRequest('Unknown command');

        let units: Awaited<ReturnType<typeof Data.playerCharacter.getArmyStructure>>;

        if (!target || target === 'all') {
          units = await Data.playerCharacter.getArmyStructure(credentials.id);
        } else if (target.startsWith('maniple_')) {
          const manipleId = parseInt(target.replace('maniple_', ''), 10);
          units = await Data.playerCharacter.findByManiple(credentials.id, manipleId);
        } else if (target.startsWith('squad_')) {
          const parts = target.replace('squad_', '');
          const manipleId = parseInt(parts, 10);
          const squadId = parts.replace(/^\d+/, '');
          units = await Data.playerCharacter.findBySquad(credentials.id, manipleId, squadId);
        } else {
          // UUID — single unit
          const unit = await Data.playerCharacter.findById(target);
          if (!unit || unit.commander_id !== credentials.id) throw Boom.notFound('Unit not found');
          units = [unit];
        }

        // Handle formation commands — calculate positions using commander location
        if (isFormation) {
          const { players } = await import('../../handlers/gameSync/combat');
          const cmdState = players.get(credentials.id);
          const center: [number, number, number] = cmdState ? cmdState.pos : [0, 0.5, 0];
          const facing = cmdState ? cmdState.rot : 0;
          const formationType = command.replace('formation_', '');

          const positions = calculateFormationPositions(
            { type: formationType, center, facing, width: units.length * 2.5 },
            units.length,
          );

          for (let i = 0; i < units.length; i++) {
            const brain = activeNPCs.get(units[i].id);
            if (brain) {
              brain.agenda = 'formation';
              brain.agendaLocked = true;
              brain.formationPos = positions[i].pos as [number, number, number];
              brain.formationRot = positions[i].rot;
              brain.formationType = formationType;
              brain.formationAction = formationType === 'shield_wall' ? 'block' : null;
            }
          }

          console.log(`[Army] Formation ${formationType}: ${units.length} units assigned at [${center.map(n => n.toFixed(1)).join(',')}]`);
          return { success: true, affected: units.length, formation: formationType };
        }

        // Handle move_to — each unit gets their own target position
        if (command === 'move_to') {
          let affected = 0;

          // Sort units by armyBlockIndex for consistent assignment
          const sortedUnits = units
            .map((u) => ({ unit: u, brain: activeNPCs.get(u.id) }))
            .filter((u) => !!u.brain)
            .sort((a, b) => (a.brain!.armyBlockIndex) - (b.brain!.armyBlockIndex));

          if (positions && positions.length > 0) {
            // Client sent exact positions — assign one per unit
            for (let i = 0; i < sortedUnits.length; i++) {
              const pos = positions[Math.min(i, positions.length - 1)];
              const b = sortedUnits[i].brain!;
              b.moveToTarget = [pos.x, pos.y, pos.z];
              b.moveToFacing = facing ?? null;
              b.agenda = 'move_to'; // Prevent follow/formation from interfering
              b.agendaLocked = true;
              b.formationPos = null;
              b.formationType = null;
              affected++;
            }
            console.log(`[Army] move_to positions: ${affected} units`);
          } else if (x !== undefined && z !== undefined) {
            // Single point — compute a block formation around that point
            const config = getFormationSpacing(credentials.id);
            const COLS = Math.ceil(sortedUnits.length / 2);
            const cmdState = players.get(credentials.id);
            const cmdRot = cmdState ? cmdState.rot : 0;
            const rad = cmdRot * Math.PI / 180;
            const fwdX = Math.sin(rad);
            const fwdZ = Math.cos(rad);
            const rightX = Math.cos(rad);
            const rightZ = -Math.sin(rad);

            for (let i = 0; i < sortedUnits.length; i++) {
              const row = Math.floor(i / COLS);
              const col = i % COLS;
              const colOffset = (col - (COLS - 1) / 2) * config.spacing;
              const px = x + rightX * colOffset - fwdX * row * config.rowDepth;
              const pz = z + rightZ * colOffset - fwdZ * row * config.rowDepth;
              const b = sortedUnits[i].brain!;
              b.moveToTarget = [px, y ?? 0, pz];
              b.moveToFacing = facing ?? cmdRot;
              b.agenda = 'move_to';
              b.agendaLocked = true;
              b.formationPos = null;
              b.formationType = null;
              affected++;
            }
            console.log(`[Army] move_to point (${x.toFixed(0)}, ${z.toFixed(0)}): ${affected} units, ${COLS} cols`);
          } else {
            throw Boom.badRequest('move_to requires positions[] or x/z');
          }

          return { success: true, affected, command };
        }

        // Handle draw/sheathe weapons — purely visual, broadcast to all clients
        if (command === 'draw_weapons' || command === 'sheathe_weapons') {
          const action = command === 'draw_weapons' ? 'draw_weapon' : 'sheathe_weapon';
          let affected = 0;
          for (const unit of units) {
            const brain = activeNPCs.get(unit.id);
            if (brain) {
              brain.weaponDrawn = command === 'draw_weapons';
              broadcastAll({ type: 'npc_combat_action', id: unit.id, action, target_id: null });
              affected++;
            }
          }
          console.log(`[Army] ${command}: ${affected} units`);
          return { success: true, affected, command };
        }

        let affected = 0;
        for (const unit of units) {
          if (!isResume) await Data.playerCharacter.update(unit.id, updates);

          const brain = activeNPCs.get(unit.id);
          if (brain) {
            if (isResume) {
              brain.agendaLocked = false;
              brain.formationPos = null;
              brain.formationType = null;
              brain.formationAction = null;
              console.log(`[Army] Unlocked agenda for ${brain.name} — AI resumes control`);
            } else if (updates.ai_agenda) {
              brain.agenda = updates.ai_agenda as string;
              brain.agendaLocked = true;
              brain.formationPos = null;
              brain.formationType = null;
              brain.formationAction = null;

              // Set march direction from commander's facing when advancing
              if (brain.agenda === 'march') {
                const { players: pMap } = await import('../../handlers/gameSync/combat');
                const cmd = pMap.get(credentials.id);
                if (cmd) {
                  const rad = cmd.rot * Math.PI / 180;
                  brain.marchDirection = [Math.sin(rad), Math.cos(rad)];
                } else {
                  brain.marchDirection = [0, 1]; // default: north
                }
              } else {
                brain.marchDirection = null;
              }
            }
            if (updates.bw_aggression !== undefined) brain.aggression = updates.bw_aggression as number;
            if (updates.bw_defense !== undefined) brain.defense = updates.bw_defense as number;
            if (updates.bw_commander_protection !== undefined) brain.commanderProtection = updates.bw_commander_protection as number;
            if (updates.bw_self_preservation !== undefined) brain.selfPreservation = updates.bw_self_preservation as number;
            if (updates.bw_flank_tendency !== undefined) brain.flankTendency = updates.bw_flank_tendency as number;
            if (updates.bw_flank_direction !== undefined) brain.flankDirection = updates.bw_flank_direction as number;
          }

          affected++;
        }

        console.log(`[Army] Command "${command}" applied to ${affected} units (target: ${target || 'all'})`);
        return { success: true, affected };
      }),
  },

  // ── Reassign unit ──
  {
    method: 'PUT',
    path: '/api/v1/army/reassign',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          unit_id: Joi.string().uuid().required(),
          target_maniple: Joi.number().integer().min(1).max(10).required(),
          target_squad: Joi.string().valid('a', 'b').required(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.REASSIGN', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { unit_id, target_maniple, target_squad } = request.payload as {
          unit_id: string; target_maniple: number; target_squad: string;
        };

        const unit = await Data.playerCharacter.findById(unit_id);
        if (!unit || unit.commander_id !== credentials.id) throw Boom.forbidden('Not your unit');

        // Get maniple name from existing units
        const manipleUnits = await Data.playerCharacter.findByManiple(credentials.id, target_maniple);
        const manipleNames = ['Iron Guard', 'Wolf Pack', 'Red Company', 'Black Watch', 'Storm Riders',
          'Shield Wall', 'Vanguard', 'Night Owls', 'Ember Fist', 'Stone Legion'];
        const name = manipleUnits.length > 0 ? manipleUnits[0].maniple_name : manipleNames[target_maniple - 1];

        await Data.playerCharacter.update(unit_id, {
          maniple_id: target_maniple,
          maniple_name: name,
          squad_id: target_squad,
        });

        return { success: true };
      }),
  },

  // ── Rename maniple ──
  {
    method: 'PUT',
    path: '/api/v1/army/maniple/{id}/rename',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({ id: Joi.number().integer().min(1).max(10).required() }),
        payload: Joi.object({ name: Joi.string().min(2).max(30).required() }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.RENAME_MANIPLE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const manipleId = parseInt(request.params.id as string, 10);
        const { name } = request.payload as { name: string };

        const units = await Data.playerCharacter.findByManiple(credentials.id, manipleId);
        for (const unit of units) {
          await Data.playerCharacter.update(unit.id, { maniple_name: name });
        }

        return { success: true, affected: units.length };
      }),
  },

  // ── Promote unit ──
  {
    method: 'POST',
    path: '/api/v1/army/promote',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          unit_id: Joi.string().uuid().required(),
          new_rank: Joi.string().valid('sergeant', 'decurion', 'centurion').required(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.PROMOTE', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { unit_id, new_rank } = request.payload as { unit_id: string; new_rank: string };

        const unit = await Data.playerCharacter.findById(unit_id);
        if (!unit || unit.commander_id !== credentials.id) throw Boom.forbidden('Not your unit');

        const currentRank = RANK_ORDER[unit.rank] || 1;
        const targetRank = RANK_ORDER[new_rank] || 1;
        if (targetRank <= currentRank) throw Boom.badRequest('Can only promote to a higher rank');

        // Check if centurion slot is taken
        if (new_rank === 'centurion') {
          const existing = await Data.playerCharacter.findCenturion(credentials.id);
          if (existing) throw Boom.conflict('Already have a Centurion — demote the current one first');
        }

        await Data.playerCharacter.update(unit_id, { rank: new_rank });

        return { success: true, name: unit.name, new_rank };
      }),
  },

  // ── Set formation ──
  {
    method: 'POST',
    path: '/api/v1/army/formation',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          type: Joi.string().valid('line', 'column', 'shield_wall', 'wedge', 'circle', 'square', 'loose').required(),
          center: Joi.array().items(Joi.number()).length(3).required(),
          facing: Joi.number().required(),
          width: Joi.number().optional(),
          depth: Joi.number().optional(),
          radius: Joi.number().optional(),
          size: Joi.number().optional(),
          spacing: Joi.number().optional(),
          unit_ids: Joi.array().items(Joi.string()).optional(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.FORMATION', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const payload = request.payload as {
          type: string;
          center: [number, number, number];
          facing: number;
          width?: number;
          depth?: number;
          radius?: number;
          size?: number;
          spacing?: number;
          unit_ids?: string[];
        };

        // Get units to form up
        let units: Awaited<ReturnType<typeof Data.playerCharacter.getArmyStructure>>;
        if (payload.unit_ids && payload.unit_ids.length > 0) {
          const army = await Data.playerCharacter.getArmyStructure(credentials.id);
          units = army.filter((u) => payload.unit_ids!.includes(u.id));
        } else {
          units = await Data.playerCharacter.getArmyStructure(credentials.id);
        }

        if (units.length === 0) throw Boom.notFound('No units to form');

        // Calculate positions
        const positions = calculateFormationPositions(
          {
            type: payload.type,
            center: payload.center,
            facing: payload.facing,
            width: payload.width,
            depth: payload.depth,
            radius: payload.radius,
            size: payload.size,
            spacing: payload.spacing,
          },
          units.length,
        );

        // Assign to each unit
        const assignments = [];
        for (let i = 0; i < units.length; i++) {
          const unit = units[i];
          const pos = positions[i];

          // Update in-memory brain
          const brain = activeNPCs.get(unit.id);
          if (brain) {
            brain.agenda = 'formation';
            brain.agendaLocked = true;
            brain.formationPos = pos.pos as [number, number, number];
            brain.formationRot = pos.rot;
            brain.formationType = payload.type;
            brain.formationAction = payload.type === 'shield_wall' ? 'block' : null;
          }

          assignments.push({
            unit_id: unit.id,
            name: unit.name,
            pos: pos.pos,
            rot: pos.rot,
          });
        }

        console.log(`[Army] Formation ${payload.type}: ${units.length} units assigned`);

        return { formation: payload.type, assignments };
      }),
  },
  // ── Get/Set formation spacing ──
  {
    method: 'GET',
    path: '/api/v1/army/spacing',
    options: { auth: 'jwt' },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.SPACING.GET', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        return getFormationSpacing(credentials.id);
      }),
  },
  {
    method: 'PUT',
    path: '/api/v1/army/spacing',
    options: {
      auth: 'jwt',
      validate: {
        payload: Joi.object({
          spacing: Joi.number().min(0.5).max(10).required(),
          rowDepth: Joi.number().min(0.5).max(10).required(),
        }),
      },
    },
    handler: async (request: Request) =>
      tracer.trace('CONTROLLER.ARMY.SPACING.SET', async () => {
        const credentials = request.auth.credentials as unknown as AuthCredentials;
        const { spacing, rowDepth } = request.payload as { spacing: number; rowDepth: number };
        setFormationSpacing(credentials.id, spacing, rowDepth);
        console.log(`[Army] ${credentials.username} set spacing=${spacing}m, rowDepth=${rowDepth}m`);
        return { spacing, rowDepth };
      }),
  },
];

export { armyRoutes };
