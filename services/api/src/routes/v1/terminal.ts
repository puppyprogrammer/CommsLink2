import { existsSync, createReadStream } from 'fs';
import { join } from 'path';

import tracer from '../../../../../core/lib/tracer';

import type { ServerRoute, Request, ResponseToolkit } from '@hapi/hapi';

const BIN_DIR = process.env.TERMINAL_AGENT_BIN_DIR || join(__dirname, '..', '..', '..', '..', '..', '..', 'packages', 'terminal-agent', 'bin');

const PLATFORM_MAP: Record<string, { file: string; contentType: string }> = {
  win: { file: 'commslink-agent-win.exe', contentType: 'application/octet-stream' },
  linux: { file: 'commslink-agent-linux', contentType: 'application/octet-stream' },
  macos: { file: 'commslink-agent-macos', contentType: 'application/octet-stream' },
};

const terminalRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/terminal/download/{platform}',
    options: { auth: false },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.TERMINAL.DOWNLOAD', async () => {
        const platformKey = request.params.platform as string;
        const platformInfo = PLATFORM_MAP[platformKey];

        if (!platformInfo) {
          return h
            .response({ data: { result: 'FAIL', message: 'Invalid platform. Use: win, linux, or macos' } })
            .code(400);
        }

        const filePath = join(BIN_DIR, platformInfo.file);

        if (!existsSync(filePath)) {
          return h
            .response({ data: { result: 'FAIL', message: 'Binary not available. Contact admin.' } })
            .code(404);
        }

        return h
          .response(createReadStream(filePath))
          .type(platformInfo.contentType)
          .header('Content-Disposition', `attachment; filename="${platformInfo.file}"`);
      }),
  },
  {
    method: 'POST',
    path: '/api/v1/terminal/setup-code',
    options: { auth: 'jwt' },
    handler: async (request: Request, h: ResponseToolkit) =>
      tracer.trace('CONTROLLER.TERMINAL.SETUP_CODE', async () => {
        const { machineName, server } = request.payload as { machineName: string; server?: string };
        const credentials = request.auth.credentials as { id: string; username: string };

        const code = Buffer.from(
          JSON.stringify({
            server: server || process.env.CLIENT_URL?.replace('http', 'ws') || 'wss://commslink.net',
            username: credentials.username,
            machineName: machineName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          }),
        ).toString('base64');

        return { data: { result: 'SUCCESS', setupCode: code } };
      }),
  },
];

export { terminalRoutes };
