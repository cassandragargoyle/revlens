import { createHash } from 'node:crypto';
import type { EditKind } from '@revlens/core';
import type { RevisionSeed } from '../sources/types.js';

/**
 * Identifiers that survive a rebuild.
 *
 * The first implementation numbered edits `E-001`, `E-002`, … in document order. That
 * reads well and is useless as an address: change the baseline and `E-050` is a different
 * change, insert a paragraph and everything after it shifts. A link pasted into an e-mail
 * would rot the next time anyone rebuilt the bundle - and INT-002 asks for exactly such a
 * link.
 *
 * So an id is derived from **what the change is**, not from where it happens to sit:
 *
 * - a **revision** is identified by the record behind it - the change-log entry, else the
 *   commit. Both are stable facts about the engagement, not about this build.
 * - an **edit** is identified by its revision, its kind, and the text it inserted and
 *   removed. That is what a reader recognises it by.
 *
 * Document position moves into `order`, which is where a position belongs.
 *
 * The one positional element left is the tie-break between two edits that are identical
 * in every respect - the same revision inserting the same words in two places. They are
 * distinguished by their rank among themselves.
 *
 * ## The known limit
 *
 * That tie-break is the one thing that can move. If two byte-identical changes of one
 * revision exist in one build and only one of them exists in another - because the other
 * fell inside the baseline, or was later withdrawn - nothing can say which of the two the
 * survivor is. Location could, and location is exactly what an id must not depend on.
 *
 * Measured against the engagement, comparing a build from the 1.5 baseline with a build
 * from the first chapter commit: **100 of the 102 changes present in both keep the same
 * id**. The two that do not are one-character insertions of `6` and `4` made by the same
 * revision in two places - the degenerate case above.
 *
 * Including the block in the id would fix those two and break far more: a block's text
 * changes whenever anyone edits that paragraph again, which happens on an active document
 * far more often than a baseline moves. The frequent case is worth more than the rare one.
 */

/** Length of the hash in the id. Eight hex characters over a few thousand edits. */
const DIGEST_LENGTH = 8;

const SEPARATOR = '';

function digest(...parts: (string | undefined)[]): string {
  const hash = createHash('sha256');
  hash.update(parts.map((part) => part ?? '').join(SEPARATOR));
  return hash.digest('hex').slice(0, DIGEST_LENGTH);
}

/**
 * Mints stable ids and guarantees they are unique inside one bundle.
 *
 * A collision is not expected - it would need two genuinely different things to hash the
 * same - but an id that silently pointed at two changes would be worse than an ugly one,
 * so a suffix is appended rather than trusted away.
 */
export class StableIdFactory {
  private readonly revisions = new Map<string, string>();
  private readonly used = new Set<string>();

  /**
   * The identity of a revision: **the record it came from and the commit it was made in**,
   * together.
   *
   * Neither alone is enough. One change-log entry can account for several commits when
   * the join falls back to matching by target and date, and one comment can be answered
   * more than once - so the record alone would merge two separate acts into one id. The
   * commit alone would split one act that the log records twice.
   *
   * `commitHash` is the **full** hash, never the abbreviated one: git lengthens the
   * abbreviation as a repository grows, and an id that changed because the repository got
   * bigger would defeat the whole point.
   */
  revisionId(seed: RevisionSeed, commitHash?: string): string {
    const parts = [seed.origin, commitHash ?? seed.commit].filter(
      (part): part is string => part !== undefined && part.length > 0,
    );
    const identity =
      parts.length > 0 ? parts.join('@') : digest(seed.at, seed.title, seed.author.name);

    const existing = this.revisions.get(identity);
    if (existing !== undefined) return existing;

    const id = this.unique(`R-${digest('revision', identity)}`);
    this.revisions.set(identity, id);
    return id;
  }

  /**
   * The identity of an edit: its revision, its kind, and the text it changed. `occurrence`
   * separates two edits that are otherwise identical.
   */
  editId(
    revisionId: string,
    kind: EditKind,
    insertedText: string,
    removedText: string,
    occurrence: number,
  ): string {
    return this.unique(
      `E-${digest('edit', revisionId, kind, insertedText, removedText, String(occurrence))}`,
    );
  }

  private unique(candidate: string): string {
    if (!this.used.has(candidate)) {
      this.used.add(candidate);
      return candidate;
    }
    for (let suffix = 2; ; suffix += 1) {
      const next = `${candidate}-${suffix}`;
      if (this.used.has(next)) continue;
      this.used.add(next);
      return next;
    }
  }
}

/** What an edit changed, read from the attribution rather than from the emitted runs. */
export interface EditContent {
  readonly inserted: string;
  readonly removed: string;
}
