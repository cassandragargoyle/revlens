import * as vscode from 'vscode';
import { BundleEditorProvider } from './bundle-editor.js';
import { buildBundleCommand } from './build-command.js';
import type { BuildLog } from './build-command.js';
import { tryExampleCommand } from './example-command.js';
import { describeCapabilities, detectCapabilities } from './host.js';

/**
 * The extension entry, written for two hosts.
 *
 * Activation is lazy - `onCustomEditor:revlens.bundle` - so neither host pays for the
 * viewer until a bundle is opened. Everything past the editor registration is optional
 * and asked for rather than assumed; see `host.ts` for why.
 */

export function activate(context: vscode.ExtensionContext): void {
  const capabilities = detectCapabilities(vscode);
  const channel = createChannel(context);
  channel.appendLine(`revlens activated: ${describeCapabilities(capabilities)}`);
  const log = (message: string): void => channel.appendLine(message);

  const provider = new BundleEditorProvider(context.extensionPath, capabilities, log);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(BundleEditorProvider.viewType, provider, {
      // A bundle is expensive to parse and the reader switches tabs while comparing.
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

  if (!capabilities.commands) return;

  context.subscriptions.push(
    vscode.commands.registerCommand('revlens.openBundle', async (uri?: vscode.Uri) => {
      const target = uri ?? (await pickBundle());
      if (target === undefined) return;
      await vscode.commands.executeCommand('vscode.openWith', target, BundleEditorProvider.viewType);
    }),
    vscode.commands.registerCommand('revlens.showBundleSource', async (uri?: vscode.Uri) => {
      const target = uri ?? (await pickBundle());
      if (target === undefined) return;
      await vscode.window.showTextDocument(target, { preview: false });
    }),
    vscode.commands.registerCommand('revlens.reloadBundle', async () => {
      await provider.reloadAll();
    }),
    // Building a bundle used to mean leaving the application for a checkout and a
    // command line; this is the same build, asked for from inside the host
    vscode.commands.registerCommand('revlens.buildBundle', async (uri?: vscode.Uri) => {
      await buildBundleCommand(channel, uri);
    }),
    // The first build is the hard one: it asks six questions about a shape nobody has
    // described. This writes one of each onto disk and builds it, so the shape is
    // something the reader can open rather than something they have to imagine
    vscode.commands.registerCommand('revlens.tryExample', async () => {
      await tryExampleCommand(channel, context.extensionPath);
    }),
  );
}

async function pickBundle(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Open in revlens',
    filters: { 'Revision bundle': ['revlens', 'json'] },
  });
  return picked?.[0];
}

/**
 * Where the extension says what it did, and where a build's report goes.
 *
 * An output channel is the right place in every host that has one. A host without them
 * gets a console-backed stand-in of the same shape, so neither the activation log nor a
 * build report simply disappears.
 */
function createChannel(context: vscode.ExtensionContext): BuildLog {
  const createOutputChannel = (
    vscode.window as { createOutputChannel?: (name: string) => vscode.OutputChannel }
  ).createOutputChannel;

  if (typeof createOutputChannel !== 'function') {
    return {
      name: 'revlens',
      appendLine: (message: string): void => console.log(`[revlens] ${message}`),
      show: (): void => {
        // Nothing to raise without a channel
      },
    };
  }

  const channel = createOutputChannel('revlens');
  context.subscriptions.push(channel);
  return channel;
}
