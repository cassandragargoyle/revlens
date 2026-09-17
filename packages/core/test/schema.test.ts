import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SCHEMA_VERSION, bundleSchema, runSchema } from '../src/index.js';
import { readSampleJson } from './helpers/fixture.js';

const generatedSchemaPath = fileURLToPath(
  new URL('../../../schema/bundle.schema.json', import.meta.url),
);

describe('bundle schema', () => {
  it('accepts the sample bundle', () => {
    const parsed = bundleSchema.safeParse(readSampleJson());
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  });

  it('declares the contract version the sample was written against', () => {
    expect(SCHEMA_VERSION).toBe('1.0');
  });

  it('rejects an unknown property, so a typo cannot be silently dropped', () => {
    const bundle = readSampleJson() as Record<string, unknown>;
    const result = bundleSchema.safeParse({ ...bundle, revisons: [] });
    expect(result.success).toBe(false);
  });

  describe('run attribution', () => {
    it('accepts kept text with no revision', () => {
      expect(runSchema.safeParse({ kind: 'kept', text: 'a' }).success).toBe(true);
    });

    it('refuses a kept run that names a revision', () => {
      const result = runSchema.safeParse({ kind: 'kept', text: 'a', revision: 'R-001' });
      expect(result.success).toBe(false);
    });

    it('refuses an inserted run with no revision', () => {
      expect(runSchema.safeParse({ kind: 'inserted', text: 'a' }).success).toBe(false);
    });

    it('refuses a deleted run with no revision', () => {
      expect(runSchema.safeParse({ kind: 'deleted', text: 'a' }).success).toBe(false);
    });
  });
});

describe('generated JSON Schema', () => {
  const committed = JSON.parse(readFileSync(generatedSchemaPath, 'utf8')) as Record<
    string,
    unknown
  >;

  it('is what the Zod schema generates, so the two cannot drift apart', () => {
    const generated = z.toJSONSchema(bundleSchema, { target: 'draft-2020-12' }) as Record<
      string,
      unknown
    >;
    // The identity fields are ours and are added by the generator script.
    const { $id, title, ...rest } = committed;
    expect($id).toBe('https://infinitesolution.cz/schemas/revlens-bundle.schema.json');
    expect(title).toBe('revlens bundle');
    expect(rest).toEqual(generated);
  });

  it('accepts the sample bundle when checked by a JSON Schema validator', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(committed);
    const valid = validate(readSampleJson());
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('refuses a kept run that names a revision, like the Zod schema does', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(committed);
    const bundle = readSampleJson() as {
      chapters: { blocks: { runs: Record<string, unknown>[] }[] }[];
    };
    const firstRun = bundle.chapters[0]?.blocks[0]?.runs[0];
    expect(firstRun).toBeDefined();
    if (firstRun !== undefined) firstRun['revision'] = 'R-001';
    expect(validate(bundle)).toBe(false);
  });
});
