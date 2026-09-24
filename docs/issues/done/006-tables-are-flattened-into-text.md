---
title: INT-006 - Markdown tables are flattened into run-together text
description: Apply when working on table blocks - the Markdown parse in packages/adapters, the block contract in packages/core, and the way apps/web draws a block that has cells.
category: specification
ai_load: on-demand
status: active
created: 2026-09-21
related:
  - docs/issues/002-document-revision-viewer.md
  - docs/adr/ADR-006-standalone-product-and-editor-extensions.md
---

# INT-006 - Markdown tables are flattened into run-together text

## Metadata

- **Status**: ✅ Implemented
- **Type**: bug
- **Priority**: high
- **Created**: 2026-09-21
- **Closed**: 2026-09-24
- **Author**: Zdeněk Kurc
- **Target**: `packages/adapters` (the parse), `packages/core` (the contract and the
  validation), `apps/web` (the drawing); `packages/viewer-page` and the three hosts inherit
  the fix without changing
- **GitHub**: [#6](https://github.com/cassandragargoyle/revlens/issues/6)
- **Related**:
  - [INT-002 — Document revision viewer](../002-document-revision-viewer.md) — the data
    contract this issue changes, amended there as well
  - [ADR-006 — Standalone product and editor extensions](../../adr/ADR-006-standalone-product-and-editor-extensions.md)
    — why the fix may not be made in one host

## Problem

A Markdown table reaches the reader as one paragraph of concatenated cell text. Every cell
boundary and every row boundary is gone, so the table reads as a single run-on sentence.
This source:

```text
| Field   | When to use |
| ------- | ----------- |
| Created | Always      |
| Author  | Always      |
```

is stored, and drawn, as:

```text
FieldWhen to useCreatedAlwaysAuthorAlways
```

This is not cosmetic. The documents revlens exists to show are specifications, and a
specification carries its obligations in tables — what a field means, when a rule applies,
which party owns a step. A bundle built from a real specification in this repository has
**41 table blocks out of 534**: roughly one block in thirteen is unreadable, and those
blocks are the ones a reader is most likely to have a reviewer comment against.

It is worse than unreadable text. An edit inside a table is attributed to the whole
flattened block, so the highlight the reader clicks covers the entire table rather than the
cell that changed, and the panel answers a question the reader did not ask.

## Where It Comes From

The fault is in the **build**, not in a viewer. `apps/vscode`, `apps/desktop` and `apps/web`
all draw what the bundle gives them, and by then the cells are already gone — which is why
this cannot be repaired in the page.

Two places, in order:

1. **`packages/adapters/src/markdown/parse-blocks.ts`** — `case 'table'` hands the node to
   `leaf()`, which calls `mdastToString(node)`. That function concatenates the text of every
   descendant with no separator, and `normalizeWhitespace` then collapses what little
   spacing survived. The structure is discarded at parse time, and the bundle stores the
   flattened string.

2. **`apps/web/src/components/DocumentView.tsx`** — `BlockView` draws every block as a
   `<div class="block block--<kind>">` holding a flat sequence of runs. There is no `<table>`
   markup for `kind: 'table'`, and no `.block--table` rule in `styles.css`. Even a bundle
   with correct separators would still be drawn as a paragraph.

Reproduced on a synthetic table through `parseChapter`, and confirmed against a real bundle
whose content is deliberately not reproduced here — `out/` carries verbatim reviewer
comments and the names of the people who wrote them.

## Proposed Solution

Give the table its cells back, in the contract, and let `packages/core` go on being the one
place that knows what a block is.

### The contract: a table is a partition of the runs it already has

`blockSchema` gains one optional field, and `runs` keeps its present meaning — the block
text split by attribution, in reading order:

```ts
table: z
  .strictObject({
    columns: z.number().int().min(1),
    cellRunCounts: z.array(z.number().int().min(0)),
  })
  .optional()
```

`cellRunCounts` says how many consecutive runs each cell takes, in row-major order. The runs
are not repeated inside the cells; the field only says where to cut. Three consequences
follow, and they are the reason for this shape:

- **Nothing that reads `runs` has to change.** `bundle-index.ts`, `validate.ts`, `text.ts`,
  `summary.ts`, `navigation.ts` and the MCP tools go on counting runs the way they do now.
- **There is one source of truth.** A cell cannot disagree with the block, because a cell is
  a range, not a copy.
- **The invariant is one line**: `cellRunCounts` sums to `runs.length`, and its length is a
  multiple of `columns`. `validate.ts` checks that, and a bundle that fails it is rejected
  at the build rather than drawn wrongly.

The rejected alternative is a `rows: [{ cells: [{ runs }] }]` tree. It reads better in the
JSON and is worse everywhere else: the runs then exist twice, every consumer needs a second
path through them, and validation has to prove the two copies agree.

The first row is the header — GFM gives a table no other shape — so no field is needed to
say so.

### The parse: diff a cell against a cell

`parseChapter` keeps the cell boundaries instead of throwing them away: `ParsedBlock` gains
`columns` and `cells: string[]`, and the word diff runs **per cell** rather than over the
whole flattened table. A cell that did not change then produces one kept run, which is what
makes the highlight land on the cell that actually changed.

When the **column count differs** between two revisions, do not try to align cells across
the change: treat the table as a rewritten block, the way any block whose shape changed is
treated. This is a judgement call — aligning columns is solvable, and it is not worth
solving before somebody has a document where it happens.

### The drawing

`DocumentView` draws a block that has `table` as a real `<table>`, slicing `runs` by
`cellRunCounts` and putting the first row in `<thead>`. The run elements inside a cell are
the same `RunView`, so selection, filtering and the inspector need no table-specific code.
A block with `kind: 'table'` and no `table` field — every bundle built before this issue —
is drawn the way it is drawn today, so an old bundle still opens.

`schema/bundle.schema.json` is regenerated by `npm run schema`, never edited by hand, and
the contract change is written into INT-002 as well.

## Acceptance Criteria

- [x] A Markdown table parses into a block whose cells are separate: the fixture table's
      cells appear as distinct runs, and no two cell texts are concatenated
- [x] `blockSchema` carries the optional `table` field, and `npm run schema:check` passes
      against the regenerated `schema/bundle.schema.json`
- [x] `validate.ts` rejects a bundle whose `cellRunCounts` does not sum to `runs.length`, or
      whose cell count is not a multiple of `columns`, naming the block in the message
- [x] The viewer draws a table as a `<table>`, with the header row in `<thead>`, in all
      three hosts — because all three take the page from `packages/viewer-page`; tried by
      hand in Visual Studio Code with 0.1.8, the desktop application and the static export
      only through the shared page and the jsdom viewer test
- [x] Changing one cell highlights that cell only, and clicking it opens the revision behind
      that edit, not the revision behind the whole table
- [x] A table whose column count changed between revisions is shown as a rewritten block
      rather than as a mis-aligned table
- [x] A bundle built before this change still opens, and its table blocks are drawn as they
      are drawn today
- [x] `fixtures/` gains a chapter with a table, including a revision that edits one cell,
      and the unit tests run on it
- [x] `npm run lint`, `npm run typecheck`, `npm run schema:check`, `npm run build` and
      `npm test` all pass

## Notes

The block id stays build-local and assigned on the baseline, as INT-002 says; adding cells
does not change how a block is identified, only what is inside it.

Nothing here needs a new runtime dependency. `remark-gfm` already parses the table — the
information exists in the mdast and is being thrown away, not missing.

## Implementation Notes

Implemented in `71ad3ac`, released as 0.1.8.

### Deviations

- **`ParsedBlock` gains one field, not two**: `table: { columns, cells }`, so the column
  count and the cells cannot be present one without the other
- **Rows are aligned before cells are diffed.** The proposal diffs cell against cell by
  position, which makes a row added in the middle of a table highlight every cell below it.
  The rows are first aligned with the same word diff, a row being one symbol; a row that
  went and a row that came in its place are one row edited, and a row added or removed as a
  whole is one `insert` or `delete` edit. A removed row stays in the table, struck through
- **The text of a table keeps its cells apart**: `textForMode`, `finalText` and
  `baselineText` join the cells with ` | ` and the rows with a line break, so the MCP tools
  no longer read a table as one run-on sentence
- **`runs-merged` stops at a cell boundary.** Two kept cells side by side are two adjacent
  kept runs, and are not a builder that forgot to merge them
- A rewritten table - its columns changed - is drawn with the new table first and the
  removed one after it, as any rewritten block is
