import Boom from '@hapi/boom';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, createReadStream, statSync } from 'fs';
import { join } from 'path';

import Data from '../../../../../core/data';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

const RELEASES_DIR = join(process.cwd(), 'data', 'game-releases');
if (!existsSync(RELEASES_DIR)) mkdirSync(RELEASES_DIR, { recursive: true });

const gameUpdateRoutes: ServerRoute[] = [
  // ── Version Check ──
  {
    method: 'GET',
    path: '/api/v1/game/version',
    options: { auth: false },
    handler: async (request: Request, h: ResponseToolkit) => {
      const versionFile = join(RELEASES_DIR, 'version.json');
      if (!existsSync(versionFile)) {
        return h.response({ error: 'No release available' }).code(404);
      }
      try {
        const data = JSON.parse(readFileSync(versionFile, 'utf-8'));
        // Add downloadUrl for Unity client
        data.downloadUrl = 'https://commslink.net/game/build.zip';
        return data;
      } catch {
        return h.response({ error: 'Failed to read version info' }).code(500);
      }
    },
  },

  // ── Download Game Build ──
  {
    method: 'GET',
    path: '/api/v1/game/download',
    options: { auth: false },
    handler: async (request: Request, h: ResponseToolkit) => {
      const zipPath = join(RELEASES_DIR, 'latest.zip');
      if (!existsSync(zipPath)) {
        return h.response({ error: 'No release available' }).code(404);
      }
      const stat = statSync(zipPath);
      return h.response(createReadStream(zipPath))
        .type('application/zip')
        .header('Content-Disposition', 'attachment; filename="AIFightClub-latest.zip"')
        .header('Content-Length', String(stat.size));
    },
  },

  // ── Upload Game Build (Admin Only) ──
  {
    method: 'POST',
    path: '/api/v1/game/upload',
    options: {
      auth: false,
      payload: {
        maxBytes: 500 * 1024 * 1024, // 500MB for game builds
        parse: false,
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

      let decoded: { id: string };
      try {
        decoded = jwt.verify(token, secret) as { id: string };
      } catch {
        throw Boom.unauthorized('Invalid token');
      }

      const user = await Data.user.findById(decoded.id);
      if (!user || !user.is_admin) throw Boom.forbidden('Admin access required');

      const version = request.query.version as string;
      const changelog = request.query.changelog as string || '';

      if (!version) throw Boom.badRequest('version query parameter is required');

      const rawBody = request.payload as Buffer;
      if (!rawBody || rawBody.length < 4) throw Boom.badRequest('Empty payload');

      // Verify ZIP magic bytes
      if (rawBody[0] !== 0x50 || rawBody[1] !== 0x4B) {
        throw Boom.badRequest('Not a valid ZIP file');
      }

      const sha256 = createHash('sha256').update(rawBody).digest('hex');

      writeFileSync(join(RELEASES_DIR, 'latest.zip'), rawBody);

      // Also write to nginx-served directory for direct download
      const nginxGameDir = '/var/www/commslink/game';
      try {
        if (existsSync(nginxGameDir)) {
          writeFileSync(join(nginxGameDir, 'build.zip'), rawBody);
        }
      } catch (err) {
        console.error('[GameUpdate] Could not write to nginx game dir:', err);
      }

      const metadata = {
        version,
        changelog: decodeURIComponent(changelog),
        sha256,
        size: rawBody.length,
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(join(RELEASES_DIR, 'version.json'), JSON.stringify(metadata, null, 2));

      console.log(`[GameUpdate] Build uploaded: v${version}, ${(rawBody.length / 1024 / 1024).toFixed(1)}MB, sha256=${sha256.substring(0, 16)}...`);

      return metadata;
    },
  },
];

export { gameUpdateRoutes };
