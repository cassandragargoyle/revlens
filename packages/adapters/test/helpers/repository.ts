import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A throw-away engagement on disk: an analysis repository with a real git history, and
 * the records that explain it one level up.
 *
 * The builder walks git, so testing it against a fabricated history is the only way to
 * show that attribution survives later revisions. A mocked git would test the mock.
 */

export interface Engagement {
  /** Root of the records - `docs/changes` and `docs/comments` live here. */
  readonly root: string;
  /** The analysis repository, which is where the chapters and the git history are. */
  readonly repo: string;
  /** Commit hashes in the order they were made. */
  readonly commits: string[];
  dispose(): void;
}

export interface ChangeEntrySeed {
  readonly id: string;
  readonly received: string;
  readonly author: string;
  readonly summary: string;
  readonly verbatim: string;
  readonly targets: readonly string[];
}

export async function createEngagement(): Promise<Engagement> {
  const root = mkdtempSync(join(tmpdir(), 'revlens-test-'));
  const repo = join(root, 'analysis-repo');
  await mkdir(repo, { recursive: true });

  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'revlens test']);
  git(repo, ['config', 'user.email', 'revlens@example.invalid']);
  git(repo, ['config', 'commit.gpgsign', 'false']);

  return {
    root,
    repo,
    commits: [],
    dispose(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function writeStructure(
  engagement: Engagement,
  chapters: readonly { id: string; number: string; file: string; title: string }[],
  version = '1.2',
): Promise<void> {
  await write(
    engagement,
    'analysis/structure.json',
    JSON.stringify(
      {
        document: {
          id: 'analyza-vzor',
          title: 'Analýza vzorového dokumentu',
          subtitle: 'Výstup analytické fáze',
          language: 'cs',
          version,
        },
        chapters: chapters.map((chapter, index) => ({ ...chapter, order: index + 1 })),
      },
      null,
      2,
    ),
  );
}

export async function write(
  engagement: Engagement,
  relativePath: string,
  contents: string,
): Promise<void> {
  const target = join(engagement.repo, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

export async function writeRecords(
  engagement: Engagement,
  version: string,
  entries: readonly (ChangeEntrySeed & { revision: string })[],
): Promise<void> {
  const target = join(engagement.root, 'docs', 'changes', version, 'changes.json');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify(
      {
        version,
        entries: entries.map((entry) => ({
          id: entry.id,
          received: entry.received,
          author: entry.author,
          revision: entry.revision,
          summary: entry.summary,
          verbatim: entry.verbatim,
          changes: entry.targets.map((target) => ({
            target,
            what: 'upraveno',
            why: 'zadáno',
          })),
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
}

export async function writeCommentRound(
  engagement: Engagement,
  round: string,
  payload: unknown,
): Promise<void> {
  const target = join(engagement.root, 'docs', 'comments', round, `${round}.json`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(payload, null, 2), 'utf8');
}

export function commit(engagement: Engagement, message: string): string {
  git(engagement.repo, ['add', '-A']);
  git(engagement.repo, ['commit', '-m', message]);
  const hash = git(engagement.repo, ['rev-parse', 'HEAD']).trim();
  engagement.commits.push(hash);
  return hash;
}

export function shortHash(engagement: Engagement, index: number): string {
  const hash = engagement.commits[index];
  if (hash === undefined) throw new Error(`no commit at index ${index}`);
  return git(engagement.repo, ['rev-parse', '--short', hash]).trim();
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
