import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The three columns, asserted against the stylesheet.
 *
 * jsdom has no layout engine, so nothing in this suite can see where the grid actually
 * puts a pane - which is why a real regression got through. The resizers carried a
 * definite row and an automatic column; grid places such items in an earlier pass than
 * fully automatic ones, so the two handles claimed columns 1 and 2 and pushed the three
 * panes one place right, leaving the document in a four-pixel column with nothing
 * readable in it.
 *
 * What can be checked is the invariant that broke: **every child of the second row names
 * its own column**, so placement never depends on the order of the auto-placement passes.
 */

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

/** Declarations of the rule whose selector list contains exactly `selector`. */
function rule(selector: string): string {
  const blocks = css.split('}');
  for (const block of blocks) {
    const brace = block.indexOf('{');
    if (brace < 0) continue;
    const selectors = block
      .slice(0, brace)
      .split(',')
      .map((part) => part.replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .map((part) => part.split('\n').pop()?.trim() ?? '');
    if (selectors.includes(selector)) return block.slice(brace + 1);
  }
  throw new Error(`no rule for ${selector}`);
}

function declaration(selector: string, property: string): string | undefined {
  // Comments sit between declarations and would otherwise be read as part of the next
  // property name.
  const body = rule(selector).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of body.split(';')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    if (line.slice(0, colon).trim() === property) return line.slice(colon + 1).trim();
  }
  return undefined;
}

describe('the grid', () => {
  it('declares six columns: rail, pane, handle, document, handle, pane', () => {
    const columns = declaration('.app', 'grid-template-columns');
    expect(columns).toBe(
      'var(--rail) var(--pane-left, 290px) 4px minmax(0, 1fr) 4px var(--pane-right, 360px)',
    );
  });

  it('gives every child of the second row an explicit column', () => {
    // Order matters and must not be left to auto-placement.
    expect(declaration('.rail', 'grid-column')).toBe('1');
    expect(declaration('.pane--left', 'grid-column')).toBe('2');
    expect(declaration('.resizer--left', 'grid-column')).toBe('3');
    expect(declaration('.pane--document', 'grid-column')).toBe('4');
    expect(declaration('.resizer--right', 'grid-column')).toBe('5');
    expect(declaration('.pane--right', 'grid-column')).toBe('6');
  });

  it('keeps the document in the column that can actually grow', () => {
    // Column 4 is the `minmax(0, 1fr)`; columns 3 and 5 are four pixels wide.
    expect(declaration('.pane--document', 'grid-column')).toBe('4');
  });

  it('gives the rail two widths and no handle', () => {
    // A dragged width would have no icons-only state, so the two are named here and the
    // container picks one; nothing sets `--rail` from JavaScript.
    expect(declaration('.app', '--rail')).toBe('48px');
    expect(declaration(".app[data-rail='wide']", '--rail')).toBe('184px');
    expect(css).not.toContain('.resizer--rail');
  });

  it('spans the header across all of them and leaves the rail beside the about page', () => {
    expect(declaration('.app__header', 'grid-column')).toBe('1 / -1');
    // The about page starts after the rail: the entry that opened it has to keep showing
    // that it is open.
    expect(declaration('.about', 'grid-column')).toBe('2 / -1');
  });

  it('puts the rail, the panes, the handles and the about page on the same row', () => {
    for (const selector of [
      '.rail',
      '.pane--left',
      '.resizer',
      '.pane--document',
      '.pane--right',
      '.about',
    ]) {
      expect(declaration(selector, 'grid-row'), selector).toBe('2');
    }
  });

  it('hides the rail in print, as it hides the other chrome', () => {
    const print = css.slice(css.indexOf('@media print'));
    expect(declaration('.rail', 'display')).toBe('flex');
    expect(print).toContain('.rail,');
  });
});
