import { describe, expect, it } from 'vitest';
import { BundleIndex, NO_SELECTION, formatHash, parseHash, resolveSelection } from '../src/index.js';
import { loadSampleBundle } from './helpers/fixture.js';

const index = new BundleIndex(loadSampleBundle());

describe('deep links', () => {
  it('parses the three forms a link can take', () => {
    expect(parseHash('#/edit/E-004')).toEqual({ kind: 'edit', id: 'E-004' });
    expect(parseHash('#/revision/R-002')).toEqual({ kind: 'revision', id: 'R-002' });
    expect(parseHash('#/comment/K1-002')).toEqual({ kind: 'comment', id: 'K1-002' });
    expect(parseHash('#/chapter/ch-02')).toEqual({ kind: 'chapter', id: 'ch-02' });
  });

  it('round-trips a selection through the address bar', () => {
    const selection = { kind: 'edit', id: 'E-004' } as const;
    expect(parseHash(formatHash(selection))).toEqual(selection);
  });

  it('survives an id that needs escaping', () => {
    const selection = { kind: 'comment', id: 'K1/002 a' } as const;
    expect(formatHash(selection)).toBe('#/comment/K1%2F002%20a');
    expect(parseHash(formatHash(selection))).toEqual(selection);
  });

  it('treats anything else as no selection', () => {
    expect(parseHash('')).toEqual(NO_SELECTION);
    expect(parseHash('#/')).toEqual(NO_SELECTION);
    expect(parseHash('#/nonsense/x')).toEqual(NO_SELECTION);
    expect(formatHash(NO_SELECTION)).toBe('');
  });
});

describe('resolving a selection on a cold load', () => {
  it('opens an edit with its revision, its comment and its siblings', () => {
    const resolved = resolveSelection(index, parseHash('#/edit/E-004'));
    expect(resolved.unresolved).toBe(false);
    expect(resolved.edit?.id).toBe('E-004');
    expect(resolved.revision?.id).toBe('R-002');
    expect(resolved.revision?.verbatim).toBe('doplň PLAN, podklad ho vede od července');
    expect(resolved.comments.map((comment) => comment.id)).toEqual(['K1-002']);
    expect(resolved.siblings.map((edit) => edit.id)).toEqual(['E-004', 'E-005']);
    expect(resolved.chapterId).toBe('ch-02');
  });

  it('lands a revision on its first change', () => {
    const resolved = resolveSelection(index, parseHash('#/revision/R-003'));
    expect(resolved.edit?.id).toBe('E-003');
    expect(resolved.chapterId).toBe('ch-01');
    expect(resolved.siblings.map((edit) => edit.id)).toEqual(['E-003', 'E-007']);
  });

  it('lands a comment on every change it produced, not just one revision', () => {
    const resolved = resolveSelection(index, parseHash('#/comment/K2-004'));
    expect(resolved.comments.map((comment) => comment.id)).toEqual(['K2-004']);
    expect(resolved.siblings.map((edit) => edit.id)).toEqual(['E-003', 'E-007']);
    expect(resolved.edit?.id).toBe('E-003');
  });

  it('carries the answer sent back to the reviewer', () => {
    const resolved = resolveSelection(index, parseHash('#/comment/K2-005'));
    expect(resolved.comments[0]?.decision?.status).toBe('prijato-castecne');
    expect(resolved.comments[0]?.answer).toContain('změkčena');
  });

  it('reports a link to something the bundle does not contain', () => {
    expect(resolveSelection(index, parseHash('#/edit/E-999')).unresolved).toBe(true);
    expect(resolveSelection(index, parseHash('#/comment/K9-999')).unresolved).toBe(true);
  });

  it('resolves an empty selection to nothing, without failing', () => {
    const resolved = resolveSelection(index, NO_SELECTION);
    expect(resolved.unresolved).toBe(false);
    expect(resolved.edit).toBeUndefined();
    expect(resolved.siblings).toEqual([]);
  });
});
