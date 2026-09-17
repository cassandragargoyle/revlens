import { basename, dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { readBundleFile } from './bundle-file.js';
import { buildErrorPage, buildViewerPage } from './webview-html.js';
import type { HostCapabilities } from './host.js';

/**
 * A revision bundle, opened as the document it describes.
 *
 * The editor is readonly because a bundle is derived: it is what `revlens build` made of
 * a repository's history, and the way to change it is to rebuild it, not to edit the
 * JSON. `CustomReadonlyEditorProvider` says exactly that to both hosts, and it is the
 * one editor contribution the Pilot State A host implements.
 *
 * Paths are assembled with `node:path` and `Uri.file` rather than `Uri.joinPath`, which
 * the State A host does not have. Same for `RelativePattern` below.
 */

/** The nonce is per render, so a stale page cannot run its scripts against a new one. */
const NONCE_BYTES = 16;

interface OpenViewer {
  readonly panel: vscode.WebviewPanel;
  readonly fsPath: string;
  readonly fileName: string;
  render(): Promise<void>;
}

export class BundleEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'revlens.bundle';

  private readonly open = new Set<OpenViewer>();

  constructor(
    private readonly extensionPath: string,
    private readonly capabilities: HostCapabilities,
    private readonly log: (message: string) => void,
  ) {}

  public openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: (): void => undefined };
  }

  public async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const fsPath = document.uri.fsPath;
    const fileName = basename(fsPath);
    const viewerRoot = join(this.extensionPath, 'media', 'viewer');

    panel.webview.options = {
      enableScripts: true,
      // The page may read the built viewer and nothing else - not the workspace, and not
      // even the bundle, which it receives inline.
      localResourceRoots: [vscode.Uri.file(viewerRoot)],
    };

    const viewer: OpenViewer = {
      panel,
      fsPath,
      fileName,
      render: async (): Promise<void> => {
        panel.webview.html = await this.renderPage(panel.webview, viewerRoot, fsPath, fileName);
      },
    };

    this.open.add(viewer);
    panel.onDidDispose(() => {
      this.open.delete(viewer);
    });

    this.watch(viewer, panel);
    await viewer.render();
  }

  /** Re-render every open viewer - the fallback where no file watcher exists. */
  public async reloadAll(): Promise<void> {
    await Promise.all([...this.open].map((viewer) => viewer.render()));
  }

  private async renderPage(
    webview: vscode.Webview,
    viewerRoot: string,
    fsPath: string,
    fileName: string,
  ): Promise<string> {
    const result = await readBundleFile(fsPath, fileName);
    const cspSource = webview.cspSource;

    if (!result.ok) {
      this.log(`${fileName}: ${result.problem}`);
      return buildErrorPage({
        title: fileName,
        problem: result.problem,
        detail: result.detail,
        cspSource,
      });
    }

    for (const warning of result.warnings) {
      this.log(`${fileName}: ${warning}`);
    }

    let indexHtml: string;
    try {
      indexHtml = await readFile(join(viewerRoot, 'index.html'), 'utf8');
    } catch (error) {
      return buildErrorPage({
        title: fileName,
        problem: 'The bundled viewer is missing from this build of the extension.',
        detail: [error instanceof Error ? error.message : String(error)],
        cspSource,
      });
    }

    return buildViewerPage({
      indexHtml,
      assetUri: (relativePath) =>
        webview.asWebviewUri(vscode.Uri.file(join(viewerRoot, relativePath))).toString(),
      cspSource,
      nonce: randomBytes(NONCE_BYTES).toString('base64'),
      bundleJson: result.json,
    });
  }

  /**
   * Follow the file, so a rebuild lands in the open editor.
   *
   * `revlens serve` re-reads its bundle on a rebuild; the editor should not be the one
   * place that keeps showing yesterday's attribution. The watcher is created through
   * whichever of the two shapes the host understands, and where it has none the
   * `revlens.reloadBundle` command is the way back.
   */
  private watch(viewer: OpenViewer, panel: vscode.WebviewPanel): void {
    if (!this.capabilities.fileWatcher) return;
    const enabled = vscode.workspace.getConfiguration('revlens').get<boolean>('reloadOnChange');
    if (enabled === false) return;

    let watcher: vscode.FileSystemWatcher;
    try {
      watcher = vscode.workspace.createFileSystemWatcher(this.watchPattern(viewer.fsPath));
    } catch (error) {
      this.log(`${viewer.fileName}: not watching the file - ${String(error)}`);
      return;
    }

    const reload = (): void => {
      void viewer.render();
    };
    watcher.onDidChange?.(reload);
    watcher.onDidCreate?.(reload);
    panel.onDidDispose(() => watcher.dispose());
  }

  /**
   * The same intent in the two shapes the two hosts understand.
   *
   * Visual Studio Code wants a `RelativePattern`, so the watch is scoped to one file
   * outside the workspace as well as inside it. The State A host has no such class and
   * hands the string straight to `fs.watch`, where a path is what it wants.
   */
  private watchPattern(fsPath: string): vscode.GlobPattern {
    const { RelativePattern } = vscode as {
      RelativePattern?: new (base: vscode.Uri, pattern: string) => vscode.RelativePattern;
    };
    if (typeof RelativePattern === 'function') {
      return new RelativePattern(vscode.Uri.file(dirname(fsPath)), basename(fsPath));
    }
    return fsPath;
  }
}
