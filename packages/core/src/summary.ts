import type { BundleIndex } from './bundle-index.js';
import type { Bundle, Edit } from './schema.js';
import { charCount } from './text.js';

/**
 * The bundle without its chapter text: metadata, the timeline, the comments and the edit
 * index. This is what `GET /api/bundle` returns, so a 150-page document does not have to
 * cross the wire before the first paint.
 */
export interface BundleSummary {
  readonly schemaVersion: string;
  readonly document: Bundle['document'];
  readonly chapters: readonly ChapterSummary[];
  readonly revisions: Bundle['revisions'];
  readonly comments: NonNullable<Bundle['comments']>;
  readonly edits: Bundle['edits'];
  readonly stats: BundleStats;
}

export interface ChapterSummary {
  readonly id: string;
  readonly number?: string;
  readonly title: string;
  readonly source?: string;
  readonly blockCount: number;
  /** How many changes the chapter carries; zero means the chapter is untouched. */
  readonly editCount: number;
}

export interface BundleStats {
  readonly chapters: number;
  readonly blocks: number;
  readonly revisions: number;
  readonly comments: number;
  readonly edits: number;
  readonly insertedChars: number;
  readonly removedChars: number;
  /** Edits whose revision could not be joined to any record - the quality measure. */
  readonly unexplainedEdits: number;
  readonly untouchedChapters: number;
}

export function summarizeBundle(index: BundleIndex): BundleSummary {
  const bundle = index.bundle;
  const chapters = bundle.chapters.map(
    (chapter): ChapterSummary => ({
      id: chapter.id,
      ...(chapter.number === undefined ? {} : { number: chapter.number }),
      title: chapter.title,
      ...(chapter.source === undefined ? {} : { source: chapter.source }),
      blockCount: chapter.blocks.length,
      editCount: index.editCountOfChapter(chapter.id),
    }),
  );

  return {
    schemaVersion: bundle.schemaVersion,
    document: bundle.document,
    chapters,
    revisions: index.revisionsInTimeOrder(),
    comments: bundle.comments ?? [],
    edits: index.editsInDocumentOrder,
    stats: computeStats(index),
  };
}

export function computeStats(index: BundleIndex): BundleStats {
  const bundle = index.bundle;
  let inserted = 0;
  let removed = 0;
  for (const chapter of bundle.chapters) {
    for (const block of chapter.blocks) {
      for (const run of block.runs) {
        if (run.kind === 'inserted') inserted += charCount(run.text);
        if (run.kind === 'deleted') removed += charCount(run.text);
      }
    }
  }

  return {
    chapters: bundle.chapters.length,
    blocks: bundle.chapters.reduce((total, chapter) => total + chapter.blocks.length, 0),
    revisions: bundle.revisions.length,
    comments: (bundle.comments ?? []).length,
    edits: bundle.edits.length,
    insertedChars: inserted,
    removedChars: removed,
    unexplainedEdits: unexplainedEdits(index).length,
    untouchedChapters: bundle.chapters.filter(
      (chapter) => index.editCountOfChapter(chapter.id) === 0,
    ).length,
  };
}

/**
 * Edits whose revision has no record behind it. The number belongs in the report rather
 * than hidden - it is what says how much of the document the join actually explained.
 */
export function unexplainedEdits(index: BundleIndex): Edit[] {
  return index.editsInDocumentOrder.filter((edit) => {
    const revision = index.getRevision(edit.revision);
    return revision === undefined || revision.kind === 'unknown';
  });
}
