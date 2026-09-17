import { describe, expect, it } from 'vitest';
import { BundleIndex, filterEdits, filterRevisions, isEmptyFilter } from '../src/index.js';
import { loadSampleBundle } from './helpers/fixture.js';

const index = new BundleIndex(loadSampleBundle());
const ids = (filter: Parameters<typeof filterEdits>[1]): string[] =>
  filterEdits(index, filter).map((edit) => edit.id);

describe('an empty filter', () => {
  it('admits everything', () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ query: '   ' })).toBe(true);
    expect(isEmptyFilter({ revisions: [] })).toBe(true);
    expect(ids({})).toHaveLength(7);
  });
});

describe('filtering edits', () => {
  it('by revision', () => {
    expect(ids({ revisions: ['R-002'] })).toEqual(['E-004', 'E-005']);
  });

  it('by chapter', () => {
    expect(ids({ chapters: ['ch-01'] })).toEqual(['E-001', 'E-002', 'E-003']);
  });

  it('by comment round', () => {
    expect(ids({ rounds: ['K2'] })).toEqual(['E-002', 'E-003', 'E-006', 'E-007']);
  });

  it('by comment', () => {
    expect(ids({ comments: ['K2-004'] })).toEqual(['E-003', 'E-007']);
  });

  it('by author', () => {
    expect(ids({ authors: ['Jan Novák'] })).toHaveLength(7);
    expect(ids({ authors: ['Nikdo Nikdo'] })).toEqual([]);
  });

  it('by date range, against the time of the revision', () => {
    expect(ids({ from: '2026-09-11T00:00:00+02:00' })).toEqual([
      'E-002',
      'E-003',
      'E-006',
      'E-007',
    ]);
    expect(ids({ to: '2026-09-09T00:00:00+02:00' })).toEqual(['E-001']);
    expect(
      ids({ from: '2026-09-10T00:00:00+02:00', to: '2026-09-11T00:00:00+02:00' }),
    ).toEqual(['E-004', 'E-005']);
  });

  it('combines criteria with AND', () => {
    expect(ids({ rounds: ['K2'], chapters: ['ch-02'] })).toEqual(['E-006', 'E-007']);
    expect(ids({ revisions: ['R-002'], chapters: ['ch-01'] })).toEqual([]);
  });
});

describe('free-text search', () => {
  it('finds a change by the instruction as it was given', () => {
    expect(ids({ query: 'není to CTO' })).toEqual(['E-003', 'E-007']);
  });

  it('finds a change by the reviewer comment behind it', () => {
    expect(ids({ query: 'plánování investic' })).toEqual(['E-004', 'E-005']);
  });

  it('ignores case and diacritics, because the text is Czech', () => {
    expect(ids({ query: 'PLANOVANI INVESTIC' })).toEqual(['E-004', 'E-005']);
    expect(ids({ query: 'zmekci' })).toEqual(['E-002', 'E-006']);
  });

  it('finds a change by a pasted record id', () => {
    expect(ids({ query: 'K2-005' })).toEqual(['E-002', 'E-006']);
    expect(ids({ query: 'E-001' })).toEqual(['E-001']);
  });

  it('returns nothing for a phrase the document does not contain', () => {
    expect(ids({ query: 'nic takového tu není' })).toEqual([]);
  });
});

describe('filtering the timeline', () => {
  it('keeps the revisions oldest first', () => {
    expect(filterRevisions(index, {}).map((revision) => revision.id)).toEqual([
      'R-001',
      'R-002',
      'R-003',
      'R-004',
    ]);
  });

  it('narrows to the revisions that answered one round', () => {
    expect(filterRevisions(index, { rounds: ['K1'] }).map((revision) => revision.id)).toEqual([
      'R-002',
    ]);
  });

  it('narrows by date range', () => {
    expect(
      filterRevisions(index, { from: '2026-09-11T00:00:00+02:00' }).map(
        (revision) => revision.id,
      ),
    ).toEqual(['R-003', 'R-004']);
  });
});
