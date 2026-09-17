import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { computeStats, resolveSelection } from '@revlens/core';
import type { BundleSource } from './data/source.js';
import { About } from './components/About.js';
import { DocumentView } from './components/DocumentView.js';
import { Inspector } from './components/Inspector.js';
import type { SidebarView } from './components/Sidebar.js';
import { PaneResizer } from './components/PaneResizer.js';
import { Rail } from './components/Rail.js';
import { Sidebar, formatDateTime } from './components/Sidebar.js';
import { cs } from './strings.js';
import { PANE_MAX, PANE_MIN, usePaneWidths } from './state/usePaneWidths.js';
import { useRailState } from './state/useRailState.js';
import { useFiltered, useViewer } from './state/useViewer.js';

const ABOUT_HASH = '#/about';

export function App({ source }: { source: BundleSource }): ReactElement {
  const [state, actions] = useViewer(source);
  const [view, setView] = useState<SidebarView>('chapters');
  const [panes, paneActions] = usePaneWidths();
  const [rail, railActions] = useRailState();
  // The about page is a page, not a modal: #/about has to be linkable and printable. It
  // is not a selection of document content, so it stays out of the core selection model.
  const [about, setAbout] = useState(() => window.location.hash === ABOUT_HASH);

  useEffect(() => {
    const onHashChange = (): void => setAbout(window.location.hash === ABOUT_HASH);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const openAbout = (): void => {
    window.history.replaceState(null, '', ABOUT_HASH);
    setAbout(true);
  };

  const closeAbout = (): void => {
    window.history.replaceState(null, '', window.location.pathname);
    setAbout(false);
  };
  const filtered = useFiltered(state.index, state.filter);

  const resolved = useMemo(
    () => (state.index === undefined ? undefined : resolveSelection(state.index, state.selection)),
    [state.index, state.selection],
  );

  // `n` and `p` step between the changes of the selected revision; `j` and `k` walk every
  // change in document order. Escape clears the selection and un-dims the document.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'n':
          event.preventDefault();
          actions.step(1, 'revision');
          break;
        case 'p':
          event.preventDefault();
          actions.step(-1, 'revision');
          break;
        case 'j':
          event.preventDefault();
          actions.step(1, 'document');
          break;
        case 'k':
          event.preventDefault();
          actions.step(-1, 'document');
          break;
        case 'Escape':
          event.preventDefault();
          actions.clearSelection();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  if (state.status === 'error') {
    return (
      <div className="status status--error">
        <p>
          {cs.status.error}: {state.error}
        </p>
        <button type="button" onClick={() => actions.reload()}>
          {cs.status.retry}
        </button>
      </div>
    );
  }

  if (state.status === 'loading' || state.index === undefined || state.bundle === undefined) {
    return <div className="status">{cs.status.loading}</div>;
  }

  const { bundle, index } = state;
  const stats = computeStats(index);
  const visibleEditIds = new Set(filtered.edits.map((edit) => edit.id));
  const selectedRevisionId = resolved?.revision?.id;
  const selectedCommentId =
    state.selection.kind === 'comment' ? state.selection.id : resolved?.comments[0]?.id;

  return (
    <div
      className="app"
      data-rail={rail}
      style={
        {
          '--pane-left': `${panes.left}px`,
          '--pane-right': `${panes.right}px`,
        } as React.CSSProperties
      }
    >
      <header className="app__header">
        <span className="app__title">{cs.appTitle}</span>
        <span className="app__document">
          {bundle.document.title}
          {' · '}
          {bundle.document.version}
          {bundle.document.baseline === undefined
            ? ''
            : ` ${cs.status.baseline(bundle.document.baseline.version)}`}
        </span>

        <span className="app__meta">
          <span title={cs.status.unexplained(stats.unexplainedEdits)}>
            {cs.status.unexplained(stats.unexplainedEdits)}
          </span>
          <span>{cs.status.generated(formatDateTime(bundle.document.generated))}</span>
        </span>
      </header>

      <Rail
        mode={state.mode}
        about={about}
        state={rail}
        onMode={(mode) => {
          // Picking a way to read the document is also a way to leave the about page.
          if (about) closeAbout();
          actions.setMode(mode);
        }}
        canRebuild={state.canRebuild}
        onAbout={about ? closeAbout : openAbout}
        onToggle={railActions.toggle}
        onRebuild={() => actions.rebuild()}
      />

      {about ? (
        <About index={index} onClose={closeAbout} />
      ) : (
        <>
      <Sidebar
        index={index}
        view={view}
        chapters={bundle.chapters}
        {...(state.chapterId === undefined ? {} : { chapterId: state.chapterId })}
        revisions={filtered.revisions}
        comments={filtered.comments}
        selection={state.selection}
        {...(selectedRevisionId === undefined ? {} : { selectedRevisionId })}
        {...(selectedCommentId === undefined ? {} : { selectedCommentId })}
        filter={state.filter}
        shown={filtered.edits.length}
        total={filtered.total}
        onView={setView}
        onSelectChapter={(id) => actions.selectChapter(id)}
        onSelect={(selection) => actions.select(selection)}
        onFilter={(filter) => actions.setFilter(filter)}
        onClear={() => actions.clearSelection()}
      />

      <PaneResizer
        side="left"
        width={panes.left}
        min={PANE_MIN}
        max={PANE_MAX}
        label={cs.layout.resizeLeft}
        onResize={paneActions.setLeft}
        onReset={() => paneActions.reset('left')}
      />

      <main className="pane pane--document">
        {state.chapter === undefined ? (
          <div className="status">{state.chapterLoading ? cs.status.loading : ''}</div>
        ) : (
          <DocumentView
            chapter={state.chapter}
            index={index}
            mode={state.mode}
            selection={state.selection}
            {...(resolved?.edit === undefined ? {} : { selectedEditId: resolved.edit.id })}
            visibleEditIds={visibleEditIds}
            onSelect={(selection) => actions.select(selection)}
          />
        )}
      </main>

      <PaneResizer
        side="right"
        width={panes.right}
        min={PANE_MIN}
        max={PANE_MAX}
        label={cs.layout.resizeRight}
        onResize={paneActions.setRight}
        onReset={() => paneActions.reset('right')}
      />

      {resolved === undefined ? (
        <aside className="pane pane--right" />
      ) : (
        <Inspector
          index={index}
          resolved={resolved}
          onSelect={(selection) => actions.select(selection)}
        />
      )}
        </>
      )}
    </div>
  );
}
