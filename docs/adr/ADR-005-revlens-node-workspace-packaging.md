# ADR-005: Run `revlens` as a Node Workspace under `tools/`, Beside the Python Tooling

## Status

**Draft** — captured 2026-09-16. Awaiting review and acceptance.

> The **location** this ADR decides — a workspace under `tools/` in
> `InfiniteCare-architecture` — is superseded by
> [ADR-006](ADR-006-standalone-product-and-editor-extensions.md), which moves revlens into
> a repository of its own. What it decides about the runtime, the workspace shape and the
> packaging inside that root still holds, and the reasoning stays here as the record of why
> the tool was built where it was built.

## Metadata

- **Created**: 2026-09-16
- **Author**: Zdeněk Kurc
- **Target**: `tools/revlens/` (npm workspace, TypeScript)
- **Related**:
  - [INT-002 — document revision viewer](../issues/002-document-revision-viewer.md)
  - [ADR-004 — revlens attribution algorithm](ADR-004-revlens-attribution-token-blame.md)
  - [ADR-003 — graphlens Python module packaging](ADR-003-graphlens-python-module-packaging.md)

---

## Context

Every piece of tooling in this repository so far is Python: `scripts/` is a single `uv`
project with one `pyproject.toml` and one `uv.lock`, and the project rules say Python is
run through `uv` and never through a bare `python` or `pip`.

[INT-002](../issues/002-document-revision-viewer.md) asks for something
that does not fit that shape. The viewer is a browser application with a live document
view, a revision timeline and keyboard navigation; the builder needs a Markdown parser
whose AST is stable enough to assign block identity across commits, and a word-level diff.
The two halves must agree on one data contract — the navigation rules ("the next edit of
this revision") are the same rules whether the server resolves them or the browser does.

That is the decision to make: **where the tool lives, in what language, and how the
browser half and the build half share one contract** without either duplicating it.

### Constraints carried from INT-002

- `scripts/` is one `uv` project. A Node toolchain — `package.json`, `node_modules`, a
  lockfile — cannot be dropped inside it without breaking the one-project assumption that
  `uv run` depends on.
- The navigation logic must be **written once and unit-tested without a browser**.
- `revlens build --static` must produce a self-contained directory that works from the
  file system, with **no server and no external CDN** — the same offline guarantee
  [ADR-003](ADR-003-graphlens-python-module-packaging.md) made for `graphlens`.
- The material is internal. Nothing may bind to a public interface by accident.
- The data contract and the sample data already exist in `tools/revlens/` and are the
  specification, not an output.

### Options considered

| Option | Shared contract | Browser app | Fit with `scripts/` | Notes |
| ------ | --------------- | ----------- | ------------------- | ----- |
| **npm workspace under `tools/`** | One `core` package, typed, imported by both halves | First class | Untouched — separate root | Chosen |
| Python builder plus vanilla-JS viewer | Duplicated — contract re-stated in JS by hand | Hand-rolled, no build step | Good | The contract drifts the first time the schema changes; `graphlens` gets away with it because its viewer has no logic |
| Node project inside `scripts/` | One package | First class | **Breaks** the single `uv` project | Rejected on the constraint above |
| Single-package Node project (no workspace) | One package, but the browser bundle drags the git and filesystem code in | First class | Untouched | Server-only dependencies leak into the web build; `core` stops being testable in isolation |
| Python builder emitting the bundle, TypeScript viewer only | Contract stated twice — Zod on one side, dataclasses on the other | First class | Good | Tempting, since `scripts/` already reads these repositories. Rejected: the invariants in `fixtures/README.md` would be validated by two implementations that can disagree |

## Decision

`revlens` gets **its own root, `tools/revlens/`, as an npm workspace in TypeScript**,
parallel to — not inside — the Python tooling in `scripts/`.

### Layout

```text
tools/revlens/
  package.json            # npm workspaces root: build, test, lint, dev
  tsconfig.base.json
  schema/
    bundle.schema.json    # generated from the Zod schema at build time
  fixtures/
    sample-bundle.json    # anonymized sample, the fixture of the unit tests
  packages/
    core/                 # types, Zod schema, validation, indexes, navigation
    adapters/             # source adapters, git and Markdown plumbing
  apps/
    cli/                  # revlens build | validate | serve
    server/               # Fastify, read-only API and static hosting
    web/                  # React + Vite single-page app
```

### `core` is the only shared package

`core` holds the Zod schema, the derived types, the invariant validator and the
navigation logic. Both the server and the web app depend on it, and nothing else depends
on both. It has no filesystem and no git imports, so it is unit-testable without a
browser and without a repository.

### The schema is generated, not maintained twice

`schema/bundle.schema.json` is **generated from the Zod schema** at build time. It was
hand-written to fix the contract before any code existed; from the moment `core` exists,
hand-editing it is a build failure. Types and schema cannot drift apart if only one of
them is authored.

### Node, TypeScript, Fastify — stateless, no database

The bundle is a generated file, the viewer is read-only, and nothing the user does in the
UI is persisted. A database would be a component with nothing to store, and a stale copy
of a document that changes daily is a liability rather than an asset. The server does
three things: serve the built SPA, serve the bundle, and rebuild on request. It binds
`127.0.0.1` by default.

The static mode stays supported and is not a lesser path: `revlens build --static` writes
a directory that can be zipped and sent, with no server and no CDN.

### The MCP surface is a fourth consumer of `core`, not a second implementation

Started with `--mcp`, the server also speaks MCP over stdio, so an assistant can ask the
questions a reader answers by clicking. This is the reason `core` had to be a package and
not a folder inside the web app: the browser, the HTTP API and the MCP tools now answer
"which edits did this revision produce" by calling **the same function**. An assistant and
a reader who disagreed about that would make the tool useless as evidence.

Stdio forces one constraint on the rest of the server: with `--mcp` on, nothing may be
written to stdout, because anything that is corrupts the protocol stream. Logging
therefore goes to stderr unconditionally rather than only in that mode, so the quiet path
is the normal path and cannot be forgotten.

### Package manager

**npm workspaces** — it ships with Node and needs no extra tooling. pnpm is faster and
stricter, and is the fallback if install time becomes a problem; that is a reversible
change of one file.

### Relationship to `graphlens`

Both are viewers, and both are local and offline, but they do not share code.
`graphlens` ([ADR-003](ADR-003-graphlens-python-module-packaging.md)) renders a graph
with no navigation logic worth testing, which is why a Python module with a vanilla-JS
viewer suits it. `revlens` has a contract and rules that must be tested. The repository
therefore carries **two tool roots with two toolchains**: `scripts/` for Python run
through `uv`, `tools/` for Node run through npm.

## Consequences

### Positive

- `scripts/` stays a single `uv` project, exactly as the project rules require.
- The contract exists once, in Zod, and the JSON Schema is derived from it.
- Navigation rules are unit-tested in `core` with no browser and no repository.
- Server-only dependencies (git, filesystem) cannot reach the browser bundle, because
  they live in `adapters` and the web app does not depend on it.
- `tools/` is a home for the next non-Python tool, so the question does not get reopened.

### Negative / costs

- A **second toolchain in the repository**. A contributor now needs Node as well as `uv`,
  and CI has to run both.
- More scaffolding than a single package — five `package.json` files and a `tsconfig`
  base, for a tool one person will mostly run.
- `node_modules` and build output must be kept out of git deliberately.
- The repository has no CI today; introducing one is part of this decision rather than a
  precondition of it.

### Follow-up actions

- [ ] Add CI that runs `npm run build`, `npm test` and `npm run lint` from
  `tools/revlens/`.
- [ ] Revisit the package manager if install time becomes a problem.
- [ ] If a second Node tool appears, decide whether `tools/` becomes one workspace or
  stays one workspace per tool.

---

**Created**: 2026-09-16
**Last Updated**: 2026-09-16
