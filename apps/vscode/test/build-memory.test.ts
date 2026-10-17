import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answersForBundle,
  answersForRepo,
  defaultOutput,
  memoryStore,
  rememberAnswers,
} from '../src/build-memory.js';
import type { BuildAnswers } from '../src/build-memory.js';

/**
 * What makes the second build a row of Enter presses and a rebuild possible at all: the
 * answers of a build that succeeded, found again by its repository and by its bundle.
 */

const repo = resolve('/work/engagement');
const answers: BuildAnswers = {
  source: 'engagement',
  repo,
  from: 'v1.0',
  records: join(repo, 'docs'),
  out: join(repo, 'out', 'engagement.revlens.json'),
};

describe('defaultOutput', () => {
  it('writes into out/ beside the history, named after the repository', () => {
    expect(defaultOutput(repo)).toBe(join(repo, 'out', 'engagement.revlens.json'));
  });

  it('uses the compound suffix both hosts claim', () => {
    expect(defaultOutput(repo).endsWith('.revlens.json')).toBe(true);
  });
});

describe('remembered answers', () => {
  it('are found again by the repository and by the bundle they wrote', async () => {
    const store = memoryStore();
    await rememberAnswers(store, answers);

    expect(answersForRepo(store, repo)).toEqual(answers);
    expect(answersForBundle(store, answers.out)).toEqual(answers);
  });

  it('are found whatever spelling of the path the host hands over', async () => {
    const store = memoryStore();
    await rememberAnswers(store, answers);

    expect(answersForRepo(store, join(repo, 'docs', '..'))).toEqual(answers);
  });

  it('are absent for a bundle nothing built in this window, so a rebuild offers the form', () => {
    expect(answersForBundle(memoryStore(), answers.out)).toBeUndefined();
  });

  it('follow the latest build of a repository', async () => {
    const store = memoryStore();
    await rememberAnswers(store, answers);
    const later = { ...answers, from: 'v2.0', out: join(repo, 'out', 'second.revlens.json') };
    await rememberAnswers(store, later);

    expect(answersForRepo(store, repo)?.from).toBe('v2.0');
    // The first bundle still rebuilds with what made it, not with what came after
    expect(answersForBundle(store, answers.out)?.from).toBe('v1.0');
  });
});
