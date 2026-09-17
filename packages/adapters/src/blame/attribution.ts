import type { Block, BlockKind, EditKind, Run } from '@revlens/core';
import { tokenize } from '../text/tokens.js';
import { diffTokens } from '../text/word-diff.js';

/**
 * Token blame with tombstones - the core of the builder, and the reason the tool can
 * answer "where did my comment land" three revisions later.
 *
 * Each token of a block carries who inserted it and, if it is gone, who removed it. A
 * removed token is not thrown away: it stays at the position it was removed from, as a
 * tombstone, because "what did my comment actually remove" is one of the three questions
 * the tool exists to answer.
 *
 * See ADR-004 for why a pairwise diff cannot do this.
 */

export interface AttributedToken {
  readonly text: string;
  /** Revision that inserted it; absent means it was there in the baseline. */
  readonly insertedBy?: string;
  readonly insertedEdit?: string;
  /** Revision that removed it; present means this token is a tombstone. */
  readonly removedBy?: string;
  readonly removedEdit?: string;
}

export interface BlockState {
  id: string;
  kind: BlockKind;
  level?: number;
  tokens: AttributedToken[];
  /** Revision that added the whole block. */
  introducedBy?: string;
  introducedEdit?: string;
  /** Revision that removed the whole block. */
  removedBy?: string;
  removedEdit?: string;
}

/** An edit as the builder knows it, before ids are assigned in document order. */
export interface PendingEdit {
  readonly key: string;
  readonly revision: string;
  readonly chapter: string;
  readonly block: string;
  kind: EditKind;
  summary?: string;
}

export interface ApplyResult {
  readonly edits: readonly PendingEdit[];
  /** Tokens written and withdrawn again before the reader ever saw them. */
  readonly churnTokens: number;
}

/**
 * How many untouched words may sit between two changed passages before they count as two
 * separate changes.
 *
 * A word diff of `TINA a PARO` against `TINA, PARO a PLAN` comes back as three fragments
 * with one surviving word between them - but a reader sees one correction of one heading,
 * and stepping through it three times is noise. Anything further apart than this stays
 * two changes, because a reader scrolling between them sees two.
 */
const MAX_GAP_TOKENS = 3;

/** Mints edit keys that are unique across the whole build. */
export class EditKeyFactory {
  private counter = 0;

  next(revision: string): string {
    this.counter += 1;
    return `${revision}#${this.counter}`;
  }
}

export function createBlockState(
  id: string,
  kind: BlockKind,
  level: number | undefined,
  text: string,
  revision?: string,
  editKey?: string,
): BlockState {
  const tokens = tokenize(text).map(
    (token): AttributedToken =>
      revision === undefined
        ? { text: token }
        : { text: token, insertedBy: revision, insertedEdit: editKey },
  );
  const state: BlockState = { id, kind, tokens };
  if (level !== undefined) state.level = level;
  if (revision !== undefined) {
    state.introducedBy = revision;
    state.introducedEdit = editKey;
  }
  return state;
}

/** The text of the block as it stands now - the tombstones are not part of it. */
export function liveText(block: BlockState): string {
  return block.tokens
    .filter((token) => token.removedBy === undefined)
    .map((token) => token.text)
    .join('');
}

export function liveTokens(block: BlockState): string[] {
  return block.tokens
    .filter((token) => token.removedBy === undefined)
    .map((token) => token.text);
}

/**
 * Diff the block against its new text and fold the result into the attribution state.
 *
 * Inserted tokens take the current revision, deleted tokens become tombstones, and every
 * token that survives keeps whatever attribution it already had. That last clause is the
 * whole point: it is what keeps a change from three revisions back highlightable at the
 * position it occupies today.
 */
export function applyBlockRevision(
  block: BlockState,
  chapterId: string,
  newText: string,
  revision: string,
  keys: EditKeyFactory,
): ApplyResult {
  const before = liveTokens(block);
  const after = tokenize(newText);
  const ops = diffTokens(before, after);

  if (ops.every((op) => op.kind === 'equal')) {
    return { edits: [], churnTokens: 0 };
  }

  const editOfOp = new Array<PendingEdit | undefined>(ops.length);
  const edits: PendingEdit[] = [];

  for (const cluster of clusterOps(ops)) {
    const kinds = new Set(cluster.map((i) => ops[i]?.kind));
    const edit: PendingEdit = {
      key: keys.next(revision),
      revision,
      chapter: chapterId,
      block: block.id,
      kind: kinds.has('insert') && kinds.has('delete') ? 'replace' : kinds.has('insert') ? 'insert' : 'delete',
    };
    edits.push(edit);
    for (const i of cluster) editOfOp[i] = edit;
  }

  const next: AttributedToken[] = [];
  let cursor = 0;
  let churn = 0;

  const carryTombstones = (): void => {
    while (cursor < block.tokens.length) {
      const token = block.tokens[cursor];
      if (token === undefined || token.removedBy === undefined) break;
      next.push(token);
      cursor += 1;
    }
  };

  const takeLive = (): AttributedToken | undefined => {
    carryTombstones();
    const token = block.tokens[cursor];
    if (token === undefined) return undefined;
    cursor += 1;
    return token;
  };

  ops.forEach((op, i) => {
    const edit = editOfOp[i];
    switch (op.kind) {
      case 'equal':
        for (let k = 0; k < op.tokens.length; k += 1) {
          const token = takeLive();
          if (token !== undefined) next.push(token);
        }
        break;

      case 'delete':
        for (let k = 0; k < op.tokens.length; k += 1) {
          const token = takeLive();
          if (token === undefined) continue;
          if (token.insertedBy !== undefined) {
            // Written after the baseline and withdrawn before the head: this text never
            // reached the reader, so it is counted as churn rather than shown.
            churn += 1;
            continue;
          }
          next.push({ ...token, removedBy: revision, removedEdit: edit?.key });
        }
        break;

      case 'insert':
        carryTombstones();
        for (const text of op.tokens) {
          next.push({ text, insertedBy: revision, insertedEdit: edit?.key });
        }
        break;
    }
  });

  // Whatever the diff did not reach - trailing tombstones, and live tokens the diff left
  // untouched because the op lengths did not line up - stays where it was.
  while (cursor < block.tokens.length) {
    const token = block.tokens[cursor];
    if (token !== undefined) next.push(token);
    cursor += 1;
  }

  block.tokens = next;

  // The kind is settled from the runs that survived, not from the diff that produced
  // them. A replacement whose deleted half turned out to be churn - text written after
  // the baseline and withdrawn again - reaches the reader as an insertion, and calling it
  // a replacement would promise a removed passage the bundle does not contain.
  const surviving: PendingEdit[] = [];
  for (const edit of edits) {
    const inserted = block.tokens.some((token) => token.insertedEdit === edit.key);
    const deleted = block.tokens.some((token) => token.removedEdit === edit.key);
    if (!inserted && !deleted) continue;
    edit.kind = inserted && deleted ? 'replace' : inserted ? 'insert' : 'delete';
    surviving.push(edit);
  }

  return { edits: surviving, churnTokens: churn };
}

/**
 * Group the diff into changes as a reader would count them: fragments separated by at
 * most `MAX_GAP_TOKENS` surviving words are one change, further apart they are two.
 * Returns the indices of the non-equal ops, clustered.
 */
function clusterOps(ops: readonly { kind: string; tokens: readonly string[] }[]): number[][] {
  const clusters: number[][] = [];
  let current: number[] = [];
  let gap = 0;

  ops.forEach((op, i) => {
    if (op.kind === 'equal') {
      if (current.length > 0) gap += op.tokens.filter((token) => token.trim().length > 0).length;
      return;
    }
    if (current.length > 0 && gap > MAX_GAP_TOKENS) {
      clusters.push(current);
      current = [];
    }
    gap = 0;
    current.push(i);
  });

  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Mark a whole block as removed: every live token that was in the baseline becomes a
 * tombstone of this revision.
 *
 * The churn rule applies here exactly as it does inside a block. Text that was inserted
 * after the baseline and is now being removed never reached the reader of either version,
 * so it is dropped rather than shown struck through under the removing revision - which
 * would otherwise attribute one revision's words to another, and leave the edit that
 * inserted them with nothing left to point at.
 */
export function removeBlock(
  block: BlockState,
  chapterId: string,
  revision: string,
  keys: EditKeyFactory,
): { edit: PendingEdit; churnTokens: number } {
  const edit: PendingEdit = {
    key: keys.next(revision),
    revision,
    chapter: chapterId,
    block: block.id,
    kind: 'delete-block',
  };

  let churn = 0;
  block.removedBy = revision;
  block.removedEdit = edit.key;
  block.tokens = block.tokens.filter((token) => {
    if (token.removedBy !== undefined) return true;
    if (token.insertedBy !== undefined) {
      churn += 1;
      return false;
    }
    return true;
  });
  block.tokens = block.tokens.map((token) =>
    token.removedBy === undefined
      ? { ...token, removedBy: revision, removedEdit: edit.key }
      : token,
  );

  return { edit, churnTokens: churn };
}

/**
 * Collapse the attributed tokens into runs: consecutive tokens with the same attribution
 * become one run. A sentence inserted by one revision is one run, not forty, which is
 * what keeps the bundle small and the highlighting readable.
 */
export function emitRuns(block: BlockState, editIds: ReadonlyMap<string, string>): Run[] {
  const runs: Run[] = [];

  for (const token of block.tokens) {
    const run = toRun(token, editIds);
    const previous = runs[runs.length - 1];
    if (previous !== undefined && sameAttribution(previous, run)) {
      runs[runs.length - 1] = { ...previous, text: previous.text + run.text } as Run;
      continue;
    }
    runs.push(run);
  }

  return runs;
}

export function emitBlock(block: BlockState, editIds: ReadonlyMap<string, string>): Block {
  const result: Block = {
    id: block.id,
    kind: block.kind,
    runs: emitRuns(block, editIds),
  };
  if (block.level !== undefined) result.level = block.level;
  if (block.introducedBy !== undefined) result.introducedBy = block.introducedBy;
  if (block.removedBy !== undefined) result.removedBy = block.removedBy;
  return result;
}

function toRun(token: AttributedToken, editIds: ReadonlyMap<string, string>): Run {
  if (token.removedBy !== undefined) {
    const edit = token.removedEdit === undefined ? undefined : editIds.get(token.removedEdit);
    return { kind: 'deleted', text: token.text, revision: token.removedBy, ...(edit === undefined ? {} : { edit }) };
  }
  if (token.insertedBy !== undefined) {
    const edit = token.insertedEdit === undefined ? undefined : editIds.get(token.insertedEdit);
    return { kind: 'inserted', text: token.text, revision: token.insertedBy, ...(edit === undefined ? {} : { edit }) };
  }
  return { kind: 'kept', text: token.text };
}

function sameAttribution(a: Run, b: Run): boolean {
  if (a.kind !== b.kind) return false;
  if (a.edit !== b.edit) return false;
  const revisionA = a.kind === 'kept' ? undefined : a.revision;
  const revisionB = b.kind === 'kept' ? undefined : b.revision;
  return revisionA === revisionB;
}
