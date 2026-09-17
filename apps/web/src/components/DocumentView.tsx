import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import type { Block, BundleIndex, Chapter, Run, Selection, ViewMode } from '@revlens/core';
import { isBlockVisible, runsForMode } from '@revlens/core';
import { revisionColor } from '../colors.js';
import { scrollIntoViewWhenStable } from '../scroll.js';
import { cs } from '../strings.js';

/**
 * The document itself: the final text with every change marked in place.
 *
 * Rendering is concatenating runs. There is no offset arithmetic anywhere, which is why a
 * highlight cannot drift out of alignment with the text it marks - the attribution was
 * resolved at build time and the browser only has to lay it out.
 */

export interface DocumentViewProps {
  readonly chapter: Chapter;
  readonly index: BundleIndex;
  readonly mode: ViewMode;
  readonly selection: Selection;
  /** The edit the inspector is showing, which is what gets scrolled into view. */
  readonly selectedEditId?: string;
  /** Edits the filter admits; everything else is dimmed rather than hidden. */
  readonly visibleEditIds?: ReadonlySet<string>;
  onSelect(selection: Selection): void;
}

export function DocumentView(props: DocumentViewProps): ReactElement {
  const { chapter, index, mode, selectedEditId, visibleEditIds, onSelect } = props;
  const container = useRef<HTMLDivElement>(null);
  const revisionIds = index.revisionsInTimeOrder().map((revision) => revision.id);

  // Selecting a change anywhere - by clicking, by pressing n, or by opening a deep link -
  // has to bring it on screen, and leave the selection anchored where the reader put it.
  useEffect(() => {
    if (selectedEditId === undefined) return;
    const node = container.current?.querySelector(`[data-edit="${escapeSelector(selectedEditId)}"]`);
    if (node === null || node === undefined) return;
    // The blocks above this one may never have been laid out, so the first scroll lands on
    // an estimate. Repeat it until the element stops moving - see scroll.ts.
    return scrollIntoViewWhenStable(node);
  }, [selectedEditId, chapter.id, mode]);

  const editCount = index.editCountOfChapter(chapter.id);

  return (
    <div className="document" ref={container}>
      <div className="document__chapter-title">
        <span>
          {chapter.number === undefined ? '' : `${chapter.number}. `}
          {chapter.title}
        </span>
        <span className={editCount === 0 ? 'chapter-list__count--none' : undefined}>
          {cs.chapters.changes(editCount)}
        </span>
      </div>

      {chapter.blocks
        .filter((block) => isBlockVisible(block, mode))
        .map((block) => (
          <BlockView
            key={block.id}
            block={block}
            mode={mode}
            isTarget={
              selectedEditId !== undefined &&
              block.runs.some((run) => run.edit === selectedEditId)
            }
            revisionIds={revisionIds}
            {...(selectedEditId === undefined ? {} : { selectedEditId })}
            {...(visibleEditIds === undefined ? {} : { visibleEditIds })}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

interface BlockViewProps {
  readonly block: Block;
  readonly mode: ViewMode;
  /** Holds the selected edit, so it is laid out rather than left as a placeholder. */
  readonly isTarget?: boolean;
  readonly revisionIds: readonly string[];
  readonly selectedEditId?: string;
  readonly visibleEditIds?: ReadonlySet<string>;
  onSelect(selection: Selection): void;
}

function BlockView(props: BlockViewProps): ReactElement {
  const { block, mode, revisionIds, isTarget, selectedEditId, visibleEditIds, onSelect } = props;

  const classes = ['block', `block--${block.kind}`];
  if (isTarget === true) classes.push('block--target');
  if (block.kind === 'heading' && block.level !== undefined) {
    classes.push(`block--heading${block.level}`);
  }
  if (block.introducedBy !== undefined) classes.push('block--introduced');
  if (block.removedBy !== undefined) classes.push('block--removed');

  return (
    <div
      className={classes.join(' ')}
      data-block={block.id}
      title={
        block.introducedBy !== undefined
          ? cs.inspector.wholeBlockAdded
          : block.removedBy !== undefined
            ? cs.inspector.wholeBlockRemoved
            : undefined
      }
    >
      {runsForMode(block, mode).map((run, position) => (
        <RunView
          key={`${block.id}:${position}`}
          run={run}
          revisionIds={revisionIds}
          {...(selectedEditId === undefined ? {} : { selectedEditId })}
          {...(visibleEditIds === undefined ? {} : { visibleEditIds })}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface RunViewProps {
  readonly run: Run;
  readonly revisionIds: readonly string[];
  readonly selectedEditId?: string;
  readonly visibleEditIds?: ReadonlySet<string>;
  onSelect(selection: Selection): void;
}

function RunView(props: RunViewProps): ReactElement {
  const { run, revisionIds, selectedEditId, visibleEditIds, onSelect } = props;

  if (run.kind === 'kept') {
    return <span className="run">{run.text}</span>;
  }

  const color = revisionColor(revisionIds, run.revision);
  const dimmed =
    visibleEditIds !== undefined && run.edit !== undefined && !visibleEditIds.has(run.edit);
  const selected = run.edit !== undefined && run.edit === selectedEditId;

  const classes = ['run', `run--${run.kind}`];
  if (dimmed) classes.push('run--dimmed');
  if (selected) classes.push('run--selected');

  return (
    <span
      className={classes.join(' ')}
      data-edit={run.edit}
      data-revision={run.revision}
      role="button"
      tabIndex={0}
      style={
        dimmed
          ? undefined
          : ({ '--revision-color': color.stroke, '--revision-tint': color.tint } as React.CSSProperties)
      }
      onClick={() => {
        if (run.edit !== undefined) onSelect({ kind: 'edit', id: run.edit });
        else onSelect({ kind: 'revision', id: run.revision });
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (run.edit !== undefined) onSelect({ kind: 'edit', id: run.edit });
      }}
    >
      {run.text}
    </span>
  );
}

/** Ids come from an adapter, so they are escaped rather than trusted to be selector-safe. */
function escapeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
