import { describe, expect, it } from 'vitest';
import { describeCapabilities, detectCapabilities } from '../src/host.js';

/**
 * The two hosts, as far as this extension can tell them apart.
 *
 * The State A shape is the subset listed in `src/electron/extensions/host/README.md` of
 * `portunix-vscode`: a custom editor, a webview, configuration defaults and a file
 * watcher. If Pilot grows an API later, this test is where the new shape is written down.
 */
const visualStudioCode = {
  commands: { registerCommand: (): void => undefined, executeCommand: (): void => undefined },
  window: {
    showErrorMessage: (): void => undefined,
    showTextDocument: (): void => undefined,
    registerCustomEditorProvider: (): void => undefined,
  },
  workspace: {
    getConfiguration: (): void => undefined,
    createFileSystemWatcher: (): void => undefined,
  },
};

const stateAHost = {
  commands: { executeCommand: (): void => undefined },
  window: { registerCustomEditorProvider: (): void => undefined },
  workspace: {
    getConfiguration: (): void => undefined,
    createFileSystemWatcher: (): void => undefined,
  },
};

describe('detectCapabilities', () => {
  it('finds everything in Visual Studio Code', () => {
    expect(detectCapabilities(visualStudioCode)).toEqual({
      commands: true,
      notifications: true,
      fileWatcher: true,
      textDocuments: true,
    });
  });

  it('finds the watcher but no commands on the State A host', () => {
    expect(detectCapabilities(stateAHost)).toEqual({
      commands: false,
      notifications: false,
      fileWatcher: true,
      textDocuments: false,
    });
  });

  it('survives a host that offers none of it', () => {
    expect(detectCapabilities({})).toEqual({
      commands: false,
      notifications: false,
      fileWatcher: false,
      textDocuments: false,
    });
  });

  it('does not mistake a present-but-not-callable member for a capability', () => {
    const half = { commands: { registerCommand: 'soon' }, window: {}, workspace: {} };

    expect(detectCapabilities(half).commands).toBe(false);
  });
});

describe('describeCapabilities', () => {
  it('names what is there and what is not', () => {
    const line = describeCapabilities(detectCapabilities(stateAHost));

    expect(line).toContain('host offers fileWatcher');
    expect(line).toContain('not offered: commands, notifications, textDocuments');
  });

  it('says so plainly when only the viewer works', () => {
    expect(describeCapabilities(detectCapabilities({}))).toContain('nothing beyond the viewer');
  });
});
