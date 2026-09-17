import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleSchema } from '@revlens/core';
import { findWebRoot } from '../src/paths.js';
import { writeStaticExport } from '../src/static-export.js';

/**
 * The self-contained export: a directory that can be zipped and sent, and that works from
 * the file system with no server and no external CDN.
 *
 * It needs the viewer to have been built, so the test says so plainly rather than passing
 * quietly when there is nothing to export.
 */

const sample = bundleSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/sample-bundle.json', import.meta.url)),
      'utf8',
    ),
  ),
);

const webRoot = findWebRoot();
let target: string;
let html: string;

beforeAll(async () => {
  if (webRoot === undefined) return;
  target = mkdtempSync(join(tmpdir(), 'revlens-static-'));
  await writeStaticExport(webRoot, target, sample);
  html = readFileSync(join(target, 'index.html'), 'utf8');
});

afterAll(() => {
  if (target !== undefined) rmSync(target, { recursive: true, force: true });
});

describe.skipIf(webRoot === undefined)('revlens build --static', () => {
  it('writes the page, its assets and the bundle', () => {
    expect(existsSync(join(target, 'index.html'))).toBe(true);
    expect(existsSync(join(target, 'bundle-data.js'))).toBe(true);
  });

  it('embeds the bundle rather than fetching it, so file:// works', () => {
    const script = readFileSync(join(target, 'bundle-data.js'), 'utf8');
    expect(script.startsWith('globalThis.__REVLENS_BUNDLE__ =')).toBe(true);
    const parsed = bundleSchema.parse(
      JSON.parse(script.replace(/^globalThis\.__REVLENS_BUNDLE__ = /, '').replace(/;\n$/, '')),
    );
    expect(parsed.edits).toHaveLength(7);
  });

  it('loads the bundle before the application module', () => {
    expect(html).toContain('<script src="./bundle-data.js"></script>');
    expect(html.indexOf('bundle-data.js')).toBeLessThan(html.indexOf('assets/'));
  });

  it('references its assets relatively, so the directory can be moved or zipped', () => {
    const absolute = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(absolute.filter((reference) => reference.startsWith('/'))).toEqual([]);
  });

  it('pulls nothing from an external origin', () => {
    expect(html).not.toMatch(/https?:\/\//);
  });
});

describe.skipIf(webRoot !== undefined)('without a built viewer', () => {
  it('reports that the viewer is not built', () => {
    expect(findWebRoot()).toBeUndefined();
  });
});
