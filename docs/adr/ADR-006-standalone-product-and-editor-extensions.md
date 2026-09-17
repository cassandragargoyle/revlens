# ADR-006: revlens as a product of its own, with one extension for two editors

## Status

**Active** — supersedes the packaging half of
[ADR-005](ADR-005-revlens-node-workspace-packaging.md); its runtime and workspace decisions
still hold.

## Metadata

- **Created**: 2026-09-17
- **Author**: Zdenek
- **Target**: `revlens` repository
- **Related**:
  - [ADR-005 — a Node workspace for revlens](ADR-005-revlens-node-workspace-packaging.md)
  - [ADR-004 — token blame with tombstones](ADR-004-revlens-attribution-token-blame.md)
  - [INT-002 — document revision viewer](../issues/002-document-revision-viewer.md)

---

## Context

ADR-005 put revlens in `tools/revlens/` inside `InfiniteCare-architecture`, next to the
Python tooling. That was right while the tool existed to read one engagement's analysis: it
lived beside the documents it was built for and needed no release of its own.

Two things changed it.

The tool turned out not to be about that engagement. Nothing in `core` or in the viewer
knows about any one engagement — only one adapter in `packages/adapters/src/sources/` does, and
adapters are the extension point. A tool that reads any repository's revision history does
not belong inside one of those repositories.

And reading a document in a browser tab on `127.0.0.1` is the wrong end of the workflow.
The people who read these documents are already in an editor, with the repository open.
Asking them to build a bundle, start a server and switch to a browser is three steps too
many, and the server is a process someone has to remember to stop.

There are two editors in play: Visual Studio Code, and the Pilot application from
`portunix-vscode` — an Electron application which, since its issue 078, installs real
`.vsix` extensions and runs them on a minimal in-process host (its ADR-010 calls that host
"State A").

## Decision

**revlens becomes its own repository**, `CassandraGargoyle/revlens`, carrying the git
history of the ten commits that built it. The design record moves with it: INT-002 and
ADR-004/005 are in `docs/` here, so the repository explains itself without a second
checkout.

**The tool is read inside the editor**, through a custom readonly editor for `*.revlens`
bundle files. The page in the webview is the viewer from `apps/web`, unchanged, handed the
bundle on the `__REVLENS_BUNDLE__` global — the seam `revlens build --static` already uses.

**One extension serves both editors.** Not two extensions around one viewer, and not one
extension with a host abstraction layer either:

- The document path uses only what both hosts have — a custom readonly editor, a webview,
  configuration defaults and a file watcher.
- Anything beyond that is **asked for, not assumed**. `src/host.ts` probes the host it was
  loaded into and registers the command-palette entries and the output channel only where
  they exist.
- What is Pilot-specific is a **declaration, not code**: `apps/pilot/pilot-plugin.json`
  states which file extensions the viewer claims and how much of it that host can run, and
  Pilot quotes that verdict to the reader in its consent dialog before enabling anything.

**Bundles carry their own file extension**, `*.revlens`. Pilot matches a plain
`path.extname`, which sees only `.json` in a compound name like `analysis.revlens.json`; a
viewer claiming `json` would be offered for every JSON file in the application. Visual
Studio Code, whose selector is a glob, accepts both spellings.

## Consequences

**The compatibility claim is verified, not asserted.** `npm run verify:pilot-host` drives
Pilot's own compiled modules — catalog validation, `.vsix` unpack, the State A host — over
the file the build just produced, with a fake rendering surface in place of the Electron
webview. It needs a `portunix-vscode` checkout and skips loudly without one.

**A second editor is a second target, not a second product.** If Pilot grows an API, the
change is in `host.ts` and in one declaration. If a third host appears with the same
`.vsix` contract, it needs neither.

**Two repositories now know about revlens.** `InfiniteCare-architecture` keeps its copy
under `tools/revlens/` for the moment, so nothing that depends on it breaks; the two will
drift until that copy is removed or pointed here. The skill that drives the tool ships with
the product and no longer resolves the hub anchor — it looks for `$REVLENS_HOME`, then for
the repository it is in, then for a sibling checkout.

**The engagement adapter travelled with the tool.** `packages/adapters/src/sources/engagement.ts`
knows one engagement's record layout and is now in a product repository. It stays for now
as the only working adapter and the reference for writing another; nothing in it is secret,
but the bundles it produces are internal and are not committed.

**The licence changed with the move.** The code was written under `UNLICENSED` in a
proprietary repository and is published here under the MIT licence this organisation uses,
recorded in [`LICENSE`](../../LICENSE); the `license` field of every manifest was made to
agree with it, and the packaged `.vsix` carries a copy. The decision is the licence file,
not this paragraph — what is recorded here is that it was a decision and not an oversight.
