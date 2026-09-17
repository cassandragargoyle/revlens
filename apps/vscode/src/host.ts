/**
 * What the host we happen to be running in can actually do.
 *
 * One extension serves two hosts. Visual Studio Code offers the whole API; the Pilot
 * application runs the same `.vsix` on a deliberately small subset - a custom readonly
 * editor, a webview, configuration defaults and a file watcher, and nothing else
 * (`src/electron/extensions/host/` in `portunix-vscode`, ADR-010 there).
 *
 * So the extension asks instead of assuming. The document always opens, because the
 * viewer needs only what both hosts have; the palette commands and the notifications
 * register where they exist, and are silently absent where they do not. The alternative
 * - two extensions around one viewer - would double the surface that can rot without
 * making the viewer any better in either host.
 */

export interface HostCapabilities {
  /** `commands.registerCommand` - the command palette. Absent on the State A host. */
  readonly commands: boolean;
  /** `window.showErrorMessage` and friends. Absent on the State A host. */
  readonly notifications: boolean;
  /** `workspace.createFileSystemWatcher` - reload when a rebuild rewrites the bundle. */
  readonly fileWatcher: boolean;
  /** `window.showTextDocument` - open the bundle as raw JSON beside the document. */
  readonly textDocuments: boolean;
}

/**
 * The probe takes `unknown` on purpose.
 *
 * The argument is the real `vscode` module in one host and a hand-written shim in the
 * other, and a type that described either of them would be a claim about what is there -
 * which is the very thing being asked. So nothing is declared, every step is checked, and
 * a fake in a test needs no cast.
 */
export function detectCapabilities(api: unknown): HostCapabilities {
  return {
    commands: isCallable(member(api, 'commands', 'registerCommand')),
    notifications: isCallable(member(api, 'window', 'showErrorMessage')),
    fileWatcher: isCallable(member(api, 'workspace', 'createFileSystemWatcher')),
    textDocuments: isCallable(member(api, 'window', 'showTextDocument')),
  };
}

/** A one-line summary for the log, so a host surprise is visible in the output channel. */
export function describeCapabilities(capabilities: HostCapabilities): string {
  const present = Object.entries(capabilities)
    .filter(([, available]) => available)
    .map(([name]) => name);
  const missing = Object.entries(capabilities)
    .filter(([, available]) => !available)
    .map(([name]) => name);
  return `host offers ${present.join(', ') || 'nothing beyond the viewer'}` +
    (missing.length === 0 ? '' : `; not offered: ${missing.join(', ')}`);
}

/** Walks a property path without assuming any step of it exists. */
function member(root: unknown, ...path: readonly string[]): unknown {
  let current = root;
  for (const step of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[step];
  }
  return current;
}

function isCallable(value: unknown): boolean {
  return typeof value === 'function';
}
