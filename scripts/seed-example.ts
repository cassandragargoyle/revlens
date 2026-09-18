import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedExample } from '@revlens/adapters';

/**
 * The command line over `seedExample`, which is where the work now lives.
 *
 * Replaying an example's snapshots into a real repository used to be this script, and
 * make was its only caller. `Try an Example` in the editor and in the desktop window
 * needs exactly the same thing, so the implementation moved into `packages/adapters`
 * beside `runBuild` and this became the wrapper it should have been - the rule the rest
 * of the Makefile already follows, that a thing two hosts need is written once.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  const example = resolve(argument('--example') ?? join(root, 'examples', '01-revision-round'));
  const language = argument('--language') ?? 'en';
  const out = resolve(argument('--out') ?? join(root, 'out', 'example', 'analysis-repo'));

  try {
    const seeded = await seedExample({
      example,
      language,
      out,
      force: process.argv.includes('--force'),
    });

    for (const step of seeded.steps) {
      console.log(`  ${step.at.slice(0, 10)}  ${step.message}`);
    }

    console.log(`\nseeded ${seeded.repository}`);
    console.log(`  ${seeded.commits} commits, baseline tagged ${seeded.baseline ?? '(none)'}`);
    console.log(`  records: ${join(seeded.records, 'docs')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Pass --out <dir>, or --force to overwrite it.');
    process.exitCode = 1;
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

await main();
