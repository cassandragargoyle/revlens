// Turning an example into something a first-time reader can open and read
// Writes the records, seeds the repository, builds the bundle - the three steps by hand

import { cp, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gitVersion, missingGitMessage, runBuild } from '../run-build.js';
import { readManifest } from './catalog.js';
import { seedExample, variant } from './seed.js';
import type { TryExampleOutcome, TryExampleRequest } from './types.js';

/**
 * What a reader does before their first build, done for them once so they can read it.
 *
 * The build form asks six questions about a shape nobody has described: a repository of
 * chapters, a change log, comment rounds. This writes one of each into a folder the
 * reader chose and builds the bundle from it, so the answer to "what do I put where" is
 * a directory they can open rather than a paragraph they have to believe.
 *
 * The target is the reader's choice and not a temporary directory on purpose. The point
 * is that they find the material again tomorrow.
 */

/** Where the pieces land under the target, so a reader always finds the same shape. */
const REPOSITORY = 'analysis-repo';

export async function tryExample(request: TryExampleRequest): Promise<TryExampleOutcome> {
  const directory = join(resolve(request.root), request.id);
  const manifest = await readManifest(directory);
  if (manifest === undefined) {
    return {
      ok: false,
      problem: `There is no example called “${request.id}” in this build.`,
      detail: [`Looked in ${directory}`],
    };
  }

  // Asked before anything is written: seeding is the first step and it is git, so the
  // reader hears what is missing instead of watching a directory half fill.
  if ((await gitVersion()) === undefined) return missingGitMessage();

  const language = manifest.languages.includes(request.language)
    ? request.language
    : (manifest.languages[0] ?? 'en');
  const target = resolve(request.target);

  let source: string;
  let repository: string;
  try {
    source = await variant(directory, language);
    await mkdir(target, { recursive: true });
    // The records are copied rather than read where they lie: the reader is meant to
    // open them, edit them and build again, and a file inside an installed application
    // is not something anybody edits.
    await cp(join(source, 'docs'), join(target, 'docs'), { recursive: true });
    const seeded = await seedExample({
      example: source,
      language,
      out: join(target, REPOSITORY),
    });
    repository = seeded.repository;
  } catch (error) {
    return {
      ok: false,
      problem: 'The example could not be written to that folder.',
      detail: [error instanceof Error ? error.message : String(error)],
    };
  }

  const out = join(target, `${request.id}.revlens`);
  const built = await runBuild({
    source: manifest.build.source,
    repo: repository,
    from: manifest.build.from,
    records: target,
    out,
  });

  if (!built.ok) return built;

  return {
    ok: true,
    out: built.out,
    records: target,
    repository,
    summary: built.summary,
    warnings: built.warnings,
  };
}
