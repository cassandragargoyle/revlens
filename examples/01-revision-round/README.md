# Example 01 — one review round

An analysis document goes out for review as version 1.5, comes back with comments, and is
reworked into version 1.6. That is the whole job revlens exists for, and this example is
the smallest engagement that still contains every part of it: instructions that changed
the text, reviewer comments that caused some of those changes, and changes nobody asked
for in writing.

Nothing here is real. Invented company `Acme Systems`, invented people, invented text.

## Running it

From the repository root:

```bash
make demo                 # compile, build the bundle, open the viewer
make demo LANGUAGE=cs     # the same engagement, written in Czech
```

The example is written twice, in `en/` and in `cs/`. The two tell the same story with the
same ids, the same dates and the same shape of change — the Czech variant is the one that
proves the renderer survives diacritics, `—` dashes and Czech quotation marks, and the
English variant is the one to read if you do not read Czech.

## What is in it

Three chapters, six commits, five instructions, four reviewer comments across two rounds.
The comparison runs from the `baseline` tag (version 1.5, 10 February 2026) to `HEAD`
(version 1.6).

| Record | What it did | Shows |
| ---------- | ---------- | ---------- |
| `CH-001` | A sentence added inside an existing paragraph | An **insert** that has to be highlighted in place, not as a new paragraph |
| `CH-002` | The `PLAN` module added to a heading **and** to the list under it | One revision, **two blocks** — the case the "next change of this revision" navigation exists for |
| `CH-003` | A job title corrected in chapter 1 **and** chapter 3 | One revision, **two chapters**, answering comment `K2-004` |
| `CH-004` | A completeness claim attributed to its source, and the source named | A comment accepted **in part** (`K2-005`), with an `answer` that went back to the reviewer, and a paragraph that did not exist in the baseline |
| `CH-005` | A sentence dropped | A **deleted block** — text the final document no longer contains, which only the bundle can still show |

And four comments, each of which ends somewhere different:

| Comment | Round | Ends as | Shows |
| ---------- | ---------- | ---------- | ---------- |
| `K2-004` | K2 | Accepted, worked in | The ordinary path: comment → revision → two edits |
| `K2-005` | K2 | Accepted in part, in progress | A comment whose answer is a negotiation, not a yes |
| `K2-006` | K2 | Confirmed, then rejected | A comment that is **factually right and still changes nothing** — the third gate |
| `K1-002` | K1 | Worked in before the baseline | A record that is **out of scope**, not a failed join |

`K2-006` and `K1-002` are the point of the example as much as the others are. A tool that
only shows what changed cannot answer "what happened to my comment?", and those two are
the cases where the document itself has nothing to say.

## What the build report says

```text
commits       5
revisions     5
edits         8
unexplained   0
comments      2 of 4 joined to a revision

warnings (3)
  the change log names commits of another repository, so all 5 explained commits were
    joined by target path and date instead of by hash
  1 comments were worked in before the baseline and are out of scope for this comparison
    - not a failed join
  1 comments resolved within the compared range could not be joined to any commit: K2-006
```

All three warnings are expected, and each one is worth understanding:

- **Joined by target path and date.** A change log entry names the commit it was carried
  out in, in its `revision` field. In a real engagement the change log lives in one
  repository and the chapters in another, so that hash names nothing here; the entries in
  this example leave the field out entirely, which makes the fallback join the only join.
  It matches an entry whose `changes[].target` names a chapter the commit touched, on the
  day the entry was received — which is why the commit dates in `history/history.json` are
  fixed rather than taken from the clock.
- **Out of scope.** `K1-002` was worked in on 28 January, before the 10 February baseline,
  so its changes are inside the text the comparison starts from. It can never appear as an
  edit. Reporting it as "could not be joined" would be a false alarm.
- **Could not be joined.** `K2-006` was rejected. Nothing in the document answers it, and
  nothing should. This line is the report being honest, not the build failing.

## Known rough edge

The bundle's baseline label comes out in Czech even in the English variant —
`packages/adapters/src/sources/engagement.ts` writes it as a fixed string rather than
taking it from the document's language. The example surfaces it; it is not something the
example can fix.

## The files

```text
en/                       # and cs/, the same again
  docs/
    changes/v1.6/changes.json                        five instructions
    comments/K1-20260120-dvorakova/...json           round K1, one comment
    comments/K2-20260213-svoboda/...json             round K2, three comments
  history/
    history.json                                     six commits: who, when, which snapshot
    00-baseline/                                     version 1.5, tagged `baseline`
    01-business-scope/ ... 05-sentence-dropped/       one directory per commit, changed files only
```

A snapshot directory holds only the files that commit changed, at their path inside the
repository. `analysis/structure.json` says what the document is and which files are its
chapters; it appears twice, because version 1.5 and version 1.6 are stamped in it and the
comparison reads both.

Every one of these files is checked against its contract by `make contracts`: the records
against [`schema/records/`](../../schema/records/README.md), and `history.json` — which is
the example's own manifest and not a record — against
[`../history.schema.json`](../history.schema.json).
