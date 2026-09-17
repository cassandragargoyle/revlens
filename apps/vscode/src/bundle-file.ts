import { readFile } from 'node:fs/promises';
import { formatIssue, validateBundle } from '@revlens/core';

/**
 * Opening a bundle file, with the same verdict the CLI would give.
 *
 * The editor validates before it renders, because a bundle that fails its invariants is
 * not a document with a few wrong highlights - it is a document whose attribution cannot
 * be trusted, and showing it anyway would make the tool useless as evidence. `revlens
 * build` refuses to write such a bundle; the editor refuses to display one.
 *
 * The JSON text is carried alongside the parsed value on purpose: the page needs the
 * text, and re-serialising the parsed object would both cost time on a large bundle and
 * risk a copy that differs from the file on disk.
 */

export interface LoadedBundle {
  readonly ok: true;
  /** The file's own text, ready to hand to the page. */
  readonly json: string;
  /** The document title, for the editor tab and the error headings. */
  readonly title: string;
  /** Invariant warnings - a smell, not a defect, so the document still opens. */
  readonly warnings: readonly string[];
}

export interface RejectedBundle {
  readonly ok: false;
  readonly problem: string;
  readonly detail: readonly string[];
}

export type BundleReadResult = LoadedBundle | RejectedBundle;

/** How many issues are worth showing before the list stops being read. */
const MAX_REPORTED_ISSUES = 25;

export function parseBundleText(text: string, fileName: string): BundleReadResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      problem: `${fileName} is not valid JSON.`,
      detail: [error instanceof Error ? error.message : String(error)],
    };
  }

  const result = validateBundle(value);
  const errors = result.issues.filter((issue) => issue.severity === 'error');
  if (!result.valid || result.bundle === undefined) {
    return {
      ok: false,
      problem:
        `${fileName} is not a revision bundle this build can show` +
        ` (${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}).`,
      detail: cap(errors.map(formatIssue)),
    };
  }

  return {
    ok: true,
    json: text,
    title: result.bundle.document.title,
    warnings: cap(result.issues.filter((issue) => issue.severity === 'warning').map(formatIssue)),
  };
}

export async function readBundleFile(fsPath: string, fileName: string): Promise<BundleReadResult> {
  let text: string;
  try {
    text = await readFile(fsPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      problem: `${fileName} could not be read.`,
      detail: [error instanceof Error ? error.message : String(error)],
    };
  }
  return parseBundleText(text, fileName);
}

function cap(lines: readonly string[]): readonly string[] {
  if (lines.length <= MAX_REPORTED_ISSUES) return lines;
  const remaining = lines.length - MAX_REPORTED_ISSUES;
  return [...lines.slice(0, MAX_REPORTED_ISSUES), `... and ${remaining} more`];
}
