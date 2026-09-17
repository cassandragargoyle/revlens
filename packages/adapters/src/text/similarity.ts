import { bigrams } from './tokens.js';

/**
 * Block similarity, used to decide whether a changed block is the same block edited or a
 * different block that replaced it.
 *
 * The threshold this feeds is the tuning parameter of the whole builder, and it has a
 * failure mode in each direction - see ADR-004. Too low and a rewritten paragraph is
 * shown as a shredded mixture of old and new; too high and an ordinary edit becomes
 * "block removed, block added" and the link from the comment to the sentence is lost.
 */

/** Dice coefficient over token bigrams, in [0, 1]. */
export function diceCoefficient(left: readonly string[], right: readonly string[]): number {
  const a = bigrams(left);
  const b = bigrams(right);

  // A one-word block has no bigrams; fall back to the words themselves so that a short
  // heading is still comparable to its predecessor.
  if (a.length === 0 || b.length === 0) {
    return unigramDice(left, right);
  }

  return multisetDice(a, b);
}

function unigramDice(left: readonly string[], right: readonly string[]): number {
  const a = left.filter((token) => token.trim().length > 0);
  const b = right.filter((token) => token.trim().length > 0);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  return multisetDice(a, b);
}

function multisetDice(a: readonly string[], b: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const item of a) counts.set(item, (counts.get(item) ?? 0) + 1);

  let shared = 0;
  for (const item of b) {
    const remaining = counts.get(item);
    if (remaining !== undefined && remaining > 0) {
      counts.set(item, remaining - 1);
      shared += 1;
    }
  }

  return (2 * shared) / (a.length + b.length);
}
