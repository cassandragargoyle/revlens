import type { Block, BlockKind, EditKind, Run } from '@revlens/core';
import type { ParsedTable } from '../markdown/parse-blocks.js';
import { tableText } from '../markdown/parse-blocks.js';
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
  /** The tokens of every block but a table; a table keeps its tokens in its cells */
  tokens: AttributedToken[];
  table?: TableState;
  /** Revision that added the whole block. */
  introducedBy?: string;
  introducedEdit?: string;
  /** Revision that removed the whole block. */
  removedBy?: string;
  removedEdit?: string;
}

/**
 * A table carries attribution per cell, so an edit in one cell is not attributed to the
 * whole table. Rows are kept apart from cells because a row is what gets added or removed
 */
export interface TableState {
  readonly columns: number;
  rows: RowState[];
}

export interface RowState {
  /** Exactly `columns` cells, each with its own tokens and its own tombstones */
  cells: AttributedToken[][];
  /** Revision that removed the whole row; its cells then hold only tombstones */
  removedBy?: string;
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
  table?: ParsedTable,
): BlockState {
  const attribute = (source: string): AttributedToken[] =>
    tokenize(source).map(
      (token): AttributedToken =>
        revision === undefined
          ? { text: token }
          : { text: token, insertedBy: revision, insertedEdit: editKey },
    );
  const state: BlockState = { id, kind, tokens: table === undefined ? attribute(text) : [] };
  if (table !== undefined) {
    state.table = {
      columns: table.columns,
      rows: chunk(table.cells, table.columns).map((cells) => ({ cells: cells.map(attribute) })),
    };
  }
  if (level !== undefined) state.level = level;
  if (revision !== undefined) {
    state.introducedBy = revision;
    state.introducedEdit = editKey;
  }
  return state;
}

/** The text of the block as it stands now - the tombstones are not part of it. */
export function liveText(block: BlockState): string {
  if (block.table !== undefined) {
    const cells = block.table.rows
      .filter((row) => row.removedBy === undefined)
      .flatMap((row) => row.cells.map(cellText));
    return tableText(block.table.columns, cells);
  }
  return cellText(block.tokens);
}

export function liveTokens(block: BlockState): string[] {
  if (block.table !== undefined) return tokenize(liveText(block));
  return liveOf(block.tokens);
}

/** Every token of the block in reading order, a table's cell by cell */
export function allTokens(block: BlockState): AttributedToken[] {
  if (block.table === undefined) return block.tokens;
  return block.table.rows.flatMap((row) => row.cells.flat());
}

function liveOf(tokens: readonly AttributedToken[]): string[] {
  return tokens.filter((token) => token.removedBy === undefined).map((token) => token.text);
}

function cellText(tokens: readonly AttributedToken[]): string {
  return liveOf(tokens).join('');
}

/**
 * Diff the block against its new text and fold the result into the attribution state.
 *
 * Inserted tokens take the current revision, deleted tokens become tombstones, and every
 * token that survives keeps whatever attribution it already had. That last clause is the
 * whole point: it is what keeps a change from three revisions back highlightable at the
 * position it occupies today.
 *
 * A table is revised by its cells, so `table` has to be given for a table block, with
 * the same columns the block has.
 */
export function applyBlockRevision(
  block: BlockState,
  chapterId: string,
  newText: string,
  revision: string,
  keys: EditKeyFactory,
  table?: ParsedTable,
): ApplyResult {
  const newEdit = (): PendingEdit => ({
    key: keys.next(revision),
    revision,
    chapter: chapterId,
    block: block.id,
    kind: 'replace',
  });

  if (block.table !== undefined || table !== undefined) {
    if (block.table === undefined || table === undefined || block.table.columns !== table.columns) {
      // The chapter walk never pairs two tables of different shape - see findMatch
      throw new Error(
        `block ${block.id}: a table can only be revised by a table with the same columns`,
      );
    }
    return applyTableRevision(block.table, table, revision, newEdit);
  }

  const result = reviseTokens(block.tokens, tokenize(newText), revision, newEdit);
  block.tokens = result.tokens;
  return { edits: result.edits, churnTokens: result.churnTokens };
}

/**
 * The word diff of one token sequence - a block, or one cell of a table - folded into its
 * attribution. Every cluster of changes becomes one edit minted by `newEdit`
 */
function reviseTokens(
  tokens: readonly AttributedToken[],
  after: readonly string[],
  revision: string,
  newEdit: () => PendingEdit,
): { tokens: AttributedToken[]; edits: PendingEdit[]; churnTokens: number } {
  const ops = diffTokens(liveOf(tokens), after);

  if (ops.every((op) => op.kind === 'equal')) {
    return { tokens: [...tokens], edits: [], churnTokens: 0 };
  }

  const editOfOp = new Array<PendingEdit | undefined>(ops.length);
  const edits: PendingEdit[] = [];

  for (const cluster of clusterOps(ops)) {
    const kinds = new Set(cluster.map((i) => ops[i]?.kind));
    const edit = newEdit();
    edit.kind =
      kinds.has('insert') && kinds.has('delete') ? 'replace' : kinds.has('insert') ? 'insert' : 'delete';
    edits.push(edit);
    for (const i of cluster) editOfOp[i] = edit;
  }

  const next: AttributedToken[] = [];
  let cursor = 0;
  let churn = 0;

  const carryTombstones = (): void => {
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token === undefined || token.removedBy === undefined) break;
      next.push(token);
      cursor += 1;
    }
  };

  const takeLive = (): AttributedToken | undefined => {
    carryTombstones();
    const token = tokens[cursor];
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
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token !== undefined) next.push(token);
    cursor += 1;
  }

  // The kind is settled from the runs that survived, not from the diff that produced
  // them. A replacement whose deleted half turned out to be churn - text written after
  // the baseline and withdrawn again - reaches the reader as an insertion, and calling it
  // a replacement would promise a removed passage the bundle does not contain.
  const surviving: PendingEdit[] = [];
  for (const edit of edits) {
    const inserted = next.some((token) => token.insertedEdit === edit.key);
    const deleted = next.some((token) => token.removedEdit === edit.key);
    if (!inserted && !deleted) continue;
    edit.kind = inserted && deleted ? 'replace' : inserted ? 'insert' : 'delete';
    surviving.push(edit);
  }

  return { tokens: next, edits: surviving, churnTokens: churn };
}

/**
 * A table revised against a table with the same columns.
 *
 * Rows are aligned first, by the same word diff one level up - a row is one symbol - so a
 * row added in the middle does not shift every row below it onto its neighbour. A row
 * that went and a row that came in its place are one row edited, and are diffed cell by
 * cell; that is what makes the highlight land on the cell that changed. A row added or
 * removed as a whole is one edit
 */
function applyTableRevision(
  state: TableState,
  table: ParsedTable,
  revision: string,
  newEdit: () => PendingEdit,
): ApplyResult {
  const incoming = chunk(table.cells, state.columns);
  const rowKey = (cells: readonly string[]): string => cells.join('\u0000');
  const ops = diffTokens(
    state.rows
      .filter((row) => row.removedBy === undefined)
      .map((row) => rowKey(row.cells.map(cellText))),
    incoming.map(rowKey),
  );

  const edits: PendingEdit[] = [];
  const next: RowState[] = [];
  let churn = 0;
  let cursor = 0;
  let position = 0;

  const takeLive = (): RowState | undefined => {
    while (cursor < state.rows.length) {
      const row = state.rows[cursor];
      cursor += 1;
      if (row === undefined) continue;
      if (row.removedBy === undefined) return row;
      next.push(row);
    }
    return undefined;
  };

  const insertRow = (cells: readonly string[]): void => {
    const edit = newEdit();
    edit.kind = 'insert';
    const row: RowState = {
      cells: cells.map((cell) =>
        tokenize(cell).map((text) => ({ text, insertedBy: revision, insertedEdit: edit.key })),
      ),
    };
    if (row.cells.some((cell) => cell.length > 0)) edits.push(edit);
    next.push(row);
  };

  const removeRow = (row: RowState): void => {
    const edit = newEdit();
    edit.kind = 'delete';
    const hadTokens = row.cells.some((cell) => cell.length > 0);
    row.cells = row.cells.map((cell) => {
      const result = tombstoneAll(cell, revision, edit.key);
      churn += result.churnTokens;
      return result.tokens;
    });
    row.removedBy = revision;
    if (row.cells.some((cell) => cell.some((token) => token.removedEdit === edit.key))) {
      edits.push(edit);
    }
    // A row written after the baseline and removed again never reached the reader
    if (!hadTokens || row.cells.some((cell) => cell.length > 0)) next.push(row);
  };

  const reviseRow = (row: RowState, cells: readonly string[]): void => {
    row.cells = row.cells.map((cell, column) => {
      const result = reviseTokens(cell, tokenize(cells[column] ?? ''), revision, newEdit);
      edits.push(...result.edits);
      churn += result.churnTokens;
      return result.tokens;
    });
    next.push(row);
  };

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (op === undefined) continue;

    if (op.kind === 'equal') {
      for (let k = 0; k < op.tokens.length; k += 1) {
        const row = takeLive();
        if (row !== undefined) next.push(row);
        position += 1;
      }
      continue;
    }

    if (op.kind === 'insert') {
      for (let k = 0; k < op.tokens.length; k += 1) {
        insertRow(incoming[position] ?? []);
        position += 1;
      }
      continue;
    }

    // Rows removed and rows added in their place are rows edited, as many as pair up
    const following = ops[i + 1];
    const added = following?.kind === 'insert' ? following.tokens.length : 0;
    const paired = Math.min(op.tokens.length, added);
    for (let k = 0; k < op.tokens.length; k += 1) {
      const row = takeLive();
      if (row === undefined) continue;
      if (k < paired) {
        reviseRow(row, incoming[position] ?? []);
        position += 1;
      } else {
        removeRow(row);
      }
    }
    for (let k = paired; k < added; k += 1) {
      insertRow(incoming[position] ?? []);
      position += 1;
    }
    if (added > 0) i += 1;
  }

  // Rows removed earlier and sitting at the end of the table stay where they were
  while (cursor < state.rows.length) {
    const row = state.rows[cursor];
    if (row !== undefined) next.push(row);
    cursor += 1;
  }

  state.rows = next;
  return { edits, churnTokens: churn };
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
  const tombstone = (tokens: readonly AttributedToken[]): AttributedToken[] => {
    const result = tombstoneAll(tokens, revision, edit.key);
    churn += result.churnTokens;
    return result.tokens;
  };

  if (block.table === undefined) {
    block.tokens = tombstone(block.tokens);
  } else {
    block.table.rows = block.table.rows.filter((row) => {
      const hadTokens = row.cells.some((cell) => cell.length > 0);
      row.cells = row.cells.map(tombstone);
      // A row that was all churn leaves nothing to show, not an empty row
      return !hadTokens || row.cells.some((cell) => cell.length > 0);
    });
  }

  return { edit, churnTokens: churn };
}

/**
 * Every live token becomes a tombstone of this revision, except the ones inserted after
 * the baseline: removing those is churn, and they are dropped
 */
function tombstoneAll(
  tokens: readonly AttributedToken[],
  revision: string,
  editKey: string,
): { tokens: AttributedToken[]; churnTokens: number } {
  let churn = 0;
  const next: AttributedToken[] = [];
  for (const token of tokens) {
    if (token.removedBy !== undefined) next.push(token);
    else if (token.insertedBy !== undefined) churn += 1;
    else next.push({ ...token, removedBy: revision, removedEdit: editKey });
  }
  return { tokens: next, churnTokens: churn };
}

/**
 * Collapse the attributed tokens into runs: consecutive tokens with the same attribution
 * become one run. A sentence inserted by one revision is one run, not forty, which is
 * what keeps the bundle small and the highlighting readable.
 */
export function emitRuns(block: BlockState, editIds: ReadonlyMap<string, string>): Run[] {
  return emitCells(block, editIds).flat();
}

/** The runs of every cell of a table, row by row; any other block is a single cell */
function emitCells(block: BlockState, editIds: ReadonlyMap<string, string>): Run[][] {
  if (block.table === undefined) return [runsOf(block.tokens, editIds)];
  // Runs never merge across a cell boundary, or the cell could not be cut back out
  return block.table.rows.flatMap((row) => row.cells.map((cell) => runsOf(cell, editIds)));
}

function runsOf(tokens: readonly AttributedToken[], editIds: ReadonlyMap<string, string>): Run[] {
  const runs: Run[] = [];

  for (const token of tokens) {
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
  const cells = emitCells(block, editIds);
  const result: Block = {
    id: block.id,
    kind: block.kind,
    runs: cells.flat(),
  };
  if (block.level !== undefined) result.level = block.level;
  if (block.introducedBy !== undefined) result.introducedBy = block.introducedBy;
  if (block.removedBy !== undefined) result.removedBy = block.removedBy;
  if (block.table !== undefined) {
    result.table = {
      columns: block.table.columns,
      cellRunCounts: cells.map((cell) => cell.length),
    };
  }
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

/** Cut a row-major list into rows of `columns` */
function chunk<T>(items: readonly T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return rows;
}
