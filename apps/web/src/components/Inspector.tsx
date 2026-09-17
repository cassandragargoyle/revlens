import type { ReactElement } from 'react';
import { useState } from 'react';
import type { BundleIndex, Comment, ResolvedSelection, Selection } from '@revlens/core';
import { commentStanding, formatHash, siblingPosition } from '@revlens/core';
import { cs } from '../strings.js';
import { GateBadge } from './CommentList.js';
import { formatDateTime } from './Sidebar.js';

/**
 * Right column: the three questions a marked passage has to answer.
 *
 * What changed, when and by whom, and why - and then the list of the other places the
 * same revision landed, which is the point of the whole tool.
 */

export interface InspectorProps {
  readonly index: BundleIndex;
  readonly resolved: ResolvedSelection;
  onSelect(selection: Selection): void;
}

export function Inspector(props: InspectorProps): ReactElement {
  const { index, resolved, onSelect } = props;
  const [copied, setCopied] = useState(false);

  if (resolved.unresolved) {
    const id = 'id' in resolved.selection ? resolved.selection.id : '';
    return (
      <aside className="pane pane--right inspector">
        <p className="inspector__empty">{cs.status.unresolved(id)}</p>
      </aside>
    );
  }

  const { edit, revision, comments, siblings } = resolved;

  if (edit === undefined && revision === undefined && comments.length === 0) {
    return (
      <aside className="pane pane--right inspector">
        <h2>{cs.inspector.heading}</h2>
        <p className="inspector__empty">{cs.inspector.empty}</p>
      </aside>
    );
  }

  // A comment that produced no change has nothing to point at in the document. Saying so,
  // with the decision and the resolution beside it, is the answer - not an empty panel.
  if (edit === undefined && comments.length > 0) {
    return (
      <aside className="pane pane--right inspector">
        <h2>{cs.inspector.heading}</h2>
        <section>
          <h3>{cs.inspector.comment}</h3>
          {comments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
        </section>
        {comments.some((comment) => commentStanding(index, comment).scope === 'settled-earlier') ? (
          <section>
            <h3>{cs.comments.outOfScopeTitle}</h3>
            <p className="hint">{cs.comments.outOfScopeWhy}</p>
          </section>
        ) : (
          <section>
            <h3>{cs.comments.landed}</h3>
            <p className="inspector__empty">{cs.comments.noChange}</p>
            <p className="hint">{cs.comments.noChangeWhy}</p>
          </section>
        )}
      </aside>
    );
  }

  const runs = edit === undefined ? [] : index.runsOf(edit.id);
  const inserted = runs
    .filter(({ run }) => run.kind === 'inserted')
    .map(({ run }) => run.text)
    .join('');
  const removed = runs
    .filter(({ run }) => run.kind === 'deleted')
    .map(({ run }) => run.text)
    .join('');
  const block = edit === undefined ? undefined : index.getBlock(edit.block);
  const position = edit === undefined ? undefined : siblingPosition(index, edit.id);

  return (
    <aside className="pane pane--right inspector">
      <h2>{cs.inspector.heading}</h2>

      {edit !== undefined && (
        <section>
          <h3>{cs.inspector.what}</h3>
          <div className="change">
            {removed.length > 0 && (
              <div className="change__row">
                <span className="change__label">{cs.inspector.removed}</span>
                <span className="change__removed">{removed}</span>
              </div>
            )}
            {inserted.length > 0 && (
              <div className="change__row">
                <span className="change__label">{cs.inspector.inserted}</span>
                <span className="change__inserted">{inserted}</span>
              </div>
            )}
            {block?.block.introducedBy !== undefined && (
              <p className="hint">{cs.inspector.wholeBlockAdded}</p>
            )}
            {block?.block.removedBy !== undefined && (
              <p className="hint">{cs.inspector.wholeBlockRemoved}</p>
            )}
          </div>
          <dl className="facts" style={{ marginTop: 8 }}>
            <dt>{cs.inspector.chapter}</dt>
            <dd>{block?.chapter.title ?? edit.chapter}</dd>
          </dl>
        </section>
      )}

      {revision !== undefined && (
        <section>
          <h3>{cs.inspector.whenWho}</h3>
          <dl className="facts">
            <dt>Revize</dt>
            <dd>
              {revision.id} · {cs.timeline.kind[revision.kind] ?? revision.kind}
            </dd>
            <dt>Kdy</dt>
            <dd>{formatDateTime(revision.at)}</dd>
            <dt>Kdo</dt>
            <dd>
              {revision.author.name}
              {revision.author.role === undefined ? '' : ` — ${revision.author.role}`}
            </dd>
            {revision.commit !== undefined && (
              <>
                <dt>Commit</dt>
                <dd style={{ fontFamily: 'var(--font-mono)' }}>{revision.commit}</dd>
              </>
            )}
          </dl>
          {revision.verbatim !== undefined && revision.verbatim.length > 0 && (
            <>
              <h3 style={{ marginTop: 10 }}>{cs.inspector.instruction}</h3>
              <blockquote className="verbatim">{revision.verbatim}</blockquote>
            </>
          )}
          {revision.why !== undefined && (
            <p className="hint">
              {cs.inspector.why}: {revision.why}
            </p>
          )}
          {revision.origin !== undefined && (
            <p className="hint">
              {cs.inspector.openSource}: <code>{revision.origin}</code>
            </p>
          )}
        </section>
      )}

      <section>
        <h3>{cs.inspector.comment}</h3>
        {comments.length === 0 ? (
          <p className="inspector__empty">{cs.inspector.noComment}</p>
        ) : (
          comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)
        )}
      </section>

      {resolved.chapters.length > 1 && (
        <section>
          <h3>{cs.inspector.chapters}</h3>
          <p className="hint" style={{ marginTop: 0, marginBottom: 6 }}>
            {cs.inspector.chaptersHint}
          </p>
          <ul className="shares">
            {resolved.chapters.map((share) => {
              const landing = siblings.find((sibling) => sibling.chapter === share.chapterId);
              return (
                <li key={share.chapterId}>
                  <button
                    type="button"
                    className="shares__item"
                    aria-current={share.chapterId === edit?.chapter}
                    disabled={landing === undefined}
                    onClick={() => {
                      if (landing !== undefined) onSelect({ kind: 'edit', id: landing.id });
                    }}
                  >
                    <span className="shares__title">
                      {share.title ?? share.chapterId}
                    </span>
                    <span className="shares__count">{cs.inspector.chapterShare(share.edits)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h3>{cs.inspector.siblings}</h3>
        {siblings.length <= 1 ? (
          <p className="inspector__empty">{cs.inspector.onlyChange}</p>
        ) : (
          <>
            <p className="hint" style={{ marginTop: 0, marginBottom: 6 }}>
              {cs.inspector.siblingsHint}
              {position === undefined
                ? ''
                : ` ${cs.inspector.position(position.position, position.total)}`}
            </p>
            <ul className="siblings">
              {siblings.map((sibling) => {
                const where = index.getBlock(sibling.block);
                const preview = index
                  .runsOf(sibling.id)
                  .map(({ run }) => run.text)
                  .join(' ')
                  .slice(0, 90);
                return (
                  <li key={sibling.id}>
                    <button
                      type="button"
                      className="siblings__item"
                      aria-current={sibling.id === edit?.id}
                      onClick={() => onSelect({ kind: 'edit', id: sibling.id })}
                    >
                      <span className="siblings__where">
                        {sibling.id} · {where?.chapter.title ?? sibling.chapter}
                      </span>
                      <br />
                      {preview}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            const hash = formatHash(resolved.selection);
            const url = `${window.location.origin}${window.location.pathname}${hash}`;
            void navigator.clipboard?.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? cs.inspector.copied : cs.inspector.copyLink}
        </button>
        <button type="button" onClick={() => window.print()}>
          {cs.keyboard.print}
        </button>
      </div>
    </aside>
  );
}

function CommentCard({ comment }: { comment: Comment }): ReactElement {
  return (
    <div style={{ marginBottom: 12 }}>
      <dl className="facts">
        <dt>{cs.inspector.commentAuthor}</dt>
        <dd>
          {comment.author.name}
          {comment.author.role === undefined ? '' : ` — ${comment.author.role}`}
        </dd>
        {comment.round !== undefined && (
          <>
            <dt>Kolo</dt>
            <dd>
              {comment.id} ({comment.round})
            </dd>
          </>
        )}
        {/* The three gates, in the order the records take them: is it right, what did we
            decide, and has it actually been worked in. */}
        {comment.check?.verdict !== undefined && (
          <>
            <dt>{cs.comments.verdict}</dt>
            <dd>
              <GateBadge kind="verdict" value={comment.check.verdict} />
            </dd>
          </>
        )}
        {comment.decision?.status !== undefined && (
          <>
            <dt>{cs.comments.decision}</dt>
            <dd>
              <GateBadge kind="decision" value={comment.decision.status} />
            </dd>
          </>
        )}
        {comment.resolution?.state !== undefined && (
          <>
            <dt>{cs.comments.resolution}</dt>
            <dd>
              <GateBadge kind="resolution" value={comment.resolution.state} />
            </dd>
          </>
        )}
      </dl>

      {(comment.resolution?.changes ?? []).length > 0 && (
        <>
          <h3 style={{ marginTop: 8 }}>{cs.comments.changes}</h3>
          <ul className="resolution">
            {(comment.resolution?.changes ?? []).map((change, position) => (
              <li key={`${comment.id}:${position}`}>{change}</li>
            ))}
          </ul>
        </>
      )}
      <blockquote className="verbatim" style={{ marginTop: 6 }}>
        {comment.verbatim}
      </blockquote>
      {comment.answer !== undefined && (
        <>
          <h3 style={{ marginTop: 8 }}>{cs.inspector.answer}</h3>
          <blockquote className="verbatim">{comment.answer}</blockquote>
        </>
      )}
    </div>
  );
}

