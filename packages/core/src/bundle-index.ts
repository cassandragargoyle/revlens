import type { Block, Bundle, Chapter, Comment, Edit, Revision, Run } from './schema.js';

/** Where a block sits in the document, so document order never needs a scan. */
export interface BlockLocation {
  chapter: Chapter;
  chapterIndex: number;
  block: Block;
  blockIndex: number;
}

/** A run together with the block it lives in - what the inspector needs to show an edit. */
export interface LocatedRun {
  run: Run;
  runIndex: number;
  location: BlockLocation;
}

/**
 * Every lookup the viewer performs, resolved once.
 *
 * The rule is that nothing in the UI scans `chapters` to answer a question. The full
 * analysis is ~150 pages with hundreds of revisions, and a scan per render is the
 * difference between instant navigation and visible lag.
 */
export class BundleIndex {
  readonly bundle: Bundle;

  private readonly chapters = new Map<string, Chapter>();
  private readonly blocks = new Map<string, BlockLocation>();
  private readonly revisions = new Map<string, Revision>();
  private readonly comments = new Map<string, Comment>();
  private readonly edits = new Map<string, Edit>();

  private readonly runsByEdit = new Map<string, LocatedRun[]>();
  private readonly editsByRevision = new Map<string, Edit[]>();
  private readonly editsByBlock = new Map<string, Edit[]>();
  private readonly editsByChapter = new Map<string, Edit[]>();
  private readonly revisionsByComment = new Map<string, Revision[]>();
  private readonly commentsByRevision = new Map<string, Comment[]>();

  /** Every edit in document order - the spine the `j` / `k` navigation walks. */
  readonly editsInDocumentOrder: Edit[];

  private readonly documentRank = new Map<string, number>();

  constructor(bundle: Bundle) {
    this.bundle = bundle;

    bundle.chapters.forEach((chapter, chapterIndex) => {
      this.chapters.set(chapter.id, chapter);
      chapter.blocks.forEach((block, blockIndex) => {
        this.blocks.set(block.id, { chapter, chapterIndex, block, blockIndex });
        block.runs.forEach((run, runIndex) => {
          if (run.edit === undefined) return;
          const located = this.runsByEdit.get(run.edit) ?? [];
          located.push({ run, runIndex, location: { chapter, chapterIndex, block, blockIndex } });
          this.runsByEdit.set(run.edit, located);
        });
      });
    });

    for (const revision of bundle.revisions) this.revisions.set(revision.id, revision);
    for (const comment of bundle.comments ?? []) this.comments.set(comment.id, comment);
    for (const edit of bundle.edits) this.edits.set(edit.id, edit);

    this.editsInDocumentOrder = [...bundle.edits].sort((a, b) =>
      this.compareDocumentPosition(a, b),
    );
    this.editsInDocumentOrder.forEach((edit, rank) => this.documentRank.set(edit.id, rank));

    for (const edit of this.editsInDocumentOrder) {
      push(this.editsByRevision, edit.revision, edit);
      push(this.editsByBlock, edit.block, edit);
      push(this.editsByChapter, edit.chapter, edit);
    }

    for (const revision of bundle.revisions) {
      for (const commentId of revision.comments ?? []) {
        const comment = this.comments.get(commentId);
        if (comment !== undefined) push(this.commentsByRevision, revision.id, comment);
        push(this.revisionsByComment, commentId, revision);
      }
    }
  }

  static of(bundle: Bundle): BundleIndex {
    return new BundleIndex(bundle);
  }

  getChapter(id: string): Chapter | undefined {
    return this.chapters.get(id);
  }

  getBlock(id: string): BlockLocation | undefined {
    return this.blocks.get(id);
  }

  getRevision(id: string): Revision | undefined {
    return this.revisions.get(id);
  }

  getComment(id: string): Comment | undefined {
    return this.comments.get(id);
  }

  getEdit(id: string): Edit | undefined {
    return this.edits.get(id);
  }

  /** The runs an edit produced, in the order they appear in the document. */
  runsOf(editId: string): LocatedRun[] {
    return this.runsByEdit.get(editId) ?? [];
  }

  /** Edits of one revision, in document order. This is what "next change" walks. */
  editsOfRevision(revisionId: string): Edit[] {
    return this.editsByRevision.get(revisionId) ?? [];
  }

  editsOfBlock(blockId: string): Edit[] {
    return this.editsByBlock.get(blockId) ?? [];
  }

  editsOfChapter(chapterId: string): Edit[] {
    return this.editsByChapter.get(chapterId) ?? [];
  }

  /** Comments a revision answers, resolved to the records themselves. */
  commentsOfRevision(revisionId: string): Comment[] {
    return this.commentsByRevision.get(revisionId) ?? [];
  }

  /** Revisions that answered a comment - "did anyone act on my comment, and where". */
  revisionsOfComment(commentId: string): Revision[] {
    const declared = this.comments.get(commentId)?.revisions ?? [];
    const fromRevisions = this.revisionsByComment.get(commentId) ?? [];
    const merged = new Map<string, Revision>();
    for (const revision of fromRevisions) merged.set(revision.id, revision);
    for (const id of declared) {
      const revision = this.revisions.get(id);
      if (revision !== undefined) merged.set(revision.id, revision);
    }
    return [...merged.values()].sort((a, b) => a.at.localeCompare(b.at));
  }

  /** Every edit a comment produced, across all the revisions that answered it. */
  editsOfComment(commentId: string): Edit[] {
    const seen = new Set<string>();
    const result: Edit[] = [];
    for (const revision of this.revisionsOfComment(commentId)) {
      for (const edit of this.editsOfRevision(revision.id)) {
        if (seen.has(edit.id)) continue;
        seen.add(edit.id);
        result.push(edit);
      }
    }
    return result.sort((a, b) => this.rankOf(a.id) - this.rankOf(b.id));
  }

  /** Position of an edit in document order; -1 when the id is unknown. */
  rankOf(editId: string): number {
    return this.documentRank.get(editId) ?? -1;
  }

  /** How many changes a chapter carries, so an untouched chapter is visible as untouched. */
  editCountOfChapter(chapterId: string): number {
    return this.editsOfChapter(chapterId).length;
  }

  /** Revisions oldest first - the order of the timeline. */
  revisionsInTimeOrder(): Revision[] {
    return [...this.bundle.revisions].sort((a, b) => a.at.localeCompare(b.at));
  }

  /**
   * Document position of an edit: the chapter, the block, and the first run the edit
   * produced inside that block. An edit with no runs (a block dropped as a whole) sorts
   * at the head of its block.
   */
  private compareDocumentPosition(a: Edit, b: Edit): number {
    const pa = this.positionOf(a);
    const pb = this.positionOf(b);
    if (pa[0] !== pb[0]) return pa[0] - pb[0];
    if (pa[1] !== pb[1]) return pa[1] - pb[1];
    if (pa[2] !== pb[2]) return pa[2] - pb[2];
    // Two edits at the same position: fall back to the declared order, then to the id,
    // so the sort is total and a rebuild does not reshuffle the navigation.
    const oa = a.order ?? Number.MAX_SAFE_INTEGER;
    const ob = b.order ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  }

  private positionOf(edit: Edit): [number, number, number] {
    const location = this.blocks.get(edit.block);
    if (location === undefined) {
      // An edit pointing at an unknown block is a validation error, not a crash; it
      // sorts last so the viewer still renders what it can.
      return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    }
    const runs = this.runsByEdit.get(edit.id) ?? [];
    const firstRun = runs.length === 0 ? -1 : Math.min(...runs.map((r) => r.runIndex));
    return [location.chapterIndex, location.blockIndex, firstRun];
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}
