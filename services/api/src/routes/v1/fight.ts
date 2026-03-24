import Joi from 'joi';
import Boom from '@hapi/boom';
import tracer from '../../../../../core/lib/tracer';

import simulateFightAction from '../../../../../core/actions/fight/simulateFightAction';
import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

interface AuthCredentials {
  id: string;
  username: string;
  email: string | null;
  is_admin: boolean;
}

const fightRoutes: ServerRoute[] = [
  // ┌──────────────────────────────────────────┐
  // │ Simulate Fight                           │
  // └──────────────────────────────────────────┘
  {
    method: 'POST',
    path: '/api/v1/fights/simulate',
    options: {
      auth: 'jwt',
      timeout: {
        server: 120000, // 2 min — AI simulation takes time
      },
      validate: {
        payload: Joi.object({
          gladiator_a_id: Joi.string().uuid().required(),
          gladiator_b_id: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FIGHT.SIMULATE', async () => {
        const { gladiator_a_id, gladiator_b_id } = request.payload as {
          gladiator_a_id: string;
          gladiator_b_id: string;
        };

        if (gladiator_a_id === gladiator_b_id) {
          throw Boom.badRequest('A gladiator cannot fight itself.');
        }

        return simulateFightAction(gladiator_a_id, gladiator_b_id);
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Get Fight Result                         │
  // └──────────────────────────────────────────┘
  {
    method: 'GET',
    path: '/api/v1/fights/{id}',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          id: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FIGHT.GET', async () => {
        const { id } = request.params;
        const fight = await Data.fight.findByIdWithDetails(id);

        if (!fight) throw Boom.notFound('Fight not found.');

        return fight;
      }),
  },

  // ┌──────────────────────────────────────────┐
  // │ Get Fight Replay                         │
  // └──────────────────────────────────────────┘
  {
    method: 'GET',
    path: '/api/v1/fights/{id}/replay',
    options: {
      auth: 'jwt',
      validate: {
        params: Joi.object({
          id: Joi.string().uuid().required(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.FIGHT.REPLAY', async () => {
        const { id } = request.params;
        const fight = await Data.fight.findByIdWithDetails(id);

        if (!fight) throw Boom.notFound('Fight not found.');
        if (fight.status !== 'completed') throw Boom.conflict('Fight has not completed yet.');

        const events = await Data.fightEvent.findByFight(id);

        return {
          fight_id: fight.id,
          gladiator_a: fight.gladiator_a,
          gladiator_b: fight.gladiator_b,
          winner_id: fight.winner_id,
          duration_seconds: fight.duration_seconds,
          elo_change_a: fight.elo_change_a,
          elo_change_b: fight.elo_change_b,
          events,
        };
      }),
  },
];

export { fightRoutes };
