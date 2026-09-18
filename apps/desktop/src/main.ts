import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { BrowserWindow, Menu, app, dialog, ipcMain, net, protocol, shell } from 'electron';
import type { BuildRequest } from '@revlens/adapters';
import { listExamples, listSources, runBuild, tryExample } from '@revlens/adapters';
import type { FileWatch } from './open.js';
import { bundlePathsFromArgv, isBundlePath, watchBundleFile } from './open.js';
import type { DesktopSettings } from './settings.js';
import {
  DEFAULT_SETTINGS,
  forgetDocument,
  readSettings,
  rememberDocument,
  writeSettings,
} from './settings.js';
import {
  VIEWER_SCHEME,
  buildFormUrl,
  documentUrl,
  renderBuildForm,
  renderDocument,
  renderWelcome,
  resolveAssetPath,
  routeRequest,
  welcomeUrl,
} from './window.js';

/**
 * The desktop application: windows, the menu, and the life-cycle of one file
 *
 * This is the only module that imports Electron, which is why everything worth testing
 * is in the other four. What is left here is the glue a host needs and nothing else -
 * the viewer is given a page, the page is given a bundle, and the bundle comes from a
 * path that arrived by one of four routes.
 */

/** The scheme has to be privileged before the application is ready, so this runs first. */
protocol.registerSchemesAsPrivileged([
  {
    scheme: VIEWER_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

interface DocumentWindow {
  readonly window: BrowserWindow;
  /** Absent until a document is opened into it - an empty window shows the welcome page. */
  fsPath?: string;
  watch?: FileWatch;
}

const windows = new Map<number, DocumentWindow>();

/** Paths that arrived before the application was ready; macOS delivers them that way. */
const pending: string[] = [];

let settings: DesktopSettings = DEFAULT_SETTINGS;

function viewerRoot(): string {
  return join(app.getAppPath(), 'media', 'viewer');
}

/**
 * The examples, copied next to the viewer by `esbuild.mjs`.
 *
 * A packaged window has no checkout to read them from, and the reader who most needs one
 * is exactly the reader who has never seen this repository.
 */
function examplesRoot(): string {
  return join(app.getAppPath(), 'media', 'examples');
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/**
 * The window icon, for the two platforms that will not find one on their own.
 *
 * macOS reads the bundle and needs nothing here. The other two do:
 *
 * X11 has no icon in the window itself - without `_NET_WM_ICON` the window manager falls
 * back to matching `WM_CLASS` against an installed `.desktop` entry, and a bundle opened
 * from a checkout, or an AppImage nobody integrated into a menu, has none.
 *
 * Windows takes it from the executable, which is the right icon only once the packager
 * has written one into it. Run from a checkout the executable is `electron.exe`, so the
 * window carries Electron's own mark instead of ours - which is what a developer and
 * every reviewer of a screenshot sees.
 */
function windowIcon(): string | undefined {
  if (process.platform === 'darwin') return undefined;
  const icon = join(app.getAppPath(), 'media', 'icon.png');
  return existsSync(icon) ? icon : undefined;
}

function html(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/**
 * Every page this application shows, answered from one place.
 *
 * The window id is in the document URL, so a reload is a second request for the same
 * address rather than a second way of rendering a document.
 */
async function handleViewerRequest(request: Request): Promise<Response> {
  const route = routeRequest(request.url);

  switch (route.kind) {
    case 'welcome':
      return html(renderWelcome());

    case 'build':
      return html(renderBuildForm({ sources: listSources() }));

    case 'asset': {
      const file = resolveAssetPath(viewerRoot(), route.pathname);
      if (file === undefined) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    }

    case 'document': {
      const entry = windows.get(route.windowId);
      if (entry === undefined || entry.fsPath === undefined) return html(renderWelcome());

      const rendered = await renderDocument({
        viewerRoot: viewerRoot(),
        fsPath: entry.fsPath,
        fileName: basename(entry.fsPath),
      });
      for (const warning of rendered.warnings) {
        console.warn(`${basename(entry.fsPath)}: ${warning}`);
      }
      if (!entry.window.isDestroyed()) {
        entry.window.setTitle(`${rendered.title} — RevLens`);
      }
      return html(rendered.html);
    }

    default:
      return new Response('not found', { status: 404 });
  }
}

function createWindow(): DocumentWindow {
  const icon = windowIcon();
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'RevLens',
    backgroundColor: '#f2f1ee',
    show: false,
    ...(icon === undefined ? {} : { icon }),
    webPreferences: {
      preload: join(app.getAppPath(), 'dist', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // The viewer's own <title> is the product name; the window says which document it is.
  window.on('page-title-updated', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  const entry: DocumentWindow = { window };
  windows.set(window.id, entry);
  window.on('closed', () => {
    entry.watch?.close();
    windows.delete(window.id);
  });

  return entry;
}

function focusedEntry(sender?: WebContents): DocumentWindow | undefined {
  const window =
    sender === undefined ? BrowserWindow.getFocusedWindow() : BrowserWindow.fromWebContents(sender);
  return window === null || window === undefined ? undefined : windows.get(window.id);
}

/** A window that has no document yet is the one to open into; otherwise a new one. */
function windowToOpenInto(): DocumentWindow {
  const focused = focusedEntry();
  if (focused !== undefined && focused.fsPath === undefined) return focused;
  const empty = [...windows.values()].find((entry) => entry.fsPath === undefined);
  return empty ?? createWindow();
}

function follow(entry: DocumentWindow): void {
  entry.watch?.close();
  entry.watch = undefined;
  if (entry.fsPath === undefined || !settings.reloadOnChange) return;

  entry.watch = watchBundleFile(entry.fsPath, () => {
    if (!entry.window.isDestroyed()) entry.window.webContents.reload();
  });
}

async function remember(fsPath: string): Promise<void> {
  settings = rememberDocument(settings, fsPath);
  app.addRecentDocument(fsPath);
  await writeSettings(settingsFile(), settings);
  buildMenu();
}

async function forget(fsPath: string): Promise<void> {
  settings = forgetDocument(settings, fsPath);
  await writeSettings(settingsFile(), settings);
  buildMenu();
}

export async function openDocument(candidate: string): Promise<void> {
  const fsPath = resolve(candidate);

  if (!isBundlePath(fsPath)) {
    dialog.showMessageBox({
      type: 'info',
      title: 'Not a revision bundle',
      message: `${basename(fsPath)} is not a revision bundle.`,
      detail: 'RevLens opens files written by `revlens build`, named *.revlens.',
    });
    return;
  }

  if (!existsSync(fsPath)) {
    await forget(fsPath);
    dialog.showMessageBox({
      type: 'info',
      title: 'The file is gone',
      message: `${basename(fsPath)} is no longer there.`,
      detail: fsPath,
    });
    return;
  }

  const already = [...windows.values()].find((entry) => entry.fsPath === fsPath);
  if (already !== undefined) {
    already.window.focus();
    return;
  }

  const entry = windowToOpenInto();
  entry.fsPath = fsPath;
  follow(entry);
  await entry.window.loadURL(documentUrl(entry.window.id));
  await remember(fsPath);
}

async function chooseAndOpen(): Promise<void> {
  const chosen = await dialog.showOpenDialog({
    title: 'Open a revision bundle',
    properties: ['openFile'],
    filters: [
      { name: 'RevLens bundle', extensions: ['revlens', 'revlens.json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (chosen.canceled || chosen.filePaths[0] === undefined) return;
  await openDocument(chosen.filePaths[0]);
}

async function openBuildForm(): Promise<void> {
  const existing = [...windows.values()].find(
    (entry) => entry.fsPath === undefined && entry.window.webContents.getURL() === buildFormUrl(),
  );
  if (existing !== undefined) {
    existing.window.focus();
    return;
  }

  const entry = createWindow();
  entry.window.setTitle('Build a Bundle — RevLens');
  await entry.window.loadURL(buildFormUrl());
}

/**
 * Try an Example: a complete engagement written out, built, and opened.
 *
 * The build form asks six questions about a shape nobody has described to a first-time
 * reader. This writes one of each into a folder they chose - the change log, the comment
 * round, the repository - and builds the bundle from it, so the shape is a directory
 * they can open afterwards rather than a paragraph they have to believe.
 */
async function chooseAndTryExample(): Promise<void> {
  const root = examplesRoot();
  const choices = await listExamples(root, app.getLocale().slice(0, 2));

  if (choices.length === 0) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'No examples in this build',
      message: 'This build of RevLens carries no examples.',
      detail: `Looked in ${root}.`,
    });
    return;
  }

  const picked = await dialog.showMessageBox({
    type: 'question',
    title: 'Try an example',
    message: 'Which example would you like to see?',
    detail: choices
      .map((choice) => `${choice.title} — ${choice.description}`)
      .join('\n\n'),
    buttons: [...choices.map((choice) => choice.title), 'Cancel'],
    cancelId: choices.length,
    defaultId: 0,
  });
  const choice = choices[picked.response];
  if (choice === undefined) return;

  const chosen = await dialog.showOpenDialog({
    title: 'An empty folder for the example',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Write it here',
  });
  const target = chosen.filePaths[0];
  if (chosen.canceled || target === undefined) return;

  const outcome = await tryExample({
    root,
    id: choice.id,
    language: choice.language,
    target,
  });

  if (!outcome.ok) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'The example could not be built',
      message: outcome.problem,
      detail: outcome.detail.join('\n'),
    });
    return;
  }

  await openDocument(outcome.out);
}

async function openWelcome(): Promise<void> {
  const entry = createWindow();
  await entry.window.loadURL(welcomeUrl());
}

async function setReloadOnChange(enabled: boolean): Promise<void> {
  settings = { ...settings, reloadOnChange: enabled };
  await writeSettings(settingsFile(), settings);
  for (const entry of windows.values()) follow(entry);
  buildMenu();
}

function buildMenu(): void {
  const recent: MenuItemConstructorOptions[] =
    settings.recent.length === 0
      ? [{ label: 'Nothing opened yet', enabled: false }]
      : [
          ...settings.recent.map((fsPath) => ({
            label: fsPath,
            click: (): void => {
              void openDocument(fsPath);
            },
          })),
          { type: 'separator' as const },
          {
            label: 'Clear the list',
            click: (): void => {
              settings = { ...settings, recent: [] };
              app.clearRecentDocuments();
              void writeSettings(settingsFile(), settings).then(buildMenu);
            },
          },
        ];

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Bundle…',
          accelerator: 'CmdOrCtrl+O',
          click: (): void => {
            void chooseAndOpen();
          },
        },
        { label: 'Open Recent', submenu: recent },
        { type: 'separator' },
        {
          label: 'Build a Bundle…',
          accelerator: 'CmdOrCtrl+B',
          click: (): void => {
            void openBuildForm();
          },
        },
        {
          label: 'Try an Example…',
          click: (): void => {
            void chooseAndTryExample();
          },
        },
        { type: 'separator' },
        {
          label: 'Reload Document',
          accelerator: 'CmdOrCtrl+R',
          click: (): void => {
            focusedEntry()?.window.webContents.reload();
          },
        },
        {
          label: 'Reload When the File Changes',
          type: 'checkbox',
          checked: settings.reloadOnChange,
          click: (item): void => {
            void setReloadOnChange(item.checked);
          },
        },
        {
          label: 'Reveal in File Manager',
          click: (): void => {
            const fsPath = focusedEntry()?.fsPath;
            if (fsPath !== undefined) shell.showItemInFolder(fsPath);
          },
        },
        { type: 'separator' },
        { role: 'close' },
        ...(process.platform === 'darwin' ? [] : [{ role: 'quit' as const }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About RevLens',
          click: (): void => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About RevLens',
              message: `RevLens ${app.getVersion()}`,
              detail:
                'A document revision viewer: the final text with every change highlighted in place, and the revision and the reviewer comment behind each one.',
            });
          },
        },
        {
          label: 'Project Page',
          click: (): void => {
            void shell.openExternal('https://github.com/CassandraGargoyle/revlens');
          },
        },
      ],
    },
  ];

  if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle('revlens:open-bundle', () => chooseAndOpen());
  ipcMain.handle('revlens:build-bundle', () => openBuildForm());
  ipcMain.handle('revlens:try-example', () => chooseAndTryExample());
  ipcMain.handle('revlens:choose-directory', async () => {
    const chosen = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return chosen.canceled ? undefined : chosen.filePaths[0];
  });
  ipcMain.handle('revlens:choose-bundle-target', async () => {
    const chosen = await dialog.showSaveDialog({
      title: 'Write the bundle to',
      defaultPath: 'bundle.revlens',
      filters: [{ name: 'RevLens bundle', extensions: ['revlens'] }],
    });
    return chosen.canceled ? undefined : chosen.filePath;
  });
  ipcMain.handle('revlens:build', async (_event, request: BuildRequest) => {
    const outcome = await runBuild(request);
    if (outcome.ok) await openDocument(outcome.out);
    return outcome;
  });
  ipcMain.handle('revlens:reveal', (event) => {
    const fsPath = focusedEntry(event.sender)?.fsPath;
    if (fsPath !== undefined) shell.showItemInFolder(fsPath);
  });
  ipcMain.handle('revlens:reload', (event) => {
    focusedEntry(event.sender)?.window.webContents.reload();
  });
  ipcMain.handle('revlens:close-window', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.on('revlens:open-dropped', (_event, fsPath: unknown) => {
    if (typeof fsPath === 'string' && fsPath !== '') void openDocument(fsPath);
  });
}

/**
 * One application, however many times it is started.
 *
 * Double-clicking a second bundle while the first is open has to reach the running
 * process, or Windows starts a second application that knows nothing about the first.
 */
function claimSingleInstance(): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', (_event, argv) => {
    const paths = bundlePathsFromArgv(argv);
    if (paths.length === 0) {
      const first = [...windows.values()][0];
      first?.window.focus();
      return;
    }
    for (const fsPath of paths) void openDocument(fsPath);
  });
  return true;
}

/**
 * Who Windows thinks is running.
 *
 * Without it the task bar groups the window under whichever executable started it, and
 * from a checkout that is `electron.exe` - the window gets our icon from `windowIcon`
 * and the task bar button keeps Electron's. The string is `appId` in
 * `electron-builder.yml`, and a test holds the two together.
 */
const APP_USER_MODEL_ID = 'com.cassandragargoyle.revlens';

function start(): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
  if (!claimSingleInstance()) return;

  // macOS opens documents through an event, and it can fire before the application is
  // ready - so early paths are parked rather than dropped.
  app.on('open-file', (event, fsPath) => {
    event.preventDefault();
    if (app.isReady()) void openDocument(fsPath);
    else pending.push(fsPath);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (windows.size === 0) void openWelcome();
  });

  void app.whenReady().then(async () => {
    protocol.handle(VIEWER_SCHEME, handleViewerRequest);
    settings = await readSettings(settingsFile());
    registerIpc();
    buildMenu();

    const initial = [...pending, ...bundlePathsFromArgv(process.argv)];
    pending.length = 0;
    if (initial.length === 0) {
      await openWelcome();
      return;
    }
    for (const fsPath of initial) await openDocument(fsPath);
  });
}

start();
