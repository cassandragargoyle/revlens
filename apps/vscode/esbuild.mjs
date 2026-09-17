import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Packaging the extension: one CommonJS file, plus the built viewer beside it.
 *
 * `vscode` stays external because the host provides it - the real module in Visual
 * Studio Code, the State A shim in Pilot. Everything else is bundled, so the `.vsix`
 * carries no `node_modules` and installs the same way in both hosts.
 *
 * `@revlens/core` resolves to its sources rather than to `packages/core/dist`, the way
 * the Vite and Vitest configs already do it in this workspace: one build step fewer, and
 * the extension can never be built against a stale `dist`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const viewerSource = join(repoRoot, 'apps', 'web', 'dist');
const viewerTarget = join(here, 'media', 'viewer');
const watch = process.argv.includes('--watch');

async function copyViewer() {
  try {
    await readFile(join(viewerSource, 'index.html'), 'utf8');
  } catch {
    throw new Error(
      `the built viewer is not in ${viewerSource} - run \`npm run build:web\` before building the extension`,
    );
  }
  await rm(viewerTarget, { recursive: true, force: true });
  await mkdir(viewerTarget, { recursive: true });
  await cp(viewerSource, viewerTarget, { recursive: true });
  console.log(`viewer copied into ${viewerTarget}`);
}

const options = {
  entryPoints: [join(here, 'src', 'extension.ts')],
  outfile: join(here, 'dist', 'extension.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
  alias: {
    '@revlens/core': join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
  },
};

await copyViewer();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('watching apps/vscode/src ...');
} else {
  await esbuild.build(options);
}
