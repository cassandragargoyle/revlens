import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bundle } from '@revlens/core';
import { BundleIndex, nextEditOfRevision, validateBundle } from '@revlens/core';
import type { BuildReport } from '../src/index.js';
import { buildBundle, engagementAdapter } from '../src/index.js';
import type { Engagement } from './helpers/repository.js';
import {
  commit,
  createEngagement,
  shortHash,
  write,
  writeCommentRound,
  writeRecords,
  writeStructure,
} from './helpers/repository.js';

/**
 * The builder, end to end, over a fabricated five-commit history.
 *
 * The history is arranged so that each acceptance criterion of INT-002 has a case: one
 * instruction landing in two blocks, one landing in two chapters, and a change from three
 * revisions back that later revisions push further down the paragraph.
 */

const SHRNUTI = 'analysis/chapters/01-shrnuti.md';
const PRODUKTY = 'analysis/chapters/02-produkty.md';

let engagement: Engagement;
let bundle: Bundle;
let report: BuildReport;
let index: BundleIndex;

beforeAll(async () => {
  engagement = await createEngagement();

  await writeStructure(engagement, [
    { id: 'ch-01', number: '1', file: 'chapters/01-shrnuti.md', title: 'Manažerské shrnutí' },
    { id: 'ch-02', number: '2', file: 'chapters/02-produkty.md', title: 'Produkty' },
  ]);

  // The baseline: the build the reviewers received.
  await write(
    engagement,
    SHRNUTI,
    [
      '## 1 Manažerské shrnutí',
      '',
      'Analýza popisuje stav přípravy kompetenčního centra.',
      '',
      'Za oblast Technology odpovídá CTO Martin Svoboda.',
      '',
    ].join('\n'),
  );
  await write(
    engagement,
    PRODUKTY,
    [
      '## 2 Produkty a jejich hranice',
      '',
      '### 2.1 Rodina CORE — jádro a moduly TINA a PARO',
      '',
      '- TINA — evidence majetku',
      '- PARO — odečty a fakturace',
      '',
      'Vlastníkem produktové roadmapy je CTO.',
      '',
    ].join('\n'),
  );
  commit(engagement, 'baseline v1.0');

  // R-001: one insertion inside an existing paragraph.
  await write(
    engagement,
    SHRNUTI,
    [
      '## 1 Manažerské shrnutí',
      '',
      'Acme Systems je česká technologická firma. Analýza popisuje stav přípravy kompetenčního centra.',
      '',
      'Za oblast Technology odpovídá CTO Martin Svoboda.',
      '',
    ].join('\n'),
  );
  commit(engagement, 'doplnena veta o predmetu podnikani');

  // R-002: one instruction, two blocks - a heading and a new list item.
  await write(
    engagement,
    PRODUKTY,
    [
      '## 2 Produkty a jejich hranice',
      '',
      '### 2.1 Rodina CORE — jádro a moduly TINA, PARO a PLAN',
      '',
      '- TINA — evidence majetku',
      '- PARO — odečty a fakturace',
      '- PLAN — plánování investic a jejich realizace',
      '',
      'Vlastníkem produktové roadmapy je CTO.',
      '',
    ].join('\n'),
  );
  commit(engagement, 'doplnen modul PLAN');

  // R-003: one instruction, two chapters - the same job title corrected in both.
  await write(
    engagement,
    SHRNUTI,
    [
      '## 1 Manažerské shrnutí',
      '',
      'Acme Systems je česká technologická firma. Analýza popisuje stav přípravy kompetenčního centra.',
      '',
      'Za oblast Technology odpovídá vedoucí oblasti Technology Martin Svoboda.',
      '',
    ].join('\n'),
  );
  await write(
    engagement,
    PRODUKTY,
    [
      '## 2 Produkty a jejich hranice',
      '',
      '### 2.1 Rodina CORE — jádro a moduly TINA, PARO a PLAN',
      '',
      '- TINA — evidence majetku',
      '- PARO — odečty a fakturace',
      '- PLAN — plánování investic a jejich realizace',
      '',
      'Vlastníkem produktové roadmapy je vedoucí oblasti Technology.',
      '',
    ].join('\n'),
  );
  commit(engagement, 'oprava funkce CTO');

  // R-004: another sentence at the very start, which pushes the R-001 insertion further
  // down the paragraph. This is the case a pairwise diff cannot attribute.
  await write(
    engagement,
    SHRNUTI,
    [
      '## 1 Manažerské shrnutí',
      '',
      'Shrnutí se čte jako první. Acme Systems je česká technologická firma. Analýza popisuje stav přípravy kompetenčního centra.',
      '',
      'Za oblast Technology odpovídá vedoucí oblasti Technology Martin Svoboda.',
      '',
    ].join('\n'),
  );
  commit(engagement, 'uvodni veta shrnuti');

  await writeRecords(engagement, 'v1.2', [
    {
      id: 'IN-041',
      revision: shortHash(engagement, 1),
      received: '2026-09-08 09:14',
      author: 'Jan Novák',
      summary: 'Shrnutí má začít větou o tom, čím se firma zabývá',
      verbatim: 'dej na začátek shrnutí větu o tom, čím se firma zabývá',
      targets: [SHRNUTI],
    },
    {
      id: 'IN-044',
      revision: shortHash(engagement, 2),
      received: '2026-09-10 11:05',
      author: 'Jan Novák',
      summary: 'Doplněn modul PLAN do výčtu modulů nad jádrem CORE',
      verbatim: 'doplň PLAN, podklad ho vede od července (vypořádání K1-002)',
      targets: [PRODUKTY],
    },
    {
      id: 'IN-047',
      revision: shortHash(engagement, 3),
      received: '2026-09-11 16:40',
      author: 'Jan Novák',
      summary: 'Funkce opravena na vedoucí oblasti Technology',
      verbatim: 'oprav to všude, není to CTO (K2-004)',
      targets: [SHRNUTI, PRODUKTY],
    },
    {
      id: 'IN-049',
      revision: shortHash(engagement, 4),
      received: '2026-09-12 08:20',
      author: 'Jan Novák',
      summary: 'Do shrnutí doplněna úvodní věta',
      verbatim: 'shrnutí ať začíná tím, jak se má číst',
      targets: [SHRNUTI],
    },
  ]);

  await writeCommentRound(engagement, 'K1-20260909-dvorakova', {
    round: {
      id: 'K1',
      author: 'Petra Dvořáková',
      role: 'garantka produktové oblasti; vede portfolio modulů',
      received: '2026-09-09T07:42:00+02:00',
      reviewed_version: '1.0',
    },
    comments: [
      {
        id: 'K1-002',
        scope: ['ch-02'],
        priority: 'P1',
        verbatim: 'Chybí zde PLAN — plánování investic a jejich realizace.',
        summary: 'Výčet modulů nad jádrem CORE vynechává modul PLAN.',
        check: { verdict: 'potvrzeno', evidence: ['kapitola 2.1'] },
        decision: { status: 'prijato', by: 'Jan Novák', at: '2026-09-10' },
        resolution: { state: 'hotovo', changes: ['02-produkty.md :: doplněn PLAN'] },
      },
    ],
  });

  await writeCommentRound(engagement, 'K2-20260910-svoboda', {
    round: {
      id: 'K2',
      author: 'Martin Svoboda',
      role: 'vedoucí oblasti Technology',
      received: '2026-09-10T18:03:00+02:00',
      reviewed_version: '1.0',
    },
    comments: [
      {
        id: 'K2-004',
        scope: ['ch-01', 'ch-02'],
        priority: 'P1',
        verbatim: 'Nejsem CTO, jsem vedoucí oblasti Technology.',
        check: { verdict: 'potvrzeno' },
        decision: { status: 'prijato', by: 'Jan Novák', at: '2026-09-11' },
        resolution: { state: 'hotovo', changes: ['01-shrnuti.md', '02-produkty.md'] },
        answer: 'Funkce opravena ve všech kapitolách.',
      },
    ],
  });

  const built = await buildBundle(engagementAdapter, {
    repo: engagement.repo,
    from: engagement.commits[0] ?? 'HEAD',
    records: engagement.root,
  });

  bundle = built.bundle;
  report = built.report;
  index = new BundleIndex(bundle);
}, 60_000);

afterAll(() => {
  engagement?.dispose();
});

describe('the built bundle', () => {
  it('is valid, with no invariant broken and no warning', () => {
    const result = validateBundle(bundle, { strict: true });
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('carries both chapters with their titles and source paths', () => {
    expect(bundle.chapters.map((chapter) => chapter.id)).toEqual(['ch-01', 'ch-02']);
    expect(bundle.chapters[0]?.title).toBe('Manažerské shrnutí');
    expect(bundle.chapters[0]?.source).toBe(SHRNUTI);
  });

  it('takes the document metadata from the analysis', () => {
    expect(bundle.document.title).toBe('Analýza vzorového dokumentu');
    expect(bundle.document.language).toBe('cs');
    expect(bundle.document.baseline?.commit).toBe(engagement.commits[0]);
  });

  it('renders the final text of every block as the head of the repository has it', () => {
    const paragraph = index.getBlock('ch-01/b-02')?.block;
    const finalText = (paragraph?.runs ?? [])
      .filter((run) => run.kind !== 'deleted')
      .map((run) => run.text)
      .join('');
    expect(finalText).toBe(
      'Shrnutí se čte jako první. Acme Systems je česká technologická firma. Analýza popisuje stav přípravy kompetenčního centra.',
    );
  });
});

describe('joining commits to the records', () => {
  it('turns each instruction into a revision with its verbatim', () => {
    const verbatims = bundle.revisions.map((revision) => revision.verbatim);
    expect(verbatims).toContain('dej na začátek shrnutí větu o tom, čím se firma zabývá');
    expect(verbatims).toContain('oprav to všude, není to CTO (K2-004)');
  });

  it('names the record the revision came from', () => {
    const revision = bundle.revisions.find((candidate) =>
      candidate.verbatim?.includes('není to CTO'),
    );
    expect(revision?.origin).toBe('docs/changes/v1.2/changes.json#IN-047');
    expect(revision?.kind).toBe('comment-resolution');
  });

  it('reports that nothing was left unexplained', () => {
    expect(report.commitsWithoutRecord).toBe(0);
    expect(report.unexplainedEdits).toBe(0);
  });

  it('joins the reviewer comments to the revisions that answered them', () => {
    expect(report.comments).toBe(2);
    expect(report.commentsJoined).toBe(2);
    const comment = index.getComment('K2-004');
    expect(comment?.revisions).toHaveLength(1);
    expect(comment?.answer).toBe('Funkce opravena ve všech kapitolách.');
  });

  it('shortens the reviewer role to something a card can show', () => {
    expect(index.getComment('K1-002')?.author.role).toBe('garantka produktové oblasti');
    expect(index.getComment('K1-002')?.author.side).toBe('reviewer');
  });
});

describe('one instruction landing in several places', () => {
  it('steps between the two blocks the PLAN instruction touched', () => {
    const revision = bundle.revisions.find((candidate) =>
      candidate.verbatim?.includes('doplň PLAN'),
    );
    expect(revision).toBeDefined();
    const edits = index.editsOfRevision(revision?.id ?? '');
    expect(edits).toHaveLength(2);
    expect(new Set(edits.map((edit) => edit.block)).size).toBe(2);
    expect(nextEditOfRevision(index, edits[0]?.id ?? '')?.id).toBe(edits[1]?.id);
  });

  it('marks the new bullet as a whole new block, not run by run', () => {
    const revision = bundle.revisions.find((candidate) =>
      candidate.verbatim?.includes('doplň PLAN'),
    );
    const blockEdit = index
      .editsOfRevision(revision?.id ?? '')
      .find((edit) => edit.kind === 'insert-block');
    expect(blockEdit).toBeDefined();
    const block = index.getBlock(blockEdit?.block ?? '')?.block;
    expect(block?.introducedBy).toBe(revision?.id);
    expect(block?.runs.every((run) => run.kind === 'inserted')).toBe(true);
  });

  it('steps across chapters when the instruction did', () => {
    const revision = bundle.revisions.find((candidate) =>
      candidate.verbatim?.includes('není to CTO'),
    );
    const edits = index.editsOfRevision(revision?.id ?? '');
    expect(edits.map((edit) => edit.chapter)).toEqual(['ch-01', 'ch-02']);
    expect(edits.every((edit) => edit.kind === 'replace')).toBe(true);
  });

  it('keeps the removed job title where it was removed from', () => {
    const block = index.getBlock('ch-01/b-03')?.block;
    const kinds = (block?.runs ?? []).map((run) => run.kind);
    expect(kinds).toEqual(['kept', 'deleted', 'inserted', 'kept']);
    expect(block?.runs[1]?.text).toBe('CTO');
    expect(block?.runs[2]?.text).toBe('vedoucí oblasti Technology');
  });
});

describe('attribution survives later revisions', () => {
  it('still attributes a change from three revisions back, at its position today', () => {
    const paragraph = index.getBlock('ch-01/b-02')?.block;
    const runs = paragraph?.runs ?? [];

    const firstRevision = bundle.revisions.find((candidate) =>
      candidate.verbatim?.includes('čím se firma zabývá'),
    );
    const lastRevision = bundle.revisions.find((candidate) =>
      candidate.verbatim?.includes('jak se má číst'),
    );
    expect(firstRevision).toBeDefined();
    expect(lastRevision).toBeDefined();

    const attributed = (revisionId: string): string =>
      runs
        .filter((run) => run.kind === 'inserted' && run.revision === revisionId)
        .map((run) => run.text)
        .join('');

    expect(attributed(firstRevision?.id ?? '')).toContain('Acme Systems je česká technologická firma.');
    expect(attributed(lastRevision?.id ?? '')).toContain('Shrnutí se čte jako první.');

    // The older insertion now sits after the newer one, and is still attributed to the
    // revision that made it - which a pairwise diff of baseline against head could not do.
    const positions = runs.map((run, position) => ({ run, position }));
    const older = positions.find(
      ({ run }) => run.kind === 'inserted' && run.revision === firstRevision?.id,
    );
    const newer = positions.find(
      ({ run }) => run.kind === 'inserted' && run.revision === lastRevision?.id,
    );
    expect(newer?.position).toBeLessThan(older?.position ?? -1);
  });

  it('keeps document position in order, and out of the id', () => {
    expect(index.editsInDocumentOrder.map((edit) => edit.id)).toEqual(
      bundle.edits.map((edit) => edit.id),
    );
    expect(bundle.edits.map((edit) => edit.order)).toEqual(
      bundle.edits.map((_edit, position) => position + 1),
    );
    // The id says what the change is, not where it sits.
    for (const edit of bundle.edits) expect(edit.id).toMatch(/^E-[0-9a-f]{8}(-d+)?$/);
    for (const revision of bundle.revisions) expect(revision.id).toMatch(/^R-[0-9a-f]{8}(-d+)?$/);
  });
});

describe('the build report', () => {
  it('states what it walked and what it produced', () => {
    expect(report.source).toBe('engagement');
    expect(report.commits).toBe(4);
    expect(report.revisions).toBe(4);
    expect(report.threshold).toBe(0.5);
    expect(report.edits).toBe(bundle.edits.length);
  });

  it('counts the edits per chapter, so an untouched chapter would be visible', () => {
    const counts = Object.fromEntries(
      report.chapters.map((chapter) => [chapter.id, chapter.edits]),
    );
    expect(counts['ch-01']).toBeGreaterThan(0);
    expect(counts['ch-02']).toBeGreaterThan(0);
  });

  it('reports no warnings for a history where everything joined', () => {
    expect(report.warnings).toEqual([]);
  });
});

describe('identifiers survive a rebuild', () => {
  /**
   * The point of a content-derived id: a link pasted into an e-mail has to still open the
   * same change after someone rebuilds the bundle - including against a different
   * baseline, which renumbers every position in the document.
   */
  it('gives a change the same id whichever baseline it is measured from', async () => {
    const fromFirst = await buildBundle(engagementAdapter, {
      repo: engagement.repo,
      from: engagement.commits[0] ?? 'HEAD',
      records: engagement.root,
    });
    const fromLater = await buildBundle(engagementAdapter, {
      // Two commits later: the earlier changes are folded into the baseline and are gone,
      // and every remaining change sits at a different position.
      repo: engagement.repo,
      from: engagement.commits[2] ?? 'HEAD',
      records: engagement.root,
    });

    const identify = (built: typeof fromFirst) => {
      const map = new Map<string, string>();
      const idx = new BundleIndex(built.bundle);
      for (const edit of built.bundle.edits) {
        const runs = idx.runsOf(edit.id);
        const inserted = runs
          .filter(({ run }) => run.kind === 'inserted')
          .map(({ run }) => run.text)
          .join('');
        const removed = runs
          .filter(({ run }) => run.kind === 'deleted')
          .map(({ run }) => run.text)
          .join('');
        map.set(`${removed}=>${inserted}`, edit.id);
      }
      return map;
    };

    const first = identify(fromFirst);
    const later = identify(fromLater);

    // The job-title correction is in both builds, at different positions.
    const key = 'CTO=>vedoucí oblasti Technology';
    expect(first.has(key)).toBe(true);
    expect(later.has(key)).toBe(true);
    expect(later.get(key)).toBe(first.get(key));

    const shared = [...later.keys()].filter((entry) => first.has(entry));
    expect(shared.length).toBeGreaterThan(1);
    for (const entry of shared) {
      expect(later.get(entry)).toBe(first.get(entry));
    }

    // Positions did move, so this is not a trivial pass.
    const orderFirst = fromFirst.bundle.edits.length;
    const orderLater = fromLater.bundle.edits.length;
    expect(orderLater).toBeLessThan(orderFirst);
  }, 60_000);

  it('gives a revision the same id, because the record behind it did not move', async () => {
    const again = await buildBundle(engagementAdapter, {
      repo: engagement.repo,
      from: engagement.commits[0] ?? 'HEAD',
      records: engagement.root,
    });
    const byOrigin = (built: { bundle: { revisions: { id: string; origin?: string }[] } }) =>
      Object.fromEntries(
        built.bundle.revisions
          .filter((revision) => revision.origin !== undefined)
          .map((revision) => [revision.origin as string, revision.id]),
      );
    expect(byOrigin(again)).toEqual(byOrigin({ bundle }));
  }, 60_000);

  it('separates two identical changes of one revision rather than colliding', () => {
    // R-003 corrected the same words in two chapters; both are `CTO` to `vedoucí oblasti
    // Technology`, so only the occurrence tie-break tells them apart.
    const revision = bundle.revisions.find((candidate) =>
      candidate.verbatim?.includes('není to CTO'),
    );
    const edits = index.editsOfRevision(revision?.id ?? '');
    expect(edits).toHaveLength(2);
    expect(edits[0]?.id).not.toBe(edits[1]?.id);
  });
});
