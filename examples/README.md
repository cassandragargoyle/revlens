# revlens examples

Complete, self-contained engagements to run the tool against. An example is not a fixture:
the unit tests read [`fixtures/sample-bundle.json`](../fixtures/README.md), which is a
bundle that already exists. An example is the other end — the raw material a bundle is
built *from*, so that `revlens build` can be watched doing its work.

## Examples

| Example | What it shows |
| ---------- | ---------- |
| [`01-revision-round/`](01-revision-round/README.md) | One review round folded into version 1.6: five instructions, four reviewer comments, three chapters |

## Running one

From the repository root, with GNU make:

```bash
make demo                 # compile, build the example, open the viewer
make demo LANGUAGE=cs     # the same example, written in Czech
make debug                # the same example in a VS Code Extension Development Host
make bundle               # just the bundle, into out/example/
make static               # a self-contained copy that needs no server
make clean                # remove out/example
```

`make help` lists every target. Without make, the same three steps are:

```bash
npm run build
npm run example:seed -- --example examples/01-revision-round --language en --out out/example/analysis-repo
npm run revlens -- build --source engagement --repo out/example/analysis-repo \
  --records examples/01-revision-round/en --from baseline --out out/example/bundle.json
npm run revlens -- serve out/example/bundle.json
```

## How an example is put together

```text
01-revision-round/
  en/                  one language variant - the same engagement, told in English
    docs/
      changes/v1.6/changes.json              the instructions that produced version 1.6
      comments/<round>/<round>.json          the reviewer comments and how they were settled
    history/
      history.json                           who committed what, and when
      00-baseline/ 01-.../ ...               the files each commit changed
  cs/                  the same, in Czech
```

The builder reads git history, so an example needs a real repository — and a git
repository cannot be committed inside another one. What is committed instead is the text
of each revision and a manifest saying when it was made and by whom;
[`scripts/seed-example.ts`](../scripts/seed-example.ts) replays that into a throw-away
repository under `out/`, with the dates the manifest gives. The commit dates are fixed
there rather than taken from the clock, because the change log joins to the commits by
target path and day — a history seeded "now" would join to nothing.

Everything under `out/` is generated and ignored by git. Nothing in an example is real:
invented company, invented people, invented text.

## The records, and what they have to satisfy

The JSON an adapter reads is described in
[`schema/records/`](../schema/records/README.md) — one JSON Schema per record type, checked
against every example by `npm run example:check` (`make contracts`). Those contracts belong
to the tool, not to the examples; what does belong here is
[`history.schema.json`](history.schema.json), the manifest that turns an example's
snapshots back into a git history, which only `scripts/seed-example.ts` reads.

The contract of what the tool *writes* is a third file, and it is generated:
[`schema/bundle.schema.json`](../schema/bundle.schema.json).

## Adding an example

1. Make a directory `NN-short-name/`, with one subdirectory per language
2. Write `history/history.json` and one snapshot directory per commit
3. Write the records under `docs/`, with `received` dates on the days the commits were made
4. Run `npm run example:check`, then `make bundle EXAMPLE=examples/NN-short-name`
5. Give it a `README.md` saying which case each revision exercises

A new **source** of records — Word tracked changes, another engagement — is a new adapter
in `packages/adapters/src/sources/`, not a new example; see
[ADR-006](../docs/adr/ADR-006-standalone-product-and-editor-extensions.md) and the source
registry.
