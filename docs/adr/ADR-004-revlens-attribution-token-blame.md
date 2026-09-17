# ADR-004: Attribute Revisions by Token Blame with Tombstones (`revlens`)

## Status

**Draft** — captured 2026-09-16. Awaiting review and acceptance.

## Metadata

- **Created**: 2026-09-16
- **Author**: Zdeněk Kurc
- **Target**: `packages/adapters/` (attribution builder)
- **Related**:
  - [INT-002 — document revision viewer](../issues/002-document-revision-viewer.md)
  - [ADR-005 — revlens runtime and packaging](ADR-005-revlens-node-workspace-packaging.md)
  - [`schema/bundle.schema.json`](../../schema/bundle.schema.json)

---

## Context

[INT-002](../issues/002-document-revision-viewer.md) asks for the final
text of a deliverable with every change that produced it highlighted **in place**, each
change carrying the revision that made it and the reviewer comment behind it.

The naive implementation is a diff between the baseline and the head. It does not work,
for one reason that decides the whole design:

> A change made three revisions ago must still be highlighted **at the position it
> occupies in today's text**, not at the position it occupied when it was made.

A pairwise diff of baseline against head knows only *that* a passage differs; it cannot
say *which* of the eleven revisions between them produced it. A chain of pairwise diffs
does no better, because each diff is computed against a text the previous diff has
already rewritten, and offsets stop meaning anything after the first insertion.

What the viewer needs is per-token provenance carried forward — the same thing
`git blame` does for lines, one granularity down, and inside a document that is being
reflowed rather than appended to.

### Constraints carried from INT-002

- The bundle stores a block as a **list of runs** (`kept` / `inserted` / `deleted`); the
  renderer concatenates and never does offset arithmetic. Attribution must therefore be
  resolved at build time, not at render time.
- **Deleted text is part of the answer**, not noise — "what did my comment actually
  remove" is one of the three questions the tool exists to answer. Deletions cannot be
  dropped, and they have to keep the position they were removed from.
- The source language is Czech. Diacritics, em dashes and Czech quotation marks must
  survive the round trip.
- The first data source is an engagement in the house layout, where the change log
  (`docs/changes/v*/changes.json`) and the comment rounds (`docs/comments/K*/K*.json`)
  live in one repository and the chapters in a nested one.

### Options considered

| Option | Attribution across revisions | Deletions | Cost | Notes |
| ------ | ---------------------------- | --------- | ---- | ----- |
| **Token blame with tombstones** | Correct — provenance carried per token | Kept in place as tombstones | O(commits × blocks) diffs at build time | Chosen |
| Pairwise diff baseline to head | Impossible — one anonymous "changed" bucket | Positioned, but unattributed | Cheapest | Answers *what*, never *who* or *why* |
| Chain of pairwise diffs, offsets remapped | Fragile — offsets invalidated by every earlier edit | Drift out of position | Medium | Fails exactly where the document was reflowed |
| CRDT / operational transform log | Correct | Correct | High — needs the editor to cooperate | The document is edited in Word and in git, not in an OT editor |
| OOXML tracked changes (`w:ins` / `w:del`) | Correct within one comparison | Correct | Low | Only knows *what*; no link to instruction or comment. Kept as a **future second adapter**, not the primary source |

## Decision

Build the attribution by **walking the commits from the baseline to the head, oldest
first, maintaining an attributed token list per block**.

### The algorithm

1. **Parse.** Each chapter file at each commit is parsed with `remark` (mdast) into
   blocks — headings, paragraphs, list items, quotes — keeping the heading path. Block
   identity is `chapterId/b-NN`, assigned on the baseline and carried forward.
2. **Match blocks.** A block whose text changed is matched to its predecessor by the
   **Dice coefficient over token bigrams**. Above the threshold it is the same block,
   edited; below it, the old block counts as removed (`removedBy`) and the new one as
   introduced (`introducedBy`).
3. **Diff at word level.** The previous and current token lists of a matched block are
   diffed with `diff-match-patch` **on words, not characters**. Character diffs shred
   Czech words into unreadable fragments — `vedoucí` against `vedoucího` becomes a
   two-character insertion in the middle of a word, which no reader can use.
4. **Apply to the attribution state.**
   - Inserted tokens take the current revision.
   - Deleted tokens are **not discarded** — they become **tombstones** carried at the
     position they were removed from, with the revision that removed them.
   - Surviving tokens keep whatever attribution they already had. This is the step that
     makes a three-revisions-old change still highlightable today.
5. **Emit runs.** Consecutive tokens sharing an attribution are merged into one run.
   This is what keeps the bundle small and the highlighting readable — a sentence
   inserted by one revision is one run, not forty.

### Churn is counted, not rendered

A token inserted by one revision and deleted by a later one **never reached the reader**.
Such a token is dropped from the bundle entirely, but counted in the build report. The
document shows what the reader sees; the report shows that the passage was written and
withdrawn.

### Block matching threshold

The threshold is **Dice at least 0.5** over token bigrams, and it is a **configurable
build parameter**, not a constant compiled into the builder.

The value is a trade-off with failure modes in both directions:

- Too low — a paragraph that was genuinely rewritten is reported as one edited block, and
  the reader is shown a shredded mixture of old and new fragments.
- Too high — an ordinary edit becomes "block removed, block added", and the connection
  between the reviewer comment and the sentence it changed is lost.

0.5 is the starting point, and it has now been measured against the engagement's real
history (83 commits touching chapters, from the first chapter commit to version 1.6):

| Observation | Value | What it says |
| ----------- | ----- | ------------ |
| Block matches within 0.1 of the threshold | 63 of 1 367 blocks | About 5% of blocks sit close enough that another threshold would flip them |
| A five-word sentence with one word replaced by three | **exactly 0.5** | The commonest correction lands precisely on the threshold |

The second row decides how the comparison is written: **the threshold is inclusive**.
`Vlastníkem produktové roadmapy je CTO.` against `… je vedoucí oblasti Technology.`
shares 3 bigrams out of 5 + 7, which is 0.5 to the digit. A strict `>` would report that
ordinary correction as "paragraph removed, paragraph added" and lose the link from the
reviewer comment to the sentence it changed. The case is pinned by a test.

The build report states how many blocks fell near the threshold, so a bad value stays
visible rather than silent.

### Unexplained edits are reported, not hidden

A commit with no matching record in the change log still becomes a revision, with
`kind: "unknown"` and the commit message as its title. The build reports **how many edits
ended up unexplained**. That number is the quality measure of the bundle; hiding it would
make an incomplete join look like a complete one.

## Consequences

### Positive

- Attribution is correct across the whole history, which is the one thing the tool is
  for. "My comment produced these two changes, here they are" becomes answerable.
- The renderer stays trivial — concatenate the non-deleted runs. A highlight cannot drift
  out of alignment, because there are no offsets to drift.
- Deletions are answerable, and they sit where the text was removed from.
- The cost is paid once at build time, into a generated file; the viewer stays fast.

### Negative / costs

- The builder is the complex part of the tool, and it is complex in a way that needs
  tests over synthetic histories rather than over the real document alone.
- Build time grows with the number of commits, not with the size of the document. A long
  history is slow to build even for a short chapter.
- The threshold is a tuning parameter, and a tuning parameter is a thing that can be set
  wrong. Mitigated by reporting near-threshold matches instead of swallowing them.
- Tombstones make the bundle larger than the final text — the price of being able to
  answer what was removed.

### What the implementation added

Three rules emerged while building this against the real history, and they belong with
the algorithm rather than living only in the code:

- **Fragments close together are one change.** A word diff of `TINA a PARO` against
  `TINA, PARO a PLAN` comes back as three fragments with one surviving word between them.
  A reader sees one corrected heading, so fragments separated by at most three surviving
  words become one edit. Further apart they stay two, because a reader scrolling between
  them sees two.
- **The churn rule applies to whole blocks too.** A paragraph removed as a whole may hold
  words inserted after the baseline. Those reached the reader of neither version, so they
  are dropped and counted rather than shown struck through under the removing revision —
  which would attribute one revision's words to another.
- **The kind of a change is settled from the runs that survive**, not from the diff that
  produced it. A replacement whose inserted words are themselves removed three revisions
  later is, to the reader of the final document, a deletion.

The last two surfaced only at scale: both were invisible over a five-commit history and
produced 41 invariant failures over the engagement's 83.

### Follow-up actions

- [x] Verify the Dice threshold against the real history of the analysis and record the
  value that was settled on here.
- [x] Cover attribution survival with a test over a synthetic history — a change from
  three revisions back highlighted at today's position.
- [ ] Decide whether 63 near-threshold matches in 1 367 blocks are worth tuning for, once
  a reader has looked at where they fall.
- [ ] Revisit when an OOXML adapter is added, so that a document that never lived in git
  can still be read through the same bundle.

---

**Created**: 2026-09-16
**Last Updated**: 2026-09-16
