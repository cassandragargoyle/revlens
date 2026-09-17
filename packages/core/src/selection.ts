import type { BundleIndex } from './bundle-index.js';
import type { Comment, Edit, Revision } from './schema.js';

/**
 * What the reader has selected, and how that selection survives being pasted into an
 * e-mail. `#/edit/E-9e4b152a` has to open the same thing on a cold load as a click does.
 */
export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'revision'; readonly id: string }
  | { readonly kind: 'comment'; readonly id: string }
  | { readonly kind: 'chapter'; readonly id: string };

export const NO_SELECTION: Selection = { kind: 'none' };

/** `#/edit/E-9e4b152a`, `#/revision/R-125cbec5`, `#/comment/K1-002`, `#/chapter/ch-02`. */
export function formatHash(selection: Selection): string {
  if (selection.kind === 'none') return '';
  return `#/${selection.kind}/${encodeURIComponent(selection.id)}`;
}

export function parseHash(hash: string): Selection {
  const match = /^#?\/?(edit|revision|comment|chapter)\/(.+)$/.exec(hash.trim());
  if (match === null) return NO_SELECTION;
  const kind = match[1] as 'edit' | 'revision' | 'comment' | 'chapter';
  const raw = match[2];
  if (raw === undefined || raw.length === 0) return NO_SELECTION;
  return { kind, id: decodeURIComponent(raw) };
}

/** A chapter the selection touched, and how much of it landed there. */
export interface ChapterShare {
  readonly chapterId: string;
  readonly title?: string;
  readonly edits: number;
}

/**
 * Everything the inspector shows for a selection, resolved in one place so the browser,
 * the HTTP API and the MCP tools cannot disagree about it.
 */
export interface ResolvedSelection {
  readonly selection: Selection;
  readonly edit?: Edit;
  readonly revision?: Revision;
  readonly comments: readonly Comment[];
  /** Edits of the same revision, in document order - the jump list of the inspector. */
  readonly siblings: readonly Edit[];
  /**
   * How the selection's changes fall across the document, in document order of chapters.
   *
   * One revision routinely touches several chapters, and naming only the first of them is
   * actively misleading: a revision with one change in one chapter and thirty-four in
   * another was being reported as belonging to the chapter that holds one of them.
   */
  readonly chapters: readonly ChapterShare[];
  /** Chapter to scroll to, when the selection points at one. */
  readonly chapterId?: string;
  /** True when the selection named something the bundle does not contain. */
  readonly unresolved: boolean;
}

export function resolveSelection(index: BundleIndex, selection: Selection): ResolvedSelection {
  switch (selection.kind) {
    case 'none':
      return { selection, comments: [], siblings: [], chapters: [], unresolved: false };

    case 'edit': {
      const edit = index.getEdit(selection.id);
      if (edit === undefined) return unresolvedFor(selection);
      const revision = index.getRevision(edit.revision);
      const siblings = index.editsOfRevision(edit.revision);
      return {
        selection,
        edit,
        revision,
        comments: index.commentsOfRevision(edit.revision),
        siblings,
        chapters: chapterShares(index, siblings),
        // The reader asked for this change, so this chapter - not wherever the bulk of the
        // revision happens to sit.
        chapterId: edit.chapter,
        unresolved: false,
      };
    }

    case 'revision': {
      const revision = index.getRevision(selection.id);
      if (revision === undefined) return unresolvedFor(selection);
      const siblings = index.editsOfRevision(revision.id);
      const chapters = chapterShares(index, siblings);
      // Land where the revision did most of its work, not on whichever of its changes
      // comes first in the document.
      const edit = landingEdit(siblings, chapters);
      return {
        selection,
        edit,
        revision,
        comments: index.commentsOfRevision(revision.id),
        siblings,
        chapters,
        chapterId: edit?.chapter,
        unresolved: false,
      };
    }

    case 'comment': {
      const comment = index.getComment(selection.id);
      if (comment === undefined) return unresolvedFor(selection);
      const edits = index.editsOfComment(comment.id);
      const chapters = chapterShares(index, edits);
      const edit = landingEdit(edits, chapters);
      const revision =
        edit === undefined
          ? index.revisionsOfComment(comment.id)[0]
          : index.getRevision(edit.revision);
      return {
        selection,
        edit,
        revision,
        comments: [comment],
        // A comment can be answered by more than one revision, so its jump list is every
        // edit it produced, not the siblings of one revision.
        siblings: edits,
        chapters,
        chapterId: edit?.chapter,
        unresolved: false,
      };
    }

    case 'chapter': {
      const chapter = index.getChapter(selection.id);
      if (chapter === undefined) return unresolvedFor(selection);
      const edits = index.editsOfChapter(chapter.id);
      return {
        selection,
        comments: [],
        siblings: edits,
        chapters: chapterShares(index, edits),
        chapterId: chapter.id,
        unresolved: false,
      };
    }
  }
}

function unresolvedFor(selection: Selection): ResolvedSelection {
  return { selection, comments: [], siblings: [], chapters: [], unresolved: true };
}

/** Which chapters a set of edits falls in, and how many in each, in document order. */
export function chapterShares(index: BundleIndex, edits: readonly Edit[]): ChapterShare[] {
  const counts = new Map<string, number>();
  for (const edit of edits) counts.set(edit.chapter, (counts.get(edit.chapter) ?? 0) + 1);

  return index.bundle.chapters
    .filter((chapter) => counts.has(chapter.id))
    .map(
      (chapter): ChapterShare => ({
        chapterId: chapter.id,
        title: chapter.title,
        edits: counts.get(chapter.id) ?? 0,
      }),
    );
}

/**
 * Where to land when a revision or a comment is selected.
 *
 * The first edit in document order is the wrong answer whenever the work is concentrated
 * elsewhere: the reader arrives at an outlying change and sees nothing of what the
 * revision was about. The chapter carrying the most changes wins, and within it the first
 * change in document order. A tie falls to the earlier chapter, which is the ordinary case
 * of one change per chapter and behaves as it always did.
 */
function landingEdit(
  edits: readonly Edit[],
  chapters: readonly ChapterShare[],
): Edit | undefined {
  if (edits.length === 0) return undefined;

  let best = chapters[0];
  for (const share of chapters) {
    if (best === undefined || share.edits > best.edits) best = share;
  }
  if (best === undefined) return edits[0];

  const target = best.chapterId;
  return edits.find((edit) => edit.chapter === target) ?? edits[0];
}
