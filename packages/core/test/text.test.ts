import { describe, expect, it } from 'vitest';
import {
  BundleIndex,
  baselineText,
  charCount,
  finalText,
  isBlockVisible,
  runsForMode,
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
