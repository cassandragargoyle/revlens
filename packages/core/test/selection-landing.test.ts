import { describe, expect, it } from 'vitest';
import type { Bundle } from '../src/index.js';
import { BundleIndex, chapterShares, resolveSelection } from '../src/index.js';
import { loadSampleBundle, mutateSample } from './helpers/fixture.js';

/**
 * INT-003, second finding: a revision spread across chapters was reported as belonging to
 * the chapter holding its first change in document order - one of thirty-six, while the
 * substance sat elsewhere.
 */

/** One revision with `counts` changes per chapter, in the order the chapters are given. */
function spread(counts: Record<string, number>): Bundle {
  return mutateSample((draft) => {
    const revision = draft.revisions.find((candidate) => candidate.id === 'R-003');
    if (revision === undefined) throw new Error('fixture changed');

    // Rebuild the document so one revision owns a known number of blocks per chapter.
    draft.chapters = Object.entries(counts).map(([chapterId, count], chapterIndex) => ({
      id: chapterId,
      title: `Kapitola ${chapterIndex + 1}`,
      blocks: Array.from({ length: count }, (_block, i) => ({
        id: `${chapterId}/b-${String(i + 1).padStart(2, '0')}`,
        kind: 'paragraph' as const,
        runs: [
          {
            kind: 'inserted' as const,
            text: `text ${chapterId} ${i + 1}`,
            revision: 'R-003',
            edit: `${chapterId}-E${i + 1}`,
          },
        ],
      })),
    }));

    let order = 0;
    draft.edits = Object.entries(counts).flatMap(([chapterId, count]) =>
      Array.from({ length: count }, (_edit, i) => {
        order += 1;
        return {
          id: `${chapterId}-E${i + 1}`,
          revision: 'R-003',
          chapter: chapterId,
          block: `${chapterId}/b-${String(i + 1).padStart(2, '0')}`,
          order,
          kind: 'insert' as const,
          insertedChars: `text ${chapterId} ${i + 1}`.length,
          removedChars: 0,
        };
      }),
    );

    draft.revisions = [{ ...revision, edits: draft.edits.map((edit) => edit.id), comments: [] }];
    delete draft.comments;
  });
}

describe('where selecting a revision lands', () => {
  it('lands in the chapter the revision actually worked in, not the first one it touched', () => {
    // The shape of R-51d85a50 on the engagement: 1, 34, 1.
    const index = new BundleIndex(spread({ 'ch-04': 1, 'ch-05': 34, 'ch-07': 1 }));
    const resolved = resolveSelection(index, { kind: 'revision', id: 'R-003' });

    expect(resolved.chapterId).toBe('ch-05');
    expect(resolved.edit?.id).toBe('ch-05-E1');
  });

  it('names every chapter the revision touched, with its share, in document order', () => {
    const index = new BundleIndex(spread({ 'ch-04': 1, 'ch-05': 34, 'ch-07': 1 }));
    const resolved = resolveSelection(index, { kind: 'revision', id: 'R-003' });

    expect(resolved.chapters.map((share) => [share.chapterId, share.edits])).toEqual([
      ['ch-04', 1],
      ['ch-05', 34],
      ['ch-07', 1],
    ]);
    expect(resolved.chapters[0]?.title).toBe('Kapitola 1');
  });

  it('keeps the earlier chapter on a tie, which is the ordinary one-each case', () => {
    const index = new BundleIndex(spread({ 'ch-04': 1, 'ch-05': 1 }));
    const resolved = resolveSelection(index, { kind: 'revision', id: 'R-003' });
    expect(resolved.chapterId).toBe('ch-04');
  });

  it('still honours the chapter of an explicitly selected change', () => {
    const index = new BundleIndex(spread({ 'ch-04': 1, 'ch-05': 34 }));
    const resolved = resolveSelection(index, { kind: 'edit', id: 'ch-04-E1' });

    // The reader asked for this change; it is not moved to where the bulk sits.
    expect(resolved.chapterId).toBe('ch-04');
    expect(resolved.edit?.id).toBe('ch-04-E1');
    // The breakdown still describes the whole revision.
    expect(resolved.chapters.map((share) => share.edits)).toEqual([1, 34]);
  });
});

describe('the chapter breakdown on the sample', () => {
  const index = new BundleIndex(loadSampleBundle());

  it('reports one chapter for a revision confined to one', () => {
    const resolved = resolveSelection(index, { kind: 'revision', id: 'R-002' });
    expect(resolved.chapters.map((share) => [share.chapterId, share.edits])).toEqual([
      ['ch-02', 2],
    ]);
  });

  it('reports both chapters for the instruction that crossed them', () => {
    const resolved = resolveSelection(index, { kind: 'revision', id: 'R-003' });
    expect(resolved.chapters.map((share) => [share.chapterId, share.edits])).toEqual([
      ['ch-01', 1],
      ['ch-02', 1],
    ]);
  });

  it('describes a comment by the chapters its answers landed in', () => {
    const resolved = resolveSelection(index, { kind: 'comment', id: 'K2-004' });
    expect(resolved.chapters.map((share) => share.chapterId)).toEqual(['ch-01', 'ch-02']);
  });

  it('is empty for a selection with no changes behind it', () => {
    expect(resolveSelection(index, { kind: 'none' }).chapters).toEqual([]);
    expect(chapterShares(index, [])).toEqual([]);
  });
});
