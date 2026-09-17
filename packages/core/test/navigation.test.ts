import { describe, expect, it } from 'vitest';
import {
  BundleIndex,
  firstEditOfRevision,
  nextEdit,
  nextEditOfRevision,
  previousEdit,
  previousEditOfRevision,
  siblingEdits,
  siblingPosition,
} from '../src/index.js';
import { loadSampleBundle } from './helpers/fixture.js';

const index = new BundleIndex(loadSampleBundle());

describe('document order', () => {
  it('walks the edits chapter by chapter, block by block', () => {
    expect(index.editsInDocumentOrder.map((edit) => edit.id)).toEqual([
      'E-001',
      'E-002',
      'E-003',
      'E-004',
      'E-005',
      'E-006',
      'E-007',
    ]);
  });

  it('agrees with the order the bundle declares', () => {
    const declared = [...index.bundle.edits]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((edit) => edit.id);
    expect(index.editsInDocumentOrder.map((edit) => edit.id)).toEqual(declared);
  });
});

describe('next change of the same revision', () => {
  it('steps between the two blocks one instruction touched', () => {
    // R-002 added PLAN to a heading and to a list item - one act, two places.
    expect(nextEditOfRevision(index, 'E-004')?.id).toBe('E-005');
    expect(previousEditOfRevision(index, 'E-005')?.id).toBe('E-004');
  });

  it('steps across chapters when the instruction did', () => {
    // R-003 corrected the same job title in chapter 1 and in chapter 2.
    expect(nextEditOfRevision(index, 'E-003')?.id).toBe('E-007');
    expect(index.getEdit('E-003')?.chapter).toBe('ch-01');
    expect(index.getEdit('E-007')?.chapter).toBe('ch-02');
  });

  it('wraps around, so the last sibling leads back to the first', () => {
    expect(nextEditOfRevision(index, 'E-007')?.id).toBe('E-003');
    expect(previousEditOfRevision(index, 'E-003')?.id).toBe('E-007');
  });

  it('stops at the ends when wrapping is switched off', () => {
    expect(nextEditOfRevision(index, 'E-007', false)).toBeUndefined();
    expect(previousEditOfRevision(index, 'E-003', false)).toBeUndefined();
  });

  it('lists the siblings in document order', () => {
    expect(siblingEdits(index, 'E-006').map((edit) => edit.id)).toEqual(['E-002', 'E-006']);
  });

  it('says where in the revision the reader is', () => {
    expect(siblingPosition(index, 'E-007')).toEqual({ position: 2, total: 2 });
    expect(siblingPosition(index, 'E-001')).toEqual({ position: 1, total: 1 });
  });

  it('returns nothing for an edit the bundle does not contain', () => {
    expect(nextEditOfRevision(index, 'E-999')).toBeUndefined();
    expect(siblingEdits(index, 'E-999')).toEqual([]);
    expect(siblingPosition(index, 'E-999')).toBeUndefined();
  });
});

describe('walking every edit in document order', () => {
  it('ignores the revision boundaries', () => {
    expect(nextEdit(index, 'E-004')?.id).toBe('E-005');
    expect(nextEdit(index, 'E-005')?.id).toBe('E-006');
    expect(previousEdit(index, 'E-001')?.id).toBe('E-007');
  });

  it('starts at the first edit when nothing is selected', () => {
    expect(nextEdit(index, undefined)?.id).toBe('E-001');
    expect(previousEdit(index, undefined)?.id).toBe('E-007');
  });

  it('walks a filtered scope when one is given', () => {
    const scope = index.editsOfChapter('ch-02');
    expect(nextEdit(index, 'E-007', true, scope)?.id).toBe('E-004');
    expect(previousEdit(index, 'E-004', true, scope)?.id).toBe('E-007');
  });
});

describe('landing on a revision', () => {
  it('lands on its first change, not on an empty panel', () => {
    expect(firstEditOfRevision(index, 'R-003')?.id).toBe('E-003');
    expect(firstEditOfRevision(index, 'R-999')).toBeUndefined();
  });
});

describe('what a comment produced', () => {
  it('lists every change made in answer to it, across chapters', () => {
    expect(index.editsOfComment('K2-004').map((edit) => edit.id)).toEqual(['E-003', 'E-007']);
  });

  it('resolves the revisions that answered it', () => {
    expect(index.revisionsOfComment('K1-002').map((revision) => revision.id)).toEqual(['R-002']);
  });
});

describe('chapter edit counts', () => {
  it('counts the changes inside each chapter', () => {
    expect(index.editCountOfChapter('ch-01')).toBe(3);
    expect(index.editCountOfChapter('ch-02')).toBe(4);
  });

  it('reports zero for a chapter the bundle does not contain', () => {
    expect(index.editCountOfChapter('ch-99')).toBe(0);
  });
});
