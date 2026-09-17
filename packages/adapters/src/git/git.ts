import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Git access by shelling out to `git`.
 *
 * ADR-005 weighed this against `isomorphic-git`: shelling out is simpler and fast enough
 * for a local tool, at the cost of a dependency on a `git` binary. Everything here is
 * read-only - the builder never writes to the repository it is reading.
 */

export interface CommitRecord {
  readonly hash: string;
  readonly shortHash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  /** Author date, ISO 8601 with an offset. */
  readonly at: string;
  readonly subject: string;
  readonly body: string;
}

/** Separators unlikely to appear in a commit message. */
const FIELD = '';
const RECORD = '';

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

async function git(repo: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', repo, ...args], {
      maxBuffer: 256 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitError(`git ${args.join(' ')} failed in ${repo}: ${message}`);
  }
}

export async function isRepository(repo: string): Promise<boolean> {
  try {
    const top = await git(repo, ['rev-parse', '--show-toplevel']);
    return top.trim().length > 0;
  } catch {
    return false;
  }
}

export async function repositoryRoot(repo: string): Promise<string> {
  return (await git(repo, ['rev-parse', '--show-toplevel'])).trim();
}

export async function resolveRevision(repo: string, revision: string): Promise<string> {
  return (await git(repo, ['rev-parse', revision])).trim();
}

/**
 * Author date of a revision, ISO 8601 with an offset.
 *
 * The baseline's date is what decides whether a record predates the comparison. A comment
 * resolved before it had its changes folded into the baseline text, so it can never appear
 * as an edit - and without the date, that case is indistinguishable from a failed join.
 */
export async function commitDate(repo: string, revision: string): Promise<string | undefined> {
  try {
    const date = (await git(repo, ['show', '-s', '--format=%aI', revision])).trim();
    return date.length === 0 ? undefined : date;
  } catch {
    return undefined;
  }
}

/**
 * Commits from `from` (exclusive) to `to` (inclusive), **oldest first** - which is the
 * order the attribution walk requires and the opposite of what `git log` gives by
 * default.
 */
export async function listCommits(
  repo: string,
  from: string,
  to = 'HEAD',
  paths: readonly string[] = [],
): Promise<CommitRecord[]> {
  const format = ['%H', '%h', '%an', '%ae', '%aI', '%s', '%b'].join(FIELD) + RECORD;
  const args = ['log', '--reverse', '--no-merges', `--format=${format}`, `${from}..${to}`];
  if (paths.length > 0) args.push('--', ...paths);

  const stdout = await git(repo, args);
  return stdout
    .split(RECORD)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim().length > 0)
    .map((record): CommitRecord => {
      const [hash, shortHash, authorName, authorEmail, at, subject, body] = record.split(FIELD);
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        authorName: authorName ?? '',
        authorEmail: authorEmail ?? '',
        at: at ?? '',
        subject: subject ?? '',
        body: (body ?? '').trim(),
      };
    })
    .filter((commit) => commit.hash.length > 0);
}

/** File contents at a commit, or undefined when the file did not exist there. */
export async function readFileAt(
  repo: string,
  commit: string,
  path: string,
): Promise<string | undefined> {
  try {
    return await git(repo, ['show', `${commit}:${path}`]);
  } catch {
    return undefined;
  }
}

/** Paths under `directory` at a commit, relative to the repository root. */
export async function listFilesAt(
  repo: string,
  commit: string,
  directory: string,
): Promise<string[]> {
  const stdout = await git(repo, ['ls-tree', '-r', '--name-only', commit, '--', directory]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Paths a commit changed, relative to the repository root. */
export async function filesChangedIn(repo: string, commit: string): Promise<string[]> {
  const stdout = await git(repo, [
    'show',
    '--name-only',
    '--format=',
    '--no-renames',
    commit,
  ]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
