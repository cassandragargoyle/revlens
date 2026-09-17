import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { bundleSchema } from '../packages/core/src/index.js';

/**
 * Generates `schema/bundle.schema.json` from the Zod schema in `@revlens/core`.
 *
 * The schema was hand-written to fix the contract before any code existed; from the
 * moment `core` exists it is generated, so the TypeScript types and the JSON Schema
 * cannot drift apart. `--check` fails when the committed file is out of date, which is
 * what CI runs.
 */

const SCHEMA_ID = 'https://infinitesolution.cz/schemas/revlens-bundle.schema.json';
const SCHEMA_TITLE = 'revlens bundle';

const target = fileURLToPath(new URL('../schema/bundle.schema.json', import.meta.url));

function generate(): string {
  const generated = z.toJSONSchema(bundleSchema, { target: 'draft-2020-12' }) as Record<
    string,
    unknown
  >;

  // The identity of the contract is ours, not the generator's, and it belongs at the top
  // of the file where a reader looks for it.
  const { $schema, description, ...rest } = generated;
  const ordered = {
    $schema,
    $id: SCHEMA_ID,
    title: SCHEMA_TITLE,
    description,
    ...rest,
  };

  return `${JSON.stringify(ordered, null, 2)}\n`;
}

async function main(): Promise<void> {
  const contents = generate();
  const check = process.argv.includes('--check');

  if (!check) {
    await writeFile(target, contents, 'utf8');
    console.log(`wrote ${target}`);
    return;
  }

  let committed: string;
  try {
    committed = await readFile(target, 'utf8');
  } catch {
    console.error(`missing ${target} - run: npm run schema`);
    process.exitCode = 1;
    return;
  }

  if (normalize(committed) === normalize(contents)) {
    console.log('schema/bundle.schema.json is up to date');
    return;
  }

  console.error(
    'schema/bundle.schema.json is out of date with the Zod schema in @revlens/core.\n' +
      'It is generated - do not edit it by hand. Run: npm run schema',
  );
  process.exitCode = 1;
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd();
}

await main();
