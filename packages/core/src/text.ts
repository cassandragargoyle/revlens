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
  switch (mode) {
    case 'clean':
      return finalRuns(block);
    case 'baseline':
      return baselineRuns(block);
    case 'review':
      return block.runs;
  }
}

export function finalText(block: Block): string {
  return finalRuns(block)
    .map((run) => run.text)
    .join('');
}

export function baselineText(block: Block): string {
  return baselineRuns(block)
    .map((run) => run.text)
    .join('');
}

export function textForMode(block: Block, mode: ViewMode): string {
  return runsForMode(block, mode)
    .map((run) => run.text)
    .join('');
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
