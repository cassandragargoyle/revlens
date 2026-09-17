import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cs } from '../strings.js';

/**
 * Dragging the boundary between the panes.
 *
 * The three columns started at fixed widths, which is wrong for a tool whose left column
 * holds anything from a five-word chapter title to a three-line comment summary: the
 * reader has to be able to give the list room and take it back.
 *
 * The handle is a real separator, not just a hit area - it takes focus and the arrow keys
 * move it, because a pointer drag is not available to everyone and a width is exactly the
 * kind of setting that otherwise becomes unreachable.
 */

export interface PaneResizerProps {
  /** Which edge this handle sits on; a left pane grows as the pointer moves right. */
  readonly side: 'left' | 'right';
  readonly width: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  onResize(width: number): void;
  onReset(): void;
}

const KEYBOARD_STEP = 16;

export function PaneResizer(props: PaneResizerProps): ReactElement {
  const { side, width, min, max, label, onResize, onReset } = props;
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; width: number }>({ x: 0, width });

  const clamp = useCallback(
    (value: number): number => Math.min(max, Math.max(min, Math.round(value))),
    [min, max],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    origin.current = { x: event.clientX, width };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    const delta = event.clientX - origin.current.x;
    // The right pane grows when the pointer moves left, so its delta is inverted.
    onResize(clamp(origin.current.width + (side === 'left' ? delta : -delta)));
  };

  const stop = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // While dragging, the pointer is over the document text; without this it selects it.
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [dragging]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';

    if (event.key === grow) {
      event.preventDefault();
      onResize(clamp(width + KEYBOARD_STEP));
      return;
    }
    if (event.key === shrink) {
      event.preventDefault();
      onResize(clamp(width - KEYBOARD_STEP));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onReset();
    }
  };

  return (
    <div
      className={`resizer resizer--${side}${dragging ? ' resizer--dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={cs.layout.resizeHint}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  );
}
