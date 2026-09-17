/** @vitest-environment jsdom */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { createEmbeddedSource } from '../src/data/source.js';

/**
 * First paint and navigation on the real document, not on the sample.
 *
 * INT-002 asks for first paint under two seconds on the full analysis and navigation
 * without visible lag. The bundle is a build artefact and is not committed, so this
 * measures whatever bundle is present and says plainly when there is none - a green run
 * with nothing measured would be worse than no test.
 *
 *   node apps/cli/bin/revlens.js build --source engagement --repo <analysis> \
 *     --records <engagement> --from <rev> --out out/engagement-1.6.json
 */

const BUNDLE = resolve(process.cwd(), process.env['REVLENS_BENCH_BUNDLE'] ?? 'out/engagement-1.6.json');
const available = existsSync(BUNDLE);

/** jsdom has no layout engine, so it is slower than a browser, not faster. */
const FIRST_PAINT_BUDGET_MS = 2000;
const NAVIGATION_BUDGET_MS = 250;

let bundle: unknown;

beforeAll(() => {
  Element.prototype.scrollIntoView = (): void => undefined;
  if (available) bundle = JSON.parse(readFileSync(BUNDLE, 'utf8'));
});

afterAll(() => {
  cleanup();
});

describe.skipIf(!available)('the full analysis', () => {
  it('paints the first chapter inside the budget', async () => {
    const started = performance.now();
    const { container } = render(<App source={createEmbeddedSource(bundle)} />);
    await waitFor(() => {
      expect(container.querySelector('[data-block]')).not.toBeNull();
    });
    const elapsed = performance.now() - started;

    const blocks = container.querySelectorAll('[data-block]').length;
    console.log(`first paint: ${elapsed.toFixed(0)} ms, ${blocks} blocks rendered`);
    expect(elapsed).toBeLessThan(FIRST_PAINT_BUDGET_MS);
    expect(blocks).toBeGreaterThan(0);
  });

  it('steps between the changes of one revision without visible lag', async () => {
    const { container } = render(<App source={createEmbeddedSource(bundle)} />);
    await waitFor(() => {
      expect(container.querySelector('[data-edit]')).not.toBeNull();
    });

    const first = container.querySelector('[data-edit]');
    await userEvent.click(first as Element);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/edit\//));

    const started = performance.now();
    await userEvent.keyboard('n');
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/edit\//));
    const elapsed = performance.now() - started;

    console.log(`step to the next change of the same revision: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(NAVIGATION_BUDGET_MS);
  });
});

describe.skipIf(available)('without a built bundle', () => {
  it('says which bundle the performance test would have measured', () => {
    console.log(`no bundle at ${BUNDLE}; the performance test measured nothing`);
    expect(available).toBe(false);
  });
});
