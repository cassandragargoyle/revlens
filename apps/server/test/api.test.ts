import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bundle } from '@revlens/core';
import { bundleSchema } from '@revlens/core';
import { BundleState, createServer, toFilter } from '../src/index.js';

/**
 * The read-only API, driven through Fastify's own injection rather than a real socket -
 * the routing is what is under test, not the TCP stack.
 */

const sample = bundleSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../fixtures/sample-bundle.json', import.meta.url)),
      'utf8',
    ),
  ),
) as Bundle;

let app: FastifyInstance;

beforeAll(async () => {
  app = await createServer({ state: new BundleState(sample), quiet: true });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/bundle', () => {
  it('answers with the timeline and the edit index but no chapter text', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/bundle' });
    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      chapters: { id: string; editCount: number; blocks?: unknown }[];
      revisions: unknown[];
      edits: unknown[];
      stats: { unexplainedEdits: number };
    };

    expect(payload.revisions).toHaveLength(4);
    expect(payload.edits).toHaveLength(7);
    expect(payload.chapters.map((chapter) => chapter.editCount)).toEqual([3, 4]);
    expect(payload.chapters[0]).not.toHaveProperty('blocks');
    expect(payload.stats.unexplainedEdits).toBe(0);
  });
});

describe('GET /api/chapters/:id', () => {
  it('answers with one chapter and its runs', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/chapters/ch-02' });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as { chapter: { blocks: unknown[] } };
    expect(payload.chapter.blocks).toHaveLength(8);
  });

  it('answers 404 for a chapter the bundle does not contain', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/chapters/ch-99' });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/revisions/:id', () => {
  it('resolves the edits and the comments of a revision', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/revisions/R-003' });
    const payload = response.json() as {
      edits: { id: string; chapter: string }[];
      comments: { id: string }[];
    };
    expect(payload.edits.map((edit) => edit.id)).toEqual(['E-003', 'E-007']);
    expect(payload.comments.map((comment) => comment.id)).toEqual(['K2-004']);
  });
});

describe('GET /api/comments/:id', () => {
  it('answers the question the tool exists for: where did my comment land', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/comments/K2-004' });
    const payload = response.json() as { edits: { id: string; chapter: string }[] };
    expect(payload.edits.map((edit) => `${edit.id} ${edit.chapter}`)).toEqual([
      'E-003 ch-01',
      'E-007 ch-02',
    ]);
  });
});

describe('GET /api/edits', () => {
  it('filters with the same rules the browser uses', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/edits?round=K2&chapter=ch-02' });
    const payload = response.json() as { count: number; edits: { id: string }[] };
    expect(payload.count).toBe(2);
    expect(payload.edits.map((edit) => edit.id)).toEqual(['E-006', 'E-007']);
  });

  it('searches the verbatims, ignoring case and diacritics', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/edits?q=PLANOVANI%20INVESTIC' });
    const payload = response.json() as { edits: { id: string }[] };
    expect(payload.edits.map((edit) => edit.id)).toEqual(['E-004', 'E-005']);
  });
});

describe('GET /api/edits/:id', () => {
  it('resolves an edit the way the inspector shows it', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/edits/E-004' });
    const payload = response.json() as {
      revision: { id: string };
      siblings: { id: string }[];
      comments: { id: string }[];
    };
    expect(payload.revision.id).toBe('R-002');
    expect(payload.siblings.map((edit) => edit.id)).toEqual(['E-004', 'E-005']);
    expect(payload.comments.map((comment) => comment.id)).toEqual(['K1-002']);
  });

  it('answers 404 for an edit that does not exist', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/edits/E-999' })).statusCode).toBe(404);
  });
});

describe('POST /api/rebuild', () => {
  it('refuses when the server was given a bundle with no source behind it', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/rebuild' });
    expect(response.statusCode).toBe(409);
  });
});

describe('query parameters', () => {
  it('become the filter core defines, splitting comma-separated lists', () => {
    expect(toFilter({ revision: 'R-001,R-002', q: 'CTO', chapter: ['ch-01'] })).toEqual({
      revisions: ['R-001', 'R-002'],
      chapters: ['ch-01'],
      query: 'CTO',
    });
  });

  it('ignores empty parameters rather than filtering everything away', () => {
    expect(toFilter({ revision: '', q: undefined })).toEqual({});
  });
});

describe('GET /api/comments', () => {
  it('browses the review with all three gates resolved', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/comments' });
    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      count: number;
      total: number;
      comments: {
        comment: { id: string };
        verdict?: string;
        decision?: string;
        resolution?: string;
        landed: boolean;
        edits: { id: string }[];
      }[];
    };

    expect(payload.count).toBe(3);
    expect(payload.total).toBe(3);

    const standing = payload.comments.find((entry) => entry.comment.id === 'K2-005');
    expect(standing?.verdict).toBe('potvrzeno-s-upresnenim');
    expect(standing?.decision).toBe('prijato-castecne');
    expect(standing?.resolution).toBe('rozpracovano');
    expect(standing?.landed).toBe(true);
    expect(standing?.edits.map((edit) => edit.id)).toEqual(['E-002', 'E-006']);
  });

  it('filters by a gate', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/comments?resolution=rozpracovano',
    });
    const payload = response.json() as { count: number; comments: { comment: { id: string } }[] };
    expect(payload.count).toBe(1);
    expect(payload.comments[0]?.comment.id).toBe('K2-005');
  });

  it('keeps an explicit landed=false, which is the list that matters', async () => {
    expect(toFilter({ landed: 'false' })).toEqual({ landed: false });
    expect(toFilter({ landed: 'true' })).toEqual({ landed: true });
    expect(toFilter({ landed: '' })).toEqual({});

    const response = await app.inject({ method: 'GET', url: '/api/comments?landed=false' });
    const payload = response.json() as { count: number };
    expect(payload.count).toBe(0);
  });

  it('combines a gate with a round', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/comments?round=K2&decision=prijato',
    });
    const payload = response.json() as { comments: { comment: { id: string } }[] };
    expect(payload.comments.map((entry) => entry.comment.id)).toEqual(['K2-004']);
  });
});

describe('GET /api/comments and the compared range', () => {
  it('answers the comparison by default, and says which scope it used', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/comments' });
    const payload = response.json() as { scope: string; count: number; total: number };
    // The sample carries no baseline timestamp, so nothing is out of scope here; what is
    // under test is that the default is stated rather than silently wide.
    expect(payload.scope).toBe('in-range');
    expect(payload.count).toBe(3);
    expect(payload.total).toBe(3);
  });

  it('widens only when asked', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/comments?scope=all' });
    const payload = response.json() as { scope: string; count: number };
    expect(payload.scope).toBe('all');
    expect(payload.count).toBe(3);
  });

  it('ignores a scope it does not recognise rather than guessing', () => {
    expect(toFilter({ scope: 'nonsense' })).toEqual({});
    expect(toFilter({ scope: 'settled-earlier' })).toEqual({ scope: 'settled-earlier' });
  });
});
