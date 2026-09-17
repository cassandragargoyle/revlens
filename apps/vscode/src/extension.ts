import * as vscode from 'vscode';
import { BundleEditorProvider } from './bundle-editor.js';
import { describeCapabilities, detectCapabilities } from './host.js';
import type { HostCapabilities } from './host.js';

/**
 * The extension entry, written for two hosts.
 *
 * Activation is lazy - `onCustomEditor:revlens.bundle` - so neither host pays for the
 * viewer until a bundle is opened. Everything past the editor registration is optional
 * and asked for rather than assumed; see `host.ts` for why.
 */

export function activate(context: vscode.ExtensionContext): void {
  const capabilities = detectCapabilities(vscode);
  const log = createLog(context, capabilities);
  log(`revlens activated: ${describeCapabilities(capabilities)}`);

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
 * Where the extension says what it did.
 *
 * An output channel is the right place in Visual Studio Code and does not exist on the
 * State A host, which has the main process console instead - so the log falls back to it
 * rather than disappearing.
 */
function createLog(
  context: vscode.ExtensionContext,
  capabilities: HostCapabilities,
): (message: string) => void {
  const createOutputChannel = (
    vscode.window as { createOutputChannel?: (name: string) => vscode.OutputChannel }
  ).createOutputChannel;

  if (!capabilities.commands || typeof createOutputChannel !== 'function') {
    return (message: string): void => {
      console.log(`[revlens] ${message}`);
    };
  }

  const channel = createOutputChannel('revlens');
  context.subscriptions.push(channel);
  return (message: string): void => {
    channel.appendLine(message);
  };
}
