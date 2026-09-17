import type { Bundle, Chapter, Comment, Edit, Revision } from '@revlens/core';
import { BundleIndex, SCHEMA_VERSION, charCount, validateBundle } from '@revlens/core';
import type { BlockState, PendingEdit } from './blame/attribution.js';
import { EditKeyFactory } from './blame/attribution.js';
import type { ChapterState } from './blame/chapter-blame.js';
import {
  DEFAULT_MATCH_THRESHOLD,
  applyChapterRevision,
  createChapterState,
  emitChapter,
} from './blame/chapter-blame.js';
import type { CommitRecord } from './git/git.js';
import { filesChangedIn, listCommits, readFileAt, resolveRevision } from './git/git.js';
import { parseChapter } from './markdown/parse-blocks.js';
import { StableIdFactory } from './blame/stable-ids.js';
import type { ChapterFile, RevisionSeed, SourceAdapter } from './sources/types.js';

/**
 * The build: walk the commits from the baseline to the head, oldest first, and fold each
 * one into the attribution state. Everything expensive happens here, once, so that the
 * viewer only ever concatenates runs.
 */

export interface BuildOptions {
  /** Repository holding the chapters. */
  readonly repo: string;
  /** Baseline revision - the build the reviewers received. */
  readonly from: string;
  /** Head revision; defaults to HEAD. */
  readonly to?: string;
  /** Where the records live, when the adapter cannot guess. */
  readonly records?: string;
  /** Dice threshold for block matching; see ADR-004. */
  readonly threshold?: number;
  readonly generator?: string;
}

export interface ChapterReport {
  readonly id: string;
  readonly title: string;
  readonly blocks: number;
  readonly edits: number;
}

export interface BuildReport {
  readonly source: string;
  readonly repo: string;
  readonly baseline: string;
  readonly head: string;
  readonly threshold: number;
  readonly commits: number;
  readonly revisions: number;
  /** Commits that no record explained - they became `unknown` revisions. */
  readonly commitsWithoutRecord: number;
  readonly edits: number;
  /**
   * Edits whose revision has no record behind it. This number is the quality measure of
   * the bundle and belongs in the report, not hidden.
   */
  readonly unexplainedEdits: number;
  readonly comments: number;
  readonly commentsJoined: number;
  /** Text written and withdrawn again before the reader ever saw it. */
  readonly churnTokens: number;
  readonly churnBlocks: number;
  /** Block matches close enough to the threshold that a different value would flip them. */
  readonly nearThresholdMatches: number;
  readonly chapters: readonly ChapterReport[];
  readonly warnings: readonly string[];
  readonly durationMs: number;
}

export interface BuildResult {
  readonly bundle: Bundle;
  readonly report: BuildReport;
}

export async function buildBundle(
  adapter: SourceAdapter,
  options: BuildOptions,
): Promise<BuildResult> {
  const started = Date.now();
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const warnings: string[] = [];

  const source = await adapter.load({
    repo: options.repo,
    from: options.from,
    ...(options.to === undefined ? {} : { to: options.to }),
    ...(options.records === undefined ? {} : { records: options.records }),
  });

  const baseline = await resolveRevision(options.repo, options.from);
  const head = await resolveRevision(options.repo, options.to ?? 'HEAD');

  const states = await seedChapters(options.repo, baseline, source.chapters, warnings);
  const keys = new EditKeyFactory();
  // Ids are derived from what a change is, not from where it sits - see stable-ids.ts.
  const ids = new StableIdFactory();
  const revisions: Revision[] = [];
  const pendingEdits: PendingEdit[] = [];

  let churnTokens = 0;
  let churnBlocks = 0;
  let nearThresholdMatches = 0;
  let commitsWithoutRecord = 0;

  const commits = await listCommits(
    options.repo,
    baseline,
    head,
    source.chapters.map((chapter) => chapter.path),
  );

  for (const commit of commits) {
    const touched = await touchedChapters(options.repo, commit, source.chapters);
    if (touched.length === 0) continue;

    const seeds = source.explain(commit, touched);
    if (seeds.length === 0) commitsWithoutRecord += 1;

    const assignment = assignSeeds(seeds, touched, commit);

    for (const chapter of touched) {
      const state = states.get(chapter.id);
      if (state === undefined) continue;

      const contents = await readFileAt(options.repo, commit.hash, chapter.path);
      if (contents === undefined) continue;

      const seed = assignment.get(chapter.id);
      if (seed === undefined) continue;

      if (seed.id === undefined) seed.id = ids.revisionId(seed.seed, commit.hash);
      const revisionId = seed.id;
      const result = applyChapterRevision(
        state,
        parseChapter(contents),
        revisionId,
        keys,
        threshold,
      );

      pendingEdits.push(...result.edits);
      churnTokens += result.churnTokens;
      churnBlocks += result.churnBlocks;
      nearThresholdMatches += result.nearThresholdMatches;
      if (result.edits.length > 0) seed.used = true;
    }

    for (const seed of assignment.values()) {
      if (!seed.used || seed.id === undefined || seed.emitted) continue;
      seed.emitted = true;
      revisions.push(toRevision(seed.id, seed.seed));
    }
  }

  const { chapters, edits } = emitDocument(source.chapters, states, pendingEdits, ids);
  attachEditsToRevisions(revisions, edits);

  const comments = attachRevisionsToComments(source.comments, revisions);

  const bundle: Bundle = {
    schemaVersion: SCHEMA_VERSION,
    document: {
      ...source.document,
      generated: new Date().toISOString(),
      generator: options.generator ?? `revlens build --source ${adapter.name}`,
      baseline: {
        ...(source.document.baseline ?? { version: options.from }),
        commit: baseline,
      },
    },
    chapters,
    revisions,
    ...(comments.length === 0 ? {} : { comments }),
    edits,
  };

  warnings.push(...source.warnings());

  const validation = validateBundle(bundle);
  for (const issue of validation.issues) {
    warnings.push(`${issue.severity}: ${issue.path}: ${issue.message} [${issue.rule}]`);
  }

  const index = new BundleIndex(bundle);
  const unexplained = edits.filter((edit) => {
    const revision = revisions.find((candidate) => candidate.id === edit.revision);
    return revision === undefined || revision.kind === 'unknown';
  }).length;

  const report: BuildReport = {
    source: adapter.name,
    repo: options.repo,
    baseline,
    head,
    threshold,
    commits: commits.length,
    revisions: revisions.length,
    commitsWithoutRecord,
    edits: edits.length,
    unexplainedEdits: unexplained,
    comments: comments.length,
    commentsJoined: comments.filter((comment) => (comment.revisions ?? []).length > 0).length,
    churnTokens,
    churnBlocks,
    nearThresholdMatches,
    chapters: source.chapters.map((chapter): ChapterReport => {
      const state = states.get(chapter.id);
      return {
        id: chapter.id,
        title: chapter.title,
        blocks: state?.blocks.length ?? 0,
        edits: index.editCountOfChapter(chapter.id),
      };
    }),
    warnings,
    durationMs: Date.now() - started,
  };

  return { bundle, report };
}

/** A seed with the identity and bookkeeping the walk adds to it. */
interface SeedState {
  readonly seed: RevisionSeed;
  id?: string;
  used?: boolean;
  emitted?: boolean;
}

/**
 * Which revision a chapter's changes belong to.
 *
 * A commit usually carries one instruction, and then every chapter it touched belongs to
 * it. When the change log holds several entries for one commit, the entries' targets
 * decide: an entry accounts for the chapters its `changes[].target` paths name. A chapter
 * no entry claims falls to the single unclaimed entry, or to an `unknown` revision.
 */
function assignSeeds(
  seeds: readonly RevisionSeed[],
  touched: readonly ChapterFile[],
  commit: CommitRecord,
): Map<string, SeedState> {
  const assignment = new Map<string, SeedState>();
  const states = seeds.map((seed): SeedState => ({ seed }));

  for (const state of states) {
    for (const chapterId of state.seed.chapters) {
      if (!assignment.has(chapterId)) assignment.set(chapterId, state);
    }
  }

  const unclaimed = touched.filter((chapter) => !assignment.has(chapter.id));
  if (unclaimed.length === 0) return assignment;

  const general = states.filter((state) => state.seed.chapters.length === 0);
  const fallback =
    general.length === 1
      ? general[0]
      : states.length === 1
        ? states[0]
        : { seed: unknownSeed(commit) };

  for (const chapter of unclaimed) {
    assignment.set(chapter.id, fallback);
  }

  return assignment;
}

/** A commit with no record behind it still becomes a revision - and is counted as such. */
function unknownSeed(commit: CommitRecord): RevisionSeed {
  return {
    kind: 'unknown',
    at: commit.at,
    author: { name: commit.authorName, side: 'unknown' },
    title: commit.subject,
    commit: commit.shortHash,
    comments: [],
    chapters: [],
  };
}

function toRevision(id: string, seed: RevisionSeed): Revision {
  return {
    id,
    kind: seed.kind,
    at: seed.at,
    author: seed.author,
    title: seed.title,
    edits: [],
    ...(seed.verbatim === undefined ? {} : { verbatim: seed.verbatim }),
    ...(seed.why === undefined ? {} : { why: seed.why }),
    ...(seed.commit === undefined ? {} : { commit: seed.commit }),
    ...(seed.origin === undefined ? {} : { origin: seed.origin }),
    ...(seed.comments.length === 0 ? {} : { comments: [...seed.comments] }),
  };
}

async function seedChapters(
  repo: string,
  baseline: string,
  chapters: readonly ChapterFile[],
  warnings: string[],
): Promise<Map<string, ChapterState>> {
  const states = new Map<string, ChapterState>();

  for (const chapter of chapters) {
    const contents = await readFileAt(repo, baseline, chapter.path);
    if (contents === undefined) {
      // A chapter written after the baseline starts empty; everything in it is new.
      warnings.push(`chapter ${chapter.id} does not exist at the baseline (${chapter.path})`);
      states.set(
        chapter.id,
        createChapterState(chapter.id, chapter.title, chapter.path, chapter.number, []),
      );
      continue;
    }
    states.set(
      chapter.id,
      createChapterState(
        chapter.id,
        chapter.title,
        chapter.path,
        chapter.number,
        parseChapter(contents),
      ),
    );
  }

  return states;
}

async function touchedChapters(
  repo: string,
  commit: CommitRecord,
  chapters: readonly ChapterFile[],
): Promise<ChapterFile[]> {
  const changed = new Set(await filesChangedIn(repo, commit.hash));
  return chapters.filter((chapter) => changed.has(chapter.path));
}

/**
 * Ids are assigned in document order, so `E-001` is the first change a reader meets and
 * the navigation spine reads the same way the document does.
 */
function emitDocument(
  order: readonly ChapterFile[],
  states: ReadonlyMap<string, ChapterState>,
  pending: readonly PendingEdit[],
  ids: StableIdFactory,
): { chapters: Chapter[]; edits: Edit[] } {
  const position = new Map<string, [number, number, number]>();

  order.forEach((chapter, chapterIndex) => {
    const state = states.get(chapter.id);
    if (state === undefined) return;
    state.blocks.forEach((block, blockIndex) => {
      recordPositions(block, chapterIndex, blockIndex, position);
    });
  });

  const ranked = [...pending]
    .filter((edit) => position.has(edit.key))
    .sort((a, b) => comparePositions(position.get(a.key), position.get(b.key)));

  // The text each edit changed, read from the attribution. This is what the id is made
  // of, so it has to be known before the ids exist - which rules out reading it back off
  // the emitted runs.
  const content = collectEditContent(order, states);

  // Two edits identical in every respect - the same revision replacing the same words in
  // two places - are separated by their rank among themselves, and by nothing else.
  const occurrences = new Map<string, number>();
  const editIds = new Map<string, string>();

  for (const edit of ranked) {
    const changed = content.get(edit.key) ?? { inserted: '', removed: '' };
    const signature = [edit.revision, edit.kind, changed.inserted, changed.removed].join('');
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    editIds.set(
      edit.key,
      ids.editId(edit.revision, edit.kind, changed.inserted, changed.removed, occurrence),
    );
  }

  const chapters = order
    .map((chapter) => states.get(chapter.id))
    .filter((state): state is ChapterState => state !== undefined)
    .map((state) => emitChapter(state, editIds));

  const charsByEdit = countChars(chapters);

  const edits = ranked.map((edit, rank): Edit => {
    const id = editIds.get(edit.key);
    if (id === undefined) throw new Error(`edit ${edit.key} was not given an id`);
    const counts = charsByEdit.get(id) ?? { inserted: 0, removed: 0 };
    return {
      id,
      revision: edit.revision,
      chapter: edit.chapter,
      block: edit.block,
      // Position lives here, where a position belongs, rather than in the id.
      order: rank + 1,
      kind: settleKind(edit.kind, counts),
      insertedChars: counts.inserted,
      removedChars: counts.removed,
      ...(edit.summary === undefined ? {} : { summary: edit.summary }),
    };
  });

  return { chapters, edits };
}

/** The inserted and removed text of every edit, keyed by the builder's internal key. */
function collectEditContent(
  order: readonly ChapterFile[],
  states: ReadonlyMap<string, ChapterState>,
): Map<string, { inserted: string; removed: string }> {
  const content = new Map<string, { inserted: string; removed: string }>();

  for (const chapter of order) {
    const state = states.get(chapter.id);
    if (state === undefined) continue;
    for (const block of state.blocks) {
      for (const token of block.tokens) {
        if (token.removedBy !== undefined) {
          if (token.removedEdit !== undefined) {
            const entry = content.get(token.removedEdit) ?? { inserted: '', removed: '' };
            entry.removed += token.text;
            content.set(token.removedEdit, entry);
          }
          continue;
        }
        if (token.insertedEdit !== undefined) {
          const entry = content.get(token.insertedEdit) ?? { inserted: '', removed: '' };
          entry.inserted += token.text;
          content.set(token.insertedEdit, entry);
        }
      }
    }
  }

  return content;
}

/**
 * What kind of change this turned out to be, judged by the runs that reached the bundle.
 *
 * An edit is classified when it is made, but later revisions can take half of it away: a
 * replacement whose inserted words are themselves deleted three revisions on is, to the
 * reader of the final document, a deletion. The kind has to say what the bundle contains,
 * not what the diff once produced, or the inspector promises text that is not there.
 *
 * Whole-block and move edits keep their kind: they are marked on the block, not derived
 * from the runs.
 */
function settleKind(
  kind: Edit['kind'],
  counts: { inserted: number; removed: number },
): Edit['kind'] {
  if (kind === 'insert-block' || kind === 'delete-block' || kind === 'move') return kind;
  if (counts.inserted > 0 && counts.removed > 0) return 'replace';
  if (counts.inserted > 0) return 'insert';
  return 'delete';
}

/**
 * Where each edit sits, read the way the runs read it.
 *
 * A token carries both who inserted it and, once it is a tombstone, who removed it - but
 * the run it becomes shows only one of the two, the removal. Ranking by anything else
 * would order the edits differently from the document the reader sees, and an edit whose
 * every token has since been removed by another edit has no position at all: it produces
 * no run, so it is not a change the reader can reach.
 */
function recordPositions(
  block: BlockState,
  chapterIndex: number,
  blockIndex: number,
  into: Map<string, [number, number, number]>,
): void {
  block.tokens.forEach((token, tokenIndex) => {
    const key = token.removedBy === undefined ? token.insertedEdit : token.removedEdit;
    if (key === undefined || into.has(key)) return;
    into.set(key, [chapterIndex, blockIndex, tokenIndex]);
  });
}

function comparePositions(
  a: [number, number, number] | undefined,
  b: [number, number, number] | undefined,
): number {
  if (a === undefined || b === undefined) return 0;
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function countChars(
  chapters: readonly Chapter[],
): Map<string, { inserted: number; removed: number }> {
  const counts = new Map<string, { inserted: number; removed: number }>();
  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      for (const run of block.runs) {
        if (run.edit === undefined || run.kind === 'kept') continue;
        const entry = counts.get(run.edit) ?? { inserted: 0, removed: 0 };
        if (run.kind === 'inserted') entry.inserted += charCount(run.text);
        else entry.removed += charCount(run.text);
        counts.set(run.edit, entry);
      }
    }
  }
  return counts;
}

function attachEditsToRevisions(revisions: Revision[], edits: readonly Edit[]): void {
  const byRevision = new Map<string, string[]>();
  for (const edit of edits) {
    const list = byRevision.get(edit.revision) ?? [];
    list.push(edit.id);
    byRevision.set(edit.revision, list);
  }
  for (const revision of revisions) {
    revision.edits = byRevision.get(revision.id) ?? [];
  }
}

/** Both directions of the comment/revision relation, so the invariants hold. */
function attachRevisionsToComments(
  comments: readonly Comment[],
  revisions: readonly Revision[],
): Comment[] {
  const byComment = new Map<string, string[]>();
  for (const revision of revisions) {
    for (const commentId of revision.comments ?? []) {
      const list = byComment.get(commentId) ?? [];
      list.push(revision.id);
      byComment.set(commentId, list);
    }
  }

  return comments.map((comment) => ({
    ...comment,
    revisions: byComment.get(comment.id) ?? [],
  }));
}
