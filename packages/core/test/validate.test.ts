import { describe, expect, it } from 'vitest';
import { validateBundle } from '../src/index.js';
import { mutateSample, readSampleJson } from './helpers/fixture.js';

/** Rule ids reported for a bundle, so an assertion names the rule rather than a message. */
function rulesFor(input: unknown): string[] {
  return validateBundle(input).issues.map((issue) => issue.rule);
}

describe('validateBundle', () => {
  it('passes the sample bundle with no issues at all', () => {
    const result = validateBundle(readSampleJson());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('passes the sample bundle in strict mode, so it has no warnings either', () => {
    expect(validateBundle(readSampleJson(), { strict: true }).valid).toBe(true);
  });

  it('reports a located message rather than throwing', () => {
    const result = validateBundle({ schemaVersion: '1.0' });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.path)).toContain('document');
  });

  it('refuses a contract version from a future major', () => {
    const bundle = mutateSample((draft) => {
      draft.schemaVersion = '2.0';
    });
    expect(rulesFor(bundle)).toContain('schema-version');
  });
});

describe('invariants', () => {
  it('catches a character count that does not match the runs it describes', () => {
    const bundle = mutateSample((draft) => {
      const edit = draft.edits.find((candidate) => candidate.id === 'E-004');
      if (edit !== undefined) edit.insertedChars = 999;
    });
    expect(rulesFor(bundle)).toContain('char-counts');
  });

  it('catches a run pointing at an edit that does not exist', () => {
    const bundle = mutateSample((draft) => {
      const run = draft.chapters[0]?.blocks[1]?.runs[0];
      if (run !== undefined) run.edit = 'E-999';
    });
    expect(rulesFor(bundle)).toContain('reference-exists');
  });

  it('catches a run pointing at a revision that does not exist', () => {
    const bundle = mutateSample((draft) => {
      const run = draft.chapters[0]?.blocks[1]?.runs[0];
      if (run !== undefined && run.kind !== 'kept') run.revision = 'R-999';
    });
    expect(rulesFor(bundle)).toContain('reference-exists');
  });

  it('catches an edit whose chapter disagrees with the block it names', () => {
    const bundle = mutateSample((draft) => {
      const edit = draft.edits.find((candidate) => candidate.id === 'E-001');
      if (edit !== undefined) edit.chapter = 'ch-02';
    });
    expect(rulesFor(bundle)).toContain('edit-chapter-matches-block');
  });

  it('catches a revision that lists its edits out of document order', () => {
    const bundle = mutateSample((draft) => {
      const revision = draft.revisions.find((candidate) => candidate.id === 'R-003');
      if (revision !== undefined) revision.edits = ['E-007', 'E-003'];
    });
    expect(rulesFor(bundle)).toContain('revision-edits-ordered');
  });

  it('catches an edit whose revision does not list it back', () => {
    const bundle = mutateSample((draft) => {
      const revision = draft.revisions.find((candidate) => candidate.id === 'R-003');
      if (revision !== undefined) revision.edits = ['E-003'];
    });
    expect(rulesFor(bundle)).toContain('revision-edits-agree');
  });

  it('catches a comment that names a revision which does not name it back', () => {
    const bundle = mutateSample((draft) => {
      const revision = draft.revisions.find((candidate) => candidate.id === 'R-002');
      if (revision !== undefined) revision.comments = [];
    });
    expect(rulesFor(bundle)).toContain('comment-revision-agree');
  });

  it('catches a duplicate id', () => {
    const bundle = mutateSample((draft) => {
      const first = draft.edits[0];
      const second = draft.edits[1];
      if (first !== undefined && second !== undefined) second.id = first.id;
    });
    expect(rulesFor(bundle)).toContain('unique-ids');
  });

  it('catches a declared order that contradicts the document', () => {
    const bundle = mutateSample((draft) => {
      const first = draft.edits.find((candidate) => candidate.id === 'E-001');
      const last = draft.edits.find((candidate) => candidate.id === 'E-007');
      if (first !== undefined && last !== undefined) {
        first.order = 7;
        last.order = 1;
      }
    });
    expect(rulesFor(bundle)).toContain('edit-order');
  });

  it('catches a replace that lost its deleted run', () => {
    const bundle = mutateSample((draft) => {
      const block = draft.chapters[1]?.blocks[1];
      if (block !== undefined) block.runs = block.runs.filter((run) => run.kind !== 'deleted');
      const edit = draft.edits.find((candidate) => candidate.id === 'E-004');
      if (edit !== undefined) edit.removedChars = 0;
    });
    expect(rulesFor(bundle)).toContain('edit-kind-matches-runs');
  });

  it('catches a block added as a whole whose attribution disagrees with the edit', () => {
    const bundle = mutateSample((draft) => {
      const block = draft.chapters[1]?.blocks.find((candidate) => candidate.id === 'ch-02/b-06');
      if (block !== undefined) delete block.introducedBy;
    });
    expect(rulesFor(bundle)).toContain('whole-block-attribution');
  });

  it('warns about adjacent runs with the same attribution that were not merged', () => {
    const bundle = mutateSample((draft) => {
      const block = draft.chapters[0]?.blocks[2];
      if (block !== undefined) {
        block.runs = [
          { kind: 'kept', text: 'Dokument vznikl ' },
          { kind: 'kept', text: 've čtyřech pracovních balících.' },
        ];
      }
    });
    const result = validateBundle(bundle);
    expect(result.issues.map((issue) => issue.rule)).toContain('runs-merged');
    // A smell, not a defect: the bundle still renders correctly.
    expect(result.valid).toBe(true);
    expect(validateBundle(bundle, { strict: true }).valid).toBe(false);
  });

  it('catches an empty run', () => {
    const bundle = mutateSample((draft) => {
      const run = draft.chapters[0]?.blocks[0]?.runs[0];
      if (run !== undefined) run.text = '';
    });
    expect(rulesFor(bundle)).toContain('run-text-nonempty');
  });
});
