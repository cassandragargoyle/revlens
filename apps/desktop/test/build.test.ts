import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bundle } from '@revlens/core';
import { serializeBundle } from '@revlens/core';
import { buildBundle, engagementAdapter } from '@revlens/adapters';
import type { Engagement } from '../../../packages/adapters/test/helpers/repository.js';
import {
  commit,
  createEngagement,
  write,
  writeStructure,
} from '../../../packages/adapters/test/helpers/repository.js';
import { gitVersion, listSources, missingGitMessage, runBuild } from '../src/build.js';

/**
 * Building from the window runs what `revlens build` runs.
 *
 * The point of the test is the last claim of INT-004: the file the application writes is
 * the file the command line writes. It is checked against a real repository rather than
 * against a mock, because the thing that could differ - how the bundle is serialised -
 * only exists once a bundle has been built.
 */

let engagement: Engagement;

beforeAll(async () => {
  engagement = await createEngagement();

  await writeStructure(engagement, [
    { id: 'ch-01', number: '1', file: 'chapters/01-shrnuti.md', title: 'Manažerské shrnutí' },
  ]);
  await write(
    engagement,
    'analysis/chapters/01-shrnuti.md',
    ['## 1 Manažerské shrnutí', '', 'Analýza popisuje stav přípravy.', ''].join('\n'),
  );
  commit(engagement, 'baseline v1.0');

  await write(
    engagement,
    'analysis/chapters/01-shrnuti.md',
    ['## 1 Manažerské shrnutí', '', 'Analýza popisuje stav přípravy centra.', ''].join('\n'),
  );
  commit(engagement, 'upresneni vety');
});

afterAll(() => {
  engagement.dispose();
});

describe('listSources', () => {
  it('offers the adapters the build knows, which is what `revlens sources` prints', () => {
    expect(listSources().map((source) => source.name)).toContain('engagement');
  });
});

describe('when git is not there', () => {
  it('reports nothing rather than throwing', async () => {
    expect(await gitVersion('revlens-no-such-program')).toBeUndefined();
  });

  it('finds the git this repository is read with', async () => {
    expect(await gitVersion()).toMatch(/^git version/);
  });

  it('names what is missing, where to get it, and what still works without it', () => {
    const message = missingGitMessage();

    expect(message.problem).toContain('git');
    expect(message.detail.join(' ')).toContain('https://git-scm.com/downloads');
    expect(message.detail.join(' ')).toContain('Opening a bundle that has already been built');
  });
});

describe('runBuild', () => {
  it('names the sources it knows when asked for one it does not', async () => {
    const outcome = await runBuild({
      source: 'ooxml',
      repo: engagement.repo,
      from: 'HEAD',
      out: join(engagement.root, 'never-written.revlens'),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toContain('ooxml');
    expect(outcome.detail.join(' ')).toContain('engagement');
  });

  it('asks for a baseline instead of guessing one', async () => {
    const outcome = await runBuild({
      source: 'engagement',
      repo: engagement.repo,
      from: '   ',
      out: join(engagement.root, 'never-written.revlens'),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toContain('baseline');
  });

  it('explains a repository it cannot walk, rather than failing silently', async () => {
    const outcome = await runBuild({
      source: 'engagement',
      repo: join(engagement.root, 'not-a-repository'),
      from: 'HEAD',
      out: join(engagement.root, 'never-written.revlens'),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toHaveLength(1);
  });

  it('writes the bytes `revlens build` writes, from the same inputs', async () => {
    const out = join(engagement.root, 'round.revlens');
    const outcome = await runBuild({
      source: 'engagement',
      repo: engagement.repo,
      from: engagement.commits[0] ?? 'HEAD',
      records: engagement.root,
      out,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const written = await readFile(out, 'utf8');
    const parsed = JSON.parse(written) as Bundle;

    // The indentation and the trailing newline are the contract, and they come from the
    // one serializer in `core` that the command line also writes through.
    expect(written).toBe(serializeBundle(parsed));

    const viaCommandLine = await buildBundle(engagementAdapter, {
      repo: engagement.repo,
      from: engagement.commits[0] ?? 'HEAD',
      records: engagement.root,
    });

    // Everything but the moment of the build, which is a fact about the run.
    expect(withoutGeneratedAt(parsed)).toEqual(withoutGeneratedAt(viaCommandLine.bundle));
    expect(parsed.document.generator).toBe(viaCommandLine.bundle.document.generator);
  });

  it('reports the build the way `revlens build` prints it', async () => {
    const outcome = await runBuild({
      source: 'engagement',
      repo: engagement.repo,
      from: engagement.commits[0] ?? 'HEAD',
      records: engagement.root,
      out: join(engagement.root, 'again.revlens'),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.summary).toContain('unexplained');
    expect(outcome.report.commits).toBeGreaterThan(0);
  });
});

function withoutGeneratedAt(bundle: Bundle): unknown {
  return { ...bundle, document: { ...bundle.document, generated: undefined } };
}
