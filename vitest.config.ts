import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

// Tests run against the sources, not against the build output, so `npm test` needs no
// prior `npm run build`. Production resolution goes through the package exports.
export default defineConfig({
  resolve: {
    alias: {
      '@revlens/core': resolve('./packages/core/src/index.ts'),
      '@revlens/adapters': resolve('./packages/adapters/src/index.ts'),
      '@revlens/server': resolve('./apps/server/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.{ts,tsx}'],
    // The web tests ask for jsdom with a docblock pragma of their own, so the default
    // environment stays node and the fast tests are not slowed by a DOM they never touch.
    globals: false,
    testTimeout: 30_000,
  },
});
