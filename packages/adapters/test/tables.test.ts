/**
 * Tables keep their cells from the parse to the bundle, and are diffed cell by cell
 * The cases of INT-006: one cell edited, a row added and removed, the columns changed
 */

import { describe, expect, it } from 'vitest';
import type { Block, Chapter, Run } from '@revlens/core';
import { BundleIndex, tableRows, textForMode, validateBundle } from '@revlens/core';
import { buildBundle, engagementAdapter } from '../src/index.js';
import { EditKeyFactory } from '../src/blame/attribution.js';
import type { PendingEdit } from '../src/blame/attribution.js';
import {
  applyChapterRevision,
  createChapterState,
  emitChapter,
} from '../src/blame/chapter-blame.js';
import { parseChapter } from '../src/markdown/parse-blocks.js';
import {
  commit,
  createEngagement,
  shortHash,
  write,
  writeRecords,
  writeStructure,
} from './helpers/repository.js';

const BASELINE = [
  '| Pole    | Kdy použít |',
  '| ------- | ---------- |',
  '| Created | Vždy       |',
  '| Author  | Vždy       |',
  '',
].join('\n');

/** Build the chapter from its versions in order, each one a revision R-00n */
function history(versions: readonly string[]): { chapter: Chapter; edits: PendingEdit[] } {
  const [first, ...rest] = versions;
  const state = createChapterState('ch-01', 'Tabulky', 'ch.md', undefined, parseChapter(first ?? ''));
  const keys = new EditKeyFactory();
  const edits: PendingEdit[] = [];
  rest.forEach((markdown, i) => {
    edits.push(...applyChapterRevision(state, parseChapter(markdown), `R-00${i + 1}`, keys).edits);
  });
  // The keys double as the ids, which is all the emitted runs need
  const ids = new Map(edits.map((edit) => [edit.key, edit.key]));
  return { chapter: emitChapter(state, ids), edits };
}

function tables(chapter: Chapter): Block[] {
  return chapter.blocks.filter((block) => block.kind === 'table');
}

/** The table as cell texts in review mode, with each run's kind so a change is visible */
function cells(block: Block | undefined): string[][] {
  if (block === undefined) throw new Error('no table block');
  const rows = tableRows(block, 'review');
  if (rows === undefined) throw new Error(`block ${block.id} has no cells`);
  return rows.map((row) => row.map((cell) => cell.map(describeRun).join('')));
}

function describeRun(run: Run): string {
  if (run.kind === 'inserted') return `[+${run.text}]`;
  if (run.kind === 'deleted') return `[-${run.text}]`;
  return run.text;
}

describe('parsing a table', () => {
  it('keeps the cells apart instead of running them together', () => {
    const [block] = parseChapter(BASELINE);
    expect(block?.kind).toBe('table');
    expect(block?.table).toEqual({
      columns: 2,
      cells: ['Pole', 'Kdy použít', 'Created', 'Vždy', 'Author', 'Vždy'],
    });
    expect(block?.text).not.toContain('PoleKdy');
  });

  it('pads a short row and drops the cells beyond the header, as GFM does', () => {
    const [block] = parseChapter(
      ['| A | B |', '| - | - |', '| jen jedna |', '| 1 | 2 | 3 |', ''].join('\n'),
    );
    expect(block?.table?.cells).toEqual(['A', 'B', 'jen jedna', '', '1', '2']);
  });
});

describe('a table in the bundle', () => {
  it('cuts its runs into cells, one kept run for a cell nobody touched', () => {
    const { chapter } = history([BASELINE]);
    const [block] = tables(chapter);
    expect(block?.table).toEqual({ columns: 2, cellRunCounts: [1, 1, 1, 1, 1, 1] });
    expect(cells(block)).toEqual([
      ['Pole', 'Kdy použít'],
      ['Created', 'Vždy'],
      ['Author', 'Vždy'],
    ]);
    expect(textForMode(block as Block, 'clean')).toBe('Pole | Kdy použít\nCreated | Vždy\nAuthor | Vždy');
  });

  it('attributes a change in one cell to that cell only', () => {
    const { chapter, edits } = history([BASELINE, BASELINE.replace('| Author  | Vždy', '| Author  | Jen v revizi')]);
    const [block] = tables(chapter);

    expect(cells(block)).toEqual([
      ['Pole', 'Kdy použít'],
      ['Created', 'Vždy'],
      ['Author', '[-Vždy][+Jen v revizi]'],
    ]);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe('replace');
    // Every changed run belongs to that one edit, so the highlight is the cell
    const changed = block?.runs.filter((run) => run.kind !== 'kept') ?? [];
    expect(changed.every((run) => run.edit === edits[0]?.key)).toBe(true);
  });

  it('keeps a change from an earlier revision in its cell when a later one edits another', () => {
    const second = BASELINE.replace('| Created | Vždy', '| Created | Při založení');
    const third = second.replace('| Pole    |', '| Název pole |');
    const { chapter, edits } = history([BASELINE, second, third]);

    expect(cells(tables(chapter)[0])).toEqual([
      ['[-Pole][+Název pole]', 'Kdy použít'],
      ['Created', '[-Vždy][+Při založení]'],
      ['Author', 'Vždy'],
    ]);
    expect(edits.map((edit) => edit.revision)).toEqual(['R-001', 'R-002']);
  });

  it('adds a row as one edit without shifting the rows below it', () => {
    const added = BASELINE.replace('| Author ', '| Status  | Volitelně  |\n| Author ');
    const { chapter, edits } = history([BASELINE, added]);

    expect(cells(tables(chapter)[0])).toEqual([
      ['Pole', 'Kdy použít'],
      ['Created', 'Vždy'],
      ['[+Status]', '[+Volitelně]'],
      ['Author', 'Vždy'],
    ]);
    expect(edits.map((edit) => edit.kind)).toEqual(['insert']);
  });

  it('keeps a removed row struck through, and leaves it out of the final text', () => {
    const removed = BASELINE.replace('| Created | Vždy       |\n', '');
    const { chapter, edits } = history([BASELINE, removed]);
    const [block] = tables(chapter);

    expect(cells(block)).toEqual([
      ['Pole', 'Kdy použít'],
      ['[-Created]', '[-Vždy]'],
      ['Author', 'Vždy'],
    ]);
    expect(edits.map((edit) => edit.kind)).toEqual(['delete']);
    expect(tableRows(block as Block, 'clean')).toHaveLength(2);
    expect(tableRows(block as Block, 'baseline')).toHaveLength(3);
  });

  it('drops a row that was added and removed again before the reader saw it', () => {
    const added = BASELINE.replace('| Author ', '| Status  | Volitelně  |\n| Author ');
    const { chapter } = history([BASELINE, added, BASELINE]);
    expect(cells(tables(chapter)[0])).toEqual([
      ['Pole', 'Kdy použít'],
      ['Created', 'Vždy'],
      ['Author', 'Vždy'],
    ]);
  });

  it('rewrites the block when the columns changed, rather than aligning the cells', () => {
    const widened = [
      '| Pole    | Kdy použít | Poznámka |',
      '| ------- | ---------- | -------- |',
      '| Created | Vždy       |          |',
      '| Author  | Vždy       |          |',
      '',
    ].join('\n');
    const { chapter, edits } = history([BASELINE, widened]);
    const old = tables(chapter).find((block) => block.removedBy !== undefined);
    const current = tables(chapter).find((block) => block.removedBy === undefined);

    expect(edits.map((edit) => edit.kind).sort()).toEqual(['delete-block', 'insert-block']);
    expect(old?.removedBy).toBe('R-001');
    expect(old?.table?.columns).toBe(2);
    expect(current?.introducedBy).toBe('R-001');
    expect(current?.table?.columns).toBe(3);
  });
});

describe('building a bundle with a table from a git history', () => {
  it('writes cells that validate, and an edit that names the revision behind the cell', async () => {
    const engagement = await createEngagement();
    try {
      const file = 'analysis/chapters/01-pole.md';
      await writeStructure(engagement, [
        { id: 'ch-01', number: '1', file: 'chapters/01-pole.md', title: 'Pole' },
      ]);
      await write(engagement, file, `## 1 Pole\n\n${BASELINE}`);
      commit(engagement, 'baseline');
      await write(
        engagement,
        file,
        `## 1 Pole\n\n${BASELINE.replace('| Author  | Vždy', '| Author  | Jen v revizi')}`,
      );
      commit(engagement, 'autor jen v revizi');
      await writeRecords(engagement, 'v1.2', [
        {
          id: 'IN-001',
          revision: shortHash(engagement, 1),
          received: '2026-09-21 10:00',
          author: 'Jan Novák',
          summary: 'Autor se uvádí jen v revizi',
          verbatim: 'autora uváděj jen v revizi',
          targets: [file],
        },
      ]);

      const { bundle } = await buildBundle(engagementAdapter, {
        repo: engagement.repo,
        from: engagement.commits[0] ?? 'HEAD',
        records: engagement.root,
      });

      expect(validateBundle(bundle, { strict: true }).issues).toEqual([]);
      const index = new BundleIndex(bundle);
      const table = bundle.chapters[0]?.blocks.find((block) => block.kind === 'table');
      expect(cells(table)).toEqual([
        ['Pole', 'Kdy použít'],
        ['Created', 'Vždy'],
        ['Author', '[-Vždy][+Jen v revizi]'],
      ]);
      const [edit] = bundle.edits;
      expect(bundle.edits).toHaveLength(1);
      expect(index.getRevision(edit?.revision ?? '')?.title).toBe('Autor se uvádí jen v revizi');
      expect(edit?.insertedChars).toBe('Jen v revizi'.length);
    } finally {
      engagement.dispose();
    }
  }, 60_000);
});
