import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One mark, wherever revlens is installed from.
 *
 * `apps/vscode/icon.svg` is the drawing; the PNG beside it is what the extension manifest
 * and the Pilot catalog point at, and the same file is the viewer's favicon, so a browser
 * tab, an editor tab and a desktop window all show the same thing. Nothing enforces that
 * but this test: the copy is a copy, and a copy rots quietly.
 */

const read = (relative: string): Promise<Buffer> =>
  readFile(fileURLToPath(new URL(relative, import.meta.url)));

describe('the product mark', () => {
  it('is the same file in the viewer as in the extension', async () => {
    const [extension, viewer] = await Promise.all([
      read('../../vscode/icon.png'),
      read('../src/assets/icon.png'),
    ]);

    expect(viewer.equals(extension)).toBe(true);
  });

  it('is what the page asks for', async () => {
    const html = await read('../index.html');

    expect(html.toString('utf8')).toContain('rel="icon"');
    expect(html.toString('utf8')).toContain('src/assets/icon.png');
  });
});
