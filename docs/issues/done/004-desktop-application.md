---
title: INT-004 - revlens as a desktop application, built with Electron
description: Apply when working on the desktop target of revlens - the Electron shell around the viewer, the bundle it builds itself, and the make targets that produce the installers.
category: specification
ai_load: on-demand
status: active
created: 2026-09-17
related:
  - docs/issues/002-document-revision-viewer.md
  - docs/issues/003-viewer-left-rail.md
  - docs/adr/ADR-006-standalone-product-and-editor-extensions.md
---

# INT-004 - revlens as a desktop application, built with Electron

## Metadata

- **Status**: ✅ Implemented
- **Type**: enhancement
- **Priority**: medium
- **Created**: 2026-09-17
- **Closed**: 2026-09-17
- **Author**: Zdeněk Kurc
- **Target**: a new `apps/desktop/` (Electron main process, preload, packaging), plus
  `Makefile` targets and a script under `scripts/`
- **GitHub**: [#4](https://github.com/cassandragargoyle/revlens/issues/4)
- **Related**:
  - [INT-002 — Document revision viewer](../002-document-revision-viewer.md) — the tool this
    packages; the bundle contract and the adapters are unchanged by it
  - [INT-003 — Left rail for the viewer's main window](../003-viewer-left-rail.md) — the same
    window, which is what the desktop application shows
  - [ADR-006 — Standalone product and editor extensions](../../adr/ADR-006-standalone-product-and-editor-extensions.md)
    — **this issue contradicts it**, see [Against ADR-006](#against-adr-006)
  - [ADR-007 — A desktop application for readers who are not in an editor](../../adr/ADR-007-desktop-application-for-readers.md)
    — the record this issue asked for, which amends ADR-006 rather than reversing it

## Feature Description

Add a **desktop application** — an Electron shell around the viewer from `apps/web` —
that can be installed on Linux, Windows and macOS, opens `*.revlens` bundles from the file
manager, and **builds a bundle itself** from a git repository and its engagement records,
without a terminal.

The application is not a new viewer. It is the same React application the browser tab, the
Visual Studio Code webview and the Pilot webview already show, given its bundle through
the `__REVLENS_BUNDLE__` global — the seam `revlens build --static` and
`apps/vscode/src/webview-html.ts` both use. Nothing in `apps/web` learns that a desktop
host exists.

Two things are genuinely new:

1. **A window with a file life-cycle** — open, recent documents, reload when the file
   changes on disk, an OS file association for `*.revlens`.
2. **Building a bundle from the user interface** — pick a repository, a records directory
   and a revision range; the main process runs exactly what `revlens build` runs, because
   `packages/core` and `packages/adapters` are ordinary Node modules and the Electron main
   process is an ordinary Node process.

It is built through `make`: the Makefile gains `desktop` and `package-desktop`, thin
wrappers over npm scripts, as everything in that file already is.

## Use Case

There are three ways to read a bundle today, and every one of them assumes a developer
somewhere in the chain:

| Way | What it needs | Who cannot use it |
| --- | ------------- | ----------------- |
| `revlens serve` and a browser tab | a checkout, Node 26.9+, npm, a terminal, a port | anyone outside the repository |
| The editor extension | Visual Studio Code or Pilot, with the repository open | anyone who does not work in an editor |
| `revlens build --static` | nothing to run it, but a developer to produce it | — it is a directory to send, not an application |

The people the tool is *for* — reviewers, analysts, the person who signs off a
deliverable — are in none of those rows. They are handed a document and asked whether their
comment was acted on. `--static` comes closest and is what they get today: a directory of
files, sent as a zip, opened by finding `index.html` inside it. It has no file association,
no window title, nothing to pin to a task bar, and each new revision round is another zip
in the downloads folder.

A desktop application closes that gap at both ends. The reviewer double-clicks a
`*.revlens` file. The analyst who prepares the round picks a repository in a dialog instead
of writing six CLI flags, and sends one file rather than a directory tree.

## Against ADR-006

[ADR-006](../../adr/ADR-006-standalone-product-and-editor-extensions.md) decided the opposite
of this issue, and for a good reason:

> reading a document in a browser tab on `127.0.0.1` is the wrong end of the workflow. The
> people who read these documents are already in an editor, with the repository open.

That holds for the audience it was written about — the developers and analysts who have the
checkout. It does not hold for the audience above, who have neither an editor nor a
repository, and for whom "install the Visual Studio Code extension" is a larger ask than
"install an application".

So the claim this issue makes is narrower than a reversal: **the editor stays the primary
target, and the desktop application is the second one for readers who are not in an
editor.** Concretely that means the extension keeps its place, `apps/web` stays the single
viewer, and the desktop shell is held to the same rule the extension is — it may not fork
the viewer, and anything it can do that the other hosts cannot stays on its own side of the
seam.

**This needs an ADR before it needs code.** ADR-006's packaging decision is amended, not
quietly bypassed, and the new record has to answer the three objections honestly:

- **A third host to keep working.** The webview page builder already exists as a pure
  function precisely so it can be tested without a host; the desktop page is the same
  function with a different asset scheme, or it is a second copy that will rot.
- **Electron is the first heavy runtime dependency.** The project's rule is that nothing is
  added without a written reason, and that the static export and the editor page keep
  working offline with no CDN. Electron is a build-time and packaging dependency of one app,
  not of `core`, `adapters`, `cli`, `server` or `web`, and the acceptance criteria below
  make that structural rather than a promise.
- **Three platforms to sign and ship.** [AGENTS.md](../../../AGENTS.md) lists macOS as
  undecided. An unsigned macOS build that shows Gatekeeper's warning is worse than no macOS
  build if it is presented as supported, so the ADR says which platforms are *supported*
  and which are merely *produced*.

## Proposed Solution

### Shape

```text
apps/desktop/
├── src/
│   ├── main.ts          # the Electron main process: windows, menu, file life-cycle
│   ├── preload.ts       # the one narrow bridge, contextIsolation on
│   ├── window.ts        # the viewer page, from the built apps/web output
│   ├── open.ts          # argv, File → Open, drag and drop, recent documents, watching
│   └── build.ts         # runs the adapter, i.e. what `revlens build` runs
├── test/
└── package.json
```

The renderer is the built `apps/web` output, loaded from disk over a custom protocol, with
the bundle assigned to `__REVLENS_BUNDLE__` before the application script runs. No node
integration in the renderer, `contextIsolation` on, and the preload exposes a small,
named set of calls — open, rebuild, reveal in the file manager — rather than a channel.

### Building a bundle from the window

The main process imports `@revlens/core` and `@revlens/adapters` directly. It does **not**
shell out to the CLI and does not start `apps/server`: a packaged application cannot assume
a checkout, an npm and a `tsx` on the machine. `git` on the `PATH` is still required, and
its absence is a message that says so and points at the download, not a stack trace — the
fourth design principle.

### Make targets

```make
desktop:         ## Run the desktop application from source, against the example bundle
package-desktop: ## Build installers for this platform into dist/desktop/
```

Both are wrappers over `npm run dev:desktop` and `npm run package:desktop`, in the style
the Makefile's own header requires — `npm run build` and `npm test` stay the source of
truth, and the Makefile adds no build logic of its own.

### Open questions, to settle in the ADR

These are judgement calls, written down so they can be disagreed with before anything is
built:

- **Packager**: `electron-builder` (all three platforms, more configuration) versus
  `@electron/forge` (simpler, closer to upstream). Proposal: `electron-builder`, for the
  Linux AppImage and the Windows portable `.exe` in one configuration.
- **The bundle in the page**: embedding it on a global is what the other hosts do, but a
  large bundle is then parsed as source text. The alternative is to serve it over the same
  custom protocol and let `createApiSource` handle chapters on demand. Proposal: start
  embedded, because it is the path that already has tests, and measure with
  `npm run bench`.
- **Sharing the page builder** with `apps/vscode/src/webview-html.ts`: it is pure and
  already parameterised by an asset-URL function, so the desktop can reuse it — but that
  module lives in an app, not a package, and sharing it means moving it. Proposal: move it
  to `packages/core` or a small shared package as part of this work, rather than copying it.
- **Does the desktop application ship the MCP server?** Proposal: no. It is a reader's
  application; the MCP server stays in `apps/server` for the developer's machine.

## Out of Scope

- No change to the bundle contract, to `schema/`, or to any adapter.
- No second viewer, no desktop-only panel, no fork of `apps/web`.
- No auto-update. A new version is downloaded and installed like any other application
  until somebody asks for more.
- No change to the editor extension or to the Pilot packaging. The Electron application in
  `portunix-vscode` is a different program and is untouched by this.
- No document editing, and no writing to the repository. The desktop application reads, and
  it produces bundles; it never changes the document or the records.

## Acceptance Criteria

- [x] A new ADR amends ADR-006's packaging decision, names the supported platforms, and is
      merged **before** the implementation
- [x] `apps/desktop/` holds the Electron main process, the preload and the packaging
      configuration, and `apps/web` contains nothing that knows about it
- [x] `make desktop` runs the application from source against the example bundle, on a
      machine that has run `npm install` and `npm run build`
- [x] `make package-desktop` writes installers into `dist/desktop/` for the platform it runs
      on: an AppImage on Linux, a portable `.exe` and an installer on Windows, a `.dmg` on
      macOS
- [x] Both targets are wrappers over npm scripts and contain no build logic of their own
- [x] Opening a `*.revlens` file shows the document: by command-line argument, by
      **File → Open**, by dragging the file onto the window, and by double-clicking it once
      the association is installed
- [x] A bundle that fails its invariants shows the validator's reasons in the window, not a
      blank page and not a crash — the same behaviour the extension has
- [x] The window reloads the document when the file changes on disk, and the behaviour can
      be turned off, matching `revlens.reloadOnChange`
- [x] The application builds a bundle from a chosen repository and records directory, and
      the result is byte-for-byte what `revlens build` produces from the same inputs
- [x] Without `git` on the `PATH`, building shows a message naming what is missing and how
      to install it; reading an existing bundle still works
- [x] The renderer runs with `contextIsolation` enabled and node integration disabled, and
      the preload exposes named calls rather than a raw channel
- [x] Nothing is fetched at runtime: the application works with no network at all, and the
      packaged build contains no CDN reference
- [x] `electron` and the packager are devDependencies of `apps/desktop` alone; installing
      and building `core`, `adapters`, `cli`, `server` and `web` does not pull Electron
- [x] `npm run package:vsix`, `npm run package:pilot` and `revlens build --static` produce
      what they produced before this change
- [x] The main process, the page builder and the file life-cycle are tested without an
      Electron process, in `apps/desktop/test/`
- [x] `docs/architecture/ui/` gains the desktop window, and [ARCHITECTURE.md](../../../ARCHITECTURE.md)
      and its Czech translation name the desktop target
- [x] `npm run lint`, `npm run typecheck`, `npm run schema:check`, `npm run build` and
      `npm test` pass

## Notes

- The three hosts differ only in how the page is loaded and how a file is opened. If a
  fourth difference appears, it belongs in the capability probe or on the main-process side
  of the seam — never in `apps/web`.
- `revlens build --static` is not replaced by this and should not be. It is the way to send
  a document to somebody who will install nothing at all.

### What was exercised, and what was only written

The ADR was written as the first commit of `feature/004-desktop-application` rather than
merged on a branch of its own — a deviation from the first criterion, decided before the
work started. Everything else in it stands.

Run against the example on Linux, with a window on screen:

- opening by command-line argument, `make desktop`, and the viewer rendering in the window
- the window reloading when the file was replaced on disk, with the title following the
  document
- **File → Build a Bundle…** end to end: the form ran the adapter, wrote the file, and the
  application opened it — and that file was identical to what `revlens build` writes from
  the same inputs, but for the build timestamp
- `make package-desktop`, which wrote `dist/desktop/revlens-<version>.AppImage`

Written and unit-tested, but not exercised with a pointer on this machine: **File → Open**
and dropping a file on the window (both end in `openDocument`, which the argument route
exercises), the operating system association, and the Windows and macOS artifacts.

`npm run verify:pilot-host` still stops at Pilot's own `unpackVsix`, which never resolves
on Node 26.9 — reproduced with an archive holding none of the files this work touched, so
it is the host checkout's `extract-zip`, not the extension.
