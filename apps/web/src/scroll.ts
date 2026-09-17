/**
 * Scrolling that survives the relayout it causes.
 *
 * Blocks are virtualized with `content-visibility: auto`, so a block that has never been
 * on screen is not laid out and stands in at its intrinsic placeholder height. The offset
 * of a target deep in a chapter is therefore computed from the guessed heights of
 * everything above it; the browser then renders what the scroll brought into view,
 * replaces the guesses with real heights, and the document slides under the scroll
 * position. The further down the chapter the target is, the worse it lands.
 *
 * `behavior: 'smooth'` makes it hopeless: the animation runs while the heights are still
 * being corrected, and where it comes to rest is arbitrary.
 *
 * So the scroll is repeated, instantly, until the element stops moving. Each pass corrects
 * against heights that are more real than the last, and two consecutive frames at the same
 * position mean layout has settled.
 */

/** Frames without movement before the position is taken as settled. */
const STABLE_FRAMES = 2;

/** Upper bound, so a page that never settles cannot spin forever. */
const MAX_FRAMES = 20;

/** Movement below this many pixels between frames counts as none. */
const TOLERANCE = 1;

export interface ScrollOptions {
  readonly block?: ScrollLogicalPosition;
}

/**
 * Bring `node` into view and keep it there while the layout settles.
 *
 * Returns a cancel function; call it when the selection changes, or a scroll for the
 * previous target will fight the new one.
 */
export function scrollIntoViewWhenStable(
  node: Element,
  options: ScrollOptions = {},
): () => void {
  const block = options.block ?? 'center';

  if (typeof node.scrollIntoView !== 'function') return () => undefined;

  // Without animation frames - a test environment, an old browser - one instant scroll is
  // still better than none.
  if (typeof requestAnimationFrame !== 'function') {
    node.scrollIntoView({ block, behavior: 'auto' });
    return () => undefined;
  }

  let cancelled = false;
  let handle = 0;
  let previousTop = Number.NaN;
  let stable = 0;
  let frames = 0;

  const step = (): void => {
    if (cancelled || !node.isConnected) return;

    node.scrollIntoView({ block, behavior: 'auto' });

    const top = node.getBoundingClientRect().top;
    stable = Math.abs(top - previousTop) <= TOLERANCE ? stable + 1 : 0;
    previousTop = top;
    frames += 1;

    if (stable >= STABLE_FRAMES || frames >= MAX_FRAMES) return;
    handle = requestAnimationFrame(step);
  };

  handle = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    if (handle !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  };
}
