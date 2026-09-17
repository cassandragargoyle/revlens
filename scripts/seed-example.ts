import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the analysis repository of an example from the snapshots under `history/`.
 *
 * The builder reads git, so an example needs a real history - and a git repository
 * cannot be committed inside this one. What is committed is the text of each revision
 * and a manifest saying when it was made and by whom; this script replays that into a
 * throw-away repository under `out/`, with the dates the manifest gives, so that the
 * change log joins to the commits by target path and day on every machine.
 *
 * Each step directory holds only the files that step changed, at their path inside the
 * repository. The baseline step carries a tag, which is what `revlens build --from`
 * names - a hash would differ on every run.
 */

interface Step {
  readonly directory: string;
  readonly message: string;
  /** Author date, ISO 8601 with an offset - the records are joined by this day. */
  readonly at: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly tag?: string;
}

interface History {
  readonly repository?: string;
  readonly branch?: string;
  readonly steps: readonly Step[];
}

/** Written into a seeded repository, so re-seeding knows what it may remove. */
const MARKER = '.revlens-example';

const root = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  const example = await variant(
    resolve(argument('--example') ?? join(root, 'examples', '01-revision-round')),
    argument('--language') ?? 'en',
  );
  const history = JSON.parse(
    await readFile(join(example, 'history', 'history.json'), 'utf8'),
  ) as History;

  const out = resolve(
    argument('--out') ?? join(root, 'out', 'example', history.repository ?? 'analysis-repo'),
  );
  const force = process.argv.includes('--force');

  if (!(await prepare(out, force))) {
    process.exitCode = 1;
    return;
  }

  git(out, ['init', '-b', history.branch ?? 'main']);
  // Set on the repository rather than read from the machine: the example is a fixture,
  // and a commit signed or attributed to whoever runs it is not the same fixture.
  git(out, ['config', 'commit.gpgsign', 'false']);
  git(out, ['config', 'user.name', 'revlens example']);
  git(out, ['config', 'user.email', 'revlens@example.invalid']);

  await writeFile(
    join(out, MARKER),
    `Seeded from ${example} by scripts/seed-example.ts. Safe to delete.\n`,
    'utf8',
  );
  // The marker explains the directory to a person who finds it; it is not part of the
  // document, so git never sees it.
  await writeFile(join(out, '.git', 'info', 'exclude'), `${MARKER}\n`, 'utf8');

  let baseline: string | undefined;
  for (const step of history.steps) {
    await cp(join(example, 'history', step.directory), out, { recursive: true });
    git(out, ['add', '-A']);
    git(
      out,
      [
        '-c',
        `user.name=${step.author.name}`,
        '-c',
        `user.email=${step.author.email}`,
        'commit',
        '--date',
        step.at,
        '-m',
        step.message,
      ],
      { GIT_AUTHOR_DATE: step.at, GIT_COMMITTER_DATE: step.at },
    );
    if (step.tag !== undefined) {
      git(out, ['tag', '-f', step.tag]);
      baseline = step.tag;
    }
    console.log(`  ${step.at.slice(0, 10)}  ${step.message}`);
  }

  console.log(`\nseeded ${out}`);
  console.log(`  ${history.steps.length} commits, baseline tagged ${baseline ?? '(none)'}`);
  console.log(`  records: ${join(example, 'docs')}`);
}

/**
 * The directory that actually holds `history/` and `docs/`.
 *
 * An example is written in more than one language, and the two variants are the same
 * engagement told twice - so the language is an argument of the example, not a different
 * example. An example with no variants is taken as it stands.
 */
async function variant(example: string, language: string): Promise<string> {
  const direct = join(example, 'history', 'history.json');
  if (await readFile(direct, 'utf8').then(() => true, () => false)) return example;
  return join(example, language);
}

/**
 * Makes sure `out` is a directory this script may write into.
 *
 * A directory it did not seed is never removed without `--force`: the path is an
 * argument, and silently deleting whatever it happens to name is the one mistake here
 * that cannot be undone.
 */
async function prepare(out: string, force: boolean): Promise<boolean> {
  const existing = await readdir(out).catch(() => undefined);
  if (existing === undefined) {
    await mkdir(out, { recursive: true });
    return true;
  }
  if (existing.length === 0) return true;

  if (!existing.includes(MARKER) && !force) {
    console.error(`${out} exists and was not seeded by this script.`);
    console.error('Refusing to remove it. Pass --out <dir>, or --force to overwrite it.');
    return false;
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  return true;
}

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

await main();
