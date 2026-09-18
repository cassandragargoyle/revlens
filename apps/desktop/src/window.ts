import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildErrorPage, buildViewerPage, escapeHtml, readBundleFile } from '@revlens/viewer-page';

/**
 * The pages this application shows, and where their assets come from
 *
 * The document page is the viewer from `apps/web`, built once and given the bundle on
 * the global it already prefers - the same seam the webview and `revlens build --static`
 * use. Nothing here is a second viewer; the two other pages are the shell's own windows,
 * an empty one and a form, and they draw nothing a document would draw.
 *
 * It is served over a scheme of its own rather than from `file://`, so the page keeps an
 * origin, a Content-Security-Policy and a per-render nonce. Everything in this module is
 * a function from data to a string, so the whole of it is tested without an Electron
 * process.
 *
 * Every address is on one host, `app`, because a module script is fetched with CORS
 * whatever its tag says, and Chromium answers a cross-origin request on a custom scheme
 * with a refusal rather than a preflight. Same host, same origin, and the viewer loads.
 */

/** Registered as standard and secure before the application is ready; see `main.ts`. */
export const VIEWER_SCHEME = 'revlens-viewer';

/** The one host every page and every asset is served from - see the note above. */
export const VIEWER_HOST = 'app';

const ORIGIN = `${VIEWER_SCHEME}://${VIEWER_HOST}`;

/** What the page is allowed to load: its own assets, and nothing else. */
export const CSP_SOURCE = `${VIEWER_SCHEME}:`;

/** The nonce is per render, so a stale page cannot run its scripts against a new one. */
const NONCE_BYTES = 16;

export function createNonce(): string {
  return randomBytes(NONCE_BYTES).toString('base64');
}

export function viewerAssetUrl(relativePath: string): string {
  return `${ORIGIN}/${relativePath.split('\\').join('/')}`;
}

/**
 * The window id travels in the URL because the handler is one function for every window.
 *
 * A document window reloads by re-requesting its own address, which is what makes
 * "follow the file" a reload rather than a second code path.
 */
export function documentUrl(windowId: number): string {
  return `${ORIGIN}${DOCUMENT_PATH}${windowId}`;
}

export function welcomeUrl(): string {
  return `${ORIGIN}${WELCOME_PATH}`;
}

export function buildFormUrl(): string {
  return `${ORIGIN}${BUILD_PATH}`;
}

/**
 * The three addresses that are pages rather than files.
 *
 * They are checked before the viewer directory is consulted, so a page can never be
 * shadowed by a file the build happened to emit under the same name.
 */
export const DOCUMENT_PATH = '/-/document/';
export const WELCOME_PATH = '/-/welcome';
export const BUILD_PATH = '/-/build';

export type ViewerRoute =
  | { readonly kind: 'document'; readonly windowId: number }
  | { readonly kind: 'welcome' }
  | { readonly kind: 'build' }
  | { readonly kind: 'asset'; readonly pathname: string }
  | { readonly kind: 'unknown' };

/** What one request is for, decided in one place and tested without a window. */
export function routeRequest(url: string): ViewerRoute {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'unknown' };
  }

  if (parsed.protocol !== `${VIEWER_SCHEME}:` || parsed.hostname !== VIEWER_HOST) {
    return { kind: 'unknown' };
  }
  if (parsed.pathname === WELCOME_PATH) return { kind: 'welcome' };
  if (parsed.pathname === BUILD_PATH) return { kind: 'build' };

  if (parsed.pathname.startsWith(DOCUMENT_PATH)) {
    const windowId = Number(parsed.pathname.slice(DOCUMENT_PATH.length));
    if (!Number.isInteger(windowId)) return { kind: 'unknown' };
    return { kind: 'document', windowId };
  }

  return { kind: 'asset', pathname: parsed.pathname };
}

/**
 * An asset path, or nothing at all.
 *
 * The page is our own build output and asks for its own files, but the handler answers
 * whatever the renderer asks for, so the answer is confined to the viewer directory by
 * construction rather than by trust.
 */
export function resolveAssetPath(viewerRoot: string, pathname: string): string | undefined {
  const requested = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (requested === '') return undefined;

  const root = resolve(viewerRoot);
  const candidate = resolve(join(root, requested));
  const inside = relative(root, candidate);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return undefined;
  return candidate;
}

export interface RenderedDocument {
  readonly html: string;
  /** The window title: the document's own, or the file name when it cannot be read. */
  readonly title: string;
  /** Invariant warnings - a smell, not a defect, so the document still opened. */
  readonly warnings: readonly string[];
  readonly ok: boolean;
}

export interface DocumentRequest {
  readonly viewerRoot: string;
  readonly fsPath: string;
  readonly fileName: string;
}

/**
 * The document, or the reason it cannot be shown.
 *
 * A bundle that fails its invariants gets the validator's own lines, in the window,
 * rather than a blank page - the behaviour the editor extension already has, because it
 * is the same loader and the same error page.
 */
export async function renderDocument(request: DocumentRequest): Promise<RenderedDocument> {
  const { viewerRoot, fsPath, fileName } = request;
  const result = await readBundleFile(fsPath, fileName);

  if (!result.ok) {
    return {
      html: buildErrorPage({
        title: fileName,
        problem: result.problem,
        detail: result.detail,
        cspSource: CSP_SOURCE,
      }),
      title: fileName,
      warnings: [],
      ok: false,
    };
  }

  let indexHtml: string;
  try {
    indexHtml = await readFile(join(viewerRoot, 'index.html'), 'utf8');
  } catch (error) {
    return {
      html: buildErrorPage({
        title: fileName,
        problem: 'The viewer is missing from this build of the application.',
        detail: [
          error instanceof Error ? error.message : String(error),
          'A build from source needs `npm run build` before `make desktop`.',
        ],
        cspSource: CSP_SOURCE,
      }),
      title: fileName,
      warnings: [],
      ok: false,
    };
  }

  return {
    html: buildViewerPage({
      indexHtml,
      assetUri: viewerAssetUrl,
      cspSource: CSP_SOURCE,
      nonce: createNonce(),
      bundleJson: result.json,
    }),
    title: result.title,
    warnings: result.warnings,
    ok: true,
  };
}

/** What an empty window says, so that starting the application is never a blank page. */
export function renderWelcome(nonce: string = createNonce()): string {
  return chromePage({
    title: 'RevLens',
    nonce,
    body: `
      <h1>RevLens</h1>
      <p class="lead">
        Read a document with every change highlighted in place, and the revision and the
        reviewer comment behind each one.
      </p>
      <div class="row">
        <button id="open" class="primary" type="button">Open Bundle&#8230;</button>
        <button id="build" type="button">Build a Bundle&#8230;</button>
      </div>
      <p class="hint">A <code>.revlens</code> file can also be dropped onto this window.</p>
    `,
    script: `
      document.getElementById('open').addEventListener('click', () => revlens.openBundle());
      document.getElementById('build').addEventListener('click', () => revlens.buildBundle());
    `,
  });
}

export interface BuildFormOptions {
  readonly sources: readonly { name: string; description: string }[];
  readonly nonce?: string;
}

/**
 * The form that replaces six command-line flags.
 *
 * It is the shell's own window, not a panel in the viewer: the analyst who prepares a
 * round needs it, the reader who was sent a file never opens it, and `apps/web` knows
 * about neither of them.
 */
export function renderBuildForm(options: BuildFormOptions): string {
  const { sources } = options;
  const choices = sources
    .map(
      (source) =>
        `<option value="${escapeHtml(source.name)}">${escapeHtml(source.name)} \u2014 ${escapeHtml(
          source.description,
        )}</option>`,
    )
    .join('\n        ');

  return chromePage({
    title: 'Build a Bundle',
    nonce: options.nonce ?? createNonce(),
    body: `
      <h1>Build a bundle</h1>
      <p class="lead">
        RevLens walks the repository from the baseline to the head revision and joins every
        commit to the record that explains it.
      </p>

      <label for="source">Source adapter</label>
      <select id="source">
        ${choices}
      </select>

      <label for="repo">Repository holding the chapters</label>
      <div class="row">
        <input id="repo" type="text" spellcheck="false" placeholder="/path/to/repository" />
        <button id="repo-browse" type="button">Choose&#8230;</button>
      </div>

      <label for="records">Records - the change log and the comment rounds</label>
      <div class="row">
        <input id="records" type="text" spellcheck="false" placeholder="the adapter's default" />
        <button id="records-browse" type="button">Choose&#8230;</button>
      </div>

      <div class="pair">
        <div>
          <label for="from">Baseline revision</label>
          <input id="from" type="text" spellcheck="false" placeholder="the build the reviewers received" />
        </div>
        <div>
          <label for="to">Head revision</label>
          <input id="to" type="text" spellcheck="false" value="HEAD" />
        </div>
      </div>

      <label for="out">Bundle to write</label>
      <div class="row">
        <input id="out" type="text" spellcheck="false" placeholder="bundle.revlens" />
        <button id="out-browse" type="button">Choose&#8230;</button>
      </div>

      <div class="row actions">
        <button id="build" class="primary" type="button">Build</button>
        <button id="close" type="button">Close</button>
        <span id="status" class="hint"></span>
      </div>

      <div id="outcome"></div>
    `,
    script: `
      const field = (id) => document.getElementById(id);
      const status = field('status');
      const outcome = field('outcome');

      const browse = async (id) => {
        const chosen = await revlens.chooseDirectory();
        if (chosen) field(id).value = chosen;
      };

      field('repo-browse').addEventListener('click', () => browse('repo'));
      field('records-browse').addEventListener('click', () => browse('records'));
      field('out-browse').addEventListener('click', async () => {
        const chosen = await revlens.chooseBundleTarget();
        if (chosen) field('out').value = chosen;
      });
      field('close').addEventListener('click', () => revlens.closeWindow());

      const show = (kind, heading, lines) => {
        outcome.className = kind;
        const list = lines.map((line) => {
          const item = document.createElement('li');
          item.textContent = line;
          return item;
        });
        outcome.replaceChildren();
        const title = document.createElement('h2');
        title.textContent = heading;
        outcome.appendChild(title);
        if (list.length > 0) {
          const box = document.createElement('ul');
          list.forEach((item) => box.appendChild(item));
          outcome.appendChild(box);
        }
      };

      field('build').addEventListener('click', async () => {
        const request = {
          source: field('source').value,
          repo: field('repo').value.trim(),
          from: field('from').value.trim(),
          to: field('to').value.trim(),
          records: field('records').value.trim(),
          out: field('out').value.trim(),
        };
        if (request.repo === '' || request.out === '') {
          show('failed', 'A repository and a file to write are both needed.', []);
          return;
        }

        field('build').disabled = true;
        status.textContent = 'Walking the history\\u2026';
        outcome.replaceChildren();
        try {
          const result = await revlens.build(request);
          if (result.ok) {
            show('built', 'The bundle was written.', [result.out, ...result.warnings]);
          } else {
            show('failed', result.problem, result.detail);
          }
        } finally {
          field('build').disabled = false;
          status.textContent = '';
        }
      });
    `,
  });
}

interface ChromePage {
  readonly title: string;
  readonly nonce: string;
  readonly body: string;
  readonly script: string;
}

/**
 * The shell's own pages: no assets, no network, one script by nonce.
 *
 * They follow the operating system's light and dark setting rather than carrying a theme
 * of their own, because they are chrome around a document and not part of it.
 *
 * `--accent` is the blue of the application icon, at the two depths the text on it needs:
 * the icon reads `#387df3`, which carries only 3.6:1 under the light text of a filled
 * button, so the light theme darkens it and the dark theme lightens it. The hue is the
 * icon's in both - 217 degrees - so the button and the mark in the task bar are the same
 * colour to a reader who sees them side by side.
 */
function chromePage(page: ChromePage): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${page.nonce}'; form-action 'none'">
    <title>${escapeHtml(page.title)}</title>
    <style>
      :root { color-scheme: light dark; --ink: #1c1c1a; --soft: #55534e; --line: #c9c6c0; --paper: #f7f6f3; --field: #ffffff; --accent: #2565d8; }
      @media (prefers-color-scheme: dark) {
        :root { --ink: #e8e6e1; --soft: #a8a49c; --line: #43413d; --paper: #1d1c1a; --field: #26251f; --accent: #8ab4f8; }
      }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 2rem 2.5rem 2.5rem; font-family: system-ui, sans-serif; background: var(--paper); color: var(--ink); line-height: 1.5; }
      h1 { font-size: 1.25rem; font-weight: 650; margin: 0 0 0.5rem; }
      h2 { font-size: 0.95rem; font-weight: 600; margin: 0 0 0.4rem; }
      .lead { color: var(--soft); max-width: 44rem; margin: 0 0 1.5rem; }
      .hint { color: var(--soft); font-size: 0.85rem; }
      label { display: block; font-size: 0.8rem; letter-spacing: 0.02em; color: var(--soft); margin: 1rem 0 0.35rem; }
      input, select { width: 100%; padding: 0.45rem 0.55rem; font: inherit; font-size: 0.9rem; color: var(--ink); background: var(--field); border: 1px solid var(--line); border-radius: 4px; }
      .row { display: flex; gap: 0.5rem; align-items: center; }
      .row.actions { margin-top: 1.5rem; }
      .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
      button { padding: 0.45rem 0.9rem; font: inherit; font-size: 0.9rem; color: var(--ink); background: var(--field); border: 1px solid var(--line); border-radius: 4px; cursor: pointer; white-space: nowrap; }
      button:hover { border-color: var(--accent); }
      button:disabled { opacity: 0.55; cursor: default; }
      button.primary { color: var(--paper); background: var(--accent); border-color: var(--accent); font-weight: 600; }
      code { font-family: ui-monospace, monospace; font-size: 0.85em; }
      #outcome { margin-top: 1.25rem; }
      #outcome ul { margin: 0; padding-left: 1.1rem; font-family: ui-monospace, monospace; font-size: 0.8rem; color: var(--soft); }
      #outcome.failed h2 { color: #a3341f; }
      @media (prefers-color-scheme: dark) { #outcome.failed h2 { color: #e08b73; } }
    </style>
  </head>
  <body>
${page.body}
    <script nonce="${page.nonce}">${page.script}</script>
  </body>
</html>
`;
}
