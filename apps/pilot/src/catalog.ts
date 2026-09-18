import { basename } from 'node:path';

/**
 * The `catalog.json` Pilot reads before it offers a viewer plugin.
 *
 * Pilot installs a real `.vsix` and runs it on its State A host, so revlens ships one
 * extension and two targets rather than two extensions. What is Pilot-specific is not
 * code but a declaration: which file extensions this viewer claims, and an honest
 * account of how much of it the host can actually run - the consent dialog quotes that
 * verdict to the reader before enabling anything.
 *
 * The shape is Pilot's, described in `src/electron/extensions/README.md` of
 * `portunix-vscode`. Pilot skips a malformed entry with a reason rather than failing the
 * whole catalog, which is the right behaviour there and the wrong one here: a viewer that
 * quietly never appears is worse than a build that stops. Hence the validation below.
 */

export type CompatVerdict = 'supported' | 'partial' | 'unsupported';

export interface CompatInfo {
  readonly verdict: CompatVerdict;
  /** Feature groups that work on the host, in the words the consent dialog shows. */
  readonly availableFeatures: readonly string[];
  /** Feature groups the manifest declares and the host does not honour. */
  readonly unavailableFeatures: readonly string[];
  readonly notes: string;
}

/** The curated half - what we assert about the plugin, kept in `pilot-plugin.json`. */
export interface PluginSeed {
  readonly id: string;
  readonly displayName: string;
  /** Lower-case extensions without the dot; Pilot matches `path.extname` against these. */
  readonly fileTypes: readonly string[];
  readonly compat: CompatInfo;
}

/** The built half - facts about the `.vsix` that only the build knows. */
export interface PackagedExtension {
  readonly version: string;
  /** File name relative to the catalog directory. */
  readonly file: string;
  /** Lower-case sha256 of the `.vsix`. */
  readonly sha256: string;
}

export interface CatalogEntry extends PluginSeed, PackagedExtension {}

export interface Catalog {
  readonly version: number;
  readonly plugins: readonly CatalogEntry[];
}

const CATALOG_VERSION = 1;
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
// A file type is a suffix Pilot matches against a file name: a plain extension
// ("revlens") or a compound one ("revlens.json"), like Pilot's own .graph.json and
// .glens.json sidecars. Pilot matches the longest suffix, so a compound type claims
// its own bundles without claiming every plain .json (portunix-vscode issue 120)
const FILE_TYPE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERDICTS: readonly CompatVerdict[] = ['supported', 'partial', 'unsupported'];

export function buildCatalog(entries: readonly CatalogEntry[]): Catalog {
  return { version: CATALOG_VERSION, plugins: entries };
}

/**
 * One catalog entry, and only the fields a catalog entry has.
 *
 * The caller hands over whatever its build knows - an absolute path, a timestamp - and
 * none of it is copied through. A catalog is read on another machine than the one that
 * wrote it, so a local path in it is at best noise and at worst a leak.
 */
export function buildCatalogEntry(seed: PluginSeed, packaged: PackagedExtension): CatalogEntry {
  if (!SHA256.test(packaged.sha256)) {
    throw new Error(`sha256 must be 64 lower-case hex characters, got "${packaged.sha256}"`);
  }
  if (packaged.version.trim() === '') {
    throw new Error('the packaged extension has no version');
  }
  if (packaged.file.trim() === '' || packaged.file !== basename(packaged.file)) {
    throw new Error(`file must be a bare file name, got "${packaged.file}"`);
  }

  return {
    id: seed.id,
    displayName: seed.displayName,
    fileTypes: seed.fileTypes,
    compat: seed.compat,
    version: packaged.version,
    file: packaged.file,
    sha256: packaged.sha256,
  };
}

/**
 * The curated metadata, checked before it is written into a catalog.
 *
 * `fileTypes` is where this goes wrong quietly: Pilot matches a plain `path.extname`, so
 * a compound suffix like `revlens.json` would never match, and a bare `json` would claim
 * every JSON file in the application. Both are rejected here.
 */
export function parsePluginSeed(value: unknown): PluginSeed {
  if (typeof value !== 'object' || value === null) {
    throw new Error('the plugin seed must be an object');
  }
  const record = value as Record<string, unknown>;

  const id = requireString(record, 'id');
  if (!PLUGIN_ID.test(id)) {
    throw new Error(`id must look like "publisher.name", got "${id}"`);
  }

  const fileTypes = requireStringArray(record, 'fileTypes');
  for (const fileType of fileTypes) {
    if (!FILE_TYPE.test(fileType)) {
      throw new Error(
        `fileTypes must be lower-case extensions, plain ("revlens") or compound` +
          ` ("revlens.json"), got "${fileType}"`,
      );
    }
    if (fileType === 'json') {
      throw new Error(
        'fileTypes must not claim "json": Pilot would offer this viewer for every JSON' +
          ' file. Give bundles their own extension instead',
      );
    }
  }

  return {
    id,
    displayName: requireString(record, 'displayName'),
    fileTypes,
    compat: parseCompat(record.compat),
  };
}

function parseCompat(value: unknown): CompatInfo {
  if (typeof value !== 'object' || value === null) {
    throw new Error('compat must be an object');
  }
  const record = value as Record<string, unknown>;
  const verdict = requireString(record, 'verdict');
  if (!VERDICTS.includes(verdict as CompatVerdict)) {
    throw new Error(`compat.verdict must be one of ${VERDICTS.join(', ')}, got "${verdict}"`);
  }

  return {
    verdict: verdict as CompatVerdict,
    // An empty `availableFeatures` would tell the reader nothing in the consent dialog.
    // An empty `unavailableFeatures` is the good case: nothing is missing.
    availableFeatures: requireStringArray(record, 'availableFeatures'),
    unavailableFeatures: optionalStringArray(record, 'unavailableFeatures'),
    notes: requireString(record, 'notes'),
  };
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(record: Record<string, unknown>, field: string): readonly string[] {
  const value = optionalStringArray(record, field);
  if (value.length === 0) {
    throw new Error(`${field} must be a non-empty array of strings`);
  }
  return value;
}

function optionalStringArray(record: Record<string, unknown>, field: string): readonly string[] {
  const value = record[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`${field}[${index}] must be a non-empty string`);
    }
    return item;
  });
}
