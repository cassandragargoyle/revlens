import { diff_match_patch } from 'diff-match-patch';

/**
 * Word-level diff.
 *
 * `diff-match-patch` diffs strings, so the tokens are first mapped onto single characters
 * - the same trick the library uses for its own line diff, one granularity down. The diff
 * then works on words and cannot produce a change that starts in the middle of one.
 */

export type WordDiffOp =
  | { readonly kind: 'equal'; readonly tokens: readonly string[] }
  | { readonly kind: 'insert'; readonly tokens: readonly string[] }
  | { readonly kind: 'delete'; readonly tokens: readonly string[] };

/** Highest code unit usable as a token stand-in; surrogates would break the mapping. */
const MAX_TOKEN_SYMBOLS = 0xd800;

export function diffTokens(
  before: readonly string[],
  after: readonly string[],
): WordDiffOp[] {
  if (before.length === 0 && after.length === 0) return [];
  if (before.length === 0) return [{ kind: 'insert', tokens: [...after] }];
  if (after.length === 0) return [{ kind: 'delete', tokens: [...before] }];

  const symbols = new Map<string, string>();
  const vocabulary: string[] = [];

  const encode = (tokens: readonly string[]): string => {
    let encoded = '';
    for (const token of tokens) {
      let symbol = symbols.get(token);
      if (symbol === undefined) {
        if (vocabulary.length >= MAX_TOKEN_SYMBOLS) {
          // A block with more than 55 000 distinct words is not a block; refusing is
          // better than silently diffing something else.
          throw new Error('word diff: too many distinct tokens in one block');
        }
        symbol = String.fromCharCode(vocabulary.length);
        symbols.set(token, symbol);
        vocabulary.push(token);
      }
      encoded += symbol;
    }
    return encoded;
  };

  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(encode(before), encode(after), false);
  dmp.diff_cleanupSemantic(diffs);

  const decoded = diffs.map((entry): WordDiffOp => {
    const [operation, encoded] = entry;
    const tokens = [...encoded].map((symbol) => {
      const token = vocabulary[symbol.charCodeAt(0)];
      if (token === undefined) throw new Error('word diff: token table is inconsistent');
      return token;
    });
    if (operation === 1) return { kind: 'insert', tokens };
    if (operation === -1) return { kind: 'delete', tokens };
    return { kind: 'equal', tokens };
  });

  return normalize(decoded);
}

/**
 * A replacement reaches the reader as "this went, that came" - the deletion first, the
 * insertion after it. The library emits the pair in either order depending on the input,
 * so the order is fixed here rather than left to chance: the bundle must not reshuffle
 * its runs between two builds of the same text.
 */
function normalize(ops: readonly WordDiffOp[]): WordDiffOp[] {
  const merged: WordDiffOp[] = [];
  for (const op of ops) {
    if (op.tokens.length === 0) continue;
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.kind === op.kind) {
      merged[merged.length - 1] = { kind: op.kind, tokens: [...previous.tokens, ...op.tokens] };
      continue;
    }
    if (previous !== undefined && previous.kind === 'insert' && op.kind === 'delete') {
      merged[merged.length - 1] = op;
      merged.push(previous);
      continue;
    }
    merged.push(op);
  }
  return merged;
}
