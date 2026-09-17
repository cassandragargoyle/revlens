import type { Chapter } from '@revlens/core';
import type { ParsedBlock } from '../markdown/parse-blocks.js';
import { diceCoefficient } from '../text/similarity.js';
import { tokenize } from '../text/tokens.js';
import type { BlockState, EditKeyFactory, PendingEdit } from './attribution.js';
import {
  applyBlockRevision,
  createBlockState,
  emitBlock,
  liveText,
  liveTokens,
  removeBlock,
} from './attribution.js';

/**
 * Carrying block identity across commits.
 *
 * A block whose text changed has to be recognised as the same block, or attribution
 * restarts from scratch every time a paragraph is edited. Recognition is by similarity,
 * and the threshold is the tuning parameter of the builder - see ADR-004.
 */

/** Dice threshold above which a changed block is the same block, edited. */
export const DEFAULT_MATCH_THRESHOLD = 0.5;

/** How far ahead a match is looked for, so a long chapter does not cost O(n squared). */
const MATCH_WINDOW = 25;

/** A match this close to the threshold is reported, so a bad threshold is visible. */
const NEAR_THRESHOLD = 0.1;

export interface ChapterState {
  readonly id: string;
  title: string;
  number?: string;
  source: string;
  blocks: BlockState[];
  nextBlockNumber: number;
}

export interface ChapterRevisionResult {
  readonly edits: readonly PendingEdit[];
  readonly churnTokens: number;
  /** Blocks matched with a similarity close to the threshold, either way. */
  readonly nearThresholdMatches: number;
  /** Blocks dropped entirely because they were added and removed after the baseline. */
  readonly churnBlocks: number;
}

export function createChapterState(
  id: string,
  title: string,
  source: string,
  number: string | undefined,
  baseline: readonly ParsedBlock[],
): ChapterState {
  const state: ChapterState = {
    id,
    title,
    source,
    blocks: [],
    nextBlockNumber: 1,
  };
  if (number !== undefined) state.number = number;

  for (const parsed of baseline) {
    state.blocks.push(
      createBlockState(nextBlockId(state), parsed.kind, parsed.level, parsed.text),
    );
  }
  return state;
}

/**
 * Fold one commit's version of the chapter into the attribution state.
 *
 * The walk is monotonic: a new block is matched only against a live block at or after
 * the cursor. That prevents two blocks from trading identities when a paragraph moves,
 * at the cost of reporting a move as a removal plus an addition - which is honest, and
 * which the `move` edit kind is reserved for should it ever be worth detecting.
 */
export function applyChapterRevision(
  state: ChapterState,
  parsed: readonly ParsedBlock[],
  revision: string,
  keys: EditKeyFactory,
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): ChapterRevisionResult {
  const edits: PendingEdit[] = [];
  let churnTokens = 0;
  let nearThresholdMatches = 0;
  let churnBlocks = 0;

  const previous = state.blocks;
  const next: BlockState[] = [];
  let cursor = 0;

  const carryTombstones = (): void => {
    while (cursor < previous.length) {
      const block = previous[cursor];
      if (block === undefined || block.removedBy === undefined) break;
      next.push(block);
      cursor += 1;
    }
  };

  const retire = (block: BlockState): void => {
    if (block.removedBy !== undefined) {
      next.push(block);
      return;
    }
    if (block.introducedBy !== undefined) {
      // Added after the baseline and removed before the head: the reader never saw it.
      churnBlocks += 1;
      return;
    }
    const removal = removeBlock(block, state.id, revision, keys);
    edits.push(removal.edit);
    churnTokens += removal.churnTokens;
    next.push(block);
  };

  // Where each incoming text appears for the last time, so a block can be reserved for
  // an unchanged block further down instead of being consumed by the one before it.
  const lastPosition = new Map<string, number>();
  parsed.forEach((block, position) => lastPosition.set(block.text, position));

  for (let p = 0; p < parsed.length; p += 1) {
    const incoming = parsed[p];
    if (incoming === undefined) continue;
    carryTombstones();

    const match = findMatch(previous, cursor, incoming, threshold, lastPosition, p);

    if (match === undefined) {
      const key = keys.next(revision);
      const block = createBlockState(
        nextBlockId(state),
        incoming.kind,
        incoming.level,
        incoming.text,
        revision,
        key,
      );
      edits.push({
        key,
        revision,
        chapter: state.id,
        block: block.id,
        kind: 'insert-block',
      });
      next.push(block);
      continue;
    }

    if (match.score < threshold + NEAR_THRESHOLD && match.score < 1) {
      nearThresholdMatches += 1;
    }

    for (let i = cursor; i < match.index; i += 1) {
      const block = previous[i];
      if (block !== undefined) retire(block);
    }
    cursor = match.index + 1;

    const block = previous[match.index];
    if (block === undefined) continue;

    // The kind can change without the text changing - a paragraph promoted to a bullet.
    block.kind = incoming.kind;
    if (incoming.level !== undefined) block.level = incoming.level;
    else delete block.level;

    const result = applyBlockRevision(block, state.id, incoming.text, revision, keys);
    edits.push(...result.edits);
    churnTokens += result.churnTokens;
    next.push(block);
  }

  for (let i = cursor; i < previous.length; i += 1) {
    const block = previous[i];
    if (block !== undefined) retire(block);
  }

  state.blocks = next;
  return { edits, churnTokens, nearThresholdMatches, churnBlocks };
}

interface Match {
  readonly index: number;
  readonly score: number;
}

function findMatch(
  blocks: readonly BlockState[],
  cursor: number,
  incoming: ParsedBlock,
  threshold: number,
  lastPosition: ReadonlyMap<string, number>,
  position: number,
): Match | undefined {
  const incomingTokens = tokenize(incoming.text);
  let best: Match | undefined;
  let examined = 0;

  for (let i = cursor; i < blocks.length && examined < MATCH_WINDOW; i += 1) {
    const block = blocks[i];
    if (block === undefined || block.removedBy !== undefined) continue;
    examined += 1;

    const text = liveText(block);

    // An unchanged block is the same block, full stop - no similarity needed.
    if (text === incoming.text && block.kind === incoming.kind) {
      return { index: i, score: 1 };
    }

    // This block is unchanged and belongs to an incoming block further down. Matching
    // anything beyond it would cross the two, so the search stops here.
    const reservedFor = lastPosition.get(text);
    if (reservedFor !== undefined && reservedFor > position) break;

    if (block.kind !== incoming.kind) continue;

    const score = diceCoefficient(liveTokens(block), incomingTokens);
    if (score >= threshold && (best === undefined || score > best.score)) {
      best = { index: i, score };
    }
  }

  return best;
}

function nextBlockId(state: ChapterState): string {
  const id = `${state.id}/b-${String(state.nextBlockNumber).padStart(2, '0')}`;
  state.nextBlockNumber += 1;
  return id;
}

export function emitChapter(
  state: ChapterState,
  editIds: ReadonlyMap<string, string>,
): Chapter {
  const chapter: Chapter = {
    id: state.id,
    title: state.title,
    blocks: state.blocks.map((block) => emitBlock(block, editIds)),
  };
  if (state.number !== undefined) chapter.number = state.number;
  if (state.source.length > 0) chapter.source = state.source;
  return chapter;
}
