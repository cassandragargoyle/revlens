import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Where the built single-page viewer is.
 *
 * The CLI runs both from `dist` and straight from `src` through `tsx`, and both sit one
 * directory below `apps/cli`, so one relative path covers them.
 */
export function findWebRoot(): string | undefined {
  const candidates = ['../../web/dist', '../../../apps/web/dist'].map((relative) =>
    fileURLToPath(new URL(relative, import.meta.url)),
  );
  return candidates.find((candidate) => existsSync(candidate));
}
