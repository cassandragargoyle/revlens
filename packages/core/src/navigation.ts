import type { BundleIndex } from './bundle-index.js';
import type { Edit } from './schema.js';

/**
 * Navigation rules, written once and unit-tested without a browser.
 *
 * The one that the whole tool exists for is `nextEditOfRevision`: one instruction
 * usually lands in several places, and stepping between those places is what makes a
 * revision readable as one act instead of as scattered edits.
 */

export type Direction = 1 | -1;

/** Step within the edits of the revision that produced `editId`. */
export function siblingEdit(
  index: BundleIndex,
  editId: string,
  direction: Direction,
  wrap = true,
): Edit | undefined {
  const edit = index.getEdit(editId);
  if (edit === undefined) return undefined;
  return step(index.editsOfRevision(edit.revision), editId, direction, wrap);
}

export function nextEditOfRevision(index: BundleIndex, editId: string, wrap = true): Edit | undefined {
  return siblingEdit(index, editId, 1, wrap);
}

export function previousEditOfRevision(
  index: BundleIndex,
  editId: string,
  wrap = true,
): Edit | undefined {
  return siblingEdit(index, editId, -1, wrap);
}

/** All the edits of the same revision, in document order, including the given one. */
export function siblingEdits(index: BundleIndex, editId: string): Edit[] {
  const edit = index.getEdit(editId);
  if (edit === undefined) return [];
  return index.editsOfRevision(edit.revision);
}

/** Step through every edit in document order, regardless of revision. */
export function nextEdit(
  index: BundleIndex,
  editId: string | undefined,
  wrap = true,
  scope?: readonly Edit[],
): Edit | undefined {
  const edits = scope ?? index.editsInDocumentOrder;
  if (editId === undefined) return edits[0];
  return step(edits, editId, 1, wrap);
}

export function previousEdit(
  index: BundleIndex,
  editId: string | undefined,
  wrap = true,
  scope?: readonly Edit[],
): Edit | undefined {
  const edits = scope ?? index.editsInDocumentOrder;
  if (editId === undefined) return edits[edits.length - 1];
  return step(edits, editId, -1, wrap);
}

/** The first edit of a revision - where selecting a revision in the timeline lands. */
export function firstEditOfRevision(index: BundleIndex, revisionId: string): Edit | undefined {
  return index.editsOfRevision(revisionId)[0];
}

/** Position of an edit among the edits of its own revision, as `2 / 5`. */
export function siblingPosition(
  index: BundleIndex,
  editId: string,
): { position: number; total: number } | undefined {
  const siblings = siblingEdits(index, editId);
  const position = siblings.findIndex((candidate) => candidate.id === editId);
  if (position < 0) return undefined;
  return { position: position + 1, total: siblings.length };
}

function step(
  edits: readonly Edit[],
  editId: string,
  direction: Direction,
  wrap: boolean,
): Edit | undefined {
  const current = edits.findIndex((edit) => edit.id === editId);
  if (current < 0) return undefined;
  const next = current + direction;
  if (next >= 0 && next < edits.length) return edits[next];
  if (!wrap || edits.length === 0) return undefined;
  return direction === 1 ? edits[0] : edits[edits.length - 1];
}
