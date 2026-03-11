import type { ServerRoute, Request } from '@hapi/hapi';
import Boom from '@hapi/boom';
import sharp from 'sharp';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';

import grokAdapter from '../../../../../core/adapters/grok';

const UPLOAD_DIR = '/app/uploads';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_DIMENSION = 1920;

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const uploadRoutes: ServerRoute[] = [
  {
    method: 'POST',
    path: '/api/v1/upload/image',
    options: {
      auth: 'jwt',
      payload: {
        maxBytes: MAX_FILE_SIZE,
        parse: true,
        output: 'data',
        multipart: { output: 'annotated' },
        allow: 'multipart/form-data',
      },
    },
    handler: async (request: Request) => {
      const payload = request.payload as Record<string, unknown>;
      const file = payload.file as {
        headers: Record<string, string>;
        payload: Buffer;
      };

      if (!file || !file.payload || !file.headers) {
        throw Boom.badRequest('No file provided');
      }

      const contentType = file.headers['content-type'];
      if (!ALLOWED_TYPES.includes(contentType)) {
        throw Boom.badRequest(`Invalid file type: ${contentType}. Allowed: ${ALLOWED_TYPES.join(', ')}`);
      }

      const rawBuffer = Buffer.from(file.payload);
      if (rawBuffer.length === 0) {
        throw Boom.badRequest('Empty file');
      }

      // Run moderation check
      const base64 = rawBuffer.toString('base64');
      const mimeType = contentType === 'image/gif' ? 'image/png' : contentType; // Grok doesn't accept gif
      try {
        const modResult = await grokAdapter.moderateImage(base64, mimeType);
        if (!modResult.safe) {
          throw Boom.forbidden(`Image rejected: ${modResult.reason || 'Content policy violation'}`);
        }
      } catch (err) {
        if (Boom.isBoom(err)) throw err;
        console.error('[Upload] Moderation error:', err);
        throw Boom.internal('Image moderation check failed');
      }

      // Process image with sharp — resize if needed, convert to webp
      const id = uuid();
      const filename = `${id}.webp`;
      const filepath = path.join(UPLOAD_DIR, filename);

      try {
        let pipeline = sharp(rawBuffer);
        const metadata = await pipeline.metadata();

        if (metadata.width && metadata.width > MAX_DIMENSION) {
          pipeline = pipeline.resize({ width: MAX_DIMENSION, withoutEnlargement: true });
        }
        if (metadata.height && metadata.height > MAX_DIMENSION) {
          pipeline = pipeline.resize({ height: MAX_DIMENSION, withoutEnlargement: true });
        }

        await pipeline.webp({ quality: 85 }).toFile(filepath);
      } catch (err) {
        console.error('[Upload] Sharp error:', err);
        throw Boom.internal('Failed to process image');
      }

      const imageUrl = `/uploads/${filename}`;

      return { url: imageUrl };
    },
  },
];

export { uploadRoutes };
