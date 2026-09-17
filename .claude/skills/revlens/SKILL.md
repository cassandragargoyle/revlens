---
name: revlens
description: Works with the revlens tool — builds a document revision bundle from git history and the engagement records, validates it, serves the viewer, writes a self-contained export, and answers questions over a loaded bundle. Use when the user (typically in Czech) wants „postavit bundle revizí", „ukázat, co se v dokumentu změnilo proti verzi X", „spustit revlens", „co udělala připomínka K…", „které připomínky se ještě nezapracovaly", „poslat někomu prohlížeč změn", or runs the slash command `/revlens [action]`.
argument-hint: "[build | serve | validate | static | ask] [details]"
user-invocable: true
invocation: /revlens [action]
language: en
translations:
  - SKILL.cs.md
---

# revlens

## What it is

`revlens` shows **the final text of a document with its changes marked in place**, and for
each change says when it happened, who caused it, and which reviewer comment it answers. It
also works the other way round: browsing the comments to find out what became of them —
including the ones that never showed up in the text at all.

The specification is
[INT-002](../../../docs/issues/002-document-revision-viewer.md) and the tool's own
documentation is [`README.md`](../../../README.md).

## STEP 0: Find the tool and prepare it

`revlens` is a repository of its own, and the documents it reads live in someone else's.
A session is usually opened in the document's repository rather than in this one, so
establish `TOOL` before anything else:

- `$REVLENS_HOME` is set → that is the tool
- `./apps/cli/bin/revlens.js` exists → the session is in the revlens repository itself
- otherwise try a sibling checkout: `../revlens`, then `../../revlens`

If none of them is there, say so and ask where revlens is checked out. Do not clone it.

If `TOOL/node_modules` has no dependencies, or `TOOL/apps/web/dist` is missing, run:

```bash
cd "$TOOL" && npm install && npm run build
```

The build takes tens of seconds. Without it `serve` still runs but has no viewer (API
only), and `--static` fails. Say so in either case rather than covering it up.

## STEP 1: Find out what the user wants

Do not assume. The commonest requests and what each needs:

| Request | What you need to establish |
| ------- | -------------------------- |
| "show what changed against version X" | which commit corresponds to version X |
| "run it" | which bundle; if there is more than one, ask |
| "what did comment K… do" | a running server, or a bundle to load |
| "what is still not worked in" | the same |
| "send it to the client" | **stop** — see STEP 5 |

## STEP 2: Find the baseline

The baseline is **the state the reviewers received**, not an arbitrary commit. When the
user asks for "against version 1.5", look for the commit where the document still carried
the 1.5 stamp — the last one before it was switched to the next version:

```bash
git -C "$ANALYSIS" log --format="%h|%aI|%s" -- analysis/structure.json | head -20
```

For each candidate read `document.version` from `analysis/structure.json` at that commit and
take the **last commit carrying the version you want**. Report the result to the user with
the commit date and subject so they can check it — a wrong baseline silently distorts the
entire output.

## STEP 3: Build the bundle

```bash
cd "$TOOL" && node apps/cli/bin/revlens.js build \
  --source engagement \
  --repo "<repository holding the chapters>" \
  --records "<repository holding the records>" \
  --from "<baseline commit>" \
  --out "out/<name>.json" \
  --report "out/<name>-report.json"
```

`--repo` is the nested analysis repository — the directory whose name ends in
`-analysis` and which holds `analysis/structure.json` — and `--records` is the engagement
directory one level up, holding `docs/changes/` and `docs/comments/`. The `engagement`
adapter is the only one so far; `node apps/cli/bin/revlens.js sources` lists what exists.

`out/` is in `.gitignore`; a bundle is a generated file and **is not committed**.

### The head is a commit, not the working tree

`--to` takes a revision and defaults to `HEAD`; there is no mode that compares against the
files on disk. Anything edited but not committed is **absent from the bundle**, and nothing
in the viewer says so. Look before you build:

```bash
git -C "<repository holding the chapters>" status --short
```

Name the modified files to the user alongside the report. Otherwise the first change they
cannot find gets blamed on the tool.

### Read the report aloud, not only for its errors

Always tell the user, from the report:

- **`unexplained`** — how many changes have no record behind them. It is a measure of how
  well the join worked, not an error.
- **`comments X of Y joined`** — how many comments were tied to a revision.
- **untouched chapters** — that is information, not emptiness.
- **`warnings`** — especially the one saying commits were joined by path and date rather
  than by hash.

If the build refuses to write a bundle because its invariants failed, **do not reach for
`--allow-invalid` to get past it**. Print the errors to the user; it is a finding, either in
the data or in the tool.

## STEP 4: Serve the viewer

```bash
cd "$TOOL" && node apps/cli/bin/revlens.js serve "out/<name>.json"
```

The server holds the terminal until someone stops it, and binds only to `127.0.0.1`. Give
the user the address. **Do not start it in the background or leave it running without the
user knowing** — on this machine the system has already killed it twice for memory; if it
needs to run for a while, let the user start it in their own terminal.

If the port is taken, node fails with `EADDRINUSE`. Check whether an instance is already
running before looking for another cause.

## STEP 5: Sending it out — stop and ask

`revlens build --static <dir>` writes a self-contained directory that works with no server.
It can be zipped and sent.

**Before sending it to anyone, get explicit consent.** The bundle carries the verbatim
wording of comments, the names of the people who made them, internal decisions and notes —
the material is internal. What goes to the client as an official deliverable is still the
Word file with tracked changes; `revlens` is the reading view for the team.

## STEP 6: Answering questions over a bundle

When the user asks about content, **do not read the bundle by hand with `grep`**. If a
server is running, use the API:

```bash
curl -s '127.0.0.1:4173/api/comments?decision=prijato&resolution=rozpracovano'
curl -s '127.0.0.1:4173/api/comments?landed=false'
curl -s '127.0.0.1:4173/api/edits?q=CTO'
curl -s '127.0.0.1:4173/api/comments/K2-004'
```

If none is running, offer `serve --mcp` and the tools `revlens_comments`, `revlens_comment`,
`revlens_edit`, `revlens_search` — they give the same answers as the browser, because they
call the same functions.

### When the user says a change is not in the current text

Do not concede the premise, and do not rebuild against a different baseline to make it go
away. **Find the chapter's own source file first** — the bundle names it in
`chapter.source` — and check that one file:

```bash
node -e 'const b=require("./out/<name>.json");console.log(b.chapters.map(c=>c.id+" <- "+c.source).join("\n"))'
```

Grepping a directory is what produces the false alarm. An engagement usually has **two
files named `GLOSSARY.md`**: the one at the root of the analysis repository is the source
of the chapter "Pojmy a zkratky", while the one in the parent engagement repository is the
project glossary and never reaches the document. They carry different wording of the same
entries, so a grep in the wrong repository reports a current sentence as missing.

Then say which it is — that the text is current and which commit inserted it, or that the
bundle really is wrong. Conceding "you are right, that is stale" when it is not costs more
than the question did.

### The vocabulary the user works in

A comment passes **three gates**, and they answer different questions:

| Gate | Field | Values |
| ---- | ----- | ------ |
| Ověření (verification) | `check.verdict` | `potvrzeno`, `potvrzeno-s-upresnenim`, `mimo-text`, `neplati` |
| Rozhodnutí (decision) | `decision.status` | `prijato`, `prijato-castecne`, `zamitnuto`, `odlozeno`, `nerozhodnuto` |
| Vypořádání (resolution) | `resolution.state` | `hotovo`, `rozpracovano`, `nezahajeno`, `odpada` |

When the user asks "what is still not worked in", do not mix the gates: `landed=false` means
"changed no place in the text at all", which is not the same as `resolution=rozpracovano`.
If you are not sure which of the two they mean, ask — the numbers differ by an order of
magnitude.

**Comments are scoped to the comparison by default.** A bundle carries every comment the
engagement ever received; the ones closed before the baseline belong to an earlier
comparison and are left out unless asked for. The API and the MCP tool both report the
scope they answered in — quote it, so nobody mistakes the width of the list:

```bash
curl -s '127.0.0.1:4173/api/comments?landed=false'              # open, within the comparison
curl -s '127.0.0.1:4173/api/comments?scope=settled-earlier'     # closed before the baseline
curl -s '127.0.0.1:4173/api/comments?scope=all'                 # everything in the bundle
```

Two words that are not interchangeable: **closed** before the baseline is not **worked into
the text**. A comment can be closed as declined, as no longer applicable, or as an umbrella
split into others. Never tell the reader an out-of-scope comment was already worked in.

The build report counts records out of scope separately from ones that genuinely failed to
join — quote both, and do not present the out-of-scope count as a weakness of the join.

## Links you hand to the user

- `#/edit/…`, `#/revision/…`, `#/comment/…` **survive a rebuild** and a change of baseline;
  ids are derived from the content of the change, not from its position.
- `ch-04-wp-a1/b-17` (a block id) **does not** — it is valid only inside one bundle.
- The exception to own up to: two byte-identical changes of one revision are told apart only
  by their order, so if one of them disappears the other one's id can shift.

## When you change the tool itself

The code is in this repository. Before reporting anything as done:

```bash
cd "$TOOL" && npm run lint && npm run build && npm run schema:check && npm test
```

- `schema/bundle.schema.json` is **generated** from the Zod schema in `packages/core`. Do
  not edit it by hand — `npm run schema` overwrites it and `schema:check` fails in CI.
- A change to the contract (`packages/core/src/schema.ts`) is **a change to INT-002**; write
  it there.
- Navigation and filtering rules belong in `packages/core`, so that the browser, the API and
  the MCP tools give the same answer. Do not write them a second time in the UI.
- Verify new behaviour against **real history**, not only against the synthetic one. Two
  attribution bugs were invisible over a five-commit test history and produced 41 broken
  invariants over the engagement's 83 commits.
