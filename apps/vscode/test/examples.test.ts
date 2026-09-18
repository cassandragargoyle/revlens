import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `Try an Example` only helps a reader who has nothing, and a reader who has nothing has
 * no checkout of revlens either. So what is checked here is the delivery: the material
 * has to be inside the `.vsix`, and the command has to be offered by the manifest.
 *
 * The command itself imports `vscode`, which no test process has; what it calls -
 * `listExamples` and `tryExample` - is covered in `packages/adapters/test/examples.test.ts`
 * against the real examples.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

async function read(relativePath: string): Promise<string> {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

describe('the examples an installed extension carries', () => {
  it('are copied next to the viewer when the extension is built', async () => {
    const esbuild = await read('apps/vscode/esbuild.mjs');

    expect(esbuild).toContain("join(repoRoot, 'examples')");
    expect(esbuild).toContain("join(here, 'media', 'examples')");
    expect(esbuild).toContain('await copyExamples();');
  });

  it('are not excluded from the package the way the sources are', async () => {
    // The patterns only: the file explains itself in comments, and `media` is named
    // there for the reader rather than as a rule.
    const patterns = (await read('apps/vscode/.vscodeignore'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

    expect(patterns).toContain('src/**');
    expect(patterns.some((pattern) => pattern.includes('media'))).toBe(false);
  });

  it('are looked for beside the viewer, under the extension the host installed', async () => {
    const command = await read('apps/vscode/src/example-command.ts');

    expect(command).toContain("join(extensionPath, 'media', 'examples')");
  });
});

describe('what the manifest offers', () => {
  it('contributes Try an Example to the palette', async () => {
    const manifest = JSON.parse(await read('apps/vscode/package.json')) as {
      contributes: { commands: { command: string; title: string }[] };
    };

    const command = manifest.contributes.commands.find(
      (entry) => entry.command === 'revlens.tryExample',
    );
    expect(command?.title).toBe('Try an Example...');
  });

  /**
   * Pilot's State A host has no `commands.registerCommand`, so every command - this one
   * included - registers behind the capability probe and simply is not there instead of
   * failing on activation.
   */
  it('registers the command only where the host has commands', async () => {
    const extension = await read('apps/vscode/src/extension.ts');

    const guard = extension.indexOf('if (!capabilities.commands) return;');
    const registration = extension.indexOf("registerCommand('revlens.tryExample'");
    expect(guard).toBeGreaterThan(-1);
    expect(registration).toBeGreaterThan(guard);
  });
});

describe('the bundle a build writes', () => {
  /**
   * `AGENTS.md`: bundles are named `*.revlens`. Pilot matches a plain `path.extname`, so
   * a `*.revlens.json` file is one of the two hosts cannot open.
   */
  it('is offered the plain extension, never the compound one', async () => {
    const command = await read('apps/vscode/src/build-command.ts');

    expect(command).toContain("'bundle.revlens'");
    expect(command).not.toContain("'bundle.revlens.json'");
  });

  it('takes the folder the explorer menu was invoked on as the repository', async () => {
    const command = await read('apps/vscode/src/build-command.ts');
    const manifest = JSON.parse(await read('apps/vscode/package.json')) as {
      contributes: { menus: { 'explorer/context': { command: string; when: string }[] } };
    };

    const entry = manifest.contributes.menus['explorer/context'].find(
      (item) => item.command === 'revlens.buildBundle',
    );
    expect(entry?.when).toBe('explorerResourceIsFolder');
    expect(command).toMatch(/const repo =\s*\n?\s*folder \?\?/);
  });
});
