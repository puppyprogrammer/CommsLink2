import Joi from 'joi';
import Boom from '@hapi/boom';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, createReadStream } from 'fs';
import { join } from 'path';

import { register, login } from '../../../../../core/actions/ffxiv/authAction';
import { generateTTS } from '../../../../../core/actions/ffxiv/ttsAction';
import pollyAdapter from '../../../../../core/adapters/polly';
import Data from '../../../../../core/data';
import { checkRateLimit } from '../../../../../core/helpers/rateLimiter';
import { broadcastAudio, updatePlayerPosition } from '../../ffxivWs';

const RELEASES_DIR = join(process.cwd(), 'data', 'plugin-releases');
if (!existsSync(RELEASES_DIR)) mkdirSync(RELEASES_DIR, { recursive: true });

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
  username: string;
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

      const result = await register(username, password, contentId, charName, ip);
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

      return login(username, password, contentId, charName, ip);
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

      const user = await Data.user.findById(decoded.id);
      if (!user) {
        throw Boom.notFound('User not found');
      }

      const profile = await Data.ffxivProfile.findByUserId(decoded.id);

      // Dedup: if this exact message was already processed recently, skip TTS
      const dedupKey = message.toLowerCase().trim();
      const lastSeen = recentMessages.get(dedupKey);
      if (lastSeen && Date.now() - lastSeen < 5000) {
        if (zone || mapId || x || y || z) {
          updatePlayerPosition(decoded.id, zone || 0, mapId || 0, x || 0, y || 0, z || 0);
        }
        return h.response({ status: 'duplicate', voice: profile?.voice_id || 'Joanna' }).code(200);
      }
      recentMessages.set(dedupKey, Date.now());

      const jobId = `tts-${decoded.id}-${Date.now()}`;
      const senderPos = { x: x || 0, y: y || 0, z: z || 0 };

      // Update player position if provided
      if (zone || mapId || x || y || z) {
        updatePlayerPosition(decoded.id, zone || 0, mapId || 0, senderPos.x, senderPos.y, senderPos.z);
      }

      // Queue TTS generation async — don't block the response
      generateTTS(decoded.id, message).then((result) => {
        console.log(`[FFXIVoices] TTS done for ${profile?.char_name || user.username}, ${result.buffer.length} bytes (${result.format}), broadcasting...`);
        broadcastAudio(
          decoded.id,
          profile?.char_name || user.username,
          message,
          result.buffer,
          zone || 0,
          mapId || 0,
          senderPos,
          result.format,
        );
      }).catch((err) => {
        console.error(`[FFXIVoices] TTS generation failed for job ${jobId}:`, err);
      });

      return h.response({
        status: 'queued',
        voice: profile?.voice_id || 'Joanna',
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
      // Combine Polly (1 credit/msg) and ElevenLabs (18 credits/50 chars) voices
      const pollyVoices = await pollyAdapter.listVoices();
      const pollyWithCost = pollyVoices.map((v) => ({ ...v, provider: 'polly', credit_cost: 1 }));

      const elevenLabsVoices = [
        { voice_id: 'el:m3yAHyFEFKtbCIM5n7GF', name: 'Ash (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:hpp4J3VqNfWAUOO0d1Us', name: 'Bella (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:FGY2WhTYpPnrIDTdsKH5', name: 'Laura (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:cgSgspJ2msm6clMCkdW9', name: 'Jessica (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:pFZP5JQG7iQjIQuC4Bku', name: 'Lily (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:Xb7hH8MSUJpSbSDYk0k2', name: 'Alice (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:6u6JbqKdaQy89ENzLSju', name: 'Brielle (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:o0M2BxRl1s2s3MZyU17F', name: 'Myriam (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:29vD33N1CtxCmqQRPOHJ', name: 'Drew (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:2EiwWnXFnvU5JabPnv8n', name: 'Clyde (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:AZnzlk1XvdvUeBnXmlld', name: 'Domi (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:CwhRBWXzGAHq8TQ4Fs17', name: 'Roger (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:IKne3meq5aSn9XLyUdCD', name: 'Charlie (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:JBFqnCBsd6RMkjVDRZzb', name: 'George (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:SOYHLrjzK2X1ezoPC6cr', name: 'Harry (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:nPczCjzI2devNBz1zQrb', name: 'Brian (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:onwK4e9ZLuTAKqWW03F9', name: 'Daniel (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:pNInz6obpgDQGcFmaJgB', name: 'Adam (Donor)', provider: 'elevenlabs', credit_cost: 18 },
        { voice_id: 'el:bIHbv24MWmeRgasZH58o', name: 'Will (Donor)', provider: 'elevenlabs', credit_cost: 18 },
      ];

      return [...pollyWithCost, ...elevenLabsVoices];
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

      const profile = await Data.ffxivProfile.update(decoded.id, { voice_id: voiceId });

      return {
        voiceId: profile.voice_id,
        message: 'Voice updated successfully',
      };
    },
  },

  // ── User Profile ────────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/ffxiv/me',
    options: { auth: false },
    handler: async (request: Request) => {
      const decoded = validateFfxivAuth(request);
      const user = await Data.user.findById(decoded.id);
      if (!user) throw Boom.notFound('User not found');

      const profile = await Data.ffxivProfile.findByUserId(decoded.id);

      // Calculate next free credit date (30 days after last grant, or now if never granted)
      const lastGrant = user.last_free_credit_at || user.created_at;
      const nextFreeCredits = new Date(lastGrant.getTime() + 30 * 24 * 60 * 60 * 1000);

      return {
        id: user.id,
        username: user.username,
        charName: profile?.char_name || null,
        voiceId: profile?.voice_id || 'Joanna',
        credit_balance: user.credit_balance,
        next_free_credits: nextFreeCredits.toISOString(),
      };
    },
  },

  // ── Plugin Update: Version Check ────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/ffxiv/update/version',
    options: { auth: false },
    handler: async (request: Request, h: ResponseToolkit) => {
      const versionFile = join(RELEASES_DIR, 'version.json');
      if (!existsSync(versionFile)) {
        return h.response({ error: 'No release available' }).code(404);
      }
      try {
        const data = JSON.parse(readFileSync(versionFile, 'utf-8'));
        return data;
      } catch {
        return h.response({ error: 'Failed to read version info' }).code(500);
      }
    },
  },

  // ── Plugin Update: Download ─────────────────────────────────
  {
    method: 'GET',
    path: '/api/v1/ffxiv/update/download',
    options: { auth: false },
    handler: async (request: Request, h: ResponseToolkit) => {
      const zipPath = join(RELEASES_DIR, 'latest.zip');
      if (!existsSync(zipPath)) {
        return h.response({ error: 'No release available' }).code(404);
      }
      return h.response(createReadStream(zipPath))
        .type('application/zip')
        .header('Content-Disposition', 'attachment; filename="FFXIVoices-latest.zip"');
    },
  },

  // ── Plugin Update: Upload (Admin Only) ──────────────────────
  {
    method: 'POST',
    path: '/api/v1/ffxiv/update/upload',
    options: {
      auth: false,
      payload: {
        maxBytes: 20 * 1024 * 1024, // 20MB
        parse: false, // Raw bytes
        output: 'data',
      },
    },
    handler: async (request: Request, h: ResponseToolkit) => {
      // Manual auth — verify admin
      const rawHeader = request.headers.authorization;
      const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw Boom.unauthorized('Missing authorization');
      }
      const token = authHeader.substring(7);
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error('JWT_SECRET required');

      let decoded: { id: string; type?: string };
      try {
        decoded = jwt.verify(token, secret) as { id: string; type?: string };
      } catch {
        throw Boom.unauthorized('Invalid token');
      }

      // Check admin — works with both CommsLink and FFXIV tokens (same user table now)
      const user = await Data.user.findById(decoded.id);
      if (!user || !user.is_admin) throw Boom.forbidden('Admin access required');

      const version = request.query.version as string;
      const changelog = request.query.changelog as string || '';

      if (!version) {
        throw Boom.badRequest('version query parameter is required');
      }

      const rawBody = request.payload as Buffer;
      if (!rawBody || rawBody.length < 4) {
        throw Boom.badRequest('Empty or too small payload');
      }

      // Verify ZIP magic bytes (PK)
      if (rawBody[0] !== 0x50 || rawBody[1] !== 0x4B) {
        throw Boom.badRequest('Not a valid ZIP file');
      }

      const sha256 = createHash('sha256').update(rawBody).digest('hex');

      // Write zip
      const zipPath = join(RELEASES_DIR, 'latest.zip');
      writeFileSync(zipPath, rawBody);

      // Write version.json
      const metadata = {
        version,
        changelog: decodeURIComponent(changelog),
        sha256,
        size: rawBody.length,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(join(RELEASES_DIR, 'version.json'), JSON.stringify(metadata, null, 2));

      console.log(`[FFXIVoices] Plugin release uploaded: v${version}, ${rawBody.length} bytes, sha256=${sha256.substring(0, 16)}...`);

      return metadata;
    },
  },
];

export { ffxivRoutes };
