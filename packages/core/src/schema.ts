import { z } from 'zod';

/**
 * The revlens bundle contract, authored once in Zod.
 *
 * `schema/bundle.schema.json` is generated from this module (see
 * `scripts/generate-schema.ts`), so the TypeScript types and the JSON Schema cannot
 * drift apart. Editing the generated file by hand is a build failure - change this
 * module instead, and remember that a change to the contract is a change to INT-002.
 */

/** Contract version this build of revlens writes and understands. */
export const SCHEMA_VERSION = '1.0';

/** Timestamps are ISO 8601 with an offset, because "when" is useless without a zone. */
const timestamp = (): z.ZodType<string> => z.iso.datetime({ offset: true });

export const personSchema = z
  .strictObject({
    name: z.string(),
    role: z.string().optional(),
    side: z
      .enum(['processor', 'reviewer', 'client', 'unknown'])
      .describe('Which side of the review the person stands on')
      .optional(),
  })
  .meta({ id: 'person' });

const keptRunSchema = z
  .strictObject({
    kind: z.literal('kept'),
    text: z.string(),
    edit: z.string().optional(),
  })
  .describe('Text present in the baseline and still present; carries no revision');

const insertedRunSchema = z.strictObject({
  kind: z.literal('inserted'),
  text: z.string(),
  revision: z.string(),
  edit: z.string().optional(),
});

const deletedRunSchema = z.strictObject({
  kind: z.literal('deleted'),
  text: z.string(),
  revision: z.string(),
  edit: z.string().optional(),
});

/**
 * A run is either kept text with no attribution, or inserted/deleted text that must name
 * the revision responsible. The discriminated union is what forbids a `revision` on a
 * kept run - there is no separate conditional to keep in step.
 */
export const runSchema = z.discriminatedUnion('kind', [
  keptRunSchema,
  insertedRunSchema,
  deletedRunSchema,
]);

export const blockSchema = z
  .strictObject({
    id: z.string(),
    kind: z.enum(['heading', 'paragraph', 'listItem', 'quote', 'code', 'table', 'image']),
    level: z.number().int().min(1).max(6).optional(),
    introducedBy: z
      .string()
      .describe(
        'Revision that added the whole block; the viewer marks such a block as new rather than marking every run',
      )
      .optional(),
    removedBy: z
      .string()
      .describe('Revision that removed the whole block; the block is shown only in review mode')
      .optional(),
    runs: z
      .array(runSchema)
      .describe(
        'The block text split by attribution. Concatenating kept and inserted runs gives the final text; deleted runs sit where the text was removed.',
      ),
    table: z
      .strictObject({
        columns: z.number().int().min(1).describe('Cells per row; the first row is the header'),
        cellRunCounts: z
          .array(z.number().int().min(0))
          .describe(
            'How many consecutive runs each cell takes, row by row. The runs are not repeated in the cells: this only says where to cut them, so it sums to runs.length.',
          ),
      })
      .describe(
        'How the runs of a table block divide into cells. Absent on a table built before cells were kept, which is drawn as one paragraph.',
      )
      .optional(),
  })
  .meta({ id: 'block' });

export const chapterSchema = z.strictObject({
  id: z.string(),
  number: z.string().optional(),
  title: z.string(),
  source: z
    .string()
    .describe(
      'Path of the chapter file the blocks were parsed from, relative to the analysed repository',
    )
    .optional(),
  blocks: z.array(blockSchema),
});

export const revisionSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['instruction', 'comment-resolution', 'merge', 'editorial', 'unknown']),
  at: timestamp(),
  author: personSchema,
  title: z.string().describe('What the revision did, one line'),
  verbatim: z
    .string()
    .describe(
      'The instruction as it was given, never rewritten. Empty when the revision has no verbatim source.',
    )
    .optional(),
  why: z.string().optional(),
  commit: z.string().describe('Git revision the change was committed in').optional(),
  origin: z
    .string()
    .describe(
      'Where the record comes from - path plus fragment, so the reader can open the source of truth',
    )
    .optional(),
  comments: z.array(z.string()).describe('Ids of comments this revision answers').optional(),
  edits: z
    .array(z.string())
    .describe('Ids of the edits this revision produced, in document order')
    .optional(),
});

export const commentSchema = z.strictObject({
  id: z.string(),
  round: z.string().optional(),
  author: personSchema,
  received: timestamp().optional(),
  reviewedVersion: z.string().optional(),
  source: z.string().optional(),
  sourceSection: z.string().optional(),
  verbatim: z.string(),
  summary: z.string().optional(),
  priority: z.enum(['P1', 'P2', 'P3']).optional(),
  check: z
    .strictObject({
      verdict: z.string().optional(),
      note: z.string().optional(),
    })
    .optional(),
  decision: z
    .strictObject({
      status: z.string().optional(),
      by: z.string().nullable().optional(),
      at: z.string().nullable().optional(),
      note: z.string().optional(),
    })
    .optional(),
  resolution: z
    .strictObject({
      state: z
        .string()
        .describe(
          'How far the comment has actually been worked into the text - hotovo, rozpracovano, nezahajeno, odpada',
        )
        .optional(),
      changes: z
        .array(z.string())
        .describe('What the processor recorded as done, one line each')
        .optional(),
      at: z.string().nullable().optional(),
    })
    .describe(
      'The third gate. A comment can be confirmed and accepted and still not worked in, and nothing in the document shows that - only this field does.',
    )
    .optional(),
  answer: z.string().optional(),
  scope: z.array(z.string()).optional(),
  revisions: z
    .array(z.string())
    .describe('Revisions that answered this comment; empty means decided but not yet worked in')
    .optional(),
});

export const editSchema = z.strictObject({
  id: z.string(),
  revision: z.string(),
  chapter: z.string(),
  block: z.string(),
  order: z.number().int().min(1).optional(),
  kind: z.enum(['insert', 'delete', 'replace', 'insert-block', 'delete-block', 'move']),
  insertedChars: z.number().int().min(0).optional(),
  removedChars: z.number().int().min(0).optional(),
  movedFrom: z.string().describe('Block id the text came from, for kind move').optional(),
  summary: z.string().optional(),
});

export const documentSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  language: z.string().optional(),
  version: z.string().describe('Version of the final text the bundle renders'),
  baseline: z
    .strictObject({
      version: z.string(),
      label: z.string().optional(),
      at: timestamp().optional(),
      commit: z.string().optional(),
    })
    .describe(
      'Version the history is measured against - usually the build the reviewers received. Text present in the baseline and still present carries no revision.',
    )
    .optional(),
  generated: timestamp(),
  generator: z.string().optional(),
});

export const bundleSchema = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: z
      .string()
      .regex(/^[0-9]+\.[0-9]+$/)
      .describe(
        'Contract version the bundle was written against; the viewer refuses a major it does not know',
      ),
    document: documentSchema,
    chapters: z.array(chapterSchema),
    revisions: z
      .array(revisionSchema)
      .describe(
        'One entry per act that changed the text - an instruction from the author, a comment resolution, a merge of a delivered draft. This is the unit the viewer navigates by.',
      ),
    comments: z
      .array(commentSchema)
      .describe(
        'Reviewer input the revisions answer. Absent for a document changed only by instructions.',
      )
      .optional(),
    edits: z
      .array(editSchema)
      .describe(
        'Navigable list of changes in document order. One edit is one contiguous change in one block; a replace is a single edit carrying both a deleted and an inserted run.',
      ),
  })
  .describe(
    'One reviewed document with its revision history flattened onto the final text. The viewer reads nothing else - every adapter (change log, comment rounds, git history, Word tracked changes) produces this shape.',
  );

export type Person = z.infer<typeof personSchema>;
export type Run = z.infer<typeof runSchema>;
export type Block = z.infer<typeof blockSchema>;
export type BlockTable = NonNullable<Block['table']>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Edit = z.infer<typeof editSchema>;
export type DocumentMeta = z.infer<typeof documentSchema>;
export type Bundle = z.infer<typeof bundleSchema>;

export type RunKind = Run['kind'];
export type BlockKind = Block['kind'];
export type RevisionKind = Revision['kind'];
export type EditKind = Edit['kind'];
export type Side = NonNullable<Person['side']>;
