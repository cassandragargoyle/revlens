import { mkdtempSync, rmSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundlePathsFromArgv, isBundlePath, watchBundleFile } from '../src/open.js';

/**
 * The file life-cycle, without an Electron process.
 *
 * Four routes end in a path - the command line, File -> Open, a dropped file and the
 * operating system association - and every one of them is this module's `argv` case or
 * nothing at all, which is why the routes themselves are the only part left in `main.ts`.
 */

describe('isBundlePath', () => {
  it('accepts both spellings the extension accepts', () => {
    expect(isBundlePath('/tmp/round-3.revlens')).toBe(true);
    expect(isBundlePath('/tmp/round-3.revlens.json')).toBe(true);
    expect(isBundlePath('C:\\rounds\\Round-3.REVLENS')).toBe(true);
  });

  it('rejects anything else, including the JSON a bundle is made of', () => {
    expect(isBundlePath('/tmp/bundle.json')).toBe(false);
    expect(isBundlePath('/tmp/revlens')).toBe(false);
    expect(isBundlePath('/tmp/notes.md')).toBe(false);
  });
});

describe('bundlePathsFromArgv', () => {
  it('takes the bundles and leaves the rest of the command line alone', () => {
    const argv = [
      '/usr/bin/electron',
      '.',
      '--enable-logging',
      'out/example.revlens',
      'notes.md',
    ];

    expect(bundlePathsFromArgv(argv)).toEqual([resolve('out/example.revlens')]);
  });

  it('reads the argument a packaged application is started with', () => {
    expect(bundlePathsFromArgv(['/opt/revlens/revlens', '/home/r/round-3.revlens'])).toEqual([
      '/home/r/round-3.revlens',
    ]);
  });

  it('finds nothing when the application was started on its own', () => {
    expect(bundlePathsFromArgv(['/usr/bin/electron', '.'])).toEqual([]);
  });
});

describe('watchBundleFile', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'revlens-watch-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /** A rebuild writes a new file and renames it into place; a watch on the old inode sees nothing. */
  it('notices the file being replaced, not only written', async () => {
    const bundle = join(directory, 'round.revlens');
    await writeFile(bundle, '{}', 'utf8');

    const changes = await new Promise<number>((resolveWith) => {
      let count = 0;
      const watch = watchBundleFile(
        bundle,
        () => {
          count += 1;
          watch.close();
          resolveWith(count);
        },
        10,
      );

      void (async (): Promise<void> => {
        const staging = join(directory, 'round.revlens.tmp');
        await writeFile(staging, '{"document":{}}', 'utf8');
        await rename(staging, bundle);
      })();
    });

    expect(changes).toBe(1);
  });

  it('ignores its neighbours in the same directory', async () => {
    const bundle = join(directory, 'round.revlens');
    await writeFile(bundle, '{}', 'utf8');

    let called = 0;
    const watch = watchBundleFile(bundle, () => {
      called += 1;
    }, 10);

    await writeFile(join(directory, 'other.revlens'), '{}', 'utf8');
    await new Promise((done) => setTimeout(done, 80));
    watch.close();

    expect(called).toBe(0);
  });

  it('is a no-op rather than a crash when the directory cannot be watched', () => {
    const watch = watchBundleFile(join(directory, 'gone', 'round.revlens'), () => {
      throw new Error('must not be called');
    });

    expect(() => watch.close()).not.toThrow();
  });
});
