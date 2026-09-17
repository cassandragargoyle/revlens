/**
 * The viewer page, prepared for a host that embeds it instead of a browser tab.
 *
 * Two hosts ask for it: the editor webview in `apps/vscode`, and the desktop window in
 * `apps/desktop`. They differ in one thing - the scheme their assets are served from -
 * so they are one function with an `assetUri`, not two pages.
 *
 * Nothing here knows the viewer's internals. The `index.html` that `apps/web` builds is
 * taken as it is, its asset URLs are rewritten to the host's resource scheme, and the
 * bundle is put on the global the viewer already prefers over the HTTP API - the same
 * seam `revlens build --static` uses, and for the same reason: a page loaded from a
 * resource URI may not fetch a local JSON file.
 *
 * Keeping this a pure function is deliberate. It is the part most likely to break
 * against a host - nonce, CSP, URL rewriting - and a pure function can be tested without
 * a Visual Studio Code or an Electron process.
 */

/** The global `detectSource()` in `apps/web/src/data/source.ts` looks for. */
export const BUNDLE_GLOBAL = '__REVLENS_BUNDLE__';

export interface ViewerPageOptions {
  /** The built `index.html`, verbatim. */
  readonly indexHtml: string;
  /** Maps an asset path from the built viewer onto a URI the webview is allowed to load. */
  readonly assetUri: (relativePath: string) => string;
  /** Where the page's own assets come from: `webview.cspSource`, or the desktop scheme. */
  readonly cspSource: string;
  /** A per-render nonce, so the page may run its own scripts and nothing else. */
  readonly nonce: string;
  /** The bundle as JSON text - handed over without a second parse on our side. */
  readonly bundleJson: string;
}

export interface ErrorPageOptions {
  readonly title: string;
  readonly problem: string;
  /** One line per issue, in the order the validator reported them. */
  readonly detail: readonly string[];
  readonly cspSource: string;
}

const HEAD_OPEN = /<head(\s[^>]*)?>/i;
const SCRIPT_SRC = /(<script\b[^>]*?\bsrc=")([^"]+)(")/gi;
const LINK_HREF = /(<link\b[^>]*?\bhref=")([^"]+)(")/gi;
const CROSSORIGIN = /\s+crossorigin(="[^"]*")?/gi;
const SCRIPT_WITHOUT_NONCE = /<script\b(?![^>]*\bnonce=)/gi;

/**
 * U+2028 and U+2029: valid in a JSON string, and a line break in a JavaScript one.
 *
 * Written through `String.fromCharCode` rather than as an escape, so the two characters
 * that would end this very regex literal cannot end up inside it.
 */
const JS_LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/**
 * The viewer with the bundle already in it.
 *
 * Throws when the built page has no `<head>`, because that is our own build output and a
 * silently half-rendered page would be worse than a message naming the build.
 */
export function buildViewerPage(options: ViewerPageOptions): string {
  const { indexHtml, assetUri, cspSource, nonce, bundleJson } = options;

  if (!HEAD_OPEN.test(indexHtml)) {
    throw new Error('the built viewer has no <head> element - run `npm run build:web` first');
  }

  const injected = [
    `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(cspSource, nonce)}">`,
    `<script nonce="${nonce}">globalThis.${BUNDLE_GLOBAL} = JSON.parse(${jsStringLiteral(bundleJson)});</script>`,
  ].join('\n    ');

  return rewriteAssetReferences(indexHtml, assetUri, nonce).replace(
    HEAD_OPEN,
    (match) => `${match}\n    ${injected}`,
  );
}

/**
 * What the reader sees instead of the document when the file cannot be shown.
 *
 * The State A host in Pilot has no `window.showErrorMessage`, so the message has to live
 * in the page. It reads better there anyway - the reason sits next to the file it is
 * about, instead of in a notification that scrolls away.
 */
export function buildErrorPage(options: ErrorPageOptions): string {
  const { title, problem, detail, cspSource } = options;
  const lines = detail.map((line) => `      <li>${escapeHtml(line)}</li>`).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: var(--vscode-font-family, system-ui), sans-serif; padding: 2rem 2.5rem; line-height: 1.5; }
      h1 { font-size: 1.1rem; font-weight: 600; margin: 0 0 0.75rem; }
      p { margin: 0 0 1rem; max-width: 46rem; }
      ul { margin: 0; padding-left: 1.25rem; }
      li { font-family: var(--vscode-editor-font-family, ui-monospace), monospace; font-size: 0.85rem; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(problem)}</p>
    <ul>
${lines}
    </ul>
  </body>
</html>
`;
}

/**
 * Point every `<script src>` and `<link href>` at the host's resource scheme.
 *
 * Only document-relative references are rewritten; anything already carrying a scheme is
 * left alone. `crossorigin` goes with them: the rewritten URI is a different origin to
 * the page, and the attribute turns a working module script into a CORS failure. The
 * assets the viewer loads at runtime - the cover image, the fonts - need no rewriting,
 * because `base: './'` in the Vite config makes them resolve against the module's own
 * URI, which is a resource URI by then.
 */
function rewriteAssetReferences(
  html: string,
  assetUri: (relativePath: string) => string,
  nonce: string,
): string {
  const rewrite = (open: string, target: string, close: string): string =>
    isDocumentRelative(target)
      ? `${open}${assetUri(stripLeadingDot(target))}${close}`
      : `${open}${target}${close}`;

  return html
    .replace(SCRIPT_SRC, (_match, open: string, target: string, close: string) =>
      rewrite(open, target, close),
    )
    .replace(LINK_HREF, (_match, open: string, target: string, close: string) =>
      rewrite(open, target, close),
    )
    .replace(CROSSORIGIN, '')
    .replace(SCRIPT_WITHOUT_NONCE, `<script nonce="${nonce}"`);
}

/** What the page may load: its own assets, and its own scripts by nonce. */
function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    // The bundle is in the page; there is nothing for the viewer to call.
    `connect-src 'none'`,
  ].join('; ');
}

function isDocumentRelative(reference: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(reference) && !reference.startsWith('//');
}

function stripLeadingDot(reference: string): string {
  return reference.replace(/^\.?\//, '');
}

/**
 * The bundle as a JavaScript string literal the page parses itself.
 *
 * A literal plus `JSON.parse` beats inlining the object: it parses faster on a large
 * bundle, and an escaped `<` can never close the script tag it sits in.
 */
function jsStringLiteral(json: string): string {
  return JSON.stringify(json)
    .replace(/</g, '\\u003c')
    .replace(JS_LINE_SEPARATORS, (match) => `\\u${match.charCodeAt(0).toString(16)}`);
}

/** Exported because every host that draws a page of its own needs exactly this. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
