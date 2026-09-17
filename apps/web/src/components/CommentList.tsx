import type { ReactElement } from 'react';
import type { BundleIndex, Comment, Selection } from '@revlens/core';
import { commentStanding } from '@revlens/core';
import { cs } from '../strings.js';

/**
 * The review, browsed directly rather than through the text.
 *
 * Everything else in the viewer is reached by clicking a marked passage, which cannot
 * show a comment that produced no change - and that is precisely the comment worth
 * finding. Each row carries all three gates, because they answer different questions and
 * a comment can be confirmed, accepted and still not worked in.
 */

export interface CommentListProps {
  readonly index: BundleIndex;
  readonly comments: readonly Comment[];
  readonly total: number;
  /** How many of them belong to this comparison. */
  readonly inRange: number;
  /** Whether the list is currently narrowed to those. */
  readonly scoped: boolean;
  readonly selectedCommentId?: string;
  onSelect(selection: Selection): void;
}

export function CommentList(props: CommentListProps): ReactElement {
  const { index, comments, total, inRange, scoped, selectedCommentId, onSelect } = props;

  if (total === 0) {
    return <p className="hint">{cs.comments.none}</p>;
  }

  return (
    <>
      <p className="hint" data-testid="comment-count">
        {/* The counter says what it is counting: "140 of 140" hid the fact that two
            thirds of them belonged to an earlier comparison. */}
        {scoped
          ? cs.comments.countScoped(comments.length, inRange, total)
          : cs.comments.count(comments.length, total)}
      </p>

      {comments.length === 0 ? (
        <p className="hint">{cs.comments.empty}</p>
      ) : (
        <ul className="comment-list">
          {comments.map((comment) => {
            const standing = commentStanding(index, comment);
            return (
              <li key={comment.id}>
                <button
                  type="button"
                  className="comment"
                  data-comment={comment.id}
                  aria-pressed={comment.id === selectedCommentId}
                  onClick={() => onSelect({ kind: 'comment', id: comment.id })}
                >
                  <span className="comment__head">
                    <span className="comment__id">{comment.id}</span>
                    <span className="comment__author">{comment.author.name}</span>
                    {standing.beforeBaseline ? (
                      // Out of scope by construction, not a comment nobody acted on.
                      <span
                        className="comment__flag comment__flag--scope"
                        title={cs.comments.beforeBaselineHint}
                        aria-label={cs.comments.beforeBaseline}
                      >
                        ·
                      </span>
                    ) : (
                      !standing.landed && (
                        <span
                          className="comment__flag"
                          title={cs.comments.landedNo}
                          aria-label={cs.comments.landedNo}
                        >
                          ○
                        </span>
                      )
                    )}
                  </span>

                  <span className="comment__text">
                    {comment.summary ?? comment.verbatim}
                  </span>

                  <span className="comment__gates">
                    <GateBadge kind="verdict" value={standing.verdict} />
                    <GateBadge kind="decision" value={standing.decision} />
                    <GateBadge kind="resolution" value={standing.resolution} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export type GateKind = 'verdict' | 'decision' | 'resolution';

export function GateBadge({
  kind,
  value,
}: {
  kind: GateKind;
  value: string | undefined;
}): ReactElement | null {
  if (value === undefined) return null;
  return (
    <span className={`badge ${gateClass(kind, value)}`} title={`${cs.comments[kind]}: ${value}`}>
      {value}
    </span>
  );
}

/**
 * Colour by what the value means for the reader, not by which gate it came from: green
 * where the matter is settled and acted on, amber where it is half-done or still moving,
 * red where it was declined, grey where it no longer applies.
 */
function gateClass(kind: GateKind, value: string): string {
  if (kind === 'verdict') {
    if (value === 'potvrzeno') return 'badge--accepted';
    if (value === 'potvrzeno-s-upresnenim') return 'badge--partial';
    return 'badge--muted';
  }

  if (kind === 'decision') {
    if (value === 'prijato') return 'badge--accepted';
    if (value === 'prijato-castecne') return 'badge--partial';
    if (value === 'zamitnuto') return 'badge--rejected';
    return 'badge--open';
  }

  if (value === 'hotovo') return 'badge--accepted';
  if (value === 'rozpracovano') return 'badge--partial';
  if (value === 'nezahajeno') return 'badge--open';
  if (value === 'odpada') return 'badge--muted';
  return '';
}
