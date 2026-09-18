import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { BuildOutcome, BuildRequest } from '@revlens/adapters';

/**
 * The one narrow bridge between the window and the main process
 *
 * The renderer runs with node integration off and context isolation on, so what the page
 * can reach is exactly what is listed here: named calls, not a channel. A page that
 * could send arbitrary messages would be a page that could ask the main process to read
 * arbitrary files, and the document in it comes from a file somebody was sent.
 *
 * Dropping a file on the window is wired here as well, and deliberately so: the viewer
 * in `apps/web` must not learn that a desktop host exists, and a preload script is the
 * one place that is in the page without being part of it.
 */

export interface RevlensBridge {
  /** File -> Open, from a button on the empty window. */
  openBundle(): Promise<void>;
  /** Open the form that builds a bundle from a repository. */
  buildBundle(): Promise<void>;
  /** Write a complete example into a chosen folder, build it, and open the result. */
  tryExample(): Promise<void>;
  /** Show the open document in the file manager. */
  reveal(): Promise<void>;
  /** Re-read the file behind this window. */
  reload(): Promise<void>;
  chooseDirectory(): Promise<string | undefined>;
  chooseBundleTarget(): Promise<string | undefined>;
  build(request: BuildRequest): Promise<BuildOutcome>;
  closeWindow(): Promise<void>;
}

const bridge: RevlensBridge = {
  openBundle: () => ipcRenderer.invoke('revlens:open-bundle'),
  buildBundle: () => ipcRenderer.invoke('revlens:build-bundle'),
  tryExample: () => ipcRenderer.invoke('revlens:try-example'),
  reveal: () => ipcRenderer.invoke('revlens:reveal'),
  reload: () => ipcRenderer.invoke('revlens:reload'),
  chooseDirectory: () => ipcRenderer.invoke('revlens:choose-directory'),
  chooseBundleTarget: () => ipcRenderer.invoke('revlens:choose-bundle-target'),
  build: (request) => ipcRenderer.invoke('revlens:build', request),
  closeWindow: () => ipcRenderer.invoke('revlens:close-window'),
};

contextBridge.exposeInMainWorld('revlens', bridge);

/**
 * A file dropped anywhere on the window opens it.
 *
 * `webUtils.getPathForFile` is how a path is read from a dropped file since Electron 32;
 * the older `File.path` is kept as a fallback so a host that still has it works too.
 * Whether the file is a bundle at all is decided in the main process, where the answer
 * to "no" is a dialog rather than a silent nothing.
 */
window.addEventListener('dragover', (event) => {
  event.preventDefault();
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  const dropped = event.dataTransfer?.files?.[0];
  if (dropped === undefined) return;

  const path =
    typeof webUtils?.getPathForFile === 'function'
      ? webUtils.getPathForFile(dropped)
      : (dropped as File & { path?: string }).path;
  if (path === undefined || path === '') return;

  ipcRenderer.send('revlens:open-dropped', path);
});
