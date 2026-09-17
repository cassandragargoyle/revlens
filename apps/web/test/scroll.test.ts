/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollIntoViewWhenStable } from '../src/scroll.js';

/**
 * INT-003: the scroll had to survive the relayout it causes.
 *
 * A block that has never been on screen is not laid out, so the first scroll aims at an
 * estimate; rendering then replaces the estimates and the document slides underneath. The
 * fix is to repeat the scroll until the target stops moving, which is what these tests
 * drive - a stub element that reports a different position on each of the first few
 * frames, exactly as a virtualized document does.
 */

let frame = 0;
const queue: FrameRequestCallback[] = [];

function runFrames(count: number): void {
  for (let i = 0; i < count; i += 1) {
    const next = queue.shift();
    if (next === undefined) return;
    next(frame++);
  }
}

function element(tops: number[]): { node: Element; calls: ScrollIntoViewOptions[] } {
  const calls: ScrollIntoViewOptions[] = [];
  let call = 0;
  const node = {
    isConnected: true,
    scrollIntoView: (options: ScrollIntoViewOptions) => {
      calls.push(options);
    },
    getBoundingClientRect: () => {
      const top = tops[Math.min(call, tops.length - 1)] ?? 0;
      call += 1;
      return { top } as DOMRect;
    },
  } as unknown as Element;
  return { node, calls };
}

beforeEach(() => {
  frame = 0;
  queue.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scrollIntoViewWhenStable', () => {
  it('scrolls instantly, never smoothly - an animation cannot outrun a relayout', () => {
    const { node, calls } = element([100, 100, 100]);
    scrollIntoViewWhenStable(node);
    runFrames(5);

    expect(calls.length).toBeGreaterThan(0);
    for (const options of calls) expect(options.behavior).toBe('auto');
    expect(calls[0]?.block).toBe('center');
  });

  it('keeps scrolling while the target is still moving under it', () => {
    // Four frames of drift, then settled: exactly what a virtualized chapter does.
    const { node, calls } = element([900, 620, 310, 140, 140, 140]);
    scrollIntoViewWhenStable(node);
    runFrames(10);

    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it('stops once the position repeats, rather than spinning', () => {
    const { node, calls } = element([200, 200, 200, 200, 200, 200, 200, 200]);
    scrollIntoViewWhenStable(node);
    runFrames(10);

    // First frame, then two that show no movement.
    expect(calls).toHaveLength(3);
    expect(queue).toHaveLength(0);
  });

  it('gives up on a page that never settles', () => {
    const tops = Array.from({ length: 60 }, (_value, i) => i * 37);
    const { node, calls } = element(tops);
    scrollIntoViewWhenStable(node);
    runFrames(60);

    expect(calls.length).toBeLessThanOrEqual(20);
    expect(queue).toHaveLength(0);
  });

  it('stops when the caller cancels, so a new selection does not fight the old one', () => {
    const { node, calls } = element([500, 400, 300, 200, 100]);
    const cancel = scrollIntoViewWhenStable(node);
    runFrames(1);
    const afterFirst = calls.length;

    cancel();
    runFrames(5);
    expect(calls).toHaveLength(afterFirst);
  });

  it('does nothing for an element that has left the document', () => {
    const { node, calls } = element([100]);
    Object.defineProperty(node, 'isConnected', { value: false });
    scrollIntoViewWhenStable(node);
    runFrames(3);
    expect(calls).toHaveLength(0);
  });

  it('falls back to one plain scroll where there are no animation frames', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const { node, calls } = element([100]);
    scrollIntoViewWhenStable(node);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.behavior).toBe('auto');
  });
});
