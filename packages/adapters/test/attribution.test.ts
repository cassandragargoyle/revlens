import { describe, expect, it } from 'vitest';
import type { BlockState } from '../src/index.js';
import {
  EditKeyFactory,
  applyBlockRevision,
  createBlockState,
  emitRuns,
  liveText,
  removeBlock,
} from '../src/index.js';

/** Runs with the edit keys resolved to themselves, so a test can read the attribution. */
function runsOf(block: BlockState): { kind: string; text: string; revision?: string }[] {
  const identity = new Map<string, string>();
  for (const token of block.tokens) {
    if (token.insertedEdit !== undefined) identity.set(token.insertedEdit, token.insertedEdit);
    if (token.removedEdit !== undefined) identity.set(token.removedEdit, token.removedEdit);
  }
  return emitRuns(block, identity).map((run) => ({
    kind: run.kind,
    text: run.text,
    ...(run.kind === 'kept' ? {} : { revision: run.revision }),
  }));
}

describe('token blame', () => {
  it('leaves an untouched block alone', () => {
    const block = createBlockState('b-01', 'paragraph', undefined, 'Beze změny.');
    const result = applyBlockRevision(block, 'ch-01', 'Beze změny.', 'R-001', new EditKeyFactory());
    expect(result.edits).toEqual([]);
    expect(runsOf(block)).toEqual([{ kind: 'kept', text: 'Beze změny.' }]);
  });

  it('records an insertion as one run of the revision that made it', () => {
    const block = createBlockState('b-01', 'paragraph', undefined, 'Analýza popisuje stav.');
    applyBlockRevision(
      block,
      'ch-01',
      'Acme je česká firma. Analýza popisuje stav.',
      'R-001',
      new EditKeyFactory(),
    );
    expect(runsOf(block)).toEqual([
      { kind: 'inserted', text: 'Acme je česká firma. ', revision: 'R-001' },
      { kind: 'kept', text: 'Analýza popisuje stav.' },
    ]);
  });

  it('keeps the removed text as a tombstone where it was removed from', () => {
    const block = createBlockState(
      'b-01',
      'paragraph',
      undefined,
      'Vlastníkem roadmapy je CTO.',
    );
    applyBlockRevision(
      block,
      'ch-01',
      'Vlastníkem roadmapy je vedoucí oblasti Technology.',
      'R-003',
      new EditKeyFactory(),
    );
    expect(runsOf(block)).toEqual([
      { kind: 'kept', text: 'Vlastníkem roadmapy je ' },
      { kind: 'deleted', text: 'CTO', revision: 'R-003' },
      { kind: 'inserted', text: 'vedoucí oblasti Technology', revision: 'R-003' },
      { kind: 'kept', text: '.' },
    ]);
  });

  it('calls a delete followed by an insert one replacement, not two changes', () => {
    const block = createBlockState('b-01', 'paragraph', undefined, 'Je to CTO.');
    const result = applyBlockRevision(
      block,
      'ch-01',
      'Je to vedoucí oblasti.',
      'R-003',
      new EditKeyFactory(),
    );
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.kind).toBe('replace');
  });

  it('counts one correction of a heading as one change, not three fragments', () => {
    const block = createBlockState(
      'b-02',
      'heading',
      3,
      '2.1 Rodina CORE — jádro a moduly TINA a PARO',
    );
    const result = applyBlockRevision(
      block,
      'ch-02',
      '2.1 Rodina CORE — jádro a moduly TINA, PARO a PLAN',
      'R-002',
      new EditKeyFactory(),
    );
    // The word diff comes back in fragments; a reader sees one edited heading.
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.kind).toBe('replace');
  });

  it('keeps two changes far apart in one paragraph as two changes', () => {
    const block = createBlockState(
      'b-03',
      'paragraph',
      undefined,
      'První tvrzení je doložené. Mezi nimi stojí několik dalších slov bez jediné úpravy. Druhé tvrzení je také doložené.',
    );
    const result = applyBlockRevision(
      block,
      'ch-01',
      'První tvrzení je indicie. Mezi nimi stojí několik dalších slov bez jediné úpravy. Druhé tvrzení je také indicie.',
      'R-004',
      new EditKeyFactory(),
    );
    expect(result.edits).toHaveLength(2);
  });

  it('keeps the live text in step with what was applied', () => {
    const block = createBlockState('b-01', 'paragraph', undefined, 'Původní text zde.');
    applyBlockRevision(block, 'ch-01', 'Upravený text zde.', 'R-001', new EditKeyFactory());
    expect(liveText(block)).toBe('Upravený text zde.');
  });
});

describe('attribution across several revisions', () => {
  it('keeps an old change attributed after later revisions move it', () => {
    const keys = new EditKeyFactory();
    const block = createBlockState('b-01', 'paragraph', undefined, 'Stav je popsán.');

    applyBlockRevision(block, 'ch-01', 'Stav je popsán velmi podrobně.', 'R-001', keys);
    applyBlockRevision(
      block,
      'ch-01',
      'Úvodem: Stav je popsán velmi podrobně.',
      'R-002',
      keys,
    );
    applyBlockRevision(
      block,
      'ch-01',
      'Úvodem: Stav centra je popsán velmi podrobně.',
      'R-003',
      keys,
    );

    expect(liveText(block)).toBe('Úvodem: Stav centra je popsán velmi podrobně.');

    const runs = runsOf(block);
    // The words added by the first revision are still attributed to it, although two
    // later revisions have since inserted text before them.
    const firstRevisionText = runs
      .filter((run) => run.revision === 'R-001')
      .map((run) => run.text)
      .join('');
    expect(firstRevisionText).toContain('velmi podrobně');
    expect(runs.some((run) => run.revision === 'R-002')).toBe(true);
    expect(runs.some((run) => run.revision === 'R-003')).toBe(true);
  });

  it('drops text written and withdrawn again, and counts it as churn', () => {
    const keys = new EditKeyFactory();
    const block = createBlockState('b-01', 'paragraph', undefined, 'Základ.');

    applyBlockRevision(block, 'ch-01', 'Základ. Dočasná věta.', 'R-001', keys);
    const second = applyBlockRevision(block, 'ch-01', 'Základ.', 'R-002', keys);

    expect(second.churnTokens).toBeGreaterThan(0);
    expect(liveText(block)).toBe('Základ.');
    // The withdrawn sentence reached no reader, so it is not in the document at all.
    expect(runsOf(block)).toEqual([{ kind: 'kept', text: 'Základ.' }]);
  });

  it('merges consecutive tokens of one revision into a single run', () => {
    const block = createBlockState('b-01', 'paragraph', undefined, 'A.');
    applyBlockRevision(block, 'ch-01', 'A. Jedna dlouhá vložená věta zde.', 'R-001', keysOnce());
    const inserted = runsOf(block).filter((run) => run.kind === 'inserted');
    expect(inserted).toHaveLength(1);
  });
});

describe('removing a whole block', () => {
  it('turns every live token into a tombstone of that revision', () => {
    const block = createBlockState('b-01', 'paragraph', undefined, 'Tento odstavec zmizel.');
    const { edit } = removeBlock(block, 'ch-01', 'R-005', new EditKeyFactory());

    expect(edit.kind).toBe('delete-block');
    expect(block.removedBy).toBe('R-005');
    expect(liveText(block)).toBe('');
    expect(runsOf(block)).toEqual([
      { kind: 'deleted', text: 'Tento odstavec zmizel.', revision: 'R-005' },
    ]);
  });
});

function keysOnce(): EditKeyFactory {
  return new EditKeyFactory();
}
