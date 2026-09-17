import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type {
  Block,
  BundleIndex,
  Comment,
  Edit,
  EditFilter,
  ViewMode,
} from '@revlens/core';
import {
  COMMENT_SCOPES,
  DEFAULT_COMMENT_SCOPE,
  commentStanding,
  distinctGateValues,
  filterComments,
  filterEdits,
  filterRevisions,
  formatIssue,
  isBlockVisible,
  runsForMode,
  siblingPosition,
  summarizeBundle,
  textForMode,
  unexplainedEdits,
  validateBundle,
} from '@revlens/core';
import type { BundleState } from './state.js';

/**
 * The MCP surface: the same questions the viewer answers by clicking, asked directly.
 *
 * Every tool is a projection of `@revlens/core` - the assistant and the reader call the
 * same functions, so they cannot disagree about which edits a revision produced. A tool
 * that re-implemented the navigation would make the whole thing useless as evidence.
 *
 * The transport is stdio, which means **nothing may be written to stdout** while it runs.
 */

const MODES = ['clean', 'review', 'baseline'] as const;

export interface McpOptions {
  readonly state: BundleState;
  readonly version?: string;
}

export function createMcpServer(options: McpOptions): McpServer {
  const server = new McpServer({
    name: 'revlens',
    version: options.version ?? '0.1.0',
  });

  const { state } = options;
  const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool(
    'revlens_document',
    {
      title: 'Document overview',
      description:
        'The document this bundle renders: metadata, the chapters with how many changes each carries, and the totals. Start here.',
      annotations: readOnly,
    },
    async () => {
      const summary = summarizeBundle(state.index);
      return text({
        document: summary.document,
        stats: summary.stats,
        chapters: summary.chapters.map((chapter) => ({
          id: chapter.id,
          number: chapter.number,
          title: chapter.title,
          editCount: chapter.editCount,
        })),
        revisions: summary.revisions.map((revision) => ({
          id: revision.id,
          at: revision.at,
          kind: revision.kind,
          author: revision.author.name,
          title: revision.title,
          edits: (revision.edits ?? []).length,
          comments: revision.comments ?? [],
        })),
      });
    },
  );

  server.registerTool(
    'revlens_chapter',
    {
      title: 'Read a chapter',
      description:
        'One chapter as text. Mode clean gives the final text, review marks insertions and deletions inline, baseline gives the text the reviewers received.',
      inputSchema: {
        id: z.string().describe('Chapter id, from revlens_document'),
        mode: z.enum(MODES).default('review').describe('clean, review or baseline'),
      },
      annotations: readOnly,
    },
    async ({ id, mode }) => {
      const chapter = state.index.getChapter(id);
      if (chapter === undefined) return error(`unknown chapter ${id}`);
      return text({
        id: chapter.id,
        title: chapter.title,
        mode,
        editCount: state.index.editCountOfChapter(chapter.id),
        blocks: chapter.blocks
          .filter((block) => isBlockVisible(block, mode as ViewMode))
          .map((block) => ({
            id: block.id,
            kind: block.kind,
            ...(block.level === undefined ? {} : { level: block.level }),
            ...(block.introducedBy === undefined ? {} : { introducedBy: block.introducedBy }),
            ...(block.removedBy === undefined ? {} : { removedBy: block.removedBy }),
            text: renderBlockText(block, mode as ViewMode),
            edits: state.index.editsOfBlock(block.id).map((edit) => edit.id),
          })),
      });
    },
  );

  server.registerTool(
    'revlens_revision',
    {
      title: 'One revision and everything it touched',
      description:
        'A revision with the instruction as it was given, the comments it answers, and every change it produced across the document.',
      inputSchema: { id: z.string().describe('Revision id, for example R-002') },
      annotations: readOnly,
    },
    async ({ id }) => {
      const revision = state.index.getRevision(id);
      if (revision === undefined) return error(`unknown revision ${id}`);
      return text({
        revision,
        comments: state.index.commentsOfRevision(id).map(describeComment),
        edits: state.index.editsOfRevision(id).map((edit) => describeEdit(state.index, edit)),
      });
    },
  );

  server.registerTool(
    'revlens_comment',
    {
      title: 'What a reviewer comment produced',
      description:
        'A reviewer comment with its decision, the answer sent back, and every change made in answer to it - the "did anyone act on my comment, and where" question.',
      inputSchema: { id: z.string().describe('Comment id, for example K2-004') },
      annotations: readOnly,
    },
    async ({ id }) => {
      const comment = state.index.getComment(id);
      if (comment === undefined) return error(`unknown comment ${id}`);
      return text({
        comment: describeComment(comment),
        revisions: state.index.revisionsOfComment(id).map((revision) => ({
          id: revision.id,
          at: revision.at,
          author: revision.author.name,
          title: revision.title,
          verbatim: revision.verbatim,
        })),
        edits: state.index.editsOfComment(id).map((edit) => describeEdit(state.index, edit)),
      });
    },
  );

  server.registerTool(
    'revlens_comments',
    {
      title: 'Browse the review',
      description:
        'The comments this comparison can speak to, filterable by round, by each of the three gates - ověření (check.verdict), rozhodnutí (decision.status), vypořádání (resolution.state) - and by whether they produced a change in the document. Comments closed before the baseline are left out by default; pass scope=settled-earlier or scope=all for those. For the genuinely open list ask with landed=false, which within the default scope means decided and still not in the text.',
      inputSchema: {
        q: z.string().optional().describe('Free text over the comment, its answer and its resolution'),
        round: z.array(z.string()).optional(),
        verdict: z.array(z.string()).optional().describe('potvrzeno, potvrzeno-s-upresnenim, ...'),
        decision: z.array(z.string()).optional().describe('prijato, prijato-castecne, zamitnuto, ...'),
        resolution: z.array(z.string()).optional().describe('hotovo, rozpracovano, nezahajeno, odpada'),
        landed: z
          .boolean()
          .optional()
          .describe('true: produced a change in the document; false: produced none'),
        scope: z
          .enum([...COMMENT_SCOPES, 'all'])
          .default(DEFAULT_COMMENT_SCOPE)
          .describe(
            'in-range (the default) is the comments this comparison can speak to. settled-earlier is the ones closed before the baseline - they belong to an earlier comparison, and "closed" does not mean "worked into the text". all widens to every comment in the bundle.',
          ),
        chapter: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: readOnly,
    },
    async (args) => {
      const filter = toFilter(args);
      const comments = filterComments(state.index, filter);
      return text({
        scope: args.scope,
        count: comments.length,
        total: (state.bundle.comments ?? []).length,
        gates: {
          verdict: distinctGateValues(state.index, 'verdict'),
          decision: distinctGateValues(state.index, 'decision'),
          resolution: distinctGateValues(state.index, 'resolution'),
        },
        comments: comments.slice(0, args.limit).map((comment) => {
          const standing = commentStanding(state.index, comment);
          return {
            ...describeComment(comment),
            resolution: standing.resolution,
            resolutionChanges: standing.changes,
            landed: standing.landed,
            scope: standing.scope,
            resolvedAt: standing.resolvedAt,
            edits: standing.edits.map((edit) => edit.id),
          };
        }),
        truncated: comments.length > args.limit,
      });
    },
  );

  server.registerTool(
    'revlens_edit',
    {
      title: 'One change, with what and when and why',
      description:
        'A single change: the text inserted and the text it replaced, the revision that made it, the comment behind it, and the other changes the same revision made elsewhere.',
      inputSchema: { id: z.string().describe('Edit id, for example E-004') },
      annotations: readOnly,
    },
    async ({ id }) => {
      const edit = state.index.getEdit(id);
      if (edit === undefined) return error(`unknown edit ${id}`);
      const revision = state.index.getRevision(edit.revision);
      return text({
        edit: describeEdit(state.index, edit),
        revision,
        comments: state.index.commentsOfRevision(edit.revision).map(describeComment),
        siblings: state.index
          .editsOfRevision(edit.revision)
          .map((sibling) => describeEdit(state.index, sibling)),
        position: siblingPosition(state.index, id),
      });
    },
  );

  server.registerTool(
    'revlens_search',
    {
      title: 'Find changes',
      description:
        'Changes matching any combination of revision, author, comment round, comment, chapter, date range and free text. Free text is matched against the instruction and comment verbatims, and ignores case and diacritics.',
      inputSchema: {
        q: z.string().optional().describe('Free text'),
        revision: z.array(z.string()).optional(),
        author: z.array(z.string()).optional(),
        round: z.array(z.string()).optional(),
        comment: z.array(z.string()).optional(),
        chapter: z.array(z.string()).optional(),
        verdict: z.array(z.string()).optional(),
        decision: z.array(z.string()).optional(),
        resolution: z.array(z.string()).optional(),
        from: z.string().optional().describe('ISO timestamp; revisions before it are excluded'),
        to: z.string().optional().describe('ISO timestamp; revisions after it are excluded'),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: readOnly,
    },
    async (args) => {
      const filter = toFilter(args);
      const edits = filterEdits(state.index, filter);
      const revisions = filterRevisions(state.index, filter);
      return text({
        count: edits.length,
        revisions: revisions.map((revision) => revision.id),
        edits: edits
          .slice(0, args.limit)
          .map((edit) => describeEdit(state.index, edit)),
        truncated: edits.length > args.limit,
      });
    },
  );

  server.registerTool(
    'revlens_validate',
    {
      title: 'Check the bundle',
      description:
        'Validates the loaded bundle against the schema and the invariants, and lists the edits whose revision has no record behind it.',
      annotations: readOnly,
    },
    async () => {
      const result = validateBundle(state.bundle);
      return text({
        valid: result.valid,
        issues: result.issues.map(formatIssue),
        unexplainedEdits: unexplainedEdits(state.index).map((edit) => edit.id),
        report: state.report ?? null,
      });
    },
  );

  server.registerTool(
    'revlens_rebuild',
    {
      title: 'Rebuild the bundle',
      description:
        'Re-runs the source adapter and swaps the result in. The browser sees the new bundle on its next request. A bundle that does not validate is refused and the previous one is kept.',
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      if (!state.canRebuild) return error('this server has nothing to rebuild from');
      try {
        const { report, issues } = await state.rebuild();
        return text({ version: state.version, report: report ?? null, issues });
      } catch (failure) {
        return error(failure instanceof Error ? failure.message : String(failure));
      }
    },
  );

  return server;
}

/** Connect the MCP server to stdio. Nothing else may write to stdout afterwards. */
export async function serveMcpOverStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}

/**
 * One filter builder for every tool, so `revlens_search` and `revlens_comments` cannot
 * come to mean different things by the same argument.
 */
function toFilter(args: {
  q?: string;
  revision?: string[];
  author?: string[];
  round?: string[];
  comment?: string[];
  chapter?: string[];
  verdict?: string[];
  decision?: string[];
  resolution?: string[];
  landed?: boolean;
  scope?: string;
  from?: string;
  to?: string;
}): EditFilter {
  return {
    ...(args.q === undefined ? {} : { query: args.q }),
    ...(args.revision === undefined ? {} : { revisions: args.revision }),
    ...(args.author === undefined ? {} : { authors: args.author }),
    ...(args.round === undefined ? {} : { rounds: args.round }),
    ...(args.comment === undefined ? {} : { comments: args.comment }),
    ...(args.chapter === undefined ? {} : { chapters: args.chapter }),
    ...(args.verdict === undefined ? {} : { verdicts: args.verdict }),
    ...(args.decision === undefined ? {} : { decisions: args.decision }),
    ...(args.resolution === undefined ? {} : { resolutions: args.resolution }),
    ...(args.landed === undefined ? {} : { landed: args.landed }),
    ...(args.scope === undefined || args.scope === 'all'
      ? {}
      : { scope: args.scope as EditFilter['scope'] }),
    ...(args.from === undefined ? {} : { from: args.from }),
    ...(args.to === undefined ? {} : { to: args.to }),
  };
}

function describeEdit(index: BundleIndex, edit: Edit): Record<string, unknown> {
  const runs = index.runsOf(edit.id);
  const inserted = runs
    .filter(({ run }) => run.kind === 'inserted')
    .map(({ run }) => run.text)
    .join('');
  const removed = runs
    .filter(({ run }) => run.kind === 'deleted')
    .map(({ run }) => run.text)
    .join('');
  const location = index.getBlock(edit.block);

  return {
    id: edit.id,
    kind: edit.kind,
    revision: edit.revision,
    chapter: edit.chapter,
    chapterTitle: location?.chapter.title,
    block: edit.block,
    blockKind: location?.block.kind,
    inserted: inserted.length === 0 ? undefined : inserted,
    removed: removed.length === 0 ? undefined : removed,
    context: location === undefined ? undefined : textForMode(location.block, 'clean'),
    link: `#/edit/${edit.id}`,
  };
}

function describeComment(comment: Comment): Record<string, unknown> {
  return {
    id: comment.id,
    round: comment.round,
    author: comment.author.name,
    side: comment.author.side,
    received: comment.received,
    verbatim: comment.verbatim,
    summary: comment.summary,
    verdict: comment.check?.verdict,
    decision: comment.decision?.status,
    resolution: comment.resolution?.state,
    answer: comment.answer,
    link: `#/comment/${comment.id}`,
  };
}

/**
 * Clean and baseline are plain text - that is what those modes mean. Review is the one
 * that marks the changes, and it marks them inline so the assistant sees them in place
 * rather than as a list beside the text.
 */
function renderBlockText(block: Block, mode: ViewMode): string {
  return runsForMode(block, mode)
    .map((run) => {
      if (mode !== 'review') return run.text;
      if (run.kind === 'inserted') return `[+${run.text}]`;
      if (run.kind === 'deleted') return `[-${run.text}]`;
      return run.text;
    })
    .join('');
}

function text(payload: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function error(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}
