# INT-002 - Document revision viewer as a TypeScript tool (`revlens`)

## Metadata

- **Status**: Implemented
- **Type**: enhancement
- **Priority**: medium
- **Created**: 2026-09-16
- **Author**: Zdeněk Kurc
- **Target**: `` (npm workspace, TypeScript — Node.js CLI + server, React web app)
- **Related**:
  - [INT-001 — 3D node-graph viewer (`graphlens`)](INT-001-3d-voices-network-viewer.md)
  - [`fixtures/README.md`](../../fixtures/README.md) — sample data, already in the repository
  - [`schema/bundle.schema.json`](../../schema/bundle.schema.json) — data contract, already in the repository

## Feature Description

Provide a **TypeScript tool `revlens`** in `tools/` that shows **how a document was
revised**: the final text as the reader gets it, with every change that produced it
highlighted in place, and — for each change — **when it happened, who caused it, and on
the basis of which comment**.

The reader opens the final document, not a diff. Changes are marked inside it. Clicking a
marked passage answers three questions in one panel:

1. **What changed** — the inserted text, and the removed text it replaced
2. **When and by whom** — timestamp of the revision and the verbatim instruction that
   triggered it
3. **Why** — the reviewer comment being answered, verbatim, with its decision and the
   answer that went back to the reviewer

From that panel the reader steps to **the next change the same revision caused elsewhere
in the document**. One instruction usually lands in several places — a corrected job
title appears in two chapters, an added product module touches a heading, a list and a
cross-reference — and this navigation is the point of the whole tool: it makes a revision
readable as one act instead of as scattered edits.

The tool is **domain-agnostic**. Its input is a single JSON bundle; producing that bundle
from a given repository is an **adapter**. The first adapter reads an engagement laid
out in the house convention, where the change log, the comment
rounds and the git history of the analysis already hold everything the bundle needs.

## Use Case

A deliverable goes out for review, comments come back from several reviewers in several
rounds, the text is reworked, a new version goes out. Today the record of that is spread
across four places that nobody reads side by side:

| Where | What it holds | What it does not hold |
| ----- | ------------- | --------------------- |
| `docs/changes/v*/changes.json` | the instruction verbatim and what changed because of it | the text itself |
| `docs/comments/K*/K*.json` | the reviewer comment verbatim, its decision and its resolution | where in the text it landed |
| git history of the analysis | the actual text change | why it happened |
| Word compare (`version-revize`) | the text change as tracked changes | who asked for it, when, and on what grounds |

The Word comparison comes closest, and it is what reviewers get today — but it answers
only *what* changed. A reviewer who asks *"did anyone actually act on my comment, and
where?"* has to be walked through three files by hand.

`revlens` joins the four sources onto one text. Concretely it serves:

- **the reviewer** — "my comment K2-004 produced these two changes, here they are"
- **the processor** — "everything this instruction touched, so nothing was half-applied"
- **the client's sponsor** — "what happened to the document between version 1.5 and 1.6,
  and on whose input"

## Proposed Solution

> **Implemented as proposed.** This section is kept as written, so that what was designed
> can be read against what was built; where the implementation diverged, the
> [Implementation notes](#implementation-notes) at the end say so. The data contract and
> the sample data already existed in `` and were the starting point, not an
> output, of the work.

### Where it lives and why it is not Python

`scripts/` is a single `uv` Python project; a Node toolchain cannot live inside it
without breaking that. `revlens` therefore gets its own root, ``, as an
**npm workspace** — one lockfile, four packages, one `tsconfig` base:

```text
tools/revlens/
  package.json            # npm workspaces root, scripts: build, test, lint, dev
  tsconfig.base.json
  schema/
    bundle.schema.json    # exists — generated from the Zod schema at build time
  fixtures/
    sample-bundle.json    # exists — anonymized sample, see fixtures/README.md
  packages/
    core/                 # types, Zod schema, validation, indexes, navigation logic
    adapters/             # source adapters (the engagement layout first), git + markdown plumbing
  apps/
    cli/                  # revlens build | validate | serve
    server/               # Fastify, read-only API + static hosting, MCP server (--mcp)
    web/                  # React + Vite single-page app
```

`core` is the only package both the server and the web app depend on, so the navigation
rules ("next edit of this revision", "comments that produced this block") are written
once and unit-tested without a browser.

### Data contract

One JSON bundle per document, validated against
[`schema/bundle.schema.json`](../../schema/bundle.schema.json). Full
description and the worked example are in
[`fixtures/README.md`](../../fixtures/README.md); the shape in brief:

```json
{
  "schemaVersion": "1.0",
  "document": { "id": "…", "version": "1.2", "baseline": { "version": "1.0" } },
  "chapters": [
    {
      "id": "ch-02",
      "title": "Produkty a jejich hranice",
      "blocks": [
        {
          "id": "ch-02/b-02",
          "kind": "heading",
          "level": 3,
          "runs": [
            { "kind": "kept", "text": "2.1 Rodina CORE — jádro a moduly " },
            { "kind": "deleted", "text": "TINA a PARO", "revision": "R-002", "edit": "E-004" },
            { "kind": "inserted", "text": "TINA, PARO a PLAN", "revision": "R-002", "edit": "E-004" }
          ]
        }
      ]
    }
  ],
  "revisions": [
    {
      "id": "R-002",
      "kind": "comment-resolution",
      "at": "2026-09-10T11:05:00+02:00",
      "author": { "name": "Jan Novák", "side": "processor" },
      "verbatim": "doplň PLAN, podklad ho vede od července",
      "commit": "b2c3d4e",
      "comments": ["K1-002"],
      "edits": ["E-004", "E-005"]
    }
  ],
  "comments": [
    {
      "id": "K1-002",
      "author": { "name": "Petra Dvořáková", "side": "reviewer" },
      "verbatim": "Chybí zde PLAN — plánování investic a jejich realizace.",
      "decision": { "status": "prijato" },
      "revisions": ["R-002"]
    }
  ],
  "edits": [
    { "id": "E-004", "revision": "R-002", "chapter": "ch-02", "block": "ch-02/b-02", "order": 4, "kind": "replace" }
  ]
}
```

Three decisions behind this shape:

- **Attribution sits in the text, not beside it.** A block is a list of runs; every run is
  either `kept` (present in the baseline and still present), `inserted` or `deleted`.
  Rendering the final document is concatenating the non-deleted runs — no offset
  arithmetic in the renderer, no way for the highlight to drift out of alignment.
- **`edits` is the navigation spine.** One edit is one contiguous change in one block; a
  replacement is a single edit holding both its deleted and its inserted run.
  `revisions[].edits` in document order is exactly what the "next change of this revision"
  button walks.
- **Deletions are kept, not dropped.** A deleted run stays in the block at the position it
  was removed from. Clean mode hides it; review mode strikes it through. Without it, "what
  did my comment actually remove" cannot be answered.

### How the bundle is produced: token blame with tombstones

The hard part is not the diff, it is that a change made three revisions ago must still be
highlighted **in today's text**, at the position it now occupies. A pairwise diff cannot
do that; blame can.

The builder walks the commits from the baseline to the head **oldest first**, and keeps
an attributed token list per block:

1. **Parse** each chapter file at each commit into blocks with `remark` (mdast), keeping
   the heading path. Block identity is `chapterId/b-NN` assigned on the baseline and
   carried forward; a block whose text changed is matched to its predecessor by
   similarity (Dice coefficient over token bigrams) above a threshold, below which it
   counts as a new block (`introducedBy`) and the old one as removed (`removedBy`).
2. **Diff** the previous and current token list of each block at word level
   (`diff-match-patch` on words, not characters — character diffs shred Czech words into
   unreadable fragments).
3. **Apply** the diff to the attribution state: inserted tokens get the current revision;
   deleted tokens are not thrown away but turned into **tombstones** carried at their
   position; tokens that survive keep whatever attribution they already had.
4. **Emit** the final state as runs — consecutive tokens with the same attribution are
   merged into one run, which keeps the bundle small and the highlighting readable.

Tokens deleted by a later revision that were themselves inserted by an earlier one are
dropped entirely (they never reached the reader) but counted in a build report, so a
sequence of "added then removed again" is visible as churn without polluting the text.

### How a commit becomes a revision

The builder joins the git history to the records that explain it:

| Join | Source | Rule |
| ---- | ------ | ---- |
| commit → instruction | `docs/changes/v*/changes.json`, field `revision` | entry whose `revision` is the commit; several entries per commit are allowed and produce several revisions sharing a timestamp |
| revision → comment | `docs/comments/K*/K*.json`, `resolution.changes[]` and `decision` | comment whose resolution names the same target file, or whose id is named in the change entry |
| revision → author, time, verbatim | the change entry (`author`, `received`, `verbatim`) | the commit's own author and date are the fallback |

A commit with no matching record still becomes a revision, with `kind: "unknown"` and the
commit message as its title. The build prints how many edits ended up unexplained — that
number is the quality measure of the bundle and belongs in the report, not hidden.

### Backend

**Node.js + TypeScript with Fastify, stateless, no database.** The bundle is a generated
file, the viewer is read-only, and nothing the user does in the UI is persisted — so a
database would be a component with nothing to store. Recommended over the alternatives:

- **Static-only SPA (no server).** Works, and the tool must keep supporting it —
  `revlens build --static` writes a self-contained directory that can be zipped and sent.
  But it loads the whole bundle up front and cannot rebuild, which is painful while the
  document is being worked on.
- **Server with a database.** Nothing to keep: the source of truth is the repository, and
  a stale copy in a database is a liability on a document that changes daily.

The server therefore does three things: serve the built SPA, serve the bundle (whole, or
per chapter for large documents), and rebuild on request (`POST /api/rebuild`) so the
viewer can be refreshed while chapters are being edited. It binds `127.0.0.1` by default —
the material is internal and must not be exposed by accident.

```text
GET  /api/bundle                 # metadata, revisions, comments, edit index (no chapter text)
GET  /api/chapters/:id           # one chapter with its blocks and runs
GET  /api/revisions/:id          # one revision with its edits resolved
POST /api/rebuild                # re-runs the adapter, returns the build report
```

### MCP server — the same tool driven by an assistant

Started with `--mcp`, the backend additionally exposes an **MCP server**, so the tool can
be driven by an AI assistant and not only by a person in a browser. The questions the
viewer answers by clicking are the questions an assistant should be able to ask directly:
*which changes did comment K2-004 produce*, *what else did this revision touch*, *what
does chapter 4 look like in review mode*, *how many edits stayed unexplained*.

```bash
revlens serve bundle.json --mcp
```

- **Transport is stdio**, which is what an assistant host spawns. The HTTP server keeps
  running alongside it, so the same process serves the browser and the assistant — one
  bundle, one rebuild, no second copy that can go stale.
- **All logging moves to stderr** when `--mcp` is on. Anything written to stdout would
  corrupt the protocol stream.
- The exposed tools are **read-only except `rebuild`**, mirroring the API: document and
  chapter list, chapter text in a chosen mode, revision with its edits resolved, comment
  with the revisions and edits that answered it, edit with its siblings, free-text search
  over the verbatims, validation report, rebuild.
- The MCP surface is a **projection of `core`**, not a second implementation. An assistant
  and a reader who disagree about which edits a revision produced would make the tool
  useless as evidence.

### Frontend

**React + Vite + TypeScript.** Three regions:

- **Left** — chapter navigation and the **revision timeline**: revisions in time order,
  each with author, time, edit count and the comment it answers; selecting one dims every
  change that does not belong to it.
- **Centre** — the document. Insertions underlined in the revision's colour, deletions
  struck through, whole new blocks marked in the margin. A **mode switch** flips between
  *clean* (final text only), *review* (insertions and deletions) and *baseline* (the text
  as the reviewers received it).
- **Right** — the inspector for the selected edit: the revision (when, who, verbatim
  instruction), the comment behind it (author, verbatim, decision, the answer sent back),
  and the list of **sibling edits of the same revision** with jump links.

Interaction requirements:

- Clicking any marked passage selects its edit and opens the inspector
- **`n` / `p`** step to the next and previous edit of the **selected revision**, scrolling
  it into view and keeping the selection anchored; `j` / `k` step through all edits in
  document order regardless of revision
- **Escape** clears the selection and returns to the unfiltered document
- Filters combine: by revision, by author, by comment round, by date range, and
  free-text search over comment and instruction verbatims
- Every selection is addressable: `#/edit/E-004`, `#/revision/R-002`, `#/comment/K1-002` —
  a link to a specific change can be pasted into an e-mail
- The heading of each chapter carries a count of the changes inside it, so an untouched
  chapter is visible as untouched
- **Print / export to PDF** of the current view, so the review state can be attached to a
  message without sending the tool

UI strings are **Czech** (the readers are the engagement team and the client), held in one
dictionary module; code, identifiers, comments and documentation stay English per the
repository rules.

### Browsing the review itself, not only the text

Everything above enters through the text: the reader finds a marked passage and asks what
produced it. The opposite direction has to work too — **start from the review and ask what
became of it**. A round of comments comes back, decisions are taken, some are worked into
the text and some are not, and the question *"what happened to all of it"* has no answer in
a view that can only be reached by clicking a passage. A comment that was decided and never
worked in is invisible in the document by definition, and it is exactly the one worth
finding.

The engagement's records carry a comment through **three gates**, and the viewer has to
show all three, because they answer different questions and can disagree:

| Gate | Field | Values in the engagement | Question it answers |
| ---- | ----- | ------------------------ | ------------------- |
| **Ověření** | `check.verdict` | `potvrzeno`, `potvrzeno-s-upresnenim`, `mimo-text`, `neplati` | Is the objection factually right? |
| **Rozhodnutí** | `decision.status` | `prijato`, `prijato-castecne`, `zamitnuto`, `odlozeno`, `nerozhodnuto` | What did the processor decide to do? |
| **Vypořádání** | `resolution.state` | `hotovo`, `rozpracovano`, `nezahajeno`, `odpada` | Has it actually been worked into the text? |

A comment can be **confirmed, accepted and still not worked in** — 9 of the engagement's
140 are `rozpracovano` and 5 are `nezahajeno`. Nothing in the document shows that, which is
the point of browsing the review directly.

**A fourth fact decides whether the other three can be read at all: whether the comment was
settled before the baseline.** Such a comment produced no change in this comparison, but
only because its edits are inside the text the comparison starts from — it is out of scope
by construction, not evidence that nobody acted. Conflating the two is a false alarm at
scale: on the engagement, "produced no change" answers 92 of 140, and the number that means
something is 27. The bundle therefore carries the baseline's timestamp, the standing of a
comment carries `beforeBaseline`, and the filters keep the two apart.

The comparison is by **instant, not by day**. A whole round of the engagement was recorded
at 06:06 on the morning of the day the baseline build was cut at 23:11 that evening; day
granularity put sixty-odd records on the wrong side of the line.

**The contract gains `resolution`.** `comments[]` already holds the verdict, the decision
and the answer sent back; it must also hold **how the comment was worked in** — the state,
the changes the processor recorded, and when. Without it the third gate cannot be shown or
filtered, and the adapter is currently dropping the field.

**The left column gains a third view.** It switches between **Kapitoly**, **Revize** and
**Připomínky**:

- **Připomínky** lists every comment with its round, its author, and a badge for each of
  the three gates. Selecting one opens it in the inspector and jumps to the first change it
  produced; a comment that produced none says so instead of opening an empty document.
- **Revize** is the timeline as before, and each entry now also shows how the comments it
  answers were disposed of.

**Filters extend to all three gates**, and combine with the filters that already exist.
Filtering by `vypořádání = rozpracovano` is the "what is still open" list; filtering by
`rozhodnutí = zamitnuto` is "what we declined, and what we told them". The live count
applies to comments as it does to changes.

The same reaches the API (`GET /api/comments`) and the MCP tools (`revlens_comments`), so
an assistant can be asked "which accepted comments have not been worked in yet" and get the
same answer the reader sees.

### An About page

The viewer is handed to people who did not build it - a reviewer opening a link, the
client's sponsor, a colleague picking the engagement up later. The three columns say what
changed; nothing on the screen says **what this thing is, what it is showing, and where
those numbers came from**.

`#/about` answers that, and is reachable from the header:

- **What the tool is for**, in a few sentences, over the cover image
  ([`README.png`](../../README.png)) - which is not
  decoration: it shows one node on a timeline with three lines running into three marked
  passages of one page, which is precisely the navigation the whole tool exists for. The
  caption says so, rather than leaving the reader to guess.
- **How to read the document** - the three modes, the keys, and what a mark means.
- **The three gates a comment passes**, named with the values the records actually use.
- **Which identifiers are durable and which are not**, because a reader who pastes a link
  into an e-mail needs to know that `#/edit/…` survives a rebuild and `ch-04/b-17` does not.
- **The provenance of this particular bundle** - the document and its version, the baseline
  it is measured against, when it was generated and by what, the totals, and how many
  changes stayed unexplained. A viewer that cannot say where its numbers came from is not
  evidence.

It is a page, not a modal: `#/about` has to be linkable, and it has to print.

### Identifiers that survive a rebuild

`E-001`, `E-002`, … in document order reads well and is useless as an address. Change the
baseline and `E-050` is a different change; insert a paragraph and everything after it
shifts. A link pasted into an e-mail would rot the next time anyone rebuilt the bundle -
and a link that can be pasted into an e-mail is one of the things asked for above.

**An id is therefore derived from what the change is, not from where it sits.**

| Thing | Identified by | Why that is stable |
| ----- | ------------- | ------------------ |
| revision | the record it came from (`docs/changes/…#IN-047`) **and** the commit it was made in, hashed | both are facts about the engagement, not about this build |
| edit | its revision, its kind, and the text it inserted and removed, hashed | that is what a reader recognises the change by |
| block | assigned on the baseline and carried forward | unchanged; block ids stay build-local |

Two details decide whether this works at all. The commit must be the **full** hash - git
lengthens the abbreviation as a repository grows, and an id that changed because the
repository got bigger would defeat the point. And the record alone is not enough: one
change-log entry can account for several commits when the join falls back to matching by
target and date, so the record and the commit identify a revision **together**.

Document position moves to `order`, which is where a position belongs, and the viewer
shows it.

**The known limit.** Two byte-identical changes of one revision - the same words inserted
in two places - are told apart only by their rank among themselves. If one of them exists
in one build and not in another, nothing can say which of the two the survivor is;
location could, and location is what the id must not depend on. Measured on the
engagement, comparing a build from the 1.5 baseline with one from the first chapter
commit, **100 of the 102 changes present in both keep the same id**; the two that do not
are one-character insertions made twice by one revision.

### Performance

The real document is ~150 pages, with hundreds of revisions. The chapter list loads
without text, chapters load on demand and long chapters render through a virtualized list;
the edit index is built once in `core` as a map, never by scanning runs on every render.
Target: first paint under two seconds on the full analysis, navigation between sibling
edits instant.

### Trade-offs to decide at implementation

- **Block matching threshold** — too low and a rewritten paragraph is reported as one
  edited block, too high and it becomes "removed plus added". Start at Dice ≥ 0.5 over the
  baseline, verify against the engagement's real history, record the value in an ADR.
- **`isomorphic-git` vs. shelling out to `git`** — shelling out is simpler and fast enough
  for a local tool; `isomorphic-git` avoids the dependency on a `git` binary. Start with
  shelling out unless a reason emerges.
- **Word tracked changes as a second input** — `docx_compare.ps1` already produces a Word
  file with real tracked changes. Reading OOXML revisions (`w:ins` / `w:del`) as an
  adapter would cover documents that never lived in git. Out of scope for the first
  version, but the contract must not make it impossible.
- **Package manager** — npm workspaces (zero extra tooling) versus pnpm (faster, stricter).
  npm unless the install time becomes a problem.

### Non-goals

- **Not an editor.** Nothing in the UI writes to the document; the repository stays the
  source of truth.
- **Not a replacement for `version-revize`.** What goes to the client stays a Word file
  with real tracked changes they can accept and reject. `revlens` is the reading view.
- **No authentication, no hosting.** Local tool, local bind. Publishing it to a URL for
  the client is a separate decision with a separate issue.

## Acceptance Criteria

- [x] `` is an npm workspace in TypeScript with `core`, `adapters`, `cli`,
      `server` and `web`; `npm run build`, `npm test` and `npm run lint` pass from its root
- [x] `revlens validate <bundle.json>` checks a bundle against the schema **and** the
      invariants listed in `fixtures/README.md`, and fails with a located message
- [x] `fixtures/sample-bundle.json` validates, renders in the viewer, and is
      used as the fixture of the unit tests
- [x] `revlens build --source engagement --repo <path> --from <baseline> --out <bundle.json>`
      produces a valid bundle from the engagement repository
- [x] The build joins commits to `docs/changes/v*/changes.json` entries and to
      `docs/comments/K*/K*.json` comments, and its report states how many edits stayed
      unexplained
- [x] Attribution survives later edits: a change from three revisions back is highlighted
      at the position it occupies in today's text (covered by a test over a synthetic
      three-commit history)
- [x] The final document renders from the bundle with insertions, deletions and whole new
      blocks marked, and a clean / review / baseline mode switch
- [x] Clicking a marked passage opens the inspector with the revision (when, who, verbatim
      instruction) and the comment behind it (author, verbatim, decision, answer)
- [x] The inspector lists the sibling edits of the same revision, and `n` / `p` jump
      between them with the selection anchored; `j` / `k` walk all edits in document order
- [x] Filters by revision, author, comment round and date range combine with a free-text
      search, and a live count shows how many changes are visible
- [ ] Both side columns are resizable by dragging the divider, with the arrow keys as an
      equal path and Home to restore the default; the width is remembered per browser and
      its absence never stops the page rendering
- [ ] The left column switches between **Kapitoly**, **Revize** and **Připomínky**; the
      comment list shows every comment with its round, its author and a badge for each of
      the three gates, and selecting one opens it in the inspector
- [ ] A comment that produced no change says so, rather than opening an empty document —
      this is the "decided but not worked in" case the list exists to surface
- [ ] `comments[].resolution` carries the state, the recorded changes and the time; the
      adapter fills it from `resolution` in the comment records
- [ ] Filters by verdict, decision and resolution state combine with the existing filters,
      with a live count over the comments
- [ ] A comment settled before the baseline is marked as out of scope rather than counted
      as one nobody acted on; `beforeBaseline` filters it, the build report counts it
      separately from a genuine join failure, and the comparison is made by instant
- [ ] `GET /api/comments` and the `revlens_comments` MCP tool answer the same filtered
      question the browser does, so "which accepted comments are not yet worked in" has one
      answer
- [x] `#/edit/…`, `#/revision/…` and `#/comment/…` deep links open the corresponding
      selection on a cold load
- [ ] `#/about` is a linkable page reachable from the header, carrying the cover image
      with a caption that names what it shows, how to read the document, the three gates,
      which identifiers are durable, and the provenance of the loaded bundle
- [ ] **A deep link survives a rebuild.** Edit and revision ids are derived from what the
      change is - the record and the commit behind the revision, and the text the edit
      inserted and removed - not from where it sits in the document. Document position
      lives in `order`. The property is verified against the engagement by building from
      two different baselines and comparing the ids of the changes present in both
- [x] `revlens serve <bundle.json>` starts a local server bound to `127.0.0.1`, serves the
      SPA and the read-only API, and `POST /api/rebuild` refreshes the bundle
- [x] `revlens serve <bundle.json> --mcp` additionally exposes an MCP server over stdio
      with tools for the document, a chapter in a chosen mode, a revision with its edits,
      a comment with the edits that answered it, an edit with its siblings, free-text
      search, validation and rebuild; with `--mcp` on, nothing but the protocol is written
      to stdout
- [x] `revlens build --static` writes a self-contained directory that works from the file
      system with no server and no external CDN
- [x] The full analysis of the engagement (~150 pages, hundreds of revisions) loads in
      under two seconds and navigates without visible lag
- [x] Unit tests in `core` and `adapters` (Vitest) plus one end-to-end smoke test of the
      web app; CI runs them
- [x] UI strings in Czech from a single dictionary; code, comments and documentation in
      English

## Notes

- The data contract and the anonymized sample were written before the issue was filed and
  are already in the repository — `schema/bundle.schema.json` and
  `fixtures/`. They are the specification of the interface between the
  builder and the viewer; changing them is a change to this issue.
- The sample is a shrunk, anonymized slice of a real engagement:
  invented company, people, products and record ids, Czech wording kept so that diacritics
  and dashes are exercised. Provenance and what each case covers are in
  `fixtures/README.md`.
- The schema is hand-written for now; once `core` exists it is **generated from the Zod
  schema** at build time, so the types and the schema cannot drift apart.
- Two decisions deserve an ADR once they are settled: the attribution algorithm (token
  blame with tombstones, and the block matching threshold) and the tool's runtime and
  packaging (Node workspace under `tools/`, parallel to the Python tooling in `scripts/`).

## Implementation notes

Written after the build, against what the section above proposed.

### What the real data changed

- **The change log names commits of the wrong repository.** `docs/changes/v*/changes.json`
  records `revision` as a commit of the engagement repository, while the chapters live in
  the nested analysis repository with its own hashes — so the join by hash, which the
  proposal treats as the primary rule, matches nothing. Two fallbacks were added and the
  build report says which one was used for each commit: an entry whose `changes[].target`
  names a chapter the commit touched **on the day the commit was made**, and, failing
  that, a comment whose `resolution.changes[]` names one. On the engagement's full history
  this took the unexplained edits from 116 of 171 down to 27, and the comments joined from
  2 of 140 up to 86.
- **`check.evidence` has no field in the contract.** The comment records carry a list of
  citations the bundle cannot hold. The adapter drops it and leaves the `source` link,
  which takes the reader to the record itself. Worth a contract change if it is missed.
- **Some comments are scoped to chapters that no longer exist** (`ch-11-role`,
  `ch-12-rozjezd`) or to `document_wide`. These are reported as warnings rather than
  errors: the bundle is still correct, the records have simply outlived a renumbering.

### What scale changed

Three rules were added to the attribution, and are recorded in
[ADR-004](../adr/ADR-004-revlens-attribution-token-blame.md): fragments
close together count as one change; the churn rule applies to whole blocks as well as to
words; and the kind of a change is settled from the runs that survive rather than from the
diff that made it. The last two were invisible over a five-commit test history and
produced 41 invariant failures over the engagement's 83 commits.

### Measured

Against the analysis at version 1.6, built from the first chapter commit — 83 commits, 125
revisions, 1 907 edits, 1 367 blocks, ~185 pages of text, a 1.84 MB bundle:

| What | Time |
| ---- | ---- |
| Build (paid once, into the bundle) | 36 s |
| Parse and validate the bundle | 64 ms |
| Build the index | 1.5 ms |
| Render the largest chapter (205 blocks) | 0.2 ms |
| Free-text search over every verbatim | 6 ms |
| Step to the next change of the same revision | 0.1 ms |
| **First paint, whole application, in jsdom** | **281 ms** |
| **Step to the next change, whole application** | **182 ms** |

jsdom has no layout engine and is slower than a browser, so these are upper bounds. The
budget was two seconds.

### Deviations

- **Virtualization is `content-visibility: auto`**, not a windowing library. The browser
  skips the layout of a block outside the viewport, which is the same result for one line
  of CSS instead of a dependency.
- **The end-to-end web test runs in jsdom**, not in a real browser. It drives the whole
  application — clicking, `n`/`p`, `j`/`k`, Escape, deep links, modes, filters — but it
  does not prove anything about rendering in a real browser engine.
- **The builder emits no `summary` per edit and never produces a `move`.** The inspector
  shows the inserted and removed text instead, which is the same information without an
  invented sentence. `move` stays in the contract for a later adapter.
- **CI did not exist in this repository.** `.gitea/workflows/revlens.yml` is the first
  workflow and covers only ``; the Python tooling in `scripts/` is still not
  wired up.

### Follow-up worth its own issue

- The change log would join exactly if it recorded the analysis repository's commit
  alongside the engagement's. That is a change to how changes are recorded, not to this
  tool.
- 63 block matches in 1 367 sit within 0.1 of the Dice threshold. Whether that needs
  tuning is a question for someone who has looked at where they fall.
