import type { Block, Run } from './schema.js';

/**
 * Rendering a view of a block is concatenating the runs that belong to it - there is no
 * offset arithmetic anywhere, which is why a highlight cannot drift out of alignment.
 */
export type ViewMode = 'clean' | 'review' | 'baseline';

/** Runs that make up the final text: everything except what was removed. */
export function finalRuns(block: Block): Run[] {
  return block.runs.filter((run) => run.kind !== 'deleted');
}

/** Runs that made up the text the reviewers received: what was kept, plus what was removed. */
export function baselineRuns(block: Block): Run[] {
  return block.runs.filter((run) => run.kind !== 'inserted');
}

/** Runs shown in a given mode. Review mode shows the whole block, deletions included. */
export function runsForMode(block: Block, mode: ViewMode): Run[] {
  return block.runs.filter(isShownIn(mode));
}

function isShownIn(mode: ViewMode): (run: Run) => boolean {
  switch (mode) {
    case 'clean':
      return (run) => run.kind !== 'deleted';
    case 'baseline':
      return (run) => run.kind !== 'inserted';
    case 'review':
      return () => true;
  }
}

/**
 * A table block cut into rows of cells, each cell the runs of it shown in the mode.
 *
 * The cut is `table.cellRunCounts`, so the runs stay the single source of truth. A row
 * that has text in review mode but none in this one - a row added after the baseline,
 * seen as the baseline, or a row removed, seen as the final text - is left out, not shown
 * empty. Undefined for a block that is not a table with cells, and for one whose counts
 * do not describe its runs, so a caller can fall back to drawing the runs as text.
 */
export function tableRows(block: Block, mode: ViewMode): Run[][][] | undefined {
  const table = block.table;
  if (table === undefined) return undefined;
  const total = table.cellRunCounts.reduce((sum, count) => sum + count, 0);
  if (total !== block.runs.length || table.cellRunCounts.length % table.columns !== 0) {
    return undefined;
  }

  const shown = isShownIn(mode);
  const rows: Run[][][] = [];
  let start = 0;
  let row: Run[][] = [];
  let hadText = false;
  for (const count of table.cellRunCounts) {
    const cell = block.runs.slice(start, start + count);
    start += count;
    if (cell.length > 0) hadText = true;
    row.push(cell.filter(shown));
    if (row.length === table.columns) {
      if (!hadText || row.some((cells) => cells.length > 0)) rows.push(row);
      row = [];
      hadText = false;
    }
  }
  return rows;
}

export function finalText(block: Block): string {
  return textForMode(block, 'clean');
}

export function baselineText(block: Block): string {
  return textForMode(block, 'baseline');
}

/** The text of a block in a mode; a table's cells are kept apart, a row on each line */
export function textForMode(block: Block, mode: ViewMode): string {
  const rows = tableRows(block, mode);
  if (rows !== undefined) {
    return rows.map((row) => row.map(joinRuns).join(' | ')).join('\n');
  }
  return joinRuns(runsForMode(block, mode));
}

function joinRuns(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('');
}

/**
 * Character count as a reader counts characters, not as UTF-16 counts them. Czech text
 * is in the BMP so the two agree today, but an emoji in a verbatim quote would not.
 */
export function charCount(text: string): number {
  return [...text].length;
}

/** True when the block was added or removed as a whole rather than edited run by run. */
export function isWholeBlockChange(block: Block): boolean {
  return block.introducedBy !== undefined || block.removedBy !== undefined;
}

/** Whether a block is visible at all in a given mode. */
export function isBlockVisible(block: Block, mode: ViewMode): boolean {
  if (block.removedBy !== undefined) {
    // A removed block is not part of the final text; the baseline still had it.
    return mode !== 'clean';
  }
  if (block.introducedBy !== undefined) {
    // A block that did not exist in the baseline cannot be shown as part of it.
    return mode !== 'baseline';
  }
  return true;
}
