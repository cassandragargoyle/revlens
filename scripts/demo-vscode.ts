import { execSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What `make demo` does, for the editor rather than for the browser.
 *
 * `make demo` ends in `revlens serve`, which is the viewer on the loopback interface.
 * The extension is the other target of the same viewer, and it cannot be pointed at a
 * URL: it opens a file. So this script stops one step earlier and writes the example
 * bundle under a name the custom editor claims - `*.revlens`, never `*.revlens.json`,
 * because Pilot matches a plain `path.extname`.
 *
 * It is one implementation with three callers, so they cannot drift: `npm run
 * demo:vscode`, the `revlens: build the example bundle` task that `F5` runs first, and
 * `make debug`.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  const example = resolve(argument('--example') ?? join(root, 'examples', '01-revision-round'));
  const language = argument('--language') ?? 'en';
  const out = resolve(argument('--out') ?? join(root, 'out', 'example'));
  const repo = join(out, 'analysis-repo');
  const bundle = join(out, 'example.revlens');
  const records = join(example, language);

  // The extension shows what is in `dist/`, so a demo that skipped the build would show
  // the previous one - the most confusing possible result of pressing F5.
  if (!process.argv.includes('--no-build')) {
    run('npm run build');
  }

  run(
    `npm run --silent example:seed -- --example ${quote(example)} ` +
      `--language ${quote(language)} --out ${quote(repo)}`,
  );
  run(
    `npm run --silent revlens -- build --source engagement ` +
      `--repo ${quote(repo)} --records ${quote(records)} ` +
      `--from baseline --to HEAD --out ${quote(bundle)}`,
  );

  await access(bundle);
  console.log(`\nbundle written to ${bundle}`);

  if (process.argv.includes('--open')) {
    open(bundle, out);
  } else {
    console.log('press F5 in Visual Studio Code, or run `make debug`, to open it in the extension');
  }
}

/**
 * An Extension Development Host with no debugger attached - the quick look.
 *
 * Run and waited for, not detached: `code` hands the window to the running editor and
 * returns at once, and a detached child dies with this process before it gets that far.
 */
function open(bundle: string, workspace: string): void {
  const command =
    `code --extensionDevelopmentPath=${quote(join(root, 'apps', 'vscode'))} ` +
    `${quote(workspace)} ${quote(bundle)}`;
  try {
    run(command);
    console.log('opened an Extension Development Host; press F5 instead to attach a debugger');
  } catch {
    console.error('could not run `code` - is Visual Studio Code on the PATH?');
    console.error(`open it by hand: ${command}`);
  }
}

/*
 * Both `npm` and `code` are `.cmd` shims on Windows, which Node refuses to spawn without
 * a shell - so everything here goes through one, as a single quoted command rather than
 * an argument list the shell would flatten anyway.
 */

function run(command: string): void {
  execSync(command, { cwd: root, stdio: 'inherit', windowsHide: true });
}

function quote(value: string): string {
  return `"${value}"`;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

await main();
