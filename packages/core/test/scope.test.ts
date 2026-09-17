import { describe, expect, it } from 'vitest';
import {
  BundleIndex,
  DEFAULT_COMMENT_SCOPE,
  commentStanding,
  filterComments,
  filterEdits,
  filterRevisions,
  isSettledBefore,
} from '../src/index.js';
import { mutateSample } from './helpers/fixture.js';

/**
 * INT-004: a bundle comparing two versions carries every comment the engagement ever
 * received, and the rounds closed before the baseline belong to an earlier comparison.
 */

const BASELINE = '2026-09-11T00:00:00+02:00';

/** K1-002 closed before the baseline, K2-004 closed before it but answered here anyway. */
const scoped = new BundleIndex(
  mutateSample((draft) => {
    draft.document.baseline = { version: '1.5', at: BASELINE };

    const settled = draft.comments?.find((candidate) => candidate.id === 'K1-002');
    if (settled !== undefined) {
      settled.revisions = [];
      settled.resolution = { state: 'nezahajeno', at: '2026-09-09T12:00:00+02:00' };
    }
    for (const revision of draft.revisions) {
      if (revision.id === 'R-002') delete revision.comments;
    }

    // K2-004 is the awkward one: its record puts it before the baseline, but a change in
    // this very bundle answers it.
    const early = draft.comments?.find((candidate) => candidate.id === 'K2-004');
    if (early !== undefined) {
      early.resolution = { state: 'hotovo', at: '2026-09-09T19:26:00+02:00' };
    }
  }),
);

describe('what belongs to this comparison', () => {
  it('leaves out a comment closed before the baseline that changed nothing here', () => {
    const standing = commentStanding(scoped, scoped.getComment('K1-002')!);
    expect(standing.beforeBaseline).toBe(true);
    expect(standing.landed).toBe(false);
    expect(standing.scope).toBe('settled-earlier');
  });

  it('keeps a comment that a change in this bundle answers, whatever its record says', () => {
    // The evidence in the document outweighs the timestamp in the record. Without this
    // rule the engagement loses a comment that plainly belongs here.
    const standing = commentStanding(scoped, scoped.getComment('K2-004')!);
    expect(standing.beforeBaseline).toBe(true);
    expect(standing.landed).toBe(true);
    expect(standing.scope).toBe('in-range');
  });

  it('treats everything as in range when the bundle names no baseline time', () => {
    const unscoped = new BundleIndex(
      mutateSample((draft) => {
        draft.document.baseline = { version: '1.5' };
      }),
    );
    for (const comment of unscoped.bundle.comments ?? []) {
      expect(commentStanding(unscoped, comment).scope).toBe('in-range');
    }
  });

  it('is decided by when the comment was closed, never by when it arrived', () => {
    // K2-004 arrived on 2026-09-10 and is in range; K1-002 arrived a day earlier and is
    // not. Received order and scope disagree, which is the point.
    expect(scoped.getComment('K2-004')?.received?.slice(0, 10)).toBe('2026-09-10');
    expect(scoped.getComment('K1-002')?.received?.slice(0, 10)).toBe('2026-09-09');
    expect(commentStanding(scoped, scoped.getComment('K2-004')!).scope).toBe('in-range');
    expect(commentStanding(scoped, scoped.getComment('K1-002')!).scope).toBe('settled-earlier');
  });
});

describe('filtering by scope', () => {
  it('defaults to the comparison the bundle answers', () => {
    expect(DEFAULT_COMMENT_SCOPE).toBe('in-range');
    expect(filterComments(scoped, { scope: 'in-range' }).map((c) => c.id)).toEqual([
      'K2-004',
      'K2-005',
    ]);
  });

  it('brings back the ones closed earlier when asked', () => {
    expect(filterComments(scoped, { scope: 'settled-earlier' }).map((c) => c.id)).toEqual([
      'K1-002',
    ]);
  });

  it('keeps every comment reachable, so a deep link still resolves', () => {
    expect(filterComments(scoped, {}).map((c) => c.id)).toHaveLength(3);
    expect(scoped.getComment('K1-002')).toBeDefined();
  });

  it('never empties the document: scope is a fact about comments, not about changes', () => {
    // Narrowing a list of comments must not hide the text. R-001 answers no comment at
    // all, and its change has to survive the filter.
    const edits = filterEdits(scoped, { scope: 'in-range' });
    expect(edits.map((edit) => edit.id)).toEqual(scoped.editsInDocumentOrder.map((e) => e.id));
    expect(filterRevisions(scoped, { scope: 'in-range' })).toHaveLength(4);
  });
});

describe('the predicate the report and the viewer share', () => {
  it('compares instants when both sides carry a zone', () => {
    expect(isSettledBefore('2026-08-31T19:26:00+02:00', '2026-08-31T23:11:47+02:00')).toBe(true);
    expect(isSettledBefore('2026-09-01T00:30:00+02:00', '2026-08-31T23:11:47+02:00')).toBe(false);
  });

  it('says no when either side is missing, rather than guessing', () => {
    expect(isSettledBefore(undefined, '2026-08-31T23:11:47+02:00')).toBe(false);
    expect(isSettledBefore('2026-08-31T19:26:00+02:00', undefined)).toBe(false);
  });
});
