import { stat } from 'node:fs/promises';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import {
  COMMENT_SCOPES,
  DEFAULT_COMMENT_SCOPE,
  commentStanding,
  filterComments,
  filterEdits,
  resolveSelection,
  summarizeBundle,
  unexplainedEdits,
} from '@revlens/core';
import type { EditFilter } from '@revlens/core';
import type { BundleState } from './state.js';

/**
 * The read-only HTTP API.
 *
 * Stateless, no database: the bundle is a generated file and the repository is the source
 * of truth, so a stale copy in a database would be a liability rather than an asset. The
 * one endpoint that is not read-only is `POST /api/rebuild`, which re-runs the adapter so
 * the viewer can be refreshed while chapters are being edited.
 */

export interface ServerOptions {
  readonly state: BundleState;
  /** Directory of the built SPA; when absent, only the API is served. */
  readonly webRoot?: string;
  /** Written to stderr, never to stdout - stdout may carry the MCP protocol. */
  readonly quiet?: boolean;
}

export async function createServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    // Logging goes to stderr unconditionally. With --mcp, anything on stdout would
    // corrupt the protocol stream, so the quiet path is the normal path.
    logger: options.quiet === true ? false : { level: 'warn', stream: process.stderr },
  });

  const { state } = options;

  app.get('/api/bundle', async () => ({
    version: state.version,
    ...summarizeBundle(state.index),
  }));

  app.get<{ Params: { id: string } }>('/api/chapters/:id', async (request, reply) => {
    const chapter = state.index.getChapter(request.params.id);
    if (chapter === undefined) {
      return reply.code(404).send({ error: `unknown chapter ${request.params.id}` });
    }
    return { version: state.version, chapter };
  });

  app.get<{ Params: { id: string } }>('/api/revisions/:id', async (request, reply) => {
    const revision = state.index.getRevision(request.params.id);
    if (revision === undefined) {
      return reply.code(404).send({ error: `unknown revision ${request.params.id}` });
    }
    return {
      version: state.version,
      revision,
      edits: state.index.editsOfRevision(revision.id),
      comments: state.index.commentsOfRevision(revision.id),
    };
  });

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>(
    '/api/comments',
    async (request) => {
      // Browsing the review rather than the text: the same filter, applied to the
      // comments, so "which accepted comments are not yet worked in" is one question with
      // one answer whoever asks it.
      // Defaulted, not neutral: a bundle comparing two versions carries every comment the
      // engagement ever received, and answering the wide question by default is how the
      // ones that matter get buried.
      const filter = withDefaultScope(toFilter(request.query), request.query);
      const comments = filterComments(state.index, filter);
      const total = (state.bundle.comments ?? []).length;
      return {
        version: state.version,
        scope: filter.scope ?? 'all',
        count: comments.length,
        total,
        comments: comments.map((comment) => commentStanding(state.index, comment)),
      };
    },
  );

  app.get<{ Params: { id: string } }>('/api/comments/:id', async (request, reply) => {
    const comment = state.index.getComment(request.params.id);
    if (comment === undefined) {
      return reply.code(404).send({ error: `unknown comment ${request.params.id}` });
    }
    return {
      version: state.version,
      comment,
      revisions: state.index.revisionsOfComment(comment.id),
      edits: state.index.editsOfComment(comment.id),
    };
  });

  app.get<{ Params: { id: string } }>('/api/edits/:id', async (request, reply) => {
    const resolved = resolveSelection(state.index, { kind: 'edit', id: request.params.id });
    if (resolved.unresolved) {
      return reply.code(404).send({ error: `unknown edit ${request.params.id}` });
    }
    return { version: state.version, ...resolved };
  });

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>(
    '/api/edits',
    async (request) => {
      const filter = toFilter(request.query);
      const edits = filterEdits(state.index, filter);
      return { version: state.version, count: edits.length, edits };
    },
  );

  app.get('/api/report', async () => ({
    version: state.version,
    report: state.report ?? null,
    unexplainedEdits: unexplainedEdits(state.index).map((edit) => edit.id),
  }));

  app.post('/api/rebuild', async (_request, reply) => {
    if (!state.canRebuild) {
      return reply.code(409).send({ error: 'this server has nothing to rebuild from' });
    }
    try {
      const { report, issues } = await state.rebuild();
      return { version: state.version, report: report ?? null, issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ error: message });
    }
  });

  if (options.webRoot !== undefined && (await isDirectory(options.webRoot))) {
    await app.register(fastifyStatic, { root: options.webRoot, prefix: '/' });
    // The viewer is a single page with hash routing; anything unknown is still the page.
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'unknown endpoint' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

/** Query parameters into the filter `core` defines, so the API cannot invent its own. */
export function toFilter(query: Record<string, string | string[] | undefined>): EditFilter {
  const list = (name: string): string[] | undefined => {
    const value = query[name];
    if (value === undefined) return undefined;
    const items = (Array.isArray(value) ? value : [value])
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return items.length === 0 ? undefined : items;
  };

  const single = (name: string): string | undefined => {
    const value = query[name];
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined || first.length === 0 ? undefined : first;
  };

  const filter: EditFilter = {};
  return {
    ...filter,
    ...defined('revisions', list('revision')),
    ...defined('authors', list('author')),
    ...defined('rounds', list('round')),
    ...defined('comments', list('comment')),
    ...defined('chapters', list('chapter')),
    ...defined('verdicts', list('verdict')),
    ...defined('decisions', list('decision')),
    ...defined('resolutions', list('resolution')),
    ...defined('landed', toBoolean(single('landed'))),
    ...defined('scope', toScope(single('scope'))),
    ...defined('from', single('from')),
    ...defined('to', single('to')),
    ...defined('query', single('q')),
  };
}

function defined<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** `scope=all` widens deliberately; anything unrecognised is ignored rather than guessed. */
function toScope(value: string | undefined): EditFilter['scope'] | undefined {
  if (value === undefined) return undefined;
  return (COMMENT_SCOPES as readonly string[]).includes(value)
    ? (value as EditFilter['scope'])
    : undefined;
}

/** The caller has to ask for the wide list; not asking gets the comparison's own. */
function withDefaultScope(
  filter: EditFilter,
  query: Record<string, string | string[] | undefined>,
): EditFilter {
  if (filter.scope !== undefined) return filter;
  const asked = Array.isArray(query['scope']) ? query['scope'][0] : query['scope'];
  if (asked === 'all') return filter;
  return { ...filter, scope: DEFAULT_COMMENT_SCOPE };
}

/** `landed=false` is the list that matters, so an explicit false must survive parsing. */
function toBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
