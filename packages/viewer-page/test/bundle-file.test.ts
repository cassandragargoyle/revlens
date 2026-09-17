import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBundleText, readBundleFile } from '../src/index.js';

const fixture = fileURLToPath(new URL('../../../fixtures/sample-bundle.json', import.meta.url));

describe('parseBundleText', () => {
  it('accepts the fixture bundle and reports its title', async () => {
    const text = await readFile(fixture, 'utf8');
    const result = parseBundleText(text, 'sample-bundle.json');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.title).toBe('Analýza kompetenčního centra');
    // The page gets the file's own bytes, not a re-serialised copy.
    expect(result.json).toBe(text);
  });

  it('says so when the file is not JSON at all', () => {
    const result = parseBundleText('# a markdown file', 'notes.md');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toContain('notes.md is not valid JSON');
    expect(result.detail).toHaveLength(1);
  });

  it('refuses a document whose attribution cannot be trusted', () => {
    const result = parseBundleText(JSON.stringify({ schemaVersion: '1.0' }), 'broken.revlens');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toContain('not a revision bundle this build can show');
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it('refuses a bundle written against another contract', async () => {
    const bundle = JSON.parse(await readFile(fixture, 'utf8')) as Record<string, unknown>;
    const result = parseBundleText(
      JSON.stringify({ ...bundle, schemaVersion: '9.0' }),
      'future.revlens',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail.join('\n')).toContain('schema-version');
  });
});

describe('readBundleFile', () => {
  it('reads the fixture from disk', async () => {
    const result = await readBundleFile(fixture, 'sample-bundle.json');

    expect(result.ok).toBe(true);
  });

  it('names the file instead of throwing when it is not there', async () => {
    const result = await readBundleFile(`${fixture}.missing`, 'missing.revlens');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toContain('missing.revlens could not be read');
  });
});
