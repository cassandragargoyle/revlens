import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleSchema } from '@revlens/core';
import { BundleState, createMcpServer } from '../src/index.js';

/**
 * The MCP surface, driven by a real MCP client over an in-memory transport.
 *
 * What is being checked is that an assistant gets the same answers a reader gets by
 * clicking - the tools are a projection of `@revlens/core`, and a disagreement between
 * the two would make the tool useless as evidence.
 */

const sample = bundleSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/sample-bundle.json', import.meta.url)),
      'utf8',
    ),
  ),
);

let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const first = result.content[0];
  expect(first?.type).toBe('text');
  if (result.isError === true) throw new Error(first?.text ?? 'tool failed');
  return JSON.parse(first?.text ?? 'null') as unknown;
}

beforeAll(async () => {
  const server = createMcpServer({ state: new BundleState(sample) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'revlens-test', version: '0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

describe('the tool list', () => {
  it('offers the questions the viewer answers, and marks everything but rebuild read-only', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'revlens_chapter',
      'revlens_comment',
      'revlens_comments',
      'revlens_document',
      'revlens_edit',
      'revlens_rebuild',
      'revlens_revision',
      'revlens_search',
      'revlens_validate',
    ]);

    for (const tool of tools) {
      const readOnly = tool.annotations?.readOnlyHint;
      expect(readOnly).toBe(tool.name !== 'revlens_rebuild');
    }
  });
});

describe('revlens_document', () => {
  it('describes the document, the chapters and the timeline', async () => {
    const payload = (await call('revlens_document')) as {
      document: { title: string };
      chapters: { id: string; editCount: number }[];
      revisions: { id: string }[];
      stats: { unexplainedEdits: number };
    };
    expect(payload.document.title).toBe('Analýza kompetenčního centra');
    expect(payload.chapters.map((chapter) => chapter.editCount)).toEqual([3, 4, 1]);
    expect(payload.revisions).toHaveLength(5);
    expect(payload.stats.unexplainedEdits).toBe(0);
  });
});

describe('revlens_chapter', () => {
  it('marks the changes inline in review mode', async () => {
    const payload = (await call('revlens_chapter', { id: 'ch-01', mode: 'review' })) as {
      blocks: { id: string; text: string }[];
    };
    const block = payload.blocks.find((entry) => entry.id === 'ch-01/b-05');
    expect(block?.text).toBe(
      'Za oblast Technology odpovídá [-CTO][+vedoucí oblasti Technology] Martin Svoboda.',
    );
  });

  it('gives plain final text in clean mode', async () => {
    const payload = (await call('revlens_chapter', { id: 'ch-01', mode: 'clean' })) as {
      blocks: { id: string; text: string }[];
    };
    const block = payload.blocks.find((entry) => entry.id === 'ch-01/b-05');
    expect(block?.text).toBe('Za oblast Technology odpovídá vedoucí oblasti Technology Martin Svoboda.');
  });

  it('gives the text the reviewers received in baseline mode', async () => {
    const payload = (await call('revlens_chapter', { id: 'ch-02', mode: 'baseline' })) as {
      blocks: { id: string; text: string }[];
    };
    // The PLAN bullet did not exist in the baseline, so it is not in that view at all.
    expect(payload.blocks.some((block) => block.id === 'ch-02/b-06')).toBe(false);
  });

  it('reports an unknown chapter as an error rather than an empty answer', async () => {
    await expect(call('revlens_chapter', { id: 'ch-99' })).rejects.toThrow(/ch-99/);
  });
});

describe('revlens_comment', () => {
  it('answers where a comment landed, across chapters', async () => {
    const payload = (await call('revlens_comment', { id: 'K2-004' })) as {
      comment: { verbatim: string; decision: string };
      edits: { id: string; chapter: string; removed?: string; inserted?: string }[];
    };
    expect(payload.comment.verbatim).toBe('Nejsem CTO, jsem vedoucí oblasti Technology.');
    expect(payload.comment.decision).toBe('prijato');
    expect(payload.edits.map((edit) => `${edit.id} ${edit.chapter}`)).toEqual([
      'E-003 ch-01',
      'E-007 ch-02',
    ]);
    expect(payload.edits[0]?.removed).toBe('CTO');
    expect(payload.edits[0]?.inserted).toBe('vedoucí oblasti Technology');
  });

  it('carries the answer that went back to the reviewer', async () => {
    const payload = (await call('revlens_comment', { id: 'K2-005' })) as {
      comment: { answer: string; decision: string };
    };
    expect(payload.comment.decision).toBe('prijato-castecne');
    expect(payload.comment.answer).toContain('změkčena');
  });
});

describe('revlens_edit', () => {
  it('gives the three answers and the siblings of the same revision', async () => {
    const payload = (await call('revlens_edit', { id: 'E-004' })) as {
      edit: { inserted: string; removed: string; link: string };
      revision: { verbatim: string; author: { name: string } };
      comments: { id: string }[];
      siblings: { id: string }[];
      position: { position: number; total: number };
    };
    expect(payload.edit.removed).toBe('TINA a PARO');
    expect(payload.edit.inserted).toBe('TINA, PARO a PLAN');
    expect(payload.edit.link).toBe('#/edit/E-004');
    expect(payload.revision.verbatim).toBe('doplň PLAN, podklad ho vede od července');
    expect(payload.comments.map((comment) => comment.id)).toEqual(['K1-002']);
    expect(payload.siblings.map((edit) => edit.id)).toEqual(['E-004', 'E-005']);
    expect(payload.position).toEqual({ position: 1, total: 2 });
  });
});

describe('revlens_search', () => {
  it('finds changes by free text, ignoring case and diacritics', async () => {
    const payload = (await call('revlens_search', { q: 'PLANOVANI INVESTIC' })) as {
      count: number;
      edits: { id: string }[];
    };
    expect(payload.count).toBe(2);
    expect(payload.edits.map((edit) => edit.id)).toEqual(['E-004', 'E-005']);
  });

  it('combines criteria the way the browser does', async () => {
    const payload = (await call('revlens_search', { round: ['K2'], chapter: ['ch-02'] })) as {
      edits: { id: string }[];
    };
    expect(payload.edits.map((edit) => edit.id)).toEqual(['E-006', 'E-007']);
  });

  it('says when it truncated the answer', async () => {
    const payload = (await call('revlens_search', { limit: 2 })) as {
      count: number;
      truncated: boolean;
      edits: unknown[];
    };
    expect(payload.count).toBe(8);
    expect(payload.edits).toHaveLength(2);
    expect(payload.truncated).toBe(true);
  });
});

describe('revlens_validate', () => {
  it('reports the bundle as valid with nothing unexplained', async () => {
    const payload = (await call('revlens_validate')) as {
      valid: boolean;
      issues: string[];
      unexplainedEdits: string[];
    };
    expect(payload.valid).toBe(true);
    expect(payload.issues).toEqual([]);
    expect(payload.unexplainedEdits).toEqual([]);
  });
});

describe('revlens_rebuild', () => {
  it('says so rather than pretending when there is nothing to rebuild from', async () => {
    await expect(call('revlens_rebuild')).rejects.toThrow(/nothing to rebuild/);
  });
});

describe('revlens_comments', () => {
  it('browses the review, with all three gates on every comment', async () => {
    const payload = (await call('revlens_comments')) as {
      count: number;
      total: number;
      gates: { verdict: string[]; decision: string[]; resolution: string[] };
      comments: { id: string; verdict?: string; decision?: string; resolution?: string }[];
    };
    expect(payload.count).toBe(3);
    expect(payload.total).toBe(3);
    expect(payload.gates.resolution).toEqual(['hotovo', 'rozpracovano']);

    const comment = payload.comments.find((entry) => entry.id === 'K2-005');
    expect(comment?.verdict).toBe('potvrzeno-s-upresnenim');
    expect(comment?.decision).toBe('prijato-castecne');
    expect(comment?.resolution).toBe('rozpracovano');
  });

  it('filters by the third gate, which is the "still open" list', async () => {
    const payload = (await call('revlens_comments', { resolution: ['rozpracovano'] })) as {
      count: number;
      comments: { id: string }[];
    };
    expect(payload.comments.map((entry) => entry.id)).toEqual(['K2-005']);
    expect(payload.count).toBe(1);
  });

  it('reports what each comment recorded as done', async () => {
    const payload = (await call('revlens_comments', { round: ['K2'] })) as {
      comments: { id: string; resolutionChanges: string[]; landed: boolean; edits: string[] }[];
    };
    const comment = payload.comments.find((entry) => entry.id === 'K2-004');
    expect(comment?.resolutionChanges).toHaveLength(2);
    expect(comment?.landed).toBe(true);
    expect(comment?.edits).toEqual(['E-003', 'E-007']);
  });

  it('answers "decided and never worked in" with landed=false', async () => {
    const payload = (await call('revlens_comments', { landed: false })) as {
      count: number;
      comments: { id: string }[];
    };
    // Every comment in the sample produced a change, and saying so is the answer.
    expect(payload.count).toBe(0);
    expect(payload.comments).toEqual([]);
  });

  it('combines a gate with a round', async () => {
    const payload = (await call('revlens_comments', {
      round: ['K2'],
      decision: ['prijato'],
    })) as { comments: { id: string }[] };
    expect(payload.comments.map((entry) => entry.id)).toEqual(['K2-004']);
  });
});

describe('the compared range over MCP', () => {
  it('reports the scope it answered in, so an assistant cannot mistake the width', async () => {
    const payload = (await call('revlens_comments')) as { scope: string; count: number };
    expect(payload.scope).toBe('in-range');
    expect(payload.count).toBe(3);
  });

  it('carries the scope of each comment', async () => {
    const payload = (await call('revlens_comments')) as {
      comments: { id: string; scope: string }[];
    };
    for (const comment of payload.comments) expect(comment.scope).toBe('in-range');
  });

  it('widens on request', async () => {
    const payload = (await call('revlens_comments', { scope: 'all' })) as {
      scope: string;
      count: number;
    };
    expect(payload.scope).toBe('all');
    expect(payload.count).toBe(3);
  });
});
