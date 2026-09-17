import { describe, expect, it } from 'vitest';
import {
  BundleIndex,
  commentStanding,
  commentsInBrowsingOrder,
  distinctGateValues,
  distinctRounds,
  filterComments,
} from '../src/index.js';
import { loadSampleBundle, mutateSample } from './helpers/fixture.js';

const index = new BundleIndex(loadSampleBundle());
const ids = (filter: Parameters<typeof filterComments>[1]): string[] =>
  filterComments(index, filter).map((comment) => comment.id);

describe('browsing order', () => {
  it('goes by round, then by the number in the id rather than by the string', () => {
    expect(commentsInBrowsingOrder(index).map((comment) => comment.id)).toEqual([
      'K1-002',
      'K2-004',
      'K2-005',
    ]);
  });

  it('puts K1-9 before K1-10, which a plain string sort would not', () => {
    const bundle = mutateSample((draft) => {
      const first = draft.comments?.[0];
      const second = draft.comments?.[1];
      if (first !== undefined) first.id = 'K1-10';
      if (second !== undefined) {
        second.id = 'K1-9';
        second.round = 'K1';
      }
      // The relations name the old ids; they are not what this test is about.
      for (const revision of draft.revisions) delete revision.comments;
      for (const comment of draft.comments ?? []) delete comment.revisions;
    });
    const order = commentsInBrowsingOrder(new BundleIndex(bundle))
      .filter((comment) => comment.round === 'K1')
      .map((comment) => comment.id);
    expect(order).toEqual(['K1-9', 'K1-10']);
  });
});

describe('the three gates', () => {
  it('reads all three from one comment', () => {
    const comment = index.getComment('K2-005');
    expect(comment).toBeDefined();
    const standing = commentStanding(index, comment!);
    expect(standing.verdict).toBe('potvrzeno-s-upresnenim');
    expect(standing.decision).toBe('prijato-castecne');
    expect(standing.resolution).toBe('rozpracovano');
    expect(standing.changes).toHaveLength(1);
    expect(standing.landed).toBe(true);
    expect(standing.edits.map((edit) => edit.id)).toEqual(['E-002', 'E-006']);
  });

  it('lists the distinct values each gate takes, for a filter to offer', () => {
    expect(distinctGateValues(index, 'verdict')).toEqual([
      'potvrzeno',
      'potvrzeno-s-upresnenim',
    ]);
    expect(distinctGateValues(index, 'decision')).toEqual(['prijato', 'prijato-castecne']);
    expect(distinctGateValues(index, 'resolution')).toEqual(['hotovo', 'rozpracovano']);
    expect(distinctRounds(index)).toEqual(['K1', 'K2']);
  });

  it('reports a gate the record does not fill as absent, not as empty', () => {
    const bundle = mutateSample((draft) => {
      const comment = draft.comments?.find((candidate) => candidate.id === 'K1-002');
      if (comment !== undefined) delete comment.resolution;
    });
    const mutated = new BundleIndex(bundle);
    const comment = mutated.getComment('K1-002');
    expect(commentStanding(mutated, comment!).resolution).toBeUndefined();
    expect(distinctGateValues(mutated, 'resolution')).toEqual(['hotovo', 'rozpracovano']);
  });
});

describe('filtering the review', () => {
  it('admits everything when nothing is asked', () => {
    expect(ids({})).toHaveLength(3);
  });

  it('by verdict', () => {
    expect(ids({ verdicts: ['potvrzeno-s-upresnenim'] })).toEqual(['K2-005']);
  });

  it('by decision', () => {
    expect(ids({ decisions: ['prijato'] })).toEqual(['K1-002', 'K2-004']);
  });

  it('by resolution state - the "still open" list', () => {
    expect(ids({ resolutions: ['rozpracovano'] })).toEqual(['K2-005']);
  });

  it('by round', () => {
    expect(ids({ rounds: ['K2'] })).toEqual(['K2-004', 'K2-005']);
  });

  it('by the chapter it was scoped to or landed in', () => {
    expect(ids({ chapters: ['ch-02'] })).toEqual(['K1-002', 'K2-004', 'K2-005']);
  });

  it('by whether it produced a change at all', () => {
    expect(ids({ landed: true })).toHaveLength(3);
    expect(ids({ landed: false })).toEqual([]);
  });

  it('finds the comment that was decided and never worked in', () => {
    const bundle = mutateSample((draft) => {
      // K1-002 was accepted, but nothing in the text answers it any more.
      const revision = draft.revisions.find((candidate) => candidate.id === 'R-002');
      if (revision !== undefined) delete revision.comments;
      const comment = draft.comments?.find((candidate) => candidate.id === 'K1-002');
      if (comment !== undefined) {
        comment.revisions = [];
        comment.resolution = { state: 'nezahajeno' };
      }
    });
    const mutated = new BundleIndex(bundle);
    expect(filterComments(mutated, { landed: false }).map((c) => c.id)).toEqual(['K1-002']);
    expect(
      filterComments(mutated, { decisions: ['prijato'], landed: false }).map((c) => c.id),
    ).toEqual(['K1-002']);
  });

  it('combines the gates with the other criteria', () => {
    expect(ids({ rounds: ['K2'], decisions: ['prijato'] })).toEqual(['K2-004']);
    expect(ids({ rounds: ['K1'], decisions: ['prijato-castecne'] })).toEqual([]);
  });

  it('searches the comment, its answer and its recorded resolution', () => {
    expect(ids({ query: 'planovani investic' })).toEqual(['K1-002']);
    expect(ids({ query: 'změkčena' })).toEqual(['K2-005']);
    expect(ids({ query: 'funkce opravena' })).toEqual(['K2-004']);
  });

  it('by the author of the comment, and by the author of the answer', () => {
    expect(ids({ authors: ['Martin Svoboda'] })).toEqual(['K2-004', 'K2-005']);
    expect(ids({ authors: ['Jan Novák'] })).toHaveLength(3);
  });
});

describe('the same filter over the other lists', () => {
  it('narrows the revisions by a gate too', () => {
    const bundle = loadSampleBundle();
    const withGates = new BundleIndex(bundle);
    const revisions = filterComments(withGates, { resolutions: ['rozpracovano'] });
    expect(revisions.map((comment) => comment.id)).toEqual(['K2-005']);
  });
});

describe('what the comparison can speak to at all', () => {
  /**
   * The sample has no baseline timestamp, so nothing is out of scope; a bundle with one
   * separates the comments settled before the comparison from the ones genuinely left
   * open. Conflating the two is what made "92 of 140 never landed" a false alarm on the
   * real engagement.
   */
  const withBaseline = (at: string) =>
    new BundleIndex(
      mutateSample((draft) => {
        draft.document.baseline = { version: '1.5', at };
      }),
    );

  it('reports nothing as out of scope when the bundle has no baseline date', () => {
    for (const comment of index.bundle.comments ?? []) {
      expect(commentStanding(index, comment).beforeBaseline).toBe(false);
    }
  });

  it('marks a comment worked in before the baseline as out of scope', () => {
    // K2-005 was resolved 2026-09-12; a baseline cut after that puts it behind the start.
    const later = withBaseline('2026-09-13T00:00:00+02:00');
    const comment = later.getComment('K2-005');
    expect(commentStanding(later, comment!).beforeBaseline).toBe(true);

    const earlier = withBaseline('2026-09-01T00:00:00+02:00');
    expect(commentStanding(earlier, earlier.getComment('K2-005')!).beforeBaseline).toBe(false);
  });

  it('compares instants, not days - the case that misreported sixty records', () => {
    // Resolved at 06:06, baseline cut at 23:11 the same evening: before it.
    const sameDay = new BundleIndex(
      mutateSample((draft) => {
        draft.document.baseline = { version: '1.5', at: '2026-08-31T23:11:47+02:00' };
        const comment = draft.comments?.find((candidate) => candidate.id === 'K1-002');
        if (comment !== undefined) {
          comment.resolution = { state: 'hotovo', at: '2026-08-31T06:06:00+02:00' };
        }
      }),
    );
    expect(commentStanding(sameDay, sameDay.getComment('K1-002')!).beforeBaseline).toBe(true);
  });

  it('counts a tie as in scope, because hiding a record is the worse mistake', () => {
    const tie = new BundleIndex(
      mutateSample((draft) => {
        draft.document.baseline = { version: '1.5', at: '2026-08-31T06:06:00+02:00' };
        const comment = draft.comments?.find((candidate) => candidate.id === 'K1-002');
        if (comment !== undefined) {
          comment.resolution = { state: 'hotovo', at: '2026-08-31T06:06:00+02:00' };
        }
      }),
    );
    expect(commentStanding(tie, tie.getComment('K1-002')!).beforeBaseline).toBe(false);
  });

  it('falls back to the day when the record carries no zone', () => {
    const noZone = new BundleIndex(
      mutateSample((draft) => {
        draft.document.baseline = { version: '1.5', at: '2026-09-11T23:11:47+02:00' };
        const comment = draft.comments?.find((candidate) => candidate.id === 'K1-002');
        if (comment !== undefined) comment.resolution = { state: 'hotovo', at: '2026-09-10 06:06' };
      }),
    );
    expect(commentStanding(noZone, noZone.getComment('K1-002')!).beforeBaseline).toBe(true);
  });

  it('separates the open list from the out-of-scope one', () => {
    const bundle = mutateSample((draft) => {
      draft.document.baseline = { version: '1.5', at: '2026-09-11T00:00:00+02:00' };
      // Neither produced a change any more: K1-002 was settled before the baseline,
      // K2-005 after it and is genuinely still open.
      for (const revision of draft.revisions) delete revision.comments;
      const settled = draft.comments?.find((candidate) => candidate.id === 'K1-002');
      if (settled !== undefined) {
        settled.revisions = [];
        settled.resolution = { state: 'hotovo', at: '2026-09-10T11:05:00+02:00' };
      }
      const open = draft.comments?.find((candidate) => candidate.id === 'K2-005');
      if (open !== undefined) {
        open.revisions = [];
        open.resolution = { state: 'rozpracovano', at: '2026-09-12T08:20:00+02:00' };
      }
      const other = draft.comments?.find((candidate) => candidate.id === 'K2-004');
      if (other !== undefined) {
        other.revisions = [];
        other.resolution = { state: 'hotovo', at: '2026-09-09T16:40:00+02:00' };
      }
    });
    const mutated = new BundleIndex(bundle);

    // `landed: false` alone catches both, which is the conflation to avoid.
    expect(filterComments(mutated, { landed: false }).map((c) => c.id)).toEqual([
      'K1-002',
      'K2-004',
      'K2-005',
    ]);
    // Adding the scope leaves the one genuinely still open.
    expect(
      filterComments(mutated, { landed: false, scope: 'in-range' }).map((c) => c.id),
    ).toEqual(['K2-005']);
  });
});
