import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // "server-only" throws outside React Server Components; tests run on the server anyway.
      'server-only': path.resolve(__dirname, 'tests/server-only.ts'),
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
