import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  BundleIndex,
  filterEdits,
  nextEditOfRevision,
  runsForMode,
  summarizeBundle,
  validateBundle,
} from '../packages/core/src/index.js';

/**
 * What the viewer actually has to do on a cold load, measured against a real bundle.
 *
 * INT-002 asks for first paint under two seconds on the full analysis and instant
 * navigation between sibling edits. Everything here is the browser's share of that: the
 * build cost is paid once, into the file this script reads.
 *
 *   npm run bench -- out/engagement-1.6.json
 */

const path = resolve(process.argv[2] ?? 'out/engagement-1.6.json');

function time<T>(label: string, work: () => T): T {
  const started = performance.now();
  const result = work();
  const elapsed = performance.now() - started;
  console.log(`${label.padEnd(44)} ${elapsed.toFixed(1).padStart(8)} ms`);
  return result;
}

let contents: string;
try {
  contents = readFileSync(path, 'utf8');
} catch {
  console.error(`cannot read ${path}`);
  console.error('build a bundle first, for example:');
  console.error(
    '  node apps/cli/bin/revlens.js build --source engagement --repo <analysis> --from <rev> --out out/bundle.json',
  );
  process.exit(2);
}

const bytes = statSync(path).size;

const parsed = time('parse JSON', () => JSON.parse(contents) as unknown);
const validation = time('validate schema and invariants', () => validateBundle(parsed));

if (validation.bundle === undefined) {
  console.error('the bundle does not parse; nothing to measure');
  process.exit(1);
}

const bundle = validation.bundle;
const index = time('build the index', () => new BundleIndex(bundle));
const summary = time('summarize (what GET /api/bundle answers)', () => summarizeBundle(index));

const largest = [...bundle.chapters].sort((a, b) => b.blocks.length - a.blocks.length)[0];
if (largest !== undefined) {
  time(`render the largest chapter (${largest.blocks.length} blocks)`, () =>
    largest.blocks.flatMap((block) => runsForMode(block, 'review')).length,
  );
}

time('filter by free text (cold)', () => filterEdits(index, { query: 'CTO' }).length);
// The second call is the one a reader feels: search runs on every keystroke.
time('filter by free text (warm)', () => filterEdits(index, { query: 'CTOx' }).length);
time('filter by round and chapter', () =>
  filterEdits(index, { rounds: ['K2'], chapters: [bundle.chapters[0]?.id ?? ''] }).length,
);

const firstEdit = index.editsInDocumentOrder[0];
if (firstEdit !== undefined) {
  time('step to the next edit of the same revision', () =>
    nextEditOfRevision(index, firstEdit.id)?.id,
  );
}

console.log('');
console.log(`file                 ${path}`);
console.log(`size                 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`chapters             ${summary.stats.chapters}`);
console.log(`blocks               ${summary.stats.blocks}`);
console.log(`revisions            ${summary.stats.revisions}`);
console.log(`comments             ${summary.stats.comments}`);
console.log(`edits                ${summary.stats.edits}`);
console.log(`unexplained edits    ${summary.stats.unexplainedEdits}`);
console.log(`issues               ${validation.issues.length}`);
