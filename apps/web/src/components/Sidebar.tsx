import type { ReactElement } from 'react';
import type {
  BundleIndex,
  Chapter,
  Comment,
  EditFilter,
  Gate,
  Revision,
  Selection,
} from '@revlens/core';
import {
  DEFAULT_COMMENT_SCOPE,
  commentStanding,
  distinctGateValues,
  distinctRounds,
} from '@revlens/core';
import { revisionColor } from '../colors.js';
import { cs } from '../strings.js';
import { CommentList } from './CommentList.js';

/**
 * Left column: three ways into the same document.
 *
 * **Kapitoly** and **Revize** enter through the text. **Připomínky** enters through the
 * review, which is the only way to reach a comment that produced no change - and that is
 * the one worth finding.
 *
 * The filter sits above all three and means the same thing in each.
 */

export type SidebarView = 'chapters' | 'revisions' | 'comments';

export interface SidebarProps {
  readonly index: BundleIndex;
  readonly view: SidebarView;
  readonly chapters: readonly Chapter[];
  readonly chapterId?: string;
  readonly revisions: readonly Revision[];
  readonly comments: readonly Comment[];
  readonly selection: Selection;
  readonly selectedRevisionId?: string;
  readonly selectedCommentId?: string;
  readonly filter: EditFilter;
  readonly shown: number;
  readonly total: number;
  onView(view: SidebarView): void;
  onSelectChapter(id: string): void;
  onSelect(selection: Selection): void;
  onFilter(filter: EditFilter): void;
  onClear(): void;
}

export function Sidebar(props: SidebarProps): ReactElement {
  const {
    index,
    view,
    chapters,
    chapterId,
    revisions,
    comments,
    selectedRevisionId,
    selectedCommentId,
    filter,
    shown,
    total,
    onView,
    onSelectChapter,
    onSelect,
    onFilter,
    onClear,
  } = props;

  const revisionIds = index.revisionsInTimeOrder().map((revision) => revision.id);
  const authors = unique(index.bundle.revisions.map((revision) => revision.author.name));
  const rounds = distinctRounds(index);
  const allComments = index.bundle.comments ?? [];
  const commentTotal = allComments.length;
  const inRange = allComments.filter(
    (comment) => commentStanding(index, comment).scope === 'in-range',
  ).length;
  const outOfScope = commentTotal - inRange;

  return (
    <aside className="pane pane--left">
      <div className="tabs" role="tablist">
        {(['chapters', 'revisions', 'comments'] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={view === candidate}
            onClick={() => onView(candidate)}
          >
            {cs.views[candidate]}
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="filter-search">{cs.filters.search}</label>
        <input
          id="filter-search"
          type="search"
          placeholder={cs.filters.searchPlaceholder}
          value={filter.query ?? ''}
          onChange={(event) => onFilter({ ...filter, query: event.target.value })}
        />
      </div>

      {authors.length > 1 && (
        <div className="field">
          <label htmlFor="filter-author">{cs.filters.author}</label>
          <select
            id="filter-author"
            value={filter.authors?.[0] ?? ''}
            onChange={(event) => onFilter(withList(filter, 'authors', event.target.value))}
          >
            <option value="">—</option>
            {authors.map((author) => (
              <option key={author} value={author}>
                {author}
              </option>
            ))}
          </select>
        </div>
      )}

      {rounds.length > 0 && (
        <div className="field">
          <label htmlFor="filter-round">{cs.filters.round}</label>
          <select
            id="filter-round"
            value={filter.rounds?.[0] ?? ''}
            onChange={(event) => onFilter(withList(filter, 'rounds', event.target.value))}
          >
            <option value="">—</option>
            {rounds.map((round) => (
              <option key={round} value={round}>
                {round}
              </option>
            ))}
          </select>
        </div>
      )}

      {commentTotal > 0 && (
        <>
          <GateFilter
            index={index}
            gate="verdict"
            label={cs.comments.verdict}
            filter={filter}
            onFilter={onFilter}
          />
          <GateFilter
            index={index}
            gate="decision"
            label={cs.comments.decision}
            filter={filter}
            onFilter={onFilter}
          />
          <GateFilter
            index={index}
            gate="resolution"
            label={cs.comments.resolution}
            filter={filter}
            onFilter={onFilter}
          />

          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={filter.landed === false}
                onChange={(event) => {
                  const next = { ...filter };
                  if (event.target.checked) next.landed = false;
                  else delete next.landed;
                  onFilter(next);
                }}
              />
              {cs.comments.onlyOutstanding}
            </label>
            <p className="hint">{cs.comments.onlyOutstandingHint}</p>
          </div>

          <div className="field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={filter.scope === undefined}
                onChange={(event) => {
                  const next = { ...filter };
                  // Widening is the deliberate act; the comparison's own list is default.
                  if (event.target.checked) delete next.scope;
                  else next.scope = DEFAULT_COMMENT_SCOPE;
                  onFilter(next);
                }}
              />
              {cs.comments.scopeToggle}
            </label>
            {outOfScope > 0 && <p className="hint">{cs.comments.scopeHint(outOfScope)}</p>}
          </div>
        </>
      )}

      <div className="field field--inline">
        <div>
          <label htmlFor="filter-from">{cs.filters.from}</label>
          <input
            id="filter-from"
            type="date"
            value={(filter.from ?? '').slice(0, 10)}
            onChange={(event) =>
              onFilter(withDate(filter, 'from', event.target.value, '00:00:00'))
            }
          />
        </div>
        <div>
          <label htmlFor="filter-to">{cs.filters.to}</label>
          <input
            id="filter-to"
            type="date"
            value={(filter.to ?? '').slice(0, 10)}
            onChange={(event) => onFilter(withDate(filter, 'to', event.target.value, '23:59:59'))}
          />
        </div>
      </div>

      <p className="hint" data-testid="filter-count">
        {cs.filters.visible(shown, total)}
      </p>

      <div className="toolbar">
        <button type="button" onClick={() => onFilter({})}>
          {cs.filters.reset}
        </button>
        {selectedRevisionId !== undefined && (
          <button type="button" onClick={onClear}>
            {cs.timeline.clearSelection}
          </button>
        )}
      </div>

      {view === 'chapters' && (
        <>
          <h2>{cs.chapters.heading}</h2>
          <ul className="chapter-list">
            {chapters.map((chapter) => {
              const count = index.editCountOfChapter(chapter.id);
              return (
                <li key={chapter.id}>
                  <button
                    type="button"
                    className="chapter-list__item"
                    aria-current={chapter.id === chapterId}
                    onClick={() => onSelectChapter(chapter.id)}
                  >
                    <span className="chapter-list__number">{chapter.number ?? ''}</span>
                    <span className="chapter-list__title">{chapter.title}</span>
                    <span
                      className={`chapter-list__count${count === 0 ? ' chapter-list__count--none' : ''}`}
                    >
                      {cs.chapters.changes(count)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {view === 'revisions' && (
        <>
          <h2>{cs.timeline.heading}</h2>
          {revisions.length === 0 ? (
            <p className="hint">{cs.timeline.empty}</p>
          ) : (
            <ul className="timeline">
              {revisions.map((revision) => {
                const color = revisionColor(revisionIds, revision.id);
                const count = index.editsOfRevision(revision.id).length;
                const answered = index.commentsOfRevision(revision.id);
                return (
                  <li key={revision.id}>
                    <button
                      type="button"
                      className="revision"
                      aria-pressed={revision.id === selectedRevisionId}
                      onClick={() => onSelect({ kind: 'revision', id: revision.id })}
                    >
                      <span className="revision__head">
                        <span className="revision__swatch" style={{ background: color.swatch }} />
                        <span className="revision__id">{revision.id}</span>
                        <span>{formatDateTime(revision.at)}</span>
                      </span>
                      <span className="revision__title">{revision.title}</span>
                      <span className="revision__foot">
                        <span>{revision.author.name}</span>
                        <span>{cs.timeline.edits(count)}</span>
                      </span>
                      {answered.length > 0 && (
                        // How the comments this revision answers were disposed of - the
                        // timeline says what changed, this says on what footing.
                        <span className="revision__gates">
                          {answered.slice(0, 4).map((comment) => (
                            <span key={comment.id} className="revision__comment">
                              <span className="comment__id">{comment.id}</span>
                              {comment.decision?.status !== undefined && (
                                <span className="badge badge--small">
                                  {comment.decision.status}
                                </span>
                              )}
                              {comment.resolution?.state !== undefined && (
                                <span className="badge badge--small">
                                  {comment.resolution.state}
                                </span>
                              )}
                            </span>
                          ))}
                          {answered.length > 4 && (
                            <span className="badge badge--small">
                              +{answered.length - 4}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {view === 'comments' && (
        <>
          <h2>{cs.comments.heading}</h2>
          <CommentList
            index={index}
            comments={comments}
            total={commentTotal}
            inRange={inRange}
            scoped={filter.scope !== undefined}
            {...(selectedCommentId === undefined ? {} : { selectedCommentId })}
            onSelect={onSelect}
          />
        </>
      )}
    </aside>
  );
}

function GateFilter({
  index,
  gate,
  label,
  filter,
  onFilter,
}: {
  index: BundleIndex;
  gate: Gate;
  label: string;
  filter: EditFilter;
  onFilter(filter: EditFilter): void;
}): ReactElement | null {
  const values = distinctGateValues(index, gate);
  if (values.length === 0) return null;

  const key = gateKey(gate);
  return (
    <div className="field">
      <label htmlFor={`filter-${gate}`}>{label}</label>
      <select
        id={`filter-${gate}`}
        value={filter[key]?.[0] ?? ''}
        onChange={(event) => onFilter(withList(filter, key, event.target.value))}
      >
        <option value="">—</option>
        {values.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  );
}

type ListKey = 'authors' | 'rounds' | 'verdicts' | 'decisions' | 'resolutions';

function gateKey(gate: Gate): ListKey {
  if (gate === 'verdict') return 'verdicts';
  if (gate === 'decision') return 'decisions';
  return 'resolutions';
}

function withList(filter: EditFilter, key: ListKey, value: string): EditFilter {
  const next = { ...filter };
  if (value.length === 0) delete next[key];
  else next[key] = [value];
  return next;
}

function withDate(
  filter: EditFilter,
  key: 'from' | 'to',
  value: string,
  time: string,
): EditFilter {
  const next = { ...filter };
  if (value.length === 0) delete next[key];
  else next[key] = `${value}T${time}+00:00`;
  return next;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'cs'));
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
