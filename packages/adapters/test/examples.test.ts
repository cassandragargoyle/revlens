import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listExamples, readManifest, seedExample, tryExample } from '../src/index.js';

/**
 * The examples, as `Try an Example` uses them.
 *
 * These run the real thing - git included - because what is being checked is precisely
 * that a reader with nothing of their own ends up with a bundle. A mocked git would
 * check that the code calls a function, which is not the claim.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const examples = join(repoRoot, 'examples');

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'revlens-examples-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('the catalogue', () => {
  it('offers every example that carries a manifest', async () => {
    const choices = await listExamples(examples, 'en');

    expect(choices.map((choice) => choice.id)).toEqual([
      '01-revision-round',
      '02-first-bundle',
      '03-loose-ends',
    ]);
    for (const choice of choices) {
      expect(choice.title).not.toBe('');
      expect(choice.description).not.toBe('');
    }
  });

  it('answers in the reader’s language when the example has it', async () => {
    const [first] = await listExamples(examples, 'cs');

    expect(first?.language).toBe('cs');
    expect(first?.languages).toContain('en');
  });

  /**
   * A reader whose editor is in a language nobody wrote the example in is better served
   * by a document in the wrong language than by an empty picker.
   */
  it('falls back to the first language rather than offering nothing', async () => {
    const choices = await listExamples(examples, 'fi');

    expect(choices).toHaveLength(3);
    expect(choices.every((choice) => choice.language === 'en')).toBe(true);
  });

  it('skips a directory that is not an example', async () => {
    expect(await readManifest(join(examples, 'does-not-exist'))).toBeUndefined();
  });
});

describe('seeding', () => {
  it('replays the snapshots with the dates the manifest gives, not the clock', async () => {
    const out = join(workspace, 'seeded');
    const seeded = await seedExample({ example: join(examples, '02-first-bundle'), language: 'en', out });

    expect(seeded.commits).toBe(2);
    expect(seeded.baseline).toBe('baseline');

    const log = execFileSync('git', ['-C', out, 'log', '--format=%ad', '--date=short'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n');
    expect(log).toEqual(['2026-03-09', '2026-03-02']);
  });

  /**
   * `fs.cp` carries the source timestamps across on Windows, and git decides whether to
   * read a file from its size and mtime. A step that rewrites a file to the same length -
   * `03-loose-ends` fixes a one-letter typo - therefore arrives looking untouched, and
   * the commit for it silently had nothing in it until the seeding stamped what it wrote.
   */
  it('commits a step that changes a file without changing its length', async () => {
    const out = join(workspace, 'same-length');
    const seeded = await seedExample({ example: join(examples, '03-loose-ends'), language: 'en', out });

    expect(seeded.commits).toBe(4);

    const subjects = execFileSync('git', ['-C', out, 'log', '--format=%s'], { encoding: 'utf8' })
      .trim()
      .split('\n');
    expect(subjects).toContain('fix a typo in the risk table');
  });

  /**
   * The path is an argument, and silently removing whatever it names is the one mistake
   * here that cannot be undone.
   */
  it('refuses a directory it did not seed', async () => {
    const out = join(workspace, 'not-ours');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'a-file-somebody-cares-about.txt'), 'x', 'utf8');

    await expect(
      seedExample({ example: join(examples, '02-first-bundle'), language: 'en', out }),
    ).rejects.toThrow(/refusing to remove it/);

    expect(await readdir(out)).toContain('a-file-somebody-cares-about.txt');
  });
});

describe('trying an example', () => {
  it('leaves the reader a bundle, the records behind it and the repository', async () => {
    const target = join(workspace, 'try-02');
    const outcome = await tryExample({
      root: examples,
      id: '02-first-bundle',
      language: 'en',
      target,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.out).toBe(join(target, '02-first-bundle.revlens'));
    // The records are copied rather than read where they lie, because the reader is
    // meant to open them - and a file inside an installed application is not one
    // anybody edits.
    expect(await readdir(join(target, 'docs'))).toEqual(['changes', 'comments']);
    expect(await readdir(join(target, 'analysis-repo'))).toContain('analysis');

    const bundle = JSON.parse(await readFile(outcome.out, 'utf8')) as {
      document: { title: string };
      revisions: unknown[];
    };
    expect(bundle.document.title).toBe('Register of data sources');
    expect(bundle.revisions).toHaveLength(1);
  });

  /**
   * `03-loose-ends` exists to show what the report warns about, so a build of it that
   * produced no warnings would mean the example had stopped teaching anything.
   */
  it('builds the awkward example, warnings and all', async () => {
    const outcome = await tryExample({
      root: examples,
      id: '03-loose-ends',
      language: 'en',
      target: join(workspace, 'try-03'),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // A commit nobody wrote an instruction for, and a comment that joins to nothing
    expect(outcome.summary).toMatch(/unexplained\s+1/);
    expect(outcome.summary).toMatch(/comments\s+1 of 2 joined/);
  });

  it('says which example it could not find rather than throwing', async () => {
    const outcome = await tryExample({
      root: examples,
      id: '99-not-an-example',
      language: 'en',
      target: join(workspace, 'try-99'),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.problem).toContain('99-not-an-example');
  });
});
