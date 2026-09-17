import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCatalog, buildCatalogEntry, parsePluginSeed } from '../src/catalog.js';

const seedFile = fileURLToPath(new URL('../pilot-plugin.json', import.meta.url));
const sha256 = 'a'.repeat(64);

const packaged = {
  version: '0.1.0',
  file: 'cassandragargoyle.revlens-0.1.0.vsix',
  sha256,
};

async function shippedSeed(): Promise<unknown> {
  return JSON.parse(await readFile(seedFile, 'utf8'));
}

describe('parsePluginSeed', () => {
  it('accepts the metadata this repository ships', async () => {
    const seed = parsePluginSeed(await shippedSeed());

    expect(seed.id).toBe('cassandragargoyle.revlens');
    expect(seed.fileTypes).toEqual(['revlens']);
    expect(seed.compat.verdict).toBe('supported');
  });

  it('refuses a compound suffix, which Pilot would never match', () => {
    expect(() => parsePluginSeed({ ...baseSeed(), fileTypes: ['revlens.json'] })).toThrow(
      /compound/,
    );
  });

  it('refuses to claim every JSON file in the application', () => {
    expect(() => parsePluginSeed({ ...baseSeed(), fileTypes: ['json'] })).toThrow(/every JSON/);
  });

  it('refuses an id that is not publisher.name', () => {
    expect(() => parsePluginSeed({ ...baseSeed(), id: 'revlens' })).toThrow(/publisher\.name/);
  });

  it('refuses a verdict the consent dialog cannot present', () => {
    const seed = baseSeed();
    expect(() =>
      parsePluginSeed({ ...seed, compat: { ...seed.compat, verdict: 'probably' } }),
    ).toThrow(/verdict/);
  });

  it('refuses an empty feature list, which would tell the reader nothing', () => {
    const seed = baseSeed();
    expect(() =>
      parsePluginSeed({ ...seed, compat: { ...seed.compat, availableFeatures: [] } }),
    ).toThrow(/availableFeatures/);
  });
});

describe('buildCatalogEntry', () => {
  it('joins the curated metadata to the facts about the built file', async () => {
    const entry = buildCatalogEntry(parsePluginSeed(await shippedSeed()), packaged);

    expect(entry).toMatchObject({
      id: 'cassandragargoyle.revlens',
      version: '0.1.0',
      file: 'cassandragargoyle.revlens-0.1.0.vsix',
      sha256,
      fileTypes: ['revlens'],
    });
  });

  it('carries the catalog fields and nothing else the build happened to know', async () => {
    const entry = buildCatalogEntry(parsePluginSeed(await shippedSeed()), {
      ...packaged,
      // The packaging step knows where the file landed; a catalog read on another
      // machine must not.
      path: 'C:/DEV/CassandraGargoyle/revlens/dist/pilot-plugins/x.vsix',
    } as never);

    expect(Object.keys(entry).sort()).toEqual([
      'compat',
      'displayName',
      'fileTypes',
      'file',
      'id',
      'sha256',
      'version',
    ].sort());
  });

  it('refuses a file name that is really a path', async () => {
    const seed = parsePluginSeed(await shippedSeed());

    expect(() => buildCatalogEntry(seed, { ...packaged, file: 'dist/x.vsix' })).toThrow(
      /bare file name/,
    );
  });

  it('refuses a digest that is not a sha256', async () => {
    const seed = parsePluginSeed(await shippedSeed());

    expect(() => buildCatalogEntry(seed, { ...packaged, sha256: 'deadbeef' })).toThrow(/sha256/);
  });

  it('refuses a package with no version, which Pilot uses to spot a stale install', async () => {
    const seed = parsePluginSeed(await shippedSeed());

    expect(() => buildCatalogEntry(seed, { ...packaged, version: '' })).toThrow(/version/);
  });
});

describe('buildCatalog', () => {
  it('writes the catalog version Pilot expects', async () => {
    const entry = buildCatalogEntry(parsePluginSeed(await shippedSeed()), packaged);
    const catalog = buildCatalog([entry]);

    expect(catalog.version).toBe(1);
    expect(catalog.plugins).toHaveLength(1);
  });
});

function baseSeed(): {
  id: string;
  displayName: string;
  fileTypes: string[];
  compat: {
    verdict: string;
    availableFeatures: string[];
    unavailableFeatures: string[];
    notes: string;
  };
} {
  return {
    id: 'cassandragargoyle.revlens',
    displayName: 'revlens revision viewer',
    fileTypes: ['revlens'],
    compat: {
      verdict: 'supported',
      availableFeatures: ['customEditor', 'webview'],
      unavailableFeatures: [],
      notes: 'note',
    },
  };
}
