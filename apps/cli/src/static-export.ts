import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Bundle } from '@revlens/core';

/**
 * A self-contained directory that can be zipped and sent.
 *
 * It has to work from the file system, with no server and no external CDN - which rules
 * out fetching the bundle, because a `file://` page may not fetch a local JSON file. The
 * bundle is therefore written as a script that assigns it to a global, and the viewer
 * prefers that global over the API when it is present.
 */

const BUNDLE_FILE = 'bundle-data.js';
const GLOBAL = '__REVLENS_BUNDLE__';

export interface StaticExportResult {
  readonly directory: string;
  readonly bytes: number;
}

export async function writeStaticExport(
  webRoot: string,
  target: string,
  bundle: Bundle,
): Promise<StaticExportResult> {
  await mkdir(target, { recursive: true });
  await cp(webRoot, target, { recursive: true });

  const script = `globalThis.${GLOBAL} = ${JSON.stringify(bundle)};\n`;
  await writeFile(join(target, BUNDLE_FILE), script, 'utf8');

  const indexPath = join(target, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  if (!html.includes(BUNDLE_FILE)) {
    // The tag goes before everything else in the head, so the bundle is on the global by
    // the time the application module runs.
    await writeFile(
      indexPath,
      html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n    <script src="./${BUNDLE_FILE}"></script>`),
      'utf8',
    );
  }

  return { directory: target, bytes: Buffer.byteLength(script, 'utf8') };
}
