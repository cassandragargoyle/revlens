import type { BundleIndex } from './bundle-index.js';
import type { Comment, Edit } from './schema.js';

/**
 * Browsing the review itself, rather than the text.
 *
 * A comment passes three gates, and they answer different questions and can disagree:
 * **ověření** says whether the objection is right, **rozhodnutí** says what the processor
 * decided, and **vypořádání** says whether it has actually been worked into the text.
 *
 * The values are the engagement's own vocabulary, so nothing here interprets them. The
 * one judgement this module does make is language-neutral and comes from the bundle
 * rather than from a string: **did the comment produce a change in the document**. A
 * comment that was confirmed and accepted and produced nothing is invisible in the text
 * by definition, and it is the one worth finding.
 */

export const GATES = ['verdict', 'decision', 'resolution'] as const;
export type Gate = (typeof GATES)[number];

/**
 * Whether a comment belongs to the comparison the bundle was built to answer.
 *
 * A bundle comparing 1.5 against 1.6 carries every comment the engagement ever received,
 * including whole rounds closed before the baseline was cut. Those belong to an earlier
 * comparison; listing them buries the ones that matter under two thirds of the file.
 *
 * `settled-earlier` says only that the comment was **closed before this comparison
 * starts** — by whichever of the three gates closed it. It must never be worded to the
 * reader as "already worked into the text": a comment can be closed as declined, as no
 * longer applicable, or as an umbrella finding split into others, and none of those put
 * anything into the document.
 */
export const COMMENT_SCOPES = ['in-range', 'settled-earlier'] as const;
export type CommentScope = (typeof COMMENT_SCOPES)[number];

/**
 * What the browser, the API and the MCP tools show unless asked otherwise.
 *
 * Exported so the three cannot drift: a reader and an assistant asking the same question
 * must get the same count.
 */
export const DEFAULT_COMMENT_SCOPE: CommentScope = 'in-range';

export interface CommentStanding {
  readonly comment: Comment;
  /** Gate 1 - is the objection right? */
  readonly verdict?: string;
  /** Gate 2 - what was decided? */
  readonly decision?: string;
  /** Gate 3 - has it been worked in? */
  readonly resolution?: string;
  /** What the processor recorded as done, verbatim. */
  readonly changes: readonly string[];
  /** The changes in the document this comment produced, in document order. */
  readonly edits: readonly Edit[];
  /** True when the comment produced at least one change a reader can open. */
  readonly landed: boolean;
  /** When the comment was worked in, as the record has it. */
  readonly resolvedAt?: string;
  /**
   * True when the comment was worked in **before the baseline**.
   *
   * Such a comment can never appear as a change in this bundle: its edits are already
   * inside the text the comparison starts from. It is out of scope by construction, not
   * a comment nobody acted on - and conflating the two turns a structural fact into a
   * false alarm.
   */
  readonly beforeBaseline: boolean;
  /**
   * Whether this comment belongs to the comparison at all.
   *
   * Being closed before the baseline is not enough on its own: if a change in **this**
   * bundle answers the comment, then the document in front of the reader contains that
   * change and the comment plainly belongs here. Evidence in the document outweighs a
   * timestamp in a record - which matters, because the engagement has exactly such a case
   * and a rule based on dates alone would hide it.
   */
  readonly scope: CommentScope;
}

export function commentStanding(index: BundleIndex, comment: Comment): CommentStanding {
  const edits = index.editsOfComment(comment.id);
  const resolvedAt = resolutionTime(comment);
  const baselineAt = index.bundle.document.baseline?.at;
  const landed = edits.length > 0;
  const beforeBaseline = isSettledBefore(resolvedAt, baselineAt);

  return {
    comment,
    ...(comment.check?.verdict === undefined ? {} : { verdict: comment.check.verdict }),
    ...(comment.decision?.status === undefined ? {} : { decision: comment.decision.status }),
    ...(comment.resolution?.state === undefined ? {} : { resolution: comment.resolution.state }),
    changes: comment.resolution?.changes ?? [],
    edits,
    landed,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    beforeBaseline,
    scope: beforeBaseline && !landed ? 'settled-earlier' : 'in-range',
  };
}

/** When the record says the comment was worked in; the decision date is the fallback. */
export function resolutionTime(comment: Comment): string | undefined {
  const resolution = comment.resolution?.at;
  if (resolution !== undefined && resolution !== null && resolution.length > 0) return resolution;
  const decision = comment.decision?.at;
  if (decision !== undefined && decision !== null && decision.length > 0) return decision;
  return undefined;
}

/**
 * Compared as instants where both sides carry one.
 *
 * Day granularity is not good enough here, and the engagement shows why: a whole round was
 * recorded at 06:06 on the morning of the day the baseline build was cut at 23:11 that
 * evening. Treating the two as the same day put sixty-odd records on the wrong side.
 *
 * The adapter writes an unambiguous instant into `resolution.at`, so both sides parse. When
 * one of them does not - a record that carries only a date, or a bundle with no baseline
 * timestamp - the comparison falls back to the calendar day, and a tie counts as **in
 * scope**: hiding a record is the more damaging of the two mistakes.
 *
 * Exported because the builder draws the same line when it reports how many records are
 * out of scope. One predicate, so the report and the viewer cannot disagree.
 */
export function isSettledBefore(
  resolvedAt: string | undefined,
  baselineAt: string | undefined,
): boolean {
  if (resolvedAt === undefined || baselineAt === undefined) return false;

  const resolved = Date.parse(resolvedAt);
  const baseline = Date.parse(baselineAt);
  if (!Number.isNaN(resolved) && !Number.isNaN(baseline) && hasZone(resolvedAt)) {
    return resolved < baseline;
  }

  const resolvedDay = resolvedAt.slice(0, 10);
  const baselineDay = baselineAt.slice(0, 10);
  if (resolvedDay.length < 10 || baselineDay.length < 10) return false;
  return resolvedDay < baselineDay;
}

/** Without a zone, `Date.parse` would read the record in whatever zone the reader sits in. */
function hasZone(timestamp: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp);
}

/**
 * Every comment, in a stable browsing order: by round, then by id.
 *
 * Ids inside a round are `K11-122`, `K11-123` and so on, so a plain string sort would put
 * `K11-9` after `K11-10`. The numeric tail is compared as a number.
 */
export function commentsInBrowsingOrder(index: BundleIndex): Comment[] {
  return [...(index.bundle.comments ?? [])].sort((a, b) => {
    const round = (a.round ?? '').localeCompare(b.round ?? '', 'cs');
    if (round !== 0) return round;
    return compareIds(a.id, b.id);
  });
}

/** Distinct values a gate takes in this bundle, for populating a filter. */
export function distinctGateValues(index: BundleIndex, gate: Gate): string[] {
  const values = new Set<string>();
  for (const comment of index.bundle.comments ?? []) {
    const value = valueOf(comment, gate);
    if (value !== undefined && value.length > 0) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'cs'));
}

/** Distinct comment rounds in this bundle. */
export function distinctRounds(index: BundleIndex): string[] {
  const rounds = new Set<string>();
  for (const comment of index.bundle.comments ?? []) {
    if (comment.round !== undefined && comment.round.length > 0) rounds.add(comment.round);
  }
  return [...rounds].sort(compareIds);
}

export function valueOf(comment: Comment, gate: Gate): string | undefined {
  switch (gate) {
    case 'verdict':
      return comment.check?.verdict;
    case 'decision':
      return comment.decision?.status;
    case 'resolution':
      return comment.resolution?.state;
  }
}

function compareIds(a: string, b: string): number {
  const split = /^(\D*)(\d*)(.*)$/;
  const left = split.exec(a);
  const right = split.exec(b);
  if (left === null || right === null) return a.localeCompare(b, 'cs');

  const prefix = (left[1] ?? '').localeCompare(right[1] ?? '', 'cs');
  if (prefix !== 0) return prefix;

  const leftNumber = Number(left[2] ?? '');
  const rightNumber = Number(right[2] ?? '');
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return (left[3] ?? '').localeCompare(right[3] ?? '', 'cs', { numeric: true });
}
