# Record contracts

The JSON an adapter **reads**, as JSON Schema. One file per record type, checked against
every example under [`examples/`](../../examples/README.md) by:

```bash
npm run example:check     # or: make contracts
```

The contract of what revlens **writes** is the file one directory up and is generated from
the Zod schema in `packages/core`: [`../bundle.schema.json`](../bundle.schema.json). Do not
confuse the two. The bundle contract is the tool's promise to the viewer; these are the
shape of the material it is built from.

## The files

| Contract | Describes | Read by |
| ---------- | ---------- | ---------- |
| [`structure.schema.json`](structure.schema.json) | `analysis/structure.json` — what the document is, which files are its chapters | `engagement` adapter, at the baseline and at the head |
| [`changes.schema.json`](changes.schema.json) | `docs/changes/<version>/changes.json` — the instructions that produced a version | `engagement` adapter |
| [`comment-round.schema.json`](comment-round.schema.json) | `docs/comments/<round>/<round>.json` — one round of reviewer comments and how each was settled | `engagement` adapter |

These are engagement records: a real engagement writes them by hand, or another tool writes
them, and revlens only reads them. They describe the material, so they belong with the
tool's other contracts and not with the examples that happen to be checked against them.

One contract is deliberately elsewhere.
[`examples/history.schema.json`](../../examples/history.schema.json) describes an example's
own manifest — the file that turns committed snapshots back into a git history — and no
adapter ever sees it. It is a contract of the examples, so it lives with them.

## These are descriptive, and that is the point

`../bundle.schema.json` is generated, so it cannot drift from the code. These are written
by hand from what `packages/adapters/src/sources/engagement.ts` actually does, so they
**can** drift — the adapter parses leniently and would not complain. `make contracts` is
what keeps them honest: it runs every example's records through them, so a contract that no
longer describes reality fails on the examples rather than silently misleading the next
person who writes a record file.

When the adapter changes what it reads, change the contract in the same commit.

## What the joins depend on

Three fields carry more weight than their type suggests, and a record that gets them wrong
produces a bundle that is valid and wrong:

- **`changes.json` → `entries[].received`** — when the entry names no `revision`, its
  calendar day is what joins the instruction to a commit. It has to be the day the change
  was committed.
- **`changes.json` → `entries[].changes[].target`** — the join is by file name. A target
  that names no chapter file ties the entry to no chapter.
- **`<round>.json` → `comments[].resolution.at`** — compared against the baseline's commit
  date to decide whether the comment is in scope at all. A comment settled before the
  baseline had its changes folded into the text the comparison starts from, and can never
  show up as an edit.

A comment id written as `K<round>-<number>` anywhere in an entry's `summary`, `verbatim`,
`notes` or `changes[]` is what turns an instruction into a comment resolution. That is a
convention of the records, not of the bundle.
