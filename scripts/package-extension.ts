import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One `.vsix` for both hosts.
 *
 * Visual Studio Code installs it from the file, Pilot installs it from its catalog, and
 * neither gets a build of its own - the compatibility difference is declared in
 * `apps/pilot/pilot-plugin.json`, not compiled in. The build is run here rather than
 * assumed, because packaging a stale `dist/` is the one mistake that produces a plausible
 * `.vsix` which shows an old document.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(repoRoot, 'apps', 'vscode');
const defaultOutputDir = join(repoRoot, 'dist');

export interface PackagedVsix {
  readonly version: string;
  /** File name only, which is what a Pilot catalog entry carries. */
  readonly file: string;
  /** Absolute path of the packaged file. */
  readonly path: string;
  readonly sha256: string;
}

export function packageExtension(outputDir: string = defaultOutputDir): PackagedVsix {
  const manifest = JSON.parse(readFileSync(join(extensionDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    publisher: string;
  };

  const viewerIndex = join(repoRoot, 'apps', 'web', 'dist', 'index.html');
  if (!existsSync(viewerIndex)) {
    throw new Error(`the viewer is not built - run \`npm run build\` first (looked for ${viewerIndex})`);
  }

  run('node', [join(extensionDir, 'esbuild.mjs')], repoRoot);

  // The licence travels with the artifact. One file is the source of truth; the copy is a
  // build output, ignored by git, so the two cannot drift.
  copyFileSync(join(repoRoot, 'LICENSE'), join(extensionDir, 'LICENSE'));

  mkdirSync(outputDir, { recursive: true });
  const file = `${manifest.publisher.toLowerCase()}.${manifest.name}-${manifest.version}.vsix`;
  const target = join(outputDir, file);

  run('npx', ['--yes', '@vscode/vsce', 'package', '--no-dependencies', '-o', target], extensionDir);

  return {
    version: manifest.version,
    file: basename(target),
    path: target,
    sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
  };
}

/**
 * Run a fixed, repository-controlled command.
 *
 * On Windows `npx` is a `.cmd` shim that needs a shell, and passing an argument array
 * with `shell: true` trips Node's DEP0190 - so the arguments are quoted into one string
 * there, the way `portunix-vscode` does it for the same reason.
 */
function run(command: string, args: readonly string[], cwd: string): void {
  console.log(`  $ ${command} ${args.join(' ')}`);
  const result =
    process.platform === 'win32'
      ? spawnSync([command, ...args].map(quoteForCmd).join(' '), { cwd, stdio: 'inherit', shell: true })
      : spawnSync(command, [...args], { cwd, stdio: 'inherit', shell: false });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`);
  }
}

function quoteForCmd(token: string): string {
  return /[\s&|<>^"]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token;
}

// Running the file packages into `dist/`; importing it leaves the choice to the caller.
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const packaged = packageExtension();
  console.log(`\nPackaged ${packaged.file} (sha256 ${packaged.sha256.slice(0, 12)}...)`);
  console.log(`  install with: code --install-extension ${packaged.path}`);
}
