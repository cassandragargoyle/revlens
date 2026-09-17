import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageExtension } from '../../scripts/package-extension.js';
import { buildCatalog, buildCatalogEntry, parsePluginSeed } from './src/catalog.js';

/**
 * The Pilot target: the packaged extension plus the catalog that offers it.
 *
 * The output is a directory Pilot can be pointed at directly, so nothing is written into
 * anyone's profile by a build. The split is Pilot's own - build is inspectable and
 * repeatable, deploy is a separate, explicit copy (issue 082 in `portunix-vscode`) - and
 * this script only ever does the first half.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const defaultOutputDir = join(repoRoot, 'dist', 'pilot-plugins');

function outputDir(): string {
  const fromArgs = process.argv.indexOf('--out');
  if (fromArgs !== -1 && process.argv[fromArgs + 1] !== undefined) {
    return resolve(process.argv[fromArgs + 1]);
  }
  // The same override Pilot itself honours, so one variable drives build and run.
  const fromEnvironment = process.env.PORTUNIX_PILOT_EXTENSIONS_DIR;
  if (fromEnvironment !== undefined && fromEnvironment.trim() !== '') {
    return resolve(fromEnvironment);
  }
  return defaultOutputDir;
}

const target = outputDir();
mkdirSync(target, { recursive: true });

const seed = parsePluginSeed(JSON.parse(readFileSync(join(here, 'pilot-plugin.json'), 'utf8')));
const packaged = packageExtension(target);
const catalog = buildCatalog([buildCatalogEntry(seed, packaged)]);
const catalogPath = join(target, 'catalog.json');

writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

console.log(`\nWrote ${catalogPath}`);
console.log(`  ${seed.id} v${packaged.version} (${packaged.file})`);
console.log(`  claims: ${seed.fileTypes.map((type) => `*.${type}`).join(', ')}`);
console.log(`\nRun Pilot against it with:\n  PORTUNIX_PILOT_EXTENSIONS_DIR="${target}"`);
console.log('or copy the .vsix and catalog.json into <userData>/extensions.');
