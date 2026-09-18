import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { formatIssue, serializeBundle, validateBundle } from '@revlens/core';
import type { BuildReport, BuildResult } from './build.js';
import { buildBundle } from './build.js';
import { findSourceAdapter, listSourceAdapters } from './sources/registry.js';
import { formatReport } from './report.js';

/**
 * Building a bundle from a host, by running what `revlens build` runs
 *
 * The adapter is imported, not shelled out to. A packaged host cannot assume a checkout,
 * an npm and a `tsx` on the machine, and this is an ordinary Node module in an ordinary
 * Node process - so every host takes the same code path the command line does, and
 * `serializeBundle` gives all of them the same bytes.
 *
 * It lives here rather than in one host because it has three callers: the desktop window,
 * the editor extension (portunix-vscode #121) and, through them, anything else that grows
 * a build button. The rule is the one `packages/viewer-page` already follows - a thing two
 * hosts need is written once, in a package, not copied into each of them.
 *
 * What it cannot import is git. That stays a program on the PATH, and its absence is a
 * message naming what is missing and where to get it, not a stack trace.
 */

const run = promisify(execFile);

export interface BuildRequest {
  readonly source: string;
  readonly repo: string;
  readonly from: string;
  readonly to?: string;
  readonly records?: string;
  readonly threshold?: number;
  /** Where to write the bundle; the reader picked it in a save dialog. */
  readonly out: string;
}

export interface BuildSucceeded {
  readonly ok: true;
  readonly out: string;
  /** The report, formatted the way `revlens build` prints it. */
  readonly summary: string;
  readonly report: BuildReport;
  readonly warnings: readonly string[];
}

export interface BuildFailed {
  readonly ok: false;
  readonly problem: string;
  readonly detail: readonly string[];
}

export type BuildOutcome = BuildSucceeded | BuildFailed;

/** How many invariant failures are worth showing before the list stops being read. */
const MAX_REPORTED_ISSUES = 25;

export function listSources(): readonly { name: string; description: string }[] {
  return listSourceAdapters().map((adapter) => ({
    name: adapter.name,
    description: adapter.description,
  }));
}

/** The version string git printed, or `undefined` when there is no git to ask. */
export async function gitVersion(command = 'git'): Promise<string | undefined> {
  try {
    const { stdout } = await run(command, ['--version']);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * What the reader is told instead of a stack trace.
 *
 * It names the missing program, says what revlens wanted it for, points at the download,
 * and ends with the reassurance that matters most to somebody who was only sent a file:
 * reading a bundle needs none of this.
 */
export function missingGitMessage(): BuildFailed {
  return {
    ok: false,
    problem: 'git was not found, so there is no history to build a bundle from.',
    detail: [
      'revlens reads a document’s revisions by running git over the repository.',
      'Install git from https://git-scm.com/downloads, then start revlens again.',
      'On Windows the installer offers “Git from the command line” - that option is the one this needs.',
      'Opening a bundle that has already been built does not need git at all.',
    ],
  };
}

export async function runBuild(request: BuildRequest): Promise<BuildOutcome> {
  const adapter = findSourceAdapter(request.source);
  if (adapter === undefined) {
    const known = listSources().map((entry) => entry.name).join(', ');
    return {
      ok: false,
      problem: `There is no source adapter called “${request.source}” in this build.`,
      detail: [`Known sources: ${known}`],
    };
  }

  if ((await gitVersion()) === undefined) return missingGitMessage();

  if (request.from.trim() === '') {
    return {
      ok: false,
      problem: 'A baseline revision is needed before anything can be measured.',
      detail: [
        'The baseline is the build the reviewers received - a tag, a branch or a commit.',
        'Everything the bundle shows is the difference between it and the head revision.',
      ],
    };
  }

  let built: BuildResult;
  try {
    built = await buildBundle(adapter, {
      repo: resolve(request.repo),
      from: request.from,
      ...(request.to === undefined || request.to === '' ? {} : { to: request.to }),
      ...(request.records === undefined || request.records === ''
        ? {}
        : { records: resolve(request.records) }),
      ...(request.threshold === undefined ? {} : { threshold: request.threshold }),
    });
  } catch (error) {
    return {
      ok: false,
      problem: 'The build stopped before it could write anything.',
      detail: [error instanceof Error ? error.message : String(error)],
    };
  }

  const { bundle, report } = built;
  const validation = validateBundle(bundle);
  if (!validation.valid) {
    // The same refusal the command line makes, and for the same reason: a bundle that
    // fails its invariants is a document whose attribution cannot be trusted. There is
    // no `--allow-invalid` here, because nobody debugs an adapter from a window.
    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    return {
      ok: false,
      problem: `The bundle that was built does not satisfy its own invariants (${errors.length} ${
        errors.length === 1 ? 'problem' : 'problems'
      }), so nothing was written.`,
      detail: cap(errors.map(formatIssue)),
    };
  }

  const out = resolve(request.out);
  try {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, serializeBundle(bundle), 'utf8');
  } catch (error) {
    return {
      ok: false,
      problem: `The bundle was built but could not be written to ${out}.`,
      detail: [error instanceof Error ? error.message : String(error)],
    };
  }

  return {
    ok: true,
    out,
    summary: formatReport(report),
    report,
    warnings: cap(validation.issues.filter((issue) => issue.severity === 'warning').map(formatIssue)),
  };
}

function cap(lines: readonly string[]): readonly string[] {
  if (lines.length <= MAX_REPORTED_ISSUES) return lines;
  return [...lines.slice(0, MAX_REPORTED_ISSUES), `... and ${lines.length - MAX_REPORTED_ISSUES} more`];
}
