import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['core/**/*.test.ts', 'services/api/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'services/web', 'packages'],
    coverage: {
      provider: 'v8',
      include: ['core/**/*.ts', 'services/api/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/interfaces/**', 'prisma/**'],
    },
  },
  resolve: {
    alias: {
      '#data': path.resolve(__dirname, 'core/data'),
      '#prisma': path.resolve(__dirname, 'prisma'),
      '@commslink/core': path.resolve(__dirname, 'core'),
    },
  },
});
