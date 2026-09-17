# ADR-007: A desktop application for readers who are not in an editor

## Status

**Active** — amends the packaging decision of
[ADR-006](ADR-006-standalone-product-and-editor-extensions.md); its decision that the
editor is the primary target, and everything it says about the one extension for two
editors, still holds.

## Metadata

- **Created**: 2026-09-17
- **Author**: Zdenek
- **Target**: `revlens` repository — a new `apps/desktop/`, a new `packages/viewer-page/`
- **Related**:
  - [ADR-006 — revlens as a product of its own](ADR-006-standalone-product-and-editor-extensions.md)
  - [ADR-005 — a Node workspace for revlens](ADR-005-revlens-node-workspace-packaging.md)
  - [INT-004 — revlens as a desktop application](../issues/done/004-desktop-application.md)
  - [INT-002 — document revision viewer](../issues/002-document-revision-viewer.md)

---

## Context

ADR-006 decided that revlens is read inside an editor, and gave the reason plainly:

> reading a document in a browser tab on `127.0.0.1` is the wrong end of the workflow. The
> people who read these documents are already in an editor, with the repository open.

That sentence is true about the people it was written about. It is not true about everyone
the tool is for.

There are three ways to read a bundle today, and each one assumes a developer somewhere in
the chain. `revlens serve` needs a checkout, Node, npm, a terminal and a port. The editor
extension needs Visual Studio Code or Pilot with the repository open. `revlens build
--static` needs nothing to *run* — but it needs a developer to *produce*, and what the
reader receives is a zipped directory that is opened by finding `index.html` inside it.

The reviewer, the analyst and the person who signs off a deliverable are in none of those
rows. They are handed a document and asked whether their comment was acted on. For them,
"install the Visual Studio Code extension and open the repository" is a larger ask than
"install an application", and `--static` gives them no file association, no window title,
nothing to pin to a task bar, and one more zip in the downloads folder for every revision
round.

So the question this record answers is not whether the editor was the right primary target.
It is what the second target is for readers who will never have an editor.

## Decision

**revlens gains a desktop application**, an Electron shell in `apps/desktop/` around the
viewer from `apps/web`, for Linux, Windows and macOS. **The editor stays the primary
target.** The desktop application is the second one, and it is held to the same rule the
extension is: it may not fork the viewer, and anything it can do that the other hosts
cannot stays on its own side of the seam.

`revlens build --static` is not replaced by it. It remains the way to send a document to
somebody who will install nothing at all.

### The viewer is given to it, not rewritten for it

The renderer is the built `apps/web` output, with the bundle assigned to
`__REVLENS_BUNDLE__` before the application script runs — the seam `revlens build --static`
and the webview already use. Nothing in `apps/web` learns that a desktop host exists.

The page is loaded over a custom scheme rather than from `file://`, so the viewer keeps an
origin, a Content-Security-Policy and a nonce, exactly as it has in a webview.

### The page builder moves out of the extension

`apps/vscode/src/webview-html.ts` was written as a pure function parameterised by an
asset-URL function, precisely so it could be tested without a host. It is now used by two
hosts, so it moves to **`packages/viewer-page`** and is imported by both. It does not go
into `packages/core`: `core` is the data contract and the rules the backend and the
frontend must agree on, and an HTML page builder is neither.

The bundle loader moved with it, for the same reason. `readBundleFile` validates before
anything is rendered, because a bundle that fails its invariants is a document whose
attribution cannot be trusted. “The desktop window refuses what the editor refuses, which
is what the CLI refuses” is now one implementation rather than three that agree today.

`serializeBundle` went the other way, into `packages/core`. Two programs now write bundles,
and a reader comparing two files byte for byte is entitled to the same bytes for the same
document, so the indentation and the trailing newline are part of the contract rather than
a detail of whichever writer ran.

A second copy of any of this would rot. The part most likely to break against a host —
nonce, CSP, URL rewriting — is the part that must not exist twice.

### It builds a bundle by importing the adapter, not by shelling out

The main process imports `@revlens/core` and `@revlens/adapters` directly and calls
`buildBundle`, which is what `revlens build` calls. It does not spawn the CLI and does not
start `apps/server`: a packaged application cannot assume a checkout, an npm and a `tsx` on
the machine.

`git` on the `PATH` is still required. Its absence is a message naming what is missing and
where to get it, not a stack trace — the fourth design principle.

### Supported platforms, and platforms merely produced

- **Supported**: **Linux** (AppImage) and **Windows** (a portable `.exe` and an NSIS
  installer). These are built, installed and opened before a release.
- **Produced, not supported**: **macOS** (`.dmg`). The build is configured and will be
  written by `make package-desktop` on a macOS machine, but it is unsigned and unnotarised,
  so Gatekeeper will refuse it on a first open. An unsigned build presented as supported is
  worse than no build, so it is offered as what it is until somebody has a signing identity
  and a reason.

This agrees with [AGENTS.md](../../AGENTS.md), which lists macOS as undecided, rather than
quietly promoting it.

## The three objections, answered

**A third host to keep working.** Answered by the paragraph above: the page builder is one
pure function in one package, used by the webview and by the desktop window, and its tests
run without an Electron or a Visual Studio Code process. The rest of the difference between
the hosts is how a file is opened, which is main-process code and has no counterpart in the
viewer.

**Electron is the first heavy runtime dependency.** It is a build-time and packaging
dependency of one application. `electron` and `electron-builder` are devDependencies of
`apps/desktop` alone; `core`, `adapters`, `cli`, `server`, `web` and `viewer-page` do not
depend on either, directly or transitively, and a test asserts it rather than a promise in
a pull request. `revlens build --static` and the `.vsix` are produced by the same scripts
they were produced by before.

**Three platforms to sign and ship.** Answered by the platform list above. Two supported,
one produced.

## The open questions of INT-004, settled

**Packager: `electron-builder`.** One configuration produces the Linux AppImage, both
Windows artifacts and the macOS `.dmg`, and it carries the file association for `*.revlens`
on all three. `@electron/forge` is simpler and closer to upstream, and would cost a second
configuration for the association and the Windows portable target.

**The bundle in the page: embedded, on the global.** It is the path that already has tests
in two hosts. Serving it over the custom scheme and letting `createApiSource` fetch
chapters on demand remains available behind the same seam, and `npm run bench` is how that
decision gets revisited — with a number, not a feeling.

**The MCP server: not in the desktop application.** It is a reader's application. The MCP
surface stays in `apps/server`, on the developer's machine, where the assistant that drives
it also is.

**Automatic updates: none.** A new version is downloaded and installed like any other
application until somebody asks for more.

## Consequences

**The rule about `apps/web` is now load-bearing in three places.** Three hosts differ only
in how the page is loaded and how a file is opened. A fourth difference belongs in the
main process or in the capability probe — never in the viewer. This is the same rule
ADR-006 stated for two hosts, and it is the thing that keeps a third host from becoming a
third viewer.

**`packages/viewer-page` is a package with one consumer's history and two consumers'
future.** It is small on purpose. If it starts accumulating host-specific branches, that is
the signal that a host is being served by the wrong layer.

**A root `npm install` now downloads Electron.** That is the visible cost of the decision.
It buys a contributor the ability to run `make desktop` without a second install step, and
it does not reach any other package's dependency graph.

**Two things now open a `*.revlens` file on a developer's machine** — the editor and the
desktop application — and the operating system's association points at the second. That is
deliberate: the developer opens bundles from the editor's explorer, where no association is
consulted.

**The Electron application in `portunix-vscode` is untouched by this.** Pilot is a
different program that happens to be built on the same runtime. It runs the `.vsix`; it has
no relationship to `apps/desktop`.
