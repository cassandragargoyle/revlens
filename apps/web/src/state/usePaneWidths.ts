import { useCallback, useMemo, useState } from 'react';

/**
 * How wide the two side columns are, remembered between visits.
 *
 * This is a per-viewer convenience, so it lives in `localStorage` and nowhere else: it is
 * not part of the bundle, it does not belong to the document, and it must never be the
 * reason the page fails to render. Every access is guarded - storage can be absent,
 * blocked, or throw outright in a private window.
 */

export interface PaneWidths {
  readonly left: number;
  readonly right: number;
}

export const PANE_DEFAULTS: PaneWidths = { left: 290, right: 360 };
export const PANE_MIN = 200;
export const PANE_MAX = 720;

const STORAGE_KEY = 'revlens:pane-widths';

export interface PaneWidthActions {
  setLeft(width: number): void;
  setRight(width: number): void;
  reset(side: 'left' | 'right'): void;
}

export function usePaneWidths(): [PaneWidths, PaneWidthActions] {
  const [widths, setWidths] = useState<PaneWidths>(() => read());

  const set = useCallback((side: 'left' | 'right', width: number): void => {
    setWidths((current) => {
      const next = { ...current, [side]: clamp(width) };
      write(next);
      return next;
    });
  }, []);

  const actions = useMemo<PaneWidthActions>(
    () => ({
      setLeft: (width) => set('left', width),
      setRight: (width) => set('right', width),
      reset: (side) => set(side, PANE_DEFAULTS[side]),
    }),
    [set],
  );

  return [widths, actions];
}

function clamp(width: number): number {
  if (!Number.isFinite(width)) return PANE_DEFAULTS.left;
  return Math.min(PANE_MAX, Math.max(PANE_MIN, Math.round(width)));
}

function read(): PaneWidths {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return PANE_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PaneWidths>;
    return {
      left: clamp(parsed.left ?? PANE_DEFAULTS.left),
      right: clamp(parsed.right ?? PANE_DEFAULTS.right),
    };
  } catch {
    // Unreadable or absent storage is not a failure; the defaults are perfectly usable.
    return PANE_DEFAULTS;
  }
}

function write(widths: PaneWidths): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Nothing to do and nothing worth telling the reader: the layout still works, it
    // simply will not be remembered.
  }
}
