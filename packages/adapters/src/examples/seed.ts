// Replaying an example's committed snapshots into a real git repository
// One implementation, called by the command line, the editor and the desktop window

import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExampleHistory, SeedRequest, SeedResult } from './types.js';

/**
 * An example needs a real history, and a git repository cannot be committed inside
 * another one.
 *
 * So an example ships the text of each revision and a manifest saying when it was made
 * and by whom, and this turns that back into history - with the dates the manifest
 * gives, never the clock, because the change log joins to the commits by target path and
 * day. A history seeded "now" would join to nothing.
 */

/** Written into a seeded repository, so re-seeding knows what it may remove. */
export const SEED_MARKER = '.revlens-example';

export async function seedExample(request: SeedRequest): Promise<SeedResult> {
  const records = await variant(resolve(request.example), request.language ?? 'en');
  const history = JSON.parse(
    await readFile(join(records, 'history', 'history.json'), 'utf8'),
  ) as ExampleHistory;

  const out = resolve(request.out);
  await prepare(out, request.force === true);

  git(out, ['init', '-b', history.branch ?? 'main']);
  // Set on the repository rather than read from the machine: the example is a fixture,
  // and a commit signed or attributed to whoever runs it is not the same fixture.
  git(out, ['config', 'commit.gpgsign', 'false']);
  git(out, ['config', 'user.name', 'revlens example']);
  git(out, ['config', 'user.email', 'revlens@example.invalid']);

  await writeFile(
    join(out, SEED_MARKER),
    `Seeded from ${records} by revlens. Safe to delete.\n`,
    'utf8',
  );
  // The marker explains the directory to a person who finds it; it is not part of the
  // document, so git never sees it.
  await writeFile(join(out, '.git', 'info', 'exclude'), `${SEED_MARKER}\n`, 'utf8');

  let baseline: string | undefined;
  for (const step of history.steps) {
    await cp(join(records, 'history', step.directory), out, { recursive: true });
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
  }

  return {
    repository: out,
    records,
    commits: history.steps.length,
    baseline,
    steps: history.steps.map((step) => ({ at: step.at, message: step.message })),
  };
}

/**
 * The directory that actually holds `history/` and `docs/`.
 *
 * An example is written in more than one language, and the two variants are the same
 * engagement told twice - so the language is an argument of the example, not a different
 * example. An example with no variants is taken as it stands.
 */
export async function variant(example: string, language: string): Promise<string> {
  const direct = join(example, 'history', 'history.json');
  const here = await readFile(direct, 'utf8').then(
    () => true,
    () => false,
  );
  return here ? example : join(example, language);
}

/**
 * Makes sure `out` is a directory the seeding may write into.
 *
 * A directory it did not seed is never removed without `force`: the path is an argument,
 * and silently deleting whatever it happens to name is the one mistake here that cannot
 * be undone.
 */
async function prepare(out: string, force: boolean): Promise<void> {
  const existing = await readdir(out).catch(() => undefined);
  if (existing === undefined) {
    await mkdir(out, { recursive: true });
    return;
  }
  if (existing.length === 0) return;

  if (!existing.includes(SEED_MARKER) && !force) {
    throw new Error(
      `${out} exists and was not seeded by revlens; refusing to remove it. Choose an empty directory, or pass force`,
    );
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
}

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}
