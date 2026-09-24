import { describe, expect, it } from 'vitest';
import {
  BundleIndex,
  baselineText,
  charCount,
  finalText,
  isBlockVisible,
  runsForMode,
  tableRows,
  textForMode,
} from '../src/index.js';
import { loadSampleBundle } from './helpers/fixture.js';

const index = new BundleIndex(loadSampleBundle());
const block = (id: string) => {
  const found = index.getBlock(id)?.block;
  if (found === undefined) throw new Error(`fixture is missing block ${id}`);
  return found;
};

describe('rendering a block', () => {
  it('gives the final text as the reader gets it', () => {
    expect(finalText(block('ch-01/b-05'))).toBe(
      'Za oblast Technology odpovídá vedoucí oblasti Technology Martin Svoboda.',
    );
  });

  it('gives the text the reviewers received, from the same runs', () => {
    expect(baselineText(block('ch-01/b-05'))).toBe(
      'Za oblast Technology odpovídá CTO Martin Svoboda.',
    );
  });

  it('keeps the deleted text in review mode, at the position it was removed from', () => {
    expect(textForMode(block('ch-01/b-05'), 'review')).toBe(
      'Za oblast Technology odpovídá CTOvedoucí oblasti Technology Martin Svoboda.',
    );
    const kinds = runsForMode(block('ch-01/b-05'), 'review').map((run) => run.kind);
    expect(kinds).toEqual(['kept', 'deleted', 'inserted', 'kept']);
  });

  it('renders an untouched block identically in every mode', () => {
    const untouched = block('ch-02/b-03');
    expect(finalText(untouched)).toBe(baselineText(untouched));
    expect(textForMode(untouched, 'review')).toBe(finalText(untouched));
  });
});

describe('blocks that were added or removed as a whole', () => {
  it('hides a new block from the baseline view', () => {
    const introduced = block('ch-02/b-06');
    expect(introduced.introducedBy).toBe('R-002');
    expect(isBlockVisible(introduced, 'baseline')).toBe(false);
    expect(isBlockVisible(introduced, 'clean')).toBe(true);
    expect(isBlockVisible(introduced, 'review')).toBe(true);
  });

  it('keeps an ordinary block visible everywhere', () => {
    expect(isBlockVisible(block('ch-02/b-03'), 'baseline')).toBe(true);
  });
});

describe('character counting', () => {
  it('counts Czech diacritics as one character each', () => {
    expect(charCount('příliš')).toBe(6);
  });

  it('counts an em dash as one character', () => {
    expect(charCount('CORE — jádro')).toBe(12);
  });
});

describe('cutting a table into cells', () => {
  const texts = (rows: ReturnType<typeof tableRows>) =>
    rows?.map((row) => row.map((cell) => cell.map((run) => run.text).join('')));

  it('slices the runs by the counts, the header row first', () => {
    const rows = tableRows(block('ch-03/b-03'), 'review');
    expect(texts(rows)?.[0]).toEqual(['Oblast', 'Odpovědná osoba', 'Podklad']);
    expect(rows?.[2]?.[2]?.map((run) => run.kind)).toEqual(['kept', 'inserted']);
  });

  it('leaves the inserted run out of the baseline cell', () => {
    expect(texts(tableRows(block('ch-03/b-03'), 'baseline'))?.[2]).toEqual([
      'Technology',
      'Martin Svoboda',
      'rozhovor',
    ]);
  });

  it('keeps the cells apart in the text of the block', () => {
    expect(finalText(block('ch-03/b-03')).split('\n')[2]).toBe(
      'Technology | Martin Svoboda | rozhovor a organizační řád',
    );
  });

  it('has no cells for a table built before cells were kept', () => {
    const { table: _cells, ...old } = block('ch-03/b-03');
    expect(tableRows(old, 'review')).toBeUndefined();
    expect(textForMode(old, 'baseline')).toContain('OblastOdpovědná osoba');
  });

  it('falls back to no cells when the counts do not describe the runs', () => {
    const broken = { ...block('ch-03/b-03'), table: { columns: 3, cellRunCounts: [1, 1, 1] } };
    expect(tableRows(broken, 'review')).toBeUndefined();
  });
});
