import type { ReactElement } from 'react';
import { useRef } from 'react';
import type { ViewMode } from '@revlens/core';
import { cs } from '../strings.js';
import type { RailState } from '../state/useRailState.js';

/**
 * The leftmost column: what the window shows, as against which part of the document.
 *
 * The mode switch is the most-used control in the tool and it used to sit in the middle
 * of the header, between the document title and the build time - read once and then
 * ignored, all of it, except the one thing a reader touches on every second paragraph.
 * A rail grows downwards instead of sideways, so the switch keeps a fixed place and the
 * header stops competing with it for one line.
 *
 * These four entries change how the text is rendered, and carry nothing underneath them.
 * Kapitoly, Revize and Připomínky are a different kind of choice - which way into the
 * document the reader takes - and they keep their column, their filter and their counts.
 */

export interface RailProps {
  readonly mode: ViewMode;
  /** Whether the about page is the thing on screen; it is a toggle, not a fourth mode. */
  readonly about: boolean;
  readonly state: RailState;
  /** Only a served bundle has an adapter behind it to run again. */
  readonly canRebuild: boolean;
  onMode(mode: ViewMode): void;
  onAbout(): void;
  onToggle(): void;
  onRebuild(): void;
}

const MODES: readonly ViewMode[] = ['clean', 'review', 'baseline'];

export function Rail(props: RailProps): ReactElement {
  const { mode, about, state, canRebuild, onMode, onAbout, onToggle, onRebuild } = props;
  const nav = useRef<HTMLElement>(null);
  const wide = state === 'wide';

  // The entries are a vertical list, so the vertical arrows walk them. Home and End go to
  // the ends, as they do in every other list a reader meets.
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const entries = [...(nav.current?.querySelectorAll<HTMLButtonElement>('[data-rail-entry]') ?? [])];
    if (entries.length === 0) return;
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;

    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? entries.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length;
    entries[next]?.focus();
  };

  return (
    <nav
      ref={nav}
      className={`rail rail--${state}`}
      aria-label={cs.rail.label}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="rail__toggle"
        aria-expanded={wide}
        aria-label={wide ? cs.rail.collapse : cs.rail.expand}
        title={wide ? cs.rail.collapse : cs.rail.expand}
        onClick={onToggle}
      >
        <ToggleIcon wide={wide} />
      </button>

      <div className="rail__group" role="group" aria-label={cs.mode.label}>
        {MODES.map((entry) => (
          <button
            key={entry}
            type="button"
            className="rail__entry"
            data-rail-entry=""
            data-mode={entry}
            aria-pressed={!about && mode === entry}
            title={cs.mode[`${entry}Hint`]}
            onClick={() => onMode(entry)}
          >
            <ModeIcon mode={entry} />
            <span className="rail__label">{cs.mode[entry]}</span>
          </button>
        ))}
      </div>

      {/* Decorative: the group above it is already named, so it is not a separator a
          screen reader has to announce. */}
      <hr className="rail__divider" aria-hidden="true" />

      <button
        type="button"
        className="rail__entry"
        data-rail-entry=""
        aria-pressed={about}
        title={cs.about.open}
        onClick={onAbout}
      >
        <AboutIcon />
        <span className="rail__label">{cs.about.open}</span>
      </button>

      {canRebuild && (
        // An action, not a state: it runs the adapter again and nothing stays pressed.
        <button
          type="button"
          className="rail__entry"
          data-rail-entry=""
          title={cs.rail.rebuildHint}
          onClick={onRebuild}
        >
          <RebuildIcon />
          <span className="rail__label">{cs.rail.rebuild}</span>
        </button>
      )}
    </nav>
  );
}

/*
 * The icons are inline SVG in the viewer's own source: the static export and the editor
 * webview have to keep working offline, so nothing here may be fetched. Each is
 * aria-hidden - the accessible name comes from the label beside it, which the narrow
 * state hides from the eye but not from a screen reader.
 */

function ModeIcon({ mode }: { mode: ViewMode }): ReactElement {
  if (mode === 'clean') {
    // Four clean lines of text: the final text, with nothing marked on it.
    return (
      <Glyph>
        <path d="M4 5h12M4 9h12M4 13h12M4 17h7" />
      </Glyph>
    );
  }
  if (mode === 'review') {
    // The same lines with a proofreader's mark drawn across them: the marked-up text.
    return (
      <Glyph>
        <path d="M4 5h12M4 9h12M4 13h12M4 17h7" />
        <path d="M15.5 3.5L6 18" />
      </Glyph>
    );
  }
  // A counter-clockwise arrow around a dial: the text as the reviewers received it.
  return (
    <Glyph>
      <path d="M4 10a6 6 0 1 1 1.8 4.3" />
      <path d="M4 6.5V10h3.5" />
      <path d="M10 7v3.2l2.2 1.5" />
    </Glyph>
  );
}

function AboutIcon(): ReactElement {
  return (
    <Glyph>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v5" />
      <path d="M10 6.2v.1" />
    </Glyph>
  );
}

function RebuildIcon(): ReactElement {
  // Two chasing arrows: the same records, read again.
  return (
    <Glyph>
      <path d="M4 10a6 6 0 0 1 10.2-4.2" />
      <path d="M16 10a6 6 0 0 1-10.2 4.2" />
      <path d="M14.4 2.6v3.4H11" />
      <path d="M5.6 17.4V14H9" />
    </Glyph>
  );
}

function ToggleIcon({ wide }: { wide: boolean }): ReactElement {
  // A panel with its edge marked, and a chevron pointing the way the rail will move.
  return (
    <Glyph>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M8 4v12" />
      <path d={wide ? 'M13.5 8.5L11.5 10l2 1.5' : 'M11.5 8.5l2 1.5-2 1.5'} />
    </Glyph>
  );
}

function Glyph({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <svg
      className="rail__icon"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
