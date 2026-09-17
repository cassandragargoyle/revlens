import { mkdtempSync, rmSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUNDLE_GLOBAL } from '@revlens/viewer-page';
import {
  CSP_SOURCE,
  VIEWER_HOST,
  VIEWER_SCHEME,
  buildFormUrl,
  documentUrl,
  renderBuildForm,
  renderDocument,
  renderWelcome,
  resolveAssetPath,
  routeRequest,
  viewerAssetUrl,
  welcomeUrl,
} from '../src/window.js';

/**
 * Every page the application shows, built without an Electron process.
 *
 * The viewer is not rebuilt here; a two-tag `index.html` in the shape Vite emits is
 * enough, because what is under test is the host's half of the seam - where the assets
 * are fetched from, what the page is allowed to load, and what is shown when the file
 * cannot be.
 */

const fixture = fileURLToPath(new URL('../../../fixtures/sample-bundle.json', import.meta.url));

const BUILT_INDEX = `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <title>revlens</title>
    <script type="module" crossorigin src="./assets/index-Cm10NnmD.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-DF2RtE_r.css">
  </head>
  <body><div id="root"></div></body>
</html>
`;

let root: string;
let viewerRoot: string;
let bundlePath: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'revlens-window-'));
  viewerRoot = join(root, 'viewer');
  await mkdir(join(viewerRoot, 'assets'), { recursive: true });
  await writeFile(join(viewerRoot, 'index.html'), BUILT_INDEX, 'utf8');
  await writeFile(join(viewerRoot, 'assets', 'index-Cm10NnmD.js'), '// viewer', 'utf8');

  bundlePath = join(root, 'round-3.revlens');
  await copyFile(fixture, bundlePath);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the addresses the window loads', () => {
  const origin = `${VIEWER_SCHEME}://${VIEWER_HOST}`;

  it('serves the assets from the application scheme, not from file://', () => {
    expect(viewerAssetUrl('assets/index-Cm10NnmD.js')).toBe(`${origin}/assets/index-Cm10NnmD.js`);
  });

  it('spells a Windows asset path the way a URL is spelt', () => {
    expect(viewerAssetUrl('assets\\cover.png')).toBe(`${origin}/assets/cover.png`);
  });

  it('carries the window id, so a reload is the same request again', () => {
    expect(documentUrl(7)).toBe(`${origin}/-/document/7`);
  });

  /**
   * The lesson that cost a blank window: a module script is fetched with CORS whatever
   * its tag says, and Chromium answers a cross-origin request on a custom scheme with a
   * refusal rather than a preflight. One host, or no viewer.
   */
  it('puts the page and its assets on one origin', () => {
    const page = new URL(documentUrl(7));
    const asset = new URL(viewerAssetUrl('assets/index-Cm10NnmD.js'));

    expect(asset.origin).toBe(page.origin);
    expect(new URL(welcomeUrl()).origin).toBe(page.origin);
    expect(new URL(buildFormUrl()).origin).toBe(page.origin);
  });
});

describe('routeRequest', () => {
  it('knows the three pages from the files', () => {
    expect(routeRequest(welcomeUrl())).toEqual({ kind: 'welcome' });
    expect(routeRequest(buildFormUrl())).toEqual({ kind: 'build' });
    expect(routeRequest(documentUrl(12))).toEqual({ kind: 'document', windowId: 12 });
    expect(routeRequest(viewerAssetUrl('assets/index.js'))).toEqual({
      kind: 'asset',
      pathname: '/assets/index.js',
    });
  });

  it('answers nothing for another scheme or another host', () => {
    expect(routeRequest('https://example.invalid/assets/index.js').kind).toBe('unknown');
    expect(routeRequest(`${VIEWER_SCHEME}://elsewhere/assets/index.js`).kind).toBe('unknown');
    expect(routeRequest('not a url at all').kind).toBe('unknown');
  });

  it('answers nothing for a document address with no window in it', () => {
    expect(routeRequest(`${VIEWER_SCHEME}://${VIEWER_HOST}/-/document/lots`).kind).toBe('unknown');
  });
});

describe('resolveAssetPath', () => {
  it('finds a file the built viewer asks for', () => {
    expect(resolveAssetPath(viewerRoot, '/assets/index-Cm10NnmD.js')).toBe(
      join(viewerRoot, 'assets', 'index-Cm10NnmD.js'),
    );
  });

  it('answers nothing for a path that climbs out of the viewer', () => {
    expect(resolveAssetPath(viewerRoot, '/../../etc/passwd')).toBeUndefined();
    expect(resolveAssetPath(viewerRoot, '/assets/../../../secrets.json')).toBeUndefined();
    expect(resolveAssetPath(viewerRoot, '/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
  });

  it('answers nothing for the viewer directory itself', () => {
    expect(resolveAssetPath(viewerRoot, '/')).toBeUndefined();
  });
});

describe('renderDocument', () => {
  it('gives the viewer the bundle on the global it already prefers', async () => {
    const rendered = await renderDocument({
      viewerRoot,
      fsPath: bundlePath,
      fileName: 'round-3.revlens',
    });

    expect(rendered.ok).toBe(true);
    expect(rendered.html).toContain(`globalThis.${BUNDLE_GLOBAL} = JSON.parse(`);
    expect(rendered.html).toContain(
      `src="${VIEWER_SCHEME}://${VIEWER_HOST}/assets/index-Cm10NnmD.js"`,
    );
    expect(rendered.html).toContain(`script-src 'nonce-`);
    expect(rendered.html).not.toContain('./assets/');
  });

  it('titles the window with the document, not with the file', async () => {
    const rendered = await renderDocument({
      viewerRoot,
      fsPath: bundlePath,
      fileName: 'round-3.revlens',
    });

    expect(rendered.title).not.toBe('round-3.revlens');
    expect(rendered.title.length).toBeGreaterThan(0);
  });

  /** The behaviour the extension has, because it is the same loader and the same page. */
  it('shows the validator’s reasons instead of a blank page', async () => {
    const broken = join(root, 'broken.revlens');
    await writeFile(broken, '{"schemaVersion":"1.0","document":{}}', 'utf8');

    const rendered = await renderDocument({
      viewerRoot,
      fsPath: broken,
      fileName: 'broken.revlens',
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.title).toBe('broken.revlens');
    expect(rendered.html).toContain('broken.revlens');
    expect(rendered.html).toMatch(/<li>/);
    expect(rendered.html).not.toContain(BUNDLE_GLOBAL);
  });

  it('says so when the file is not JSON at all', async () => {
    const notJson = join(root, 'notes.revlens');
    await writeFile(notJson, 'this is not a bundle', 'utf8');

    const rendered = await renderDocument({
      viewerRoot,
      fsPath: notJson,
      fileName: 'notes.revlens',
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.html).toContain('not valid JSON');
  });

  it('names the missing build rather than showing an empty window', async () => {
    const rendered = await renderDocument({
      viewerRoot: join(root, 'no-viewer-here'),
      fsPath: bundlePath,
      fileName: 'round-3.revlens',
    });

    expect(rendered.ok).toBe(false);
    expect(rendered.html).toContain('npm run build');
  });
});

describe('the shell’s own pages', () => {
  it('offers the two ways in, and nothing to fetch', () => {
    const page = renderWelcome('n0nce');

    expect(page).toContain('Open Bundle');
    expect(page).toContain('Build a Bundle');
    expect(page).toContain("default-src 'none'");
    expect(page).toContain('<script nonce="n0nce">');
  });

  it('lists the source adapters the build knows, escaped', () => {
    const page = renderBuildForm({
      nonce: 'n0nce',
      sources: [{ name: 'engagement', description: 'records of an <engagement>' }],
    });

    expect(page).toContain('<option value="engagement">');
    expect(page).toContain('records of an &lt;engagement&gt;');
    expect(page).not.toContain('<engagement>');
  });
});

describe('the content security policy', () => {
  it('names the application scheme and nothing else', () => {
    expect(CSP_SOURCE).toBe(`${VIEWER_SCHEME}:`);
    expect(CSP_SOURCE).not.toContain('http');
  });
});
