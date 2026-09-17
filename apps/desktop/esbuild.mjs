import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/**
 * Packaging the desktop application: two CommonJS files, plus the built viewer beside them.
 *
 * `electron` stays external because the runtime provides it. Everything else is bundled,
 * so what `electron-builder` packs is `dist/` and `media/` and no `node_modules` at all -
 * which is also why a workspace symlink can never end up inside an installer.
 *
 * CommonJS rather than ESM: a sandboxed preload script has to be CommonJS, and there is
 * nothing to gain from the main process being the one file in a different format.
 *
 * `@revlens/*` resolves to sources rather than to `dist`, the way the Vite, Vitest and
 * extension builds already do it here: one build step fewer, and the application can
 * never be built against a stale `dist`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const viewerSource = join(repoRoot, 'apps', 'web', 'dist');
const viewerTarget = join(here, 'media', 'viewer');
const iconSource = join(here, 'build', 'icon.png');
const iconTarget = join(here, 'media', 'icon.png');
const watch = process.argv.includes('--watch');

/**
 * The product mark, where the running application can reach it.
 *
 * `build/` is the packager's own directory and is not packed, so the icon is copied next
 * to the viewer, which is - see `electron-builder.yml`.
 */
async function copyIcon() {
  await mkdir(dirname(iconTarget), { recursive: true });
  await cp(iconSource, iconTarget);
  console.log(`icon copied into ${iconTarget}`);
}

async function copyViewer() {
  try {
    await readFile(join(viewerSource, 'index.html'), 'utf8');
  } catch {
    throw new Error(
      `the built viewer is not in ${viewerSource} - run \`npm run build:web\` before building the desktop application`,
    );
  }
  await rm(viewerTarget, { recursive: true, force: true });
  await mkdir(viewerTarget, { recursive: true });
  await cp(viewerSource, viewerTarget, { recursive: true });
  console.log(`viewer copied into ${viewerTarget}`);
}

const options = {
  entryPoints: [join(here, 'src', 'main.ts'), join(here, 'src', 'preload.ts')],
  outdir: join(here, 'dist'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
  alias: {
    '@revlens/core': join(repoRoot, 'packages', 'core', 'src', 'index.ts'),
    '@revlens/adapters': join(repoRoot, 'packages', 'adapters', 'src', 'index.ts'),
    '@revlens/viewer-page': join(repoRoot, 'packages', 'viewer-page', 'src', 'index.ts'),
  },
};

await copyViewer();
await copyIcon();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('watching apps/desktop/src ...');
} else {
  await esbuild.build(options);
}
