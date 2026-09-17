import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/**
 * The file life-cycle: what counts as a bundle, where one comes from, and following it
 *
 * Nothing here touches Electron. A window is opened by four routes - the command line,
 * File -> Open, a file dropped on the window, and a double-click once the association is
 * installed - and every one of them ends in a path. The routes are the main process's
 * business; deciding what the path means is this module's, so it can be tested without
 * an Electron process.
 */

/**
 * `*.revlens`, and `*.revlens.json` because the extension accepts it too.
 *
 * The operating system association is on `revlens` alone: Pilot matches a plain
 * `path.extname`, so a compound extension never matches there, and this file stays the
 * one place that knows both spellings.
 */
const BUNDLE_NAME = /\.revlens(\.json)?$/i;

export function isBundlePath(candidate: string): boolean {
  return BUNDLE_NAME.test(candidate);
}

/**
 * The bundles named on the command line.
 *
 * Everything else is dropped rather than guessed at: `electron .` puts the application
 * directory in `argv`, a packaged application is started with Chromium's own switches,
 * and Windows re-launches the executable with the dropped file appended. Taking only the
 * arguments that name a bundle covers all three without a rule per host.
 */
export function bundlePathsFromArgv(argv: readonly string[]): string[] {
  return argv
    .slice(1)
    .filter((argument) => !argument.startsWith('-') && isBundlePath(argument))
    .map((argument) => resolve(argument));
}

export interface FileWatch {
  close(): void;
}

/** Quiet enough to coalesce a rewrite, short enough that a rebuild feels immediate. */
const SETTLE_MS = 150;

/**
 * Follow one file, so a rebuild lands in the open window.
 *
 * The directory is watched rather than the file: `revlens build` writes a new file and
 * renames it into place, and a watch on the old inode would see nothing at all. Events
 * arrive in bursts - a write, a rename, a chmod - so the callback is made once the file
 * has been quiet for a moment.
 */
export function watchBundleFile(
  fsPath: string,
  onChange: () => void,
  settleMs: number = SETTLE_MS,
): FileWatch {
  const name = basename(fsPath);
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher;

  try {
    watcher = watch(dirname(fsPath), { persistent: false }, (_event, changed) => {
      if (changed !== null && changed !== undefined && basename(changed.toString()) !== name) {
        return;
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(onChange, settleMs);
    });
  } catch {
    // A directory that cannot be watched - a network share, a container mount - is a
    // reason to stop following the file, not to stop showing it.
    return { close: (): void => undefined };
  }

  return {
    close: (): void => {
      if (timer !== undefined) clearTimeout(timer);
      watcher.close();
    },
  };
}
