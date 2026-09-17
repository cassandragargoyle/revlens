import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bundle, Chapter, EditFilter, Selection, ViewMode } from '@revlens/core';
import {
  BundleIndex,
  DEFAULT_COMMENT_SCOPE,
  NO_SELECTION,
  filterComments,
  filterEdits,
  filterRevisions,
  formatHash,
  isEmptyFilter,
  nextEdit,
  nextEditOfRevision,
  parseHash,
  previousEdit,
  previousEditOfRevision,
  resolveSelection,
} from '@revlens/core';
import type { BundleSource } from '../data/source.js';

/**
 * Everything the viewer knows, in one hook.
 *
 * The navigation and filtering rules are not here - they are in `@revlens/core`, which
 * the server and the MCP tools call too. This hook is the browser's share of the work:
 * what is loaded, what is selected, and how the address bar reflects it.
 */

export interface ViewerState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly error?: string;
  readonly bundle?: Bundle;
  readonly index?: BundleIndex;
  readonly mode: ViewMode;
  readonly filter: EditFilter;
  readonly selection: Selection;
  readonly chapterId?: string;
  readonly chapter?: Chapter;
  readonly chapterLoading: boolean;
  readonly canRebuild: boolean;
}

export interface ViewerActions {
  setMode(mode: ViewMode): void;
  setFilter(filter: EditFilter): void;
  select(selection: Selection): void;
  selectChapter(id: string): void;
  clearSelection(): void;
  step(direction: 1 | -1, scope: 'revision' | 'document'): void;
  rebuild(): void;
  reload(): void;
}

export function useViewer(source: BundleSource): [ViewerState, ViewerActions] {
  const [bundle, setBundle] = useState<Bundle>();
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<ViewMode>('review');
  // Scoped from the start: a bundle carries every comment the engagement ever received,
  // and the wide list buries the ones this comparison is about.
  const [filter, setFilter] = useState<EditFilter>({ scope: DEFAULT_COMMENT_SCOPE });
  const [selection, setSelection] = useState<Selection>(() => readHash());
  const [chapterId, setChapterId] = useState<string>();
  const [chapter, setChapter] = useState<Chapter>();
  const [chapterLoading, setChapterLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const index = useMemo(() => (bundle === undefined ? undefined : new BundleIndex(bundle)), [
    bundle,
  ]);

  // The hash is the address of a selection, and it has to survive a cold load, so it is
  // read before anything else and written on every change.
  useEffect(() => {
    const onHashChange = (): void => setSelection(readHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    source
      .load()
      .then((loaded) => {
        if (!cancelled) setBundle(loaded);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [source, reloadToken]);

  // A selection names a chapter; that chapter is what has to be on screen.
  const resolved = useMemo(
    () => (index === undefined ? undefined : resolveSelection(index, selection)),
    [index, selection],
  );

  const wantedChapter = resolved?.chapterId ?? chapterId ?? bundle?.chapters[0]?.id;

  const loadedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (wantedChapter === undefined || index === undefined) return;
    if (loadedFor.current === wantedChapter && chapter !== undefined) return;

    const known = index.getChapter(wantedChapter);
    if (known !== undefined && known.blocks.length > 0) {
      loadedFor.current = wantedChapter;
      setChapter(known);
      setChapterId(wantedChapter);
      return;
    }

    let cancelled = false;
    setChapterLoading(true);
    source
      .chapter(wantedChapter)
      .then((loaded) => {
        if (cancelled) return;
        loadedFor.current = wantedChapter;
        setChapter(loaded);
        setChapterId(wantedChapter);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (!cancelled) setChapterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [wantedChapter, index, source, chapter, reloadToken]);

  const select = useCallback((next: Selection) => {
    setSelection(next);
    const hash = formatHash(next);
    // `replaceState` rather than assigning `location.hash`, so stepping through a
    // revision with `n` does not fill the back button with fifty entries.
    window.history.replaceState(null, '', hash.length === 0 ? window.location.pathname : hash);
  }, []);

  const actions = useMemo<ViewerActions>(
    () => ({
      setMode,
      setFilter,
      select,
      selectChapter(id: string): void {
        loadedFor.current = undefined;
        setChapter(undefined);
        setChapterId(id);
        select({ kind: 'chapter', id });
      },
      clearSelection(): void {
        select(NO_SELECTION);
      },
      step(direction: 1 | -1, scope: 'revision' | 'document'): void {
        if (index === undefined) return;
        const current = selection.kind === 'edit' ? selection.id : resolved?.edit?.id;

        if (scope === 'revision') {
          if (current === undefined) return;
          const target =
            direction === 1
              ? nextEditOfRevision(index, current)
              : previousEditOfRevision(index, current);
          if (target !== undefined) select({ kind: 'edit', id: target.id });
          return;
        }

        // `j` and `k` walk what the filter admits, so stepping never lands on a change
        // the reader has filtered away.
        const scopeEdits = isEmptyFilter(filter) ? undefined : filterEdits(index, filter);
        const target =
          direction === 1
            ? nextEdit(index, current, true, scopeEdits)
            : previousEdit(index, current, true, scopeEdits);
        if (target !== undefined) select({ kind: 'edit', id: target.id });
      },
      rebuild(): void {
        void source.rebuild().then((done) => {
          if (done) setReloadToken((token) => token + 1);
        });
      },
      reload(): void {
        loadedFor.current = undefined;
        setChapter(undefined);
        setReloadToken((token) => token + 1);
      },
    }),
    [index, selection, resolved, filter, select, source],
  );

  const state: ViewerState = {
    status: error !== undefined ? 'error' : bundle === undefined ? 'loading' : 'ready',
    ...(error === undefined ? {} : { error }),
    ...(bundle === undefined ? {} : { bundle }),
    ...(index === undefined ? {} : { index }),
    mode,
    filter,
    selection,
    ...(wantedChapter === undefined ? {} : { chapterId: wantedChapter }),
    ...(chapter === undefined ? {} : { chapter }),
    chapterLoading,
    canRebuild: source.kind === 'api',
  };

  return [state, actions];
}

/** Revisions the timeline shows, and the changes the filter admits. */
export function useFiltered(index: BundleIndex | undefined, filter: EditFilter) {
  return useMemo(() => {
    if (index === undefined) return { revisions: [], edits: [], comments: [], total: 0 };
    return {
      revisions: filterRevisions(index, filter),
      edits: filterEdits(index, filter),
      comments: filterComments(index, filter),
      total: index.editsInDocumentOrder.length,
    };
  }, [index, filter]);
}

function readHash(): Selection {
  return parseHash(window.location.hash);
}
