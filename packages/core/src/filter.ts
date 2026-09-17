import type { BundleIndex } from './bundle-index.js';
import type { CommentScope, Gate } from './comments.js';
import { GATES, commentStanding, commentsInBrowsingOrder, valueOf } from './comments.js';
import type { Comment, Edit, Revision } from './schema.js';

/**
 * Filtering lives in core because the browser, the HTTP API and the MCP tools must agree
 * on what "changes by this author in this date range" means. Two implementations that
 * disagree would make the tool useless as evidence.
 *
 * All criteria combine with AND. An empty or absent criterion matches everything.
 */
export interface EditFilter {
  /** Only edits produced by these revisions. */
  readonly revisions?: readonly string[];
  /** Only revisions whose author name matches one of these, case-insensitively. */
  readonly authors?: readonly string[];
  /** Only edits answering a comment from one of these rounds. */
  readonly rounds?: readonly string[];
  /** Only edits answering one of these comments. */
  readonly comments?: readonly string[];
  /** Only edits in these chapters. */
  readonly chapters?: readonly string[];
  /** Gate 1 - only comments whose `check.verdict` is one of these. */
  readonly verdicts?: readonly string[];
  /** Gate 2 - only comments whose `decision.status` is one of these. */
  readonly decisions?: readonly string[];
  /** Gate 3 - only comments whose `resolution.state` is one of these. */
  readonly resolutions?: readonly string[];
  /**
   * Whether the comment produced a change in the document.
   *
   * `false` on its own is **not** the "still open" list: it also catches every comment
   * that was worked in before the baseline, whose changes are inside the text the
   * comparison starts from. Combine it with `beforeBaseline: false`.
   */
  readonly landed?: boolean;
  /**
   * Which comments belong to the comparison this bundle answers.
   *
   * Absent means no scope filtering at all. The browser, the API and the MCP tools each
   * apply `DEFAULT_COMMENT_SCOPE` unless told otherwise, so the three give one answer;
   * `core` itself stays neutral, because a library that filters silently is worse than one
   * that filters when asked.
   */
  readonly scope?: CommentScope;
  /** ISO timestamp; revisions made before it are excluded. */
  readonly from?: string;
  /** ISO timestamp; revisions made after it are excluded. */
  readonly to?: string;
  /** Free text, matched against the instruction and comment verbatims and the summaries. */
  readonly query?: string;
}

export function isEmptyFilter(filter: EditFilter): boolean {
  return (
    isBlank(filter.revisions) &&
    isBlank(filter.authors) &&
    isBlank(filter.rounds) &&
    isBlank(filter.comments) &&
    isBlank(filter.chapters) &&
    isBlank(filter.verdicts) &&
    isBlank(filter.decisions) &&
    isBlank(filter.resolutions) &&
    filter.landed === undefined &&
    filter.scope === undefined &&
    filter.from === undefined &&
    filter.to === undefined &&
    (filter.query === undefined || filter.query.trim().length === 0)
  );
}

/** The edits a filter admits, in document order. */
export function filterEdits(index: BundleIndex, filter: EditFilter): Edit[] {
  if (isEmptyFilter(filter)) return [...index.editsInDocumentOrder];
  return index.editsInDocumentOrder.filter((edit) => matchesEdit(index, edit, filter));
}

/** The revisions a filter admits, oldest first - what the timeline shows. */
export function filterRevisions(index: BundleIndex, filter: EditFilter): Revision[] {
  if (isEmptyFilter(filter)) return index.revisionsInTimeOrder();
  return index
    .revisionsInTimeOrder()
    .filter((revision) => matchesRevision(index, revision, filter));
}

export function matchesEdit(index: BundleIndex, edit: Edit, filter: EditFilter): boolean {
  if (!isBlank(filter.chapters) && !filter.chapters.includes(edit.chapter)) return false;
  const revision = index.getRevision(edit.revision);
  if (revision === undefined) return false;
  if (!matchesRevisionCriteria(index, revision, filter)) return false;
  // The query is applied here rather than inside the revision test, so that the edit's
  // own id and summary count as searchable - a pasted edit id must find its change.
  return matchesQuery(index, revision, filter.query, edit);
}

export function matchesRevision(
  index: BundleIndex,
  revision: Revision,
  filter: EditFilter,
): boolean {
  if (!matchesRevisionCriteria(index, revision, filter)) return false;
  if (!isBlank(filter.chapters)) {
    // A revision belongs in a chapter-scoped timeline only if it changed something there.
    const chapters = filter.chapters;
    const touches = index
      .editsOfRevision(revision.id)
      .some((edit) => chapters.includes(edit.chapter));
    if (!touches) return false;
  }
  return matchesQuery(index, revision, filter.query);
}

function matchesRevisionCriteria(
  index: BundleIndex,
  revision: Revision,
  filter: EditFilter,
): boolean {
  if (!isBlank(filter.revisions) && !filter.revisions.includes(revision.id)) return false;

  if (!isBlank(filter.authors)) {
    const wanted = filter.authors.map(normalize);
    if (!wanted.includes(normalize(revision.author.name))) return false;
  }

  if (filter.from !== undefined && revision.at < filter.from) return false;
  if (filter.to !== undefined && revision.at > filter.to) return false;

  const answered = index.commentsOfRevision(revision.id);

  if (!isBlank(filter.comments)) {
    const wanted = new Set(filter.comments);
    if (!answered.some((comment) => wanted.has(comment.id))) return false;
  }

  if (!isBlank(filter.rounds)) {
    const wanted = new Set(filter.rounds);
    if (!answered.some((comment) => comment.round !== undefined && wanted.has(comment.round))) {
      return false;
    }
  }

  // A revision passes a gate filter when one of the comments it answers does. A revision
  // that answers no comment cannot satisfy a gate, and is excluded rather than let
  // through - "show me what we declined" must not also show the plain instructions.
  for (const gate of GATES) {
    const wanted = wantedFor(filter, gate);
    if (isBlank(wanted)) continue;
    if (!answered.some((comment) => matchesGate(comment, gate, wanted))) return false;
  }

  // `landed` and `scope` are facts about a comment, and they stop there. Applying them to
  // a revision would drop every plain instruction - a revision that answers no comment
  // cannot satisfy either - and with it the changes it made, silently emptying the
  // document because the reader narrowed a list of comments.
  return true;
}

/**
 * Comments the filter admits, in browsing order.
 *
 * The gates and the free text are applied to the comment itself; the round, author and
 * date criteria are applied through the revisions that answered it, so that one filter
 * means the same thing whichever list the reader is looking at.
 */
export function filterComments(index: BundleIndex, filter: EditFilter): Comment[] {
  const comments = commentsInBrowsingOrder(index);
  if (isEmptyFilter(filter)) return comments;
  return comments.filter((comment) => matchesComment(index, comment, filter));
}

export function matchesComment(
  index: BundleIndex,
  comment: Comment,
  filter: EditFilter,
): boolean {
  if (!isBlank(filter.comments) && !filter.comments.includes(comment.id)) return false;

  if (!isBlank(filter.rounds)) {
    if (comment.round === undefined || !filter.rounds.includes(comment.round)) return false;
  }

  for (const gate of GATES) {
    const wanted = wantedFor(filter, gate);
    if (isBlank(wanted)) continue;
    if (!matchesGate(comment, gate, wanted)) return false;
  }

  const answered = index.revisionsOfComment(comment.id);

  if (filter.landed !== undefined || filter.scope !== undefined) {
    const standing = commentStanding(index, comment);
    if (filter.landed !== undefined && standing.landed !== filter.landed) return false;
    if (filter.scope !== undefined && standing.scope !== filter.scope) return false;
  }

  if (!isBlank(filter.revisions)) {
    const revisions = filter.revisions;
    if (!answered.some((revision) => revisions.includes(revision.id))) return false;
  }

  if (!isBlank(filter.chapters)) {
    const chapters = filter.chapters;
    const scoped = (comment.scope ?? []).some((id) => chapters.includes(id));
    const touched = index
      .editsOfComment(comment.id)
      .some((edit) => chapters.includes(edit.chapter));
    if (!scoped && !touched) return false;
  }

  if (!isBlank(filter.authors)) {
    const wanted = filter.authors.map(normalize);
    const byReviewer = wanted.includes(normalize(comment.author.name));
    const byProcessor = answered.some((revision) =>
      wanted.includes(normalize(revision.author.name)),
    );
    if (!byReviewer && !byProcessor) return false;
  }

  if (filter.from !== undefined || filter.to !== undefined) {
    // A comment is dated by when it arrived; one with no timestamp is not excluded by a
    // range, because the record simply does not say.
    const at = comment.received;
    if (at !== undefined) {
      if (filter.from !== undefined && at < filter.from) return false;
      if (filter.to !== undefined && at > filter.to) return false;
    }
  }

  if (filter.query !== undefined && filter.query.trim().length > 0) {
    return matchesCommentQuery(comment, filter.query);
  }

  return true;
}

function matchesGate(comment: Comment, gate: Gate, wanted: readonly string[]): boolean {
  const value = valueOf(comment, gate);
  return value !== undefined && wanted.includes(value);
}

function wantedFor(filter: EditFilter, gate: Gate): readonly string[] | undefined {
  switch (gate) {
    case 'verdict':
      return filter.verdicts;
    case 'decision':
      return filter.decisions;
    case 'resolution':
      return filter.resolutions;
  }
}

function matchesCommentQuery(comment: Comment, query: string): boolean {
  const needle = normalize(query);
  if (needle.length === 0) return true;
  const haystack: (string | undefined)[] = [
    comment.id,
    comment.round,
    comment.verbatim,
    comment.summary,
    comment.answer,
    comment.author.name,
    comment.decision?.note,
    comment.check?.note,
    ...(comment.resolution?.changes ?? []),
  ];
  return haystack.some((value) => value !== undefined && normalize(value).includes(needle));
}

/**
 * Free text is matched against what a person would search for: the instruction as it was
 * given, the comment as it was written, and the one-line summaries - never against ids
 * alone, which nobody types, but including them so a pasted id still finds its change.
 */
function matchesQuery(
  index: BundleIndex,
  revision: Revision,
  query: string | undefined,
  edit?: Edit,
): boolean {
  if (query === undefined) return true;
  const needle = normalize(query);
  if (needle.length === 0) return true;

  const haystack: (string | undefined)[] = [
    revision.id,
    revision.title,
    revision.verbatim,
    revision.why,
    revision.author.name,
    edit?.id,
    edit?.summary,
  ];

  for (const comment of index.commentsOfRevision(revision.id)) {
    haystack.push(
      comment.id,
      comment.verbatim,
      comment.summary,
      comment.answer,
      comment.author.name,
      comment.decision?.note,
    );
  }

  return haystack.some((value) => value !== undefined && normalize(value).includes(needle));
}

/**
 * Case- and diacritics-insensitive, because the text is Czech and nobody searching for
 * "roadmapy" should have to reproduce the accents to find "roadmapy".
 *
 * The results are cached. Search runs on every keystroke over every verbatim in the
 * document, and normalizing a 150-page document's worth of quotations each time is the
 * one place in the viewer where a reader would feel the lag.
 */
const normalized = new Map<string, string>();

function normalize(value: string): string {
  const cached = normalized.get(value);
  if (cached !== undefined) return cached;
  const result = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
  normalized.set(value, result);
  return result;
}

function isBlank(values: readonly string[] | undefined): values is undefined {
  return values === undefined || values.length === 0;
}
