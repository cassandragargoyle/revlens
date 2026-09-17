import { describe, expect, it } from 'vitest';
import { bigrams, detokenize, diceCoefficient, diffTokens, tokenize } from '../src/index.js';

describe('tokenize', () => {
  it('round-trips, so the renderer cannot lose a space', () => {
    const samples = [
      'Vlastníkem produktové roadmapy je CTO.',
      '2.1 Rodina CORE — jádro a moduly TINA, PARO a PLAN',
      '  leading and trailing   ',
      'Modulární skladba je „hlavní výhodou" portfolia.',
      '',
    ];
    for (const sample of samples) {
      expect(detokenize(tokenize(sample))).toBe(sample);
    }
  });

  it('keeps a Czech word with diacritics in one piece', () => {
    expect(tokenize('vedoucí oblasti')).toEqual(['vedoucí', ' ', 'oblasti']);
  });

  it('makes punctuation its own token, so it can stay kept', () => {
    expect(tokenize('je CTO.')).toEqual(['je', ' ', 'CTO', '.']);
  });

  it('treats an em dash as a token of its own', () => {
    expect(tokenize('CORE — jádro')).toEqual(['CORE', ' ', '—', ' ', 'jádro']);
  });
});

describe('bigrams', () => {
  it('ignores whitespace tokens', () => {
    expect(bigrams(tokenize('a b c'))).toEqual(['a\u0000b', 'b\u0000c']);
  });

  it('has none for a single word', () => {
    expect(bigrams(tokenize('slovo'))).toEqual([]);
  });
});

describe('diceCoefficient', () => {
  it('is 1 for identical text', () => {
    const tokens = tokenize('Nad jádrem CORE staví firma vlastní moduly.');
    expect(diceCoefficient(tokens, tokens)).toBe(1);
  });

  it('is 0 for text with nothing in common', () => {
    expect(diceCoefficient(tokenize('a b c d'), tokenize('e f g h'))).toBe(0);
  });

  it('lands exactly on the default threshold for a short sentence with a long replacement', () => {
    // Five words with one of them replaced by three gives 3 shared bigrams out of 5 + 7,
    // which is 0.5 to the digit. The match survives only because the threshold is
    // inclusive - a stricter one would report this ordinary correction as "paragraph
    // removed, paragraph added" and lose the link from the comment to the sentence.
    // This is the case the near-threshold counter in the build report exists to surface.
    const before = tokenize('Vlastníkem produktové roadmapy je CTO.');
    const after = tokenize('Vlastníkem produktové roadmapy je vedoucí oblasti Technology.');
    expect(diceCoefficient(before, after)).toBe(0.5);
  });

  it('stays clearly above the threshold when a longer sentence is edited', () => {
    const before = tokenize(
      'Vlastníkem produktové roadmapy pro celé portfolio modulů je podle dokumentu CTO.',
    );
    const after = tokenize(
      'Vlastníkem produktové roadmapy pro celé portfolio modulů je podle dokumentu vedoucí oblasti Technology.',
    );
    expect(diceCoefficient(before, after)).toBeGreaterThan(0.5);
  });

  it('falls below the default threshold when a paragraph is rewritten', () => {
    const before = tokenize('Portfolio je uzavřené, nové moduly vznikají jen na zakázku.');
    const after = tokenize('Dodavatelská závislost je doložena napříč všemi oblastmi firmy.');
    expect(diceCoefficient(before, after)).toBeLessThan(0.5);
  });

  it('compares single words when neither side has a bigram', () => {
    expect(diceCoefficient(tokenize('CTO'), tokenize('CTO'))).toBe(1);
    expect(diceCoefficient(tokenize('CTO'), tokenize('CFO'))).toBe(0);
  });
});

describe('diffTokens', () => {
  it('reports no change for identical text', () => {
    const tokens = tokenize('Beze změny.');
    expect(diffTokens(tokens, tokens).every((op) => op.kind === 'equal')).toBe(true);
  });

  it('never splits a word, unlike a character diff', () => {
    const ops = diffTokens(tokenize('vedoucí'), tokenize('vedoucího'));
    for (const op of ops) {
      for (const token of op.tokens) {
        expect(['vedoucí', 'vedoucího']).toContain(token);
      }
    }
  });

  it('puts the deletion before the insertion of a replacement', () => {
    const ops = diffTokens(
      tokenize('Vlastníkem roadmapy je CTO.'),
      tokenize('Vlastníkem roadmapy je vedoucí oblasti Technology.'),
    );
    const kinds = ops.map((op) => op.kind);
    const deleteAt = kinds.indexOf('delete');
    const insertAt = kinds.indexOf('insert');
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(deleteAt);
  });

  it('leaves the full stop outside the replacement', () => {
    const ops = diffTokens(
      tokenize('Vlastníkem roadmapy je CTO.'),
      tokenize('Vlastníkem roadmapy je vedoucí oblasti Technology.'),
    );
    const last = ops[ops.length - 1];
    expect(last?.kind).toBe('equal');
    expect(last?.tokens).toEqual(['.']);
  });

  it('reconstructs the new text from equal and inserted tokens', () => {
    const before = tokenize('Analýza popisuje stav přípravy.');
    const after = tokenize('Analýza stručně popisuje stav přípravy centra.');
    const ops = diffTokens(before, after);
    const rebuilt = ops
      .filter((op) => op.kind !== 'delete')
      .flatMap((op) => op.tokens)
      .join('');
    expect(rebuilt).toBe('Analýza stručně popisuje stav přípravy centra.');
  });

  it('reconstructs the old text from equal and deleted tokens', () => {
    const before = tokenize('Analýza popisuje stav přípravy.');
    const after = tokenize('Analýza stručně popisuje stav přípravy centra.');
    const ops = diffTokens(before, after);
    const rebuilt = ops
      .filter((op) => op.kind !== 'insert')
      .flatMap((op) => op.tokens)
      .join('');
    expect(rebuilt).toBe('Analýza popisuje stav přípravy.');
  });

  it('handles an empty side', () => {
    expect(diffTokens([], tokenize('nový text'))).toEqual([
      { kind: 'insert', tokens: ['nový', ' ', 'text'] },
    ]);
    expect(diffTokens(tokenize('starý text'), [])).toEqual([
      { kind: 'delete', tokens: ['starý', ' ', 'text'] },
    ]);
    expect(diffTokens([], [])).toEqual([]);
  });
});
