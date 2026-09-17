import { describe, expect, it } from 'vitest';
import { BUNDLE_GLOBAL, buildErrorPage, buildViewerPage } from '../src/webview-html.js';

/**
 * The page is assembled from our own build output, so these tests use the shape Vite
 * actually emits - relative asset paths, a module script, `crossorigin` on both tags.
 */
const BUILT_INDEX = `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <title>revlens</title>
    <script type="module" crossorigin src="./assets/index-Cm10NnmD.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-DF2RtE_r.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const page = (overrides: Partial<Parameters<typeof buildViewerPage>[0]> = {}): string =>
  buildViewerPage({
    indexHtml: BUILT_INDEX,
    assetUri: (relativePath) => `https://host.example/resource/${relativePath}`,
    cspSource: 'https://host.example',
    nonce: 'n0nce',
    bundleJson: '{"document":{"title":"t"}}',
    ...overrides,
  });

describe('buildViewerPage', () => {
  it('points the assets at the host resource scheme', () => {
    const html = page();

    expect(html).toContain('src="https://host.example/resource/assets/index-Cm10NnmD.js"');
    expect(html).toContain('href="https://host.example/resource/assets/index-DF2RtE_r.css"');
    expect(html).not.toContain('./assets/');
  });

  it('drops crossorigin, which would make the rewritten module script a CORS failure', () => {
    expect(page()).not.toContain('crossorigin');
  });

  it('gives every script the nonce the policy allows', () => {
    const html = page();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];

    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const script of scripts) {
      expect(script).toContain('nonce="n0nce"');
    }
  });

  it('puts the bundle on the global the viewer reads', () => {
    const html = page({ bundleJson: '{"document":{"title":"Analýza"}}' });
    const script = /globalThis\.__REVLENS_BUNDLE__ = JSON\.parse\((.*)\);/.exec(html);

    expect(html).toContain(`globalThis.${BUNDLE_GLOBAL}`);
    expect(script).not.toBeNull();
    expect(JSON.parse(JSON.parse(script?.[1] ?? '""') as string)).toEqual({
      document: { title: 'Analýza' },
    });
  });

  it('escapes a bundle that tries to close the script tag it sits in', () => {
    const hostile = JSON.stringify({ note: '</script><script>alert(1)</script>' });
    const html = page({ bundleJson: hostile });

    // The payload survives as data and never as a tag.
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script');

    const script = /globalThis\.__REVLENS_BUNDLE__ = JSON\.parse\((.*)\);/.exec(html);
    const recovered = JSON.parse(JSON.parse(script?.[1] ?? '""') as string) as { note: string };
    expect(recovered.note).toBe('</script><script>alert(1)</script>');
  });

  it('states a policy that allows the assets and no network', () => {
    const html = page();

    expect(html).toContain("script-src 'nonce-n0nce'");
    expect(html).toContain('img-src https://host.example data:');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
  });

  it('leaves a reference that already carries a scheme alone', () => {
    const html = page({
      indexHtml: BUILT_INDEX.replace(
        './assets/index-DF2RtE_r.css',
        'https://cdn.example/reset.css',
      ),
    });

    expect(html).toContain('href="https://cdn.example/reset.css"');
  });

  it('names the missing build instead of rendering half a page', () => {
    expect(() => page({ indexHtml: '<html><body>nothing</body></html>' })).toThrow(/build:web/);
  });
});

describe('buildErrorPage', () => {
  it('shows the problem and every issue line', () => {
    const html = buildErrorPage({
      title: 'analysis.revlens',
      problem: 'not a revision bundle this build can show (2 problems).',
      detail: ['error  edits[0].revision: unknown revision R-1 [edit-revision]', 'error  x: y'],
      cspSource: 'https://host.example',
    });

    expect(html).toContain('analysis.revlens');
    expect(html).toContain('2 problems');
    expect(html).toContain('unknown revision R-1');
    expect(html).toContain('<li>error  x: y</li>');
  });

  it('escapes the detail, which comes from a file we did not write', () => {
    const html = buildErrorPage({
      title: '<img src=x onerror=alert(1)>',
      problem: 'bad & worse',
      detail: ['<script>alert(1)</script>'],
      cspSource: 'https://host.example',
    });

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('bad &amp; worse');
  });
});
