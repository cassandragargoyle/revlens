import { describe, expect, it } from 'vitest';
import { BundleIndex, summarizeBundle, unexplainedEdits } from '../src/index.js';
import { loadSampleBundle, mutateSample } from './helpers/fixture.js';

const index = new BundleIndex(loadSampleBundle());

describe('bundle summary', () => {
  const summary = summarizeBundle(index);

  it('carries the timeline, the comments and the edit index but no chapter text', () => {
    expect(summary.revisions).toHaveLength(5);
    expect(summary.comments).toHaveLength(3);
    expect(summary.edits).toHaveLength(8);
    expect(summary.chapters).toHaveLength(3);
    expect(summary.chapters[0]).not.toHaveProperty('blocks');
  });

  it('counts the changes in each chapter, so an untouched chapter is visible', () => {
    expect(summary.chapters.map((chapter) => [chapter.id, chapter.editCount])).toEqual([
      ['ch-01', 3],
      ['ch-02', 4],
      ['ch-03', 1],
    ]);
  });

  it('counts what was inserted and what was removed', () => {
    const declaredInserted = index.bundle.edits.reduce(
      (total, edit) => total + (edit.insertedChars ?? 0),
      0,
    );
    const declaredRemoved = index.bundle.edits.reduce(
      (total, edit) => total + (edit.removedChars ?? 0),
      0,
    );
    expect(summary.stats.insertedChars).toBe(declaredInserted);
    expect(summary.stats.removedChars).toBe(declaredRemoved);
  });

  it('reports that every edit in the sample is explained', () => {
    expect(summary.stats.unexplainedEdits).toBe(0);
    expect(unexplainedEdits(index)).toEqual([]);
  });
});

describe('unexplained edits', () => {
  it('counts the edits whose revision has no record behind it', () => {
    const bundle = mutateSample((draft) => {
      const revision = draft.revisions.find((candidate) => candidate.id === 'R-001');
      if (revision !== undefined) {
        revision.kind = 'unknown';
        revision.verbatim = '';
      }
    });
    const mutated = new BundleIndex(bundle);
    expect(unexplainedEdits(mutated).map((edit) => edit.id)).toEqual(['E-001']);
    expect(summarizeBundle(mutated).stats.unexplainedEdits).toBe(1);
  });
});
