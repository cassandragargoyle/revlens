# revlens fixtures

Sample data for the document revision viewer specified in
[INT-002](../docs/issues/002-document-revision-viewer.md).
These files were written before the first line of code, so that the contract was concrete
from the start and the viewer had something to render on day one. The tool is now built —
see [the README](../README.md) — and the sample is the fixture its unit tests run against.

## Files

| File | What it is |
| ---- | ---------- |
| `sample-bundle.json` | One complete bundle: two chapters, four revisions, three comments, seven edits |
| [`../schema/bundle.schema.json`](../schema/bundle.schema.json) | JSON Schema the bundle is validated against — **generated** from the Zod schema in `packages/core`, not hand-edited |

## Where it comes from

The sample is a **shrunk and anonymized** slice of the first real engagement the tool was
built against.
It keeps the shapes that matter and drops everything else:

| Real source | What the sample keeps |
| ----------- | --------------------- |
| `docs/changes/v*/changes.json` | one instruction verbatim per revision, its author, timestamp and commit |
| `docs/comments/K*/K*.json` | reviewer comment verbatim, `check.verdict`, `decision.status`, the answer sent back |
| `analysis/chapters/*.md` | chapter blocks — headings, paragraphs, list items |
| git history of the analysis repository | which revision introduced or removed which run of text |

**Everything identifying is replaced.** Company `Acme Systems`, people `Jan Novák`,
`Petra Dvořáková`, `Martin Svoboda`, products `CORE`, `TINA`, `PARO`, `PLAN`, invented
chapter text, invented commit hashes, invented record ids. No sentence is copied from the
engagement. The Czech wording stays Czech on purpose — diacritics, `—` dashes and Czech
quotation marks are what the renderer has to survive.

## What each case in the sample exercises

- **`R-001`** — a plain instruction, one insertion inside an existing paragraph
- **`R-002`** — one revision, **two edits in different blocks** (a heading and a new list
  item); this is the case the "jump to the next change of the same revision" navigation
  exists for
- **`R-003`** — one comment (`K2-004`) answered in **two chapters**, so the comment panel
  has to list more than one target
- **`R-004`** — a comment accepted only in part (`K2-005`), with an `answer` that goes back
  to the reviewer; both of its edits are replacements, so a deleted and an inserted run sit
  next to each other
- **`ch-02/b-06`** — a block that did not exist in the baseline (`introducedBy`), which the
  viewer marks as a whole rather than run by run

## Invariants a generated bundle must hold

Checked by `revlens validate`; the sample satisfies all of them, and each one has a test
in `packages/core/test/validate.test.ts` that breaks the sample on purpose to prove the
check catches it:

- Concatenating the `kept` and `inserted` runs of a block yields the final text; `deleted`
  runs sit at the position the text was removed from and are excluded from the final text
- Every `inserted` and `deleted` run carries a `revision` and an `edit`; a `kept` run
  carries neither
- Every id referenced (`revision`, `edit`, `block`, `chapter`, comment id) exists
- `revisions[].edits` and `edits[].revision` agree, and `edits[].order` runs in document order
- `insertedChars` / `removedChars` equal the character counts of the runs of that edit
