/**
 * Tokenization for the attribution builder.
 *
 * The unit of attribution is a **word**, not a character. A character diff shreds Czech
 * words into unreadable fragments - `vedoucí` against `vedoucího` becomes a
 * two-character insertion in the middle of a word, which no reader can use.
 *
 * Punctuation is its own token so that it can stay `kept` when the words around it
 * change: replacing `CTO` with `vedoucí oblasti Technology` must leave the full stop
 * where it was, not swallow it into the replacement.
 *
 * The one hard rule: `tokenize(text).join('') === text`. The final document is rendered
 * by concatenating runs, so a tokenizer that loses a space loses it from the document.
 */

const TOKEN_PATTERN = /\p{L}[\p{L}\p{N}_-]*|\p{N}+|\s+|[^\s]/gu;

export function tokenize(text: string): string[] {
  if (text.length === 0) return [];
  return text.match(TOKEN_PATTERN) ?? [];
}

export function detokenize(tokens: readonly string[]): string {
  return tokens.join('');
}

/** Token bigrams, used for block similarity. A single-token text has none. */
export function bigrams(tokens: readonly string[]): string[] {
  const meaningful = tokens.filter((token) => token.trim().length > 0);
  if (meaningful.length < 2) return [];
  const result: string[] = [];
  for (let i = 1; i < meaningful.length; i += 1) {
    result.push(`${meaningful[i - 1]}\u0000${meaningful[i]}`);
  }
  return result;
}
