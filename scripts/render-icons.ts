import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * One drawing, every PNG the product ships: `npm run icons`.
 *
 * `assets/icon.svg` is the mark. The extension manifest and the Pilot catalog want a
 * 128x128 PNG, the viewer's favicon is a byte-identical copy of it (held so by
 * `apps/web/test/icon.test.ts`), and electron-builder wants 512x512. A change to the mark
 * is one edit to the drawing and this command, and the PNGs it writes are committed.
 *
 * The renderer is a headless Chrome, Chromium or Edge, which a developer machine has and
 * a reader never runs. A rasteriser as a dependency would be a package for a build step
 * nobody installs revlens to do, so instead this says plainly what to install when no
 * browser is found. `REVLENS_BROWSER` names one that is not on the usual paths.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

const DRAWING = join(root, 'assets', 'icon.svg');

/** What is rendered, at which size; the copies are byte-identical to the first target */
const TARGETS = [
  { size: 128, out: join(root, 'apps', 'vscode', 'icon.png') },
  { size: 512, out: join(root, 'apps', 'desktop', 'build', 'icon.png') },
] as const;
const COPIES = [{ from: TARGETS[0].out, to: join(root, 'apps', 'web', 'src', 'assets', 'icon.png') }];

const BROWSER_NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
  'microsoft-edge',
  'msedge',
];

const WELL_KNOWN_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

/** The browser to render with, or undefined when this machine has none we know of */
function findBrowser(): string | undefined {
  const named = process.env.REVLENS_BROWSER;
  if (named !== undefined && named !== '') return named;

  const suffixes = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of BROWSER_NAMES) {
      for (const suffix of suffixes) {
        const candidate = join(directory, name + suffix);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return WELL_KNOWN_PATHS.find((candidate) => existsSync(candidate));
}

/**
 * The drawing on a page exactly its own size, with nothing around it.
 *
 * The SVG is inlined and stretched to the viewport, so one drawing at viewBox 128 renders
 * crisply at any size rather than as a scaled 128-pixel bitmap.
 */
function page(svg: string): string {
  const drawing = svg.replace(/<!--[\s\S]*?-->/g, '').trim();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
svg { display: block; width: 100vw; height: 100vh; }
</style></head><body>${drawing}</body></html>`;
}

function render(browser: string, html: string, size: number, out: string): void {
  const result = spawnSync(
    browser,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      `--screenshot=${out}`,
      pathToFileURL(html).href,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !existsSync(out)) {
    throw new Error(
      `${browser} could not render ${out}` +
        (result.error === undefined ? '' : `: ${result.error.message}`) +
        (result.stderr ? `\n${result.stderr.trim()}` : ''),
    );
  }
}

/** Width and height from a PNG's IHDR, so a render at the wrong size is caught here */
async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const png = await readFile(file);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function main(): Promise<void> {
  const browser = findBrowser();
  if (browser === undefined) {
    console.error('No Chrome, Chromium or Edge was found to render the icon with.');
    console.error('Install one of them, or name one with REVLENS_BROWSER=/path/to/browser.');
    console.error('The committed PNGs are unchanged.');
    process.exitCode = 1;
    return;
  }

  const work = await mkdtemp(join(tmpdir(), 'revlens-icons-'));
  try {
    const html = join(work, 'icon.html');
    await writeFile(html, page(await readFile(DRAWING, 'utf8')), 'utf8');

    for (const target of TARGETS) {
      // Rendered aside and moved into place, so a failed render leaves the old PNG
      const rendered = join(work, `icon-${target.size}.png`);
      render(browser, html, target.size, rendered);
      const { width, height } = await pngSize(rendered);
      if (width !== target.size || height !== target.size) {
        throw new Error(`${browser} rendered ${width}x${height} instead of ${target.size}x${target.size}`);
      }
      await copyFile(rendered, target.out);
      console.log(`  ${target.size}x${target.size}  ${target.out}`);
    }
    for (const copy of COPIES) {
      await copyFile(copy.from, copy.to);
      console.log(`  copy     ${copy.to}`);
    }
    console.log(`\nrendered ${DRAWING} with ${browser}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
