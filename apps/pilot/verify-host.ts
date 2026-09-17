import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Does the packaged extension actually run on Pilot's State A host?
 *
 * The compatibility verdict in `pilot-plugin.json` is an assertion, and an assertion
 * about someone else's host is worth very little unless it is checked. This drives
 * Pilot's own compiled modules - catalog validation, `.vsix` unpack, the extension host -
 * against the `.vsix` this repository builds, with a fake `WebviewSurface` in place of
 * the Electron webview. That is Pilot's acceptance path minus the display, so it runs on
 * a build machine with no screen.
 *
 * It needs a checkout of `portunix-vscode` beside this one, and skips - loudly, with exit
 * code 0 - when there is none. A verification that cannot run must not look like one that
 * passed, and must not fail a build that had no way of running it.
 *
 *   npm run verify:pilot-host
 *   PORTUNIX_VSCODE_DIR=/path/to/portunix-vscode npm run verify:pilot-host
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const require = createRequire(import.meta.url);

interface Check {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

const checks: Check[] = [];

function check(label: string, ok: unknown, detail = ''): void {
  const passed = Boolean(ok);
  checks.push({ label, ok: passed, detail });
  console.log(`${passed ? 'pass' : 'FAIL'}  ${label}${detail === '' ? '' : ` - ${detail}`}`);
}

function pilotExtensionsDir(): string | undefined {
  const candidates = [
    process.env.PORTUNIX_VSCODE_DIR,
    join(repoRoot, '..', 'portunix', 'portunix-vscode'),
    join(repoRoot, '..', 'portunix-vscode'),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.trim() !== '');

  for (const candidate of candidates) {
    const compiled = join(resolve(candidate), 'src', 'electron', 'dist', 'electron', 'extensions');
    if (existsSync(join(compiled, 'catalog.js'))) return compiled;
  }
  return undefined;
}

const pilot = pilotExtensionsDir();
if (pilot === undefined) {
  console.log(
    'skipped: no compiled Pilot host found.\n' +
      '  Point PORTUNIX_VSCODE_DIR at a portunix-vscode checkout whose\n' +
      '  src/electron has been built, and run this again.',
  );
  process.exit(0);
}

const catalogDir = join(repoRoot, 'dist', 'pilot-plugins');
if (!existsSync(join(catalogDir, 'catalog.json'))) {
  console.error(`no catalog in ${catalogDir} - run \`npm run package:pilot\` first`);
  process.exit(1);
}

console.log(`Pilot host: ${pilot}\n`);

// Pilot's modules are plain CommonJS with no type declarations; everything below is
// deliberately untyped, and the assertions are what stands in for the types.
const { validateCatalog, findByFileType } = require(join(pilot, 'catalog.js'));
const { unpackVsix, isUnpacked } = require(join(pilot, 'vsix.js'));
const { ExtensionHost } = require(join(pilot, 'host', 'extensionHost.js'));
const { Uri } = require(join(pilot, 'host', 'uri.js'));

const catalog = JSON.parse(readFileSync(join(catalogDir, 'catalog.json'), 'utf8'));
const validated = validateCatalog(catalog);
check(
  'Pilot validates the catalog we write',
  validated.entries.length === 1 && validated.errors.length === 0,
  validated.errors.join('; '),
);

const entry = findByFileType(validated.entries, 'revlens');
check('Pilot matches *.revlens to this plugin', entry?.id === 'cassandragargoyle.revlens');
check('and does not claim every .json file', findByFileType(validated.entries, 'json') === undefined);

const root = mkdtempSync(join(tmpdir(), 'revlens-pilot-'));
const pluginDir = join(root, String(entry.id));
await unpackVsix(join(catalogDir, String(entry.file)), pluginDir);
check('Pilot unpacks the .vsix', isUnpacked(pluginDir));

const host = new ExtensionHost(join(pluginDir, 'extension'));
check('the host resolves the editor from the manifest, without activating', host.resolveViewType('analysis.revlens') === 'revlens.bundle');
check('and matches the compound *.revlens.json name too', host.resolveViewType('analysis.revlens.json') === 'revlens.bundle');

const workspace = join(root, 'work');
mkdirSync(workspace, { recursive: true });
const bundlePath = join(workspace, 'analysis.revlens');
writeFileSync(bundlePath, readFileSync(join(repoRoot, 'fixtures', 'sample-bundle.json'), 'utf8'), 'utf8');

let html = '';
let resourceRoots: unknown[] = [];
const surface = {
  cspSource: 'pilot-resource://revlens',
  asWebviewUri: (fsPath: string): string =>
    `pilot-resource://revlens/${fsPath.replace(/\\/g, '/')}`,
  setLocalResourceRoots: (value: unknown[]): void => {
    resourceRoots = value;
  },
  setHtml: (value: string): void => {
    html = value;
  },
  postMessage: (): void => undefined,
  onMessage: () => (): void => undefined,
  onDispose: () => (): void => undefined,
  dispose: (): void => undefined,
};

await host.openCustomEditor(Uri.file(bundlePath), surface);

check('the host renders a page', html.length > 0, `${html.length} bytes`);
check('with the bundle on the global the viewer reads', html.includes('globalThis.__REVLENS_BUNDLE__'));
check(
  'with the viewer script pointed at the resource protocol',
  /src="pilot-resource:\/\/revlens\/[^"]*assets\/index-[^"]*\.js"/.test(html),
);
check('with no crossorigin attribute left to break the module script', !html.includes('crossorigin'));
check(
  'with a nonce on every script the policy has to allow',
  (html.match(/<script\b[^>]*>/g) ?? []).every((tag) => tag.includes('nonce=')),
);
check(
  'and the resource sandbox scoped to the viewer alone',
  resourceRoots.length === 1 &&
    String((resourceRoots[0] as { fsPath?: string }).fsPath ?? resourceRoots[0])
      .replace(/\\/g, '/')
      .endsWith('media/viewer'),
);

const payload = /globalThis\.__REVLENS_BUNDLE__ = JSON\.parse\((.*)\);/.exec(html);
const recovered = payload === null ? undefined : (JSON.parse(JSON.parse(payload[1]) as string) as { document?: { title?: string } });
check(
  'the document arrives intact, diacritics included',
  recovered?.document?.title === 'Analýza kompetenčního centra',
  recovered?.document?.title ?? 'missing',
);

const brokenPath = join(workspace, 'broken.revlens');
writeFileSync(brokenPath, '{"schemaVersion":"1.0"}', 'utf8');
html = '';
await host.openCustomEditor(Uri.file(brokenPath), surface);
check(
  'a bundle that fails its invariants shows the reason instead of the document',
  html.includes('not a revision bundle this build can show') && !html.includes('__REVLENS_BUNDLE__'),
);

const failed = checks.filter((one) => !one.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
