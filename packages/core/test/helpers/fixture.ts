import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Bundle } from '../../src/index.js';
import { bundleSchema } from '../../src/index.js';

/** The anonymized sample from `fixtures/` - the fixture of the unit tests, per INT-002. */
export const SAMPLE_BUNDLE_PATH = fileURLToPath(
  new URL('../../../../fixtures/sample-bundle.json', import.meta.url),
);

export function readSampleJson(): unknown {
  return JSON.parse(readFileSync(SAMPLE_BUNDLE_PATH, 'utf8')) as unknown;
}

export function loadSampleBundle(): Bundle {
  return bundleSchema.parse(readSampleJson());
}

/** A deep copy, so a test that breaks the bundle on purpose cannot leak into the next one. */
export function mutateSample(change: (bundle: Bundle) => void): Bundle {
  const copy = structuredClone(loadSampleBundle());
  change(copy);
  return copy;
}
