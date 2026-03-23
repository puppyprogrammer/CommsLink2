import Joi from 'joi';
import Boom from '@hapi/boom';
import jwt from 'jsonwebtoken';

import { register, login } from '../../../../../core/actions/ffxiv/authAction';
import { generateTTS } from '../../../../../core/actions/ffxiv/ttsAction';
import pollyAdapter from '../../../../../core/adapters/polly';
import Data from '../../../../../core/data';
import { checkRateLimit } from '../../../../../core/helpers/rateLimiter';
import { broadcastAudio, updatePlayerPosition } from '../../ffxivWs';

// Dedup: track recent messages to prevent double TTS when multiple clients send the same chat
const recentMessages = new Map<string, number>();
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentMessages) {
    if (now - ts > 10000) recentMessages.delete(key);
  }
}, 30000);

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

type FfxivJwtPayload = {
  id: string;
  email: string;
  type: string;
};

function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  }
  return request.info.remoteAddress;
}

/**
 * Validate FFXIV JWT from Authorization header manually.
 * Returns decoded payload or throws Boom.unauthorized.
 */
function validateFfxivAuth(request: Request): FfxivJwtPayload {
  const rawHeader = request.headers.authorization;
  const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw Boom.unauthorized('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');

  try {
    const decoded = jwt.verify(token, secret) as FfxivJwtPayload;
    if (decoded.type !== 'ffxiv') {
      throw Boom.unauthorized('Invalid token type');
    }
    return decoded;
  } catch (err) {
    if (err instanceof Error && err.name === 'JsonWebTokenError') {
      throw Boom.unauthorized('Invalid token');
    }
    if (err instanceof Error && err.name === 'TokenExpiredError') {
      throw Boom.unauthorized('Token expired');
    }
    throw err;
  }
}

const ffxivRoutes: ServerRoute[] = [
  // ── Register ──────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/ffxiv/register',
    options: {
      auth: false,
      validate: {
        payload: Joi.object({
          username: Joi.string().min(3).max(30).required(),
          password: Joi.string().min(6).required(),
          contentId: Joi.string().optional(),
          charName: Joi.string().optional(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) => {
      const ip = getClientIp(request);
      const { allowed, retryAfterMs } = checkRateLimit(`ffxiv-register:${ip}`, 3, 60_000);
      if (!allowed) {
        throw Boom.tooManyRequests(
          `Too many registration attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
        );
      }

      const { username, password, contentId, charName } = request.payload as {
        username: string;
        password: string;
        contentId?: string;
        charName?: string;
      };

      const result = await register(username, password, contentId, charName);
      return h.response(result).code(201);
    },
  },

  // ── Login ─────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/v1/ffxiv/login',
    options: {
      auth: false,
      validate: {
        payload: Joi.object({
          username: Joi.string().min(3).max(30).required(),
          password: Joi.string().min(6).required(),
          contentId: Joi.string().optional(),
          charName: Joi.string().optional(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) => {
      const ip = getClientIp(request);
      const { allowed, retryAfterMs } = checkRateLimit(`ffxiv-login:${ip}`, 5, 60_000);
      if (!allowed) {
        throw Boom.tooManyRequests(
          `Too many login attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
        );
      }

      const { username, password, contentId, charName } = request.payload as {
        username: string;
        password: string;
        contentId?: string;
        charName?: string;
      };

      return login(username, password, contentId, charName);
    },
  },

  // ── Chat (TTS generation + broadcast) ─────────────────────
  {
    method: 'POST',
    path: '/api/v1/ffxiv/chat',
    options: {
      auth: false, // Manual FFXIV JWT validation
      validate: {
        payload: Joi.object({
          message: Joi.string().max(500).required(),
          zone: Joi.number().optional(),
          mapId: Joi.number().optional(),
          x: Joi.number().optional(),
          y: Joi.number().optional(),
          z: Joi.number().optional(),
        }),
      },
    },
    handler: async (request: Request, h: ResponseToolkit) => {
      const decoded = validateFfxivAuth(request);

      const { message, zone, mapId, x, y, z } = request.payload as {
        message: string;
        zone?: number;
        mapId?: number;
        x?: number;
        y?: number;
        z?: number;
      };

      const user = await Data.ffxivUser.findById(decoded.id);
      if (!user) {
        throw Boom.notFound('User not found');
      }

      // Dedup: if this exact message was already processed recently, skip TTS
      // (multiple clients send the same chat message they see)
      const dedupKey = message.toLowerCase().trim();
      const lastSeen = recentMessages.get(dedupKey);
      if (lastSeen && Date.now() - lastSeen < 5000) {
        // Already processed — just update this user's position and return
        if (zone || mapId || x || y || z) {
          updatePlayerPosition(decoded.id, zone || 0, mapId || 0, x || 0, y || 0, z || 0);
        }
        return h.response({ status: 'duplicate', voice: user.voice_id }).code(200);
      }
      recentMessages.set(dedupKey, Date.now());

      const jobId = `tts-${decoded.id}-${Date.now()}`;
      const senderPos = { x: x || 0, y: y || 0, z: z || 0 };

      // Update player position if provided
      if (zone || mapId || x || y || z) {
        updatePlayerPosition(decoded.id, zone || 0, mapId || 0, senderPos.x, senderPos.y, senderPos.z);
      }

      // Queue TTS generation async — don't block the response
      generateTTS(decoded.id, message).then((wavBuffer) => {
        console.log(`[FFXIVoices] TTS done for ${user.char_name}, ${wavBuffer.length} bytes, broadcasting...`);
        broadcastAudio(
          decoded.id,
          user.char_name || 'Unknown',
          message,
          wavBuffer,
          zone || 0,
          mapId || 0,
          senderPos,
        );
      }).catch((err) => {
        console.error(`[FFXIVoices] TTS generation failed for job ${jobId}:`, err);
      });

      return h.response({
        status: 'queued',
        voice: user.voice_id,
        jobId,
      }).code(202);
    },
  },

  // ── List voices ───────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/ffxiv/voices',
    options: {
      auth: false,
    },
    handler: async () => {
      return pollyAdapter.listVoices();
    },
  },

  // ── Select voice ──────────────────────────────────────────
  {
    method: 'PUT',
    path: '/api/v1/ffxiv/voices/select',
    options: {
      auth: false, // Manual FFXIV JWT validation
      validate: {
        payload: Joi.object({
          voiceId: Joi.string().required(),
        }),
      },
    },
    handler: async (request: Request) => {
      const decoded = validateFfxivAuth(request);

      const { voiceId } = request.payload as { voiceId: string };

      const user = await Data.ffxivUser.update(decoded.id, { voice_id: voiceId });

      return {
        voiceId: user.voice_id,
        message: 'Voice updated successfully',
      };
    },
  },
];

export { ffxivRoutes };
