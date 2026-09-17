import type { Bundle } from './schema.js';

/**
 * How a bundle is written to a file, decided once
 *
 * Two programs write bundles - `revlens build` and the desktop application - and a
 * reader comparing two files byte for byte is entitled to see the same bytes for the
 * same document. The indentation and the trailing newline are therefore part of the
 * contract, not a detail of whichever writer happened to run.
 */
export function serializeBundle(bundle: Bundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}
