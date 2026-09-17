import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';

/**
 * Checks the records of the examples against the contracts in `schema/records`.
 *
 * `schema/bundle.schema.json` is what the tool *writes*, and it is generated. The record
 * contracts are what an adapter *reads*, and they are written by hand - so they can drift
 * from the adapter, and nothing but this check would notice. Running it over every example
 * is what keeps them honest: an example that stops matching them is a real mismatch,
 * either in the records or in the contract.
 *
 * `history.schema.json` is the one contract that is not the tool's: it describes an
 * example's own manifest, which only `seed-example.ts` reads, so it lives with the
 * examples rather than with the schema the adapters answer to.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const examples = join(root, 'examples');
const contracts = join(root, 'schema', 'records');

/** Where a contract lives; everything but the examples' own manifest is the tool's. */
function contract(name: string): string {
  return name === 'history.schema.json' ? join(examples, name) : join(contracts, name);
}

interface Case {
  readonly file: string;
  readonly schema: string;
}

async function main(): Promise<void> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const cases = await collect();

  if (cases.length === 0) {
    console.error(`no records found under ${examples}`);
    process.exitCode = 1;
    return;
  }

  // One compiled validator per contract: Ajv refuses to register the same `$id` twice,
  // and every example is checked against the same handful of contracts.
  const compiled = new Map<string, ValidateFunction>();
  for (const name of new Set(cases.map((item) => item.schema))) {
    compiled.set(
      name,
      ajv.compile(JSON.parse(await readFile(contract(name), 'utf8')) as object),
    );
  }

  let failed = 0;
  for (const item of cases) {
    const validate = compiled.get(item.schema);
    if (validate === undefined) continue;
    const data = JSON.parse(await readFile(item.file, 'utf8')) as unknown;
    const where = relative(root, item.file).replace(/\\/g, '/');

    if (validate(data)) {
      console.log(`  ok    ${where}`);
      continue;
    }

    failed += 1;
    console.error(`  FAIL  ${where}  (${item.schema})`);
    for (const error of validate.errors ?? []) {
      console.error(`          ${error.instancePath || '/'} ${error.message ?? ''}`);
    }
  }

  console.log(`\n${cases.length} records checked against ${relative(root, contracts)}`);
  if (failed > 0) {
    console.error(`${failed} of them do not match their contract`);
    process.exitCode = 1;
  }
}

/** Every record file of every example, paired with the contract it has to satisfy. */
async function collect(): Promise<Case[]> {
  const cases: Case[] = [];

  for (const variant of await variants()) {
    for (const file of await walk(variant)) {
      const name = basename(file);
      if (name === 'structure.json') cases.push({ file, schema: 'structure.schema.json' });
      else if (name === 'changes.json') cases.push({ file, schema: 'changes.schema.json' });
      else if (name === 'history.json') cases.push({ file, schema: 'history.schema.json' });
      // A comment round repeats its directory name, which is what tells it apart from
      // any other JSON that may end up next to it.
      else if (name === `${basename(join(file, '..'))}.json`) {
        cases.push({ file, schema: 'comment-round.schema.json' });
      }
    }
  }

  return cases.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The directories that hold records: an example either holds `docs/` and `history/`
 * itself, or one language variant per subdirectory.
 */
async function variants(): Promise<string[]> {
  const found: string[] = [];
  for (const example of await readdir(examples, { withFileTypes: true })) {
    if (!example.isDirectory()) continue;
    const directory = join(examples, example.name);

    const children = await readdir(directory, { withFileTypes: true });
    if (children.some((child) => child.isDirectory() && child.name === 'history')) {
      found.push(directory);
      continue;
    }
    for (const child of children) {
      if (child.isDirectory()) found.push(join(directory, child.name));
    }
  }
  return found;
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.name.endsWith('.json')) files.push(path);
  }
  return files;
}

await main();
