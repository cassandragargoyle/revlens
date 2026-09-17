import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, posix, resolve } from 'node:path';
import type { Comment, Person } from '@revlens/core';
import { isSettledBefore } from '@revlens/core';
import type { CommitRecord } from '../git/git.js';
import { commitDate, readFileAt } from '../git/git.js';
import { dateToIsoWithZone, isoDay, toIsoWithZone } from '../util/timestamps.js';
import type {
  ChapterFile,
  DocumentSeed,
  LoadedSource,
  RevisionSeed,
  SourceAdapter,
  SourceOptions,
} from './types.js';

/**
 * An engagement whose records follow the house layout.
 *
 * The name is the shape of the material, not the client it first came from: an analysis
 * repository of chapters, an engagement repository around it holding the change log and
 * the comment rounds. Any engagement laid out that way builds with this adapter.
 *
 * The chapters and their git history live in the analysis repository; the change log and
 * the comment rounds live in the engagement repository one level up. The join is what
 * turns a commit into a revision that can say who asked for the change and why:
 *
 * | Join | Source | Rule |
 * | ---- | ------ | ---- |
 * | commit to instruction | `docs/changes/v*\/changes.json`, field `revision` | the entry whose `revision` is this commit |
 * | instruction to chapter | the entry's `changes[].target` paths | an entry accounts for the chapters its targets name |
 * | revision to comment | comment ids named in the entry, then `resolution.changes[]` | id first, then the file and the day |
 */

const COMMENT_ID = /\bK\d+-\d+\b/g;

interface ChangeEntry {
  id?: string;
  received?: string;
  author?: string;
  revision?: string;
  summary?: string;
  verbatim?: string;
  changes?: { target?: string; what?: string; why?: string }[];
  notes?: string;
}

interface ChangeFile {
  version?: string;
  entries?: ChangeEntry[];
}

interface CommentRoundFile {
  round?: {
    id?: string;
    author?: string;
    role?: string;
    received?: string;
    reviewed_version?: string;
    source?: string;
  };
  comments?: RawComment[];
}

interface RawComment {
  id?: string;
  scope?: string[];
  priority?: string;
  title?: string;
  source_section?: string;
  verbatim?: string;
  summary?: string;
  check?: { verdict?: string; note?: string };
  decision?: { status?: string; by?: string | null; at?: string | null; note?: string };
  resolution?: { state?: string; changes?: string[]; at?: string };
  answer?: string;
}

interface StructureFile {
  document?: {
    id?: string;
    title?: string;
    subtitle?: string;
    language?: string;
    version?: string;
  };
  chapters?: { id?: string; number?: string; file?: string; title?: string; order?: number }[];
}

/**
 * Whether this comment was closed before the baseline.
 *
 * The predicate is `core`'s, not a second copy: the build report and the viewer draw the
 * same line, or the report would say one thing and the list another.
 */
function resolvedBefore(item: JoinableComment, baselineAt: string | undefined): boolean {
  return isSettledBefore(item.resolvedAt, baselineAt);
}

/** A comment as loaded, plus what is needed to join it to a commit. */
interface JoinableComment {
  readonly comment: Comment;
  /** Chapter file basenames the resolution names. */
  readonly files: ReadonlySet<string>;
  /** Day the resolution was recorded, for the fallback join. */
  readonly resolvedOn?: string;
  /** The same moment as an instant, for deciding whether it predates the baseline. */
  readonly resolvedAt?: string;
}

export const engagementAdapter: SourceAdapter = {
  name: 'engagement',
  description:
    'engagement records in the house layout - chapters from the analysis repository, instructions from docs/changes, comments from docs/comments',

  async load(options: SourceOptions): Promise<LoadedSource> {
    const repo = resolve(options.repo);
    // The records live in the engagement repository, which holds the analysis repository.
    const records = resolve(options.records ?? dirname(repo));

    const structure = await readStructure(repo, options.to ?? 'HEAD');
    // The document carries its own version stamp, so the baseline can say "1.5" rather
    // than a commit hash - which is what a reader comparing 1.6 against 1.5 wants to see.
    const baselineStructure = await readStructure(repo, options.from);
    const baselineAt = await commitDate(repo, options.from);
    const chapters = toChapterFiles(structure);
    const entries = await readChangeEntries(records);
    const comments = await readComments(records);

    const joinedComments = new Set<string>();
    const warnings: string[] = [];
    let joinedByHash = 0;
    let joinedByDate = 0;
    let joinedByComment = 0;

    if (chapters.length === 0) {
      warnings.push(`no chapters found in ${posix.join('analysis', 'structure.json')}`);
    }
    if (entries.length === 0) {
      warnings.push(`no change entries found under ${join(records, 'docs', 'changes')}`);
    }
    if (comments.length === 0) {
      warnings.push(`no comment rounds found under ${join(records, 'docs', 'comments')}`);
    }

    const commentsById = new Map(comments.map((item) => [item.comment.id, item]));


    return {
      document: toDocumentSeed(structure, options, baselineStructure, baselineAt),
      chapters,
      comments: comments.map((item) => item.comment),

      explain(commit: CommitRecord, touched: readonly ChapterFile[]): RevisionSeed[] {
        // The change log records the commit of the engagement repository, which is not
        // the repository the chapters live in, so its hashes usually name nothing here.
        // The hash is still tried first - it is the exact join - and the fallback is the
        // one that actually works: an entry whose targets name a chapter this commit
        // touched, received on the day the commit was made.
        const byHash = entries.filter((entry) => matchesCommit(entry, commit));
        const matching =
          byHash.length > 0
            ? byHash
            : entries.filter((entry) => matchesTargetAndDay(entry, commit, touched));

        if (byHash.length > 0) joinedByHash += 1;
        else if (matching.length > 0) joinedByDate += 1;

        if (matching.length === 0) {
          // No instruction accounts for this commit, but a comment resolution may: a
          // comment whose resolution names a chapter this commit touched, recorded on the
          // day it was made. That is a weaker claim than an instruction, so the revision
          // says it came from the comment and not from a change entry.
          const answered = inferComments(comments, commit, touched);
          if (answered.length === 0) return [];
          joinedByComment += 1;
          for (const id of answered) joinedComments.add(id);

          const first = commentsById.get(answered[0] ?? '');
          return [
            {
              kind: 'comment-resolution',
              at: commit.at,
              author: toPerson(commit.authorName),
              title: first?.comment.summary ?? first?.comment.verbatim ?? commit.subject,
              comments: answered,
              chapters: [],
              commit: commit.shortHash,
              ...(first?.comment.source === undefined ? {} : { origin: first.comment.source }),
            },
          ];
        }

        return matching.map((entry): RevisionSeed => {
          const targets = (entry.changes ?? [])
            .map((change) => change.target ?? '')
            .filter((target) => target.length > 0);

          const accounted = touched
            .filter((chapter) =>
              targets.some((target) => target.includes(basename(chapter.path))),
            )
            .map((chapter) => chapter.id);

          const namedComments = commentIdsIn(entry, commentsById);
          const inferred =
            namedComments.length > 0
              ? namedComments
              : inferComments(comments, commit, touched);
          for (const id of inferred) joinedComments.add(id);

          const seed: RevisionSeed = {
            kind: inferred.length > 0 ? 'comment-resolution' : 'instruction',
            at:
              (entry.received === undefined ? undefined : toIsoWithZone(entry.received)) ??
              commit.at,
            author: toPerson(entry.author ?? commit.authorName),
            title: entry.summary ?? commit.subject,
            comments: inferred,
            chapters: accounted,
            commit: commit.shortHash,
            ...(entry.verbatim === undefined ? {} : { verbatim: entry.verbatim }),
            ...(entry.id === undefined
              ? {}
              : { origin: `docs/changes/${entry.version}/changes.json#${entry.id}` }),
          };
          return seed;
        });
      },

      warnings(): string[] {
        const extra: string[] = [];
        if (joinedByHash === 0 && joinedByDate > 0) {
          extra.push(
            `the change log names commits of another repository, so all ${joinedByDate} explained commits were joined by target path and date instead of by hash`,
          );
        } else if (joinedByDate > 0) {
          extra.push(
            `${joinedByDate} commits were joined by target path and date rather than by hash`,
          );
        }
        if (joinedByComment > 0) {
          extra.push(
            `${joinedByComment} commits were explained by a comment resolution rather than by a change entry`,
          );
        }

        // A comment worked in before the baseline cannot show up in this comparison: its
        // changes are inside the text the comparison starts from. Reporting it as "could
        // not be joined" turns a structural fact into a false alarm, and buries the ones
        // that genuinely did not join among dozens that never could.
        const unjoined = comments.filter((item) => !joinedComments.has(item.comment.id));
        const settledEarlier = unjoined.filter((item) => resolvedBefore(item, baselineAt));
        const genuinelyUnjoined = unjoined.filter((item) => !resolvedBefore(item, baselineAt));

        const result = [...warnings, ...extra];
        if (settledEarlier.length > 0) {
          result.push(
            `${settledEarlier.length} comments were worked in before the baseline and are out of scope for this comparison - not a failed join`,
          );
        }
        if (genuinelyUnjoined.length > 0) {
          const ids = genuinelyUnjoined.slice(0, 10).map((item) => item.comment.id);
          result.push(
            `${genuinelyUnjoined.length} comments resolved within the compared range could not be joined to any commit: ${ids.join(', ')}${genuinelyUnjoined.length > 10 ? ' ...' : ''}`,
          );
        }
        return result;
      },
    };
  },
};

/** Entries carry the version they belong to, so the origin link can name the file. */
type VersionedEntry = ChangeEntry & { version: string };

function matchesCommit(entry: VersionedEntry, commit: CommitRecord): boolean {
  const revision = entry.revision?.trim();
  if (revision === undefined || revision.length === 0) return false;
  return commit.hash.startsWith(revision) || revision.startsWith(commit.shortHash);
}

/**
 * The fallback join: an entry whose targets name a chapter this commit touched, written
 * on the day the commit was made. Weaker than a hash, and the report says when it was
 * used, because a join that guessed is not a join that was recorded.
 */
function matchesTargetAndDay(
  entry: VersionedEntry,
  commit: CommitRecord,
  touched: readonly ChapterFile[],
): boolean {
  if (entry.received === undefined) return false;
  const received = toIsoWithZone(entry.received);
  if (received === undefined || isoDay(received) !== isoDay(commit.at)) return false;

  const targets = (entry.changes ?? []).map((change) => change.target ?? '');
  return touched.some((chapter) => targets.some((target) => target.includes(basename(chapter.path))));
}

function commentIdsIn(
  entry: VersionedEntry,
  known: ReadonlyMap<string, JoinableComment>,
): string[] {
  const haystack = [
    entry.summary ?? '',
    entry.verbatim ?? '',
    entry.notes ?? '',
    ...(entry.changes ?? []).flatMap((change) => [
      change.target ?? '',
      change.what ?? '',
      change.why ?? '',
    ]),
  ].join('\n');

  const found = new Set<string>();
  for (const match of haystack.matchAll(COMMENT_ID)) {
    if (known.has(match[0])) found.add(match[0]);
  }
  return [...found];
}

/**
 * Fallback join: a comment whose resolution names one of the chapter files this commit
 * touched, and which was resolved on the day the commit was made.
 */
function inferComments(
  comments: readonly JoinableComment[],
  commit: CommitRecord,
  touched: readonly ChapterFile[],
): string[] {
  const day = isoDay(commit.at);
  const files = new Set(touched.map((chapter) => basename(chapter.path)));
  return comments
    .filter((item) => item.resolvedOn === day)
    .filter((item) => [...item.files].some((file) => files.has(file)))
    .map((item) => item.comment.id);
}

async function readStructure(repo: string, revision: string): Promise<StructureFile> {
  const contents =
    (await readFileAt(repo, revision, 'analysis/structure.json')) ??
    (await readFile(join(repo, 'analysis', 'structure.json'), 'utf8').catch(() => undefined));
  if (contents === undefined) return {};
  return JSON.parse(contents) as StructureFile;
}

function toChapterFiles(structure: StructureFile): ChapterFile[] {
  return (structure.chapters ?? [])
    .filter((chapter) => chapter.id !== undefined && chapter.file !== undefined)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((chapter): ChapterFile => {
      const file = chapter.file ?? '';
      return {
        id: chapter.id ?? file,
        title: chapter.title ?? file,
        path: posix.join('analysis', file),
        ...(chapter.number === undefined ? {} : { number: chapter.number }),
      };
    });
}

function toDocumentSeed(
  structure: StructureFile,
  options: SourceOptions,
  baseline: StructureFile,
  baselineAt?: string,
): DocumentSeed {
  const document = structure.document ?? {};
  const baselineVersion = baseline.document?.version;
  return {
    id: document.id ?? 'document',
    title: document.title ?? 'Document',
    version: document.version ?? 'unknown',
    ...(document.subtitle === undefined ? {} : { subtitle: document.subtitle }),
    ...(document.language === undefined ? {} : { language: document.language }),
    baseline: {
      // The version the reviewers received, read from the stamp the document carried at
      // that commit. The hash is kept alongside it, so the comparison is reproducible.
      version: baselineVersion ?? options.from,
      label:
        baselineVersion === undefined
          ? 'baseline revision'
          : `verze ${baselineVersion} — znění rozeslané k revizi`,
      commit: options.from,
      // The date decides which records predate the comparison at all.
      ...(baselineAt === undefined ? {} : { at: baselineAt }),
    },
  };
}

async function readChangeEntries(records: string): Promise<VersionedEntry[]> {
  const root = join(records, 'docs', 'changes');
  const versions = await readdir(root, { withFileTypes: true }).catch(() => []);
  const entries: VersionedEntry[] = [];

  for (const version of versions) {
    if (!version.isDirectory()) continue;
    const file = join(root, version.name, 'changes.json');
    const contents = await readFile(file, 'utf8').catch(() => undefined);
    if (contents === undefined) continue;
    const parsed = JSON.parse(contents) as ChangeFile;
    for (const entry of parsed.entries ?? []) {
      entries.push({ ...entry, version: parsed.version ?? version.name });
    }
  }

  return entries;
}

async function readComments(records: string): Promise<JoinableComment[]> {
  const root = join(records, 'docs', 'comments');
  const rounds = await readdir(root, { withFileTypes: true }).catch(() => []);
  const result: JoinableComment[] = [];

  for (const round of rounds) {
    if (!round.isDirectory()) continue;
    const file = join(root, round.name, `${round.name}.json`);
    const contents = await readFile(file, 'utf8').catch(() => undefined);
    if (contents === undefined) continue;

    const parsed = JSON.parse(contents) as CommentRoundFile;
    const meta = parsed.round ?? {};
    const author = toPerson(meta.author ?? 'unknown', 'reviewer', meta.role);

    for (const raw of parsed.comments ?? []) {
      if (raw.id === undefined) continue;
      result.push(toJoinableComment(raw, meta, author, round.name));
    }
  }

  return result;
}

function toJoinableComment(
  raw: RawComment,
  meta: NonNullable<CommentRoundFile['round']>,
  author: Person,
  roundDirectory: string,
): JoinableComment {
  const id = raw.id ?? '';
  const received = meta.received === undefined ? undefined : toIsoWithZone(meta.received);
  const resolvedAt = raw.resolution?.at ?? raw.decision?.at ?? undefined;

  const comment: Comment = {
    id,
    author,
    verbatim: raw.verbatim ?? raw.title ?? '',
    revisions: [],
    ...(meta.id === undefined ? {} : { round: meta.id }),
    ...(received === undefined ? {} : { received }),
    ...(meta.reviewed_version === undefined
      ? {}
      : { reviewedVersion: meta.reviewed_version }),
    source: `docs/comments/${roundDirectory}/${roundDirectory}.json#${id}`,
    ...(raw.source_section === undefined ? {} : { sourceSection: raw.source_section }),
    ...(raw.summary === undefined ? {} : { summary: raw.summary }),
    ...(isPriority(raw.priority) ? { priority: raw.priority } : {}),
    // `check.evidence` is a list of citations the contract has no field for; the source
    // link is what takes the reader to it.
    ...(raw.check === undefined
      ? {}
      : {
          check: {
            ...(raw.check.verdict === undefined ? {} : { verdict: raw.check.verdict }),
            ...(raw.check.note === undefined ? {} : { note: raw.check.note }),
          },
        }),
    ...(raw.decision === undefined
      ? {}
      : {
          decision: {
            ...(raw.decision.status === undefined ? {} : { status: raw.decision.status }),
            ...(raw.decision.by === undefined ? {} : { by: raw.decision.by }),
            ...(raw.decision.at === undefined || raw.decision.at === null
              ? {}
              : { at: dateToIsoWithZone(raw.decision.at) ?? raw.decision.at }),
            ...(raw.decision.note === undefined ? {} : { note: raw.decision.note }),
          },
        }),
    // The third gate. A comment can be confirmed and accepted and still not worked in,
    // and only this field says so - the document cannot, because there is nothing in it.
    ...(raw.resolution === undefined
      ? {}
      : {
          resolution: {
            ...(raw.resolution.state === undefined ? {} : { state: raw.resolution.state }),
            ...(raw.resolution.changes === undefined
              ? {}
              : { changes: raw.resolution.changes }),
            ...(raw.resolution.at === undefined
              ? {}
              : { at: toIsoWithZone(raw.resolution.at) ?? raw.resolution.at }),
          },
        }),
    ...(raw.answer === undefined ? {} : { answer: raw.answer }),
    ...(raw.scope === undefined ? {} : { scope: raw.scope }),
  };

  const files = new Set<string>();
  for (const change of raw.resolution?.changes ?? []) {
    for (const match of change.matchAll(/[\w.-]+\.md/g)) files.add(basename(match[0]));
  }

  const resolvedOn =
    resolvedAt === undefined ? undefined : isoDay(dateToIsoWithZone(resolvedAt) ?? resolvedAt);

  const resolvedInstant = resolvedAt === undefined ? undefined : dateToIsoWithZone(resolvedAt);
  return {
    comment,
    files,
    ...(resolvedOn === undefined ? {} : { resolvedOn }),
    ...(resolvedInstant === undefined ? {} : { resolvedAt: resolvedInstant }),
  };
}

function isPriority(value: string | undefined): value is 'P1' | 'P2' | 'P3' {
  return value === 'P1' || value === 'P2' || value === 'P3';
}

function toPerson(
  name: string,
  side: Person['side'] = 'processor',
  role?: string,
): Person {
  const person: Person = { name };
  const shortRole = role === undefined ? undefined : firstSentence(role);
  if (shortRole !== undefined && shortRole.length > 0) person.role = shortRole;
  if (side !== undefined) person.side = side;
  return person;
}

/** The role in the records is a paragraph; a card shows a line. */
function firstSentence(text: string): string {
  const plain = text.replace(/[*`_]/g, '').replace(/\s+/g, ' ').trim();
  const stop = plain.search(/[;.]\s/);
  const sentence = stop < 0 ? plain : plain.slice(0, stop);
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence;
}
