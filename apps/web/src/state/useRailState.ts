import { useCallback, useMemo, useState } from 'react';

/**
 * Whether the rail shows its labels, remembered between visits.
 *
 * The same rules as the pane widths next door: a per-viewer convenience that lives in
 * `localStorage` and nowhere else, with every access guarded, because storage can be
 * absent, blocked, or throw outright in a private window. It must never be the reason the
 * page fails to render.
 *
 * The default is narrow. The viewer's whole point is the document, and the editor webview
 * is routinely half a screen wide - opening with two columns of chrome in front of the
 * text spends width the chrome has not earned.
 */

export type RailState = 'narrow' | 'wide';

export const RAIL_DEFAULT: RailState = 'narrow';

const STORAGE_KEY = 'revlens:rail';

export interface RailActions {
  toggle(): void;
  set(state: RailState): void;
}

export function useRailState(): [RailState, RailActions] {
  const [state, setState] = useState<RailState>(() => read());

  const set = useCallback((next: RailState): void => {
    setState(() => {
      write(next);
      return next;
    });
  }, []);

  const actions = useMemo<RailActions>(
    () => ({
      set,
      toggle: () => setState((current) => {
        const next = current === 'narrow' ? 'wide' : 'narrow';
        write(next);
        return next;
      }),
    }),
    [set],
  );

  return [state, actions];
}

function read(): RailState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'wide' || raw === 'narrow' ? raw : RAIL_DEFAULT;
  } catch {
    // Unreadable or absent storage is not a failure; the default is perfectly usable.
    return RAIL_DEFAULT;
  }
}

function write(state: RailState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, state);
  } catch {
    // Nothing worth telling the reader: the rail still works, it simply will not be
    // remembered.
  }
}
