/**
 * The viewer's palette holds inside a webview, asserted against the stylesheet
 * A host that themes an element the viewer leaves undeclared repaints it from its own theme
 *
 * A webview is not a blank page. Visual Studio Code injects element defaults into every
 * webview it opens - `blockquote` and `code` are painted from the editor theme - and those
 * defaults fill in whatever the viewer did not declare. Under a dark editor theme that put
 * near-black behind the near-black body text: the quoted comment in the inspector was there
 * and could be selected, but not read. The viewer has one theme and it is light, so any
 * element it renders has to say what its own background and colour are.
 *
 * jsdom loads no stylesheet and there is no webview here, so the check is on the text of
 * the stylesheet: every element the viewer renders and a host is known to theme declares
 * `background`, in a rule of its own or in a rule it shares.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

/** Element selectors that a host themes and the viewer renders. */
const THEMED_BY_HOST = ['blockquote', 'code', 'input', 'select'];

/** Declarations of every rule whose selector list contains exactly `selector`. */
function declarationsFor(selector: string): string {
  const found: string[] = [];
  for (const block of css.split('}')) {
    const brace = block.indexOf('{');
    if (brace < 0) continue;
    const selectors = block
      .slice(0, brace)
      .split(',')
      .map((part) => part.replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .map((part) => part.split('\n').pop()?.trim() ?? '');
    if (selectors.includes(selector)) found.push(block.slice(brace + 1));
  }
  return found.join(';').replace(/\/\*[\s\S]*?\*\//g, '');
}

function declares(selector: string, property: string): boolean {
  return declarationsFor(selector)
    .split(';')
    .some((line) => line.slice(0, Math.max(0, line.indexOf(':'))).trim() === property);
}

describe('element defaults a webview host would otherwise supply', () => {
  it.each(THEMED_BY_HOST)('%s declares its own background', (selector) => {
    expect(declares(selector, 'background')).toBe(true);
  });

  it('the inspector quote is drawn on the viewer background, not the host one', () => {
    // The regression: `.verbatim` styled the border and the padding but left the
    // background to the browser, which in a webview means to the editor theme.
    expect(declarationsFor('blockquote')).toContain('transparent');
  });
});
