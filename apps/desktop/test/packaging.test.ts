import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Electron is a dependency of one application, and this is where that stops being a
 * promise in a pull request.
 *
 * INT-004 asks for it structurally: installing and building `core`, `adapters`, `cli`,
 * `server`, `web` or `viewer-page` must not pull Electron. The check is a reading of the
 * manifests, because that is exactly what npm resolves.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

interface Manifest {
  readonly name?: string;
  readonly main?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

async function manifest(relativePath: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(repoRoot, relativePath, 'package.json'), 'utf8')) as Manifest;
}

const ELECTRON = ['electron', 'electron-builder'];

const OTHER_PACKAGES = [
  'packages/core',
  'packages/adapters',
  'packages/viewer-page',
  'apps/cli',
  'apps/server',
  'apps/web',
  'apps/vscode',
  '.',
];

describe('where Electron is allowed to be', () => {
  it('is a devDependency of the desktop application, and only a devDependency', async () => {
    const desktop = await manifest('apps/desktop');

    for (const name of ELECTRON) {
      expect(desktop.devDependencies?.[name]).toBeDefined();
      expect(desktop.dependencies?.[name]).toBeUndefined();
    }
  });

  it('is named by no other manifest in the workspace', async () => {
    for (const relativePath of OTHER_PACKAGES) {
      const found = await manifest(relativePath);
      const declared = { ...found.dependencies, ...found.devDependencies };
      for (const name of ELECTRON) {
        expect(`${relativePath}: ${name} ${String(declared[name])}`).toBe(
          `${relativePath}: ${name} undefined`,
        );
      }
    }
  });

  it('packs nothing from node_modules, because esbuild has already bundled it', async () => {
    const desktop = await manifest('apps/desktop');
    expect(desktop.dependencies).toBeUndefined();
    expect(desktop.main).toBe('./dist/main.cjs');
  });
});

describe('how the renderer is opened', () => {
  /**
   * A source reading rather than a behaviour: the flags below cannot be observed without
   * an Electron process, and they are the difference between a window that shows a file
   * somebody was sent and a window that hands that file the machine.
   */
  it('gives the window no node integration and no shared context', async () => {
    const main = await readFile(join(repoRoot, 'apps/desktop/src/main.ts'), 'utf8');

    expect(main).toContain('contextIsolation: true');
    expect(main).toContain('nodeIntegration: false');
    expect(main).toContain('sandbox: true');
    expect(main).not.toContain('webSecurity: false');
    expect(main).not.toContain('allowRunningInsecureContent');
  });

  it('exposes named calls rather than a channel', async () => {
    const preload = await readFile(join(repoRoot, 'apps/desktop/src/preload.ts'), 'utf8');

    expect(preload).toContain('contextBridge.exposeInMainWorld');
    // Handing the page `ipcRenderer`, `send` or `on` would be handing it every channel.
    expect(preload).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer\s*\)/);
    expect(preload).not.toContain('nodeIntegration');
  });

  it('registers its scheme as secure, so the page is not treated as a file', async () => {
    const main = await readFile(join(repoRoot, 'apps/desktop/src/main.ts'), 'utf8');

    expect(main).toContain('registerSchemesAsPrivileged');
    expect(main).toContain('secure: true');
  });
});

describe('the window icon', () => {
  /**
   * Linux and Windows both need it, and for different reasons. Electron sets
   * `_NET_WM_ICON` from the window's `icon` option and from nothing else; on Windows the
   * icon comes from the executable, which is `electron.exe` in a checkout. Only macOS
   * finds one on its own, in the bundle.
   */
  it('is given to the window wherever nothing else provides one', async () => {
    const main = await readFile(join(repoRoot, 'apps/desktop/src/main.ts'), 'utf8');

    expect(main).toContain("process.platform === 'darwin'");
    expect(main).toContain("join(app.getAppPath(), 'media', 'icon.png')");
  });

  /**
   * The window icon alone leaves the Windows task bar showing the executable's, because
   * the button is grouped by the application model id rather than by the window.
   */
  it('names the application to Windows, under the id the installer uses', async () => {
    const main = await readFile(join(repoRoot, 'apps/desktop/src/main.ts'), 'utf8');
    const config = await readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');

    expect(main).toContain('app.setAppUserModelId(APP_USER_MODEL_ID)');
    expect(main).toContain("const APP_USER_MODEL_ID = 'com.cassandragargoyle.revlens'");
    expect(config).toContain('appId: com.cassandragargoyle.revlens');
  });

  it('travels into the packed application, because `build/` does not', async () => {
    const esbuild = await readFile(join(repoRoot, 'apps/desktop/esbuild.mjs'), 'utf8');
    const config = await readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');

    expect(esbuild).toContain("join(here, 'media', 'icon.png')");
    expect(config).toContain('- media/**/*');
  });

  it('is the drawing at the size an installer asks for', async () => {
    const icon = await readFile(join(repoRoot, 'apps/desktop/build/icon.png'));

    // A PNG says so in its IHDR: width and height, big-endian, at offsets 16 and 20.
    expect(icon.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(icon.readUInt32BE(16)).toBe(512);
    expect(icon.readUInt32BE(20)).toBe(512);
  });
});

describe('the installer configuration', () => {
  it('ships the two bundled files and the viewer, and nothing else', async () => {
    const config = await readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');

    expect(config).toContain('- dist/**/*');
    expect(config).toContain('- media/**/*');
    expect(config).toContain('npmRebuild: false');
  });

  /**
   * The product is written RevLens wherever a reader sees it, the way the extension and
   * the Pilot plugin already spell it. The binary, the window class and the desktop
   * entry stay `revlens`: those are file names, and a capital in one of them is a
   * different path on a case-sensitive file system.
   */
  it('is called RevLens, and installs a binary called revlens', async () => {
    const config = await readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');

    expect(config).toContain('productName: RevLens');
    expect(config).toContain('executableName: revlens');
  });

  it('claims the plain extension, which is the one both hosts agree on', async () => {
    const config = await readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');

    expect(config).toContain('ext: revlens');
    // `*.revlens.json` is a compound extension no operating system association matches.
    expect(config).not.toContain('ext: revlens.json');
  });

  it('writes its installers where the Makefile says it does', async () => {
    const config = await readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8');
    const makefile = await readFile(join(repoRoot, 'Makefile'), 'utf8');

    expect(config).toContain('output: ../../dist/desktop');
    expect(makefile).toContain('package-desktop:');
    expect(makefile).toContain('dist/desktop/');
  });
});
