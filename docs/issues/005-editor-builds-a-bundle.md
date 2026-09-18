---
title: INT-005 - The editor builds a bundle, not only reads one
description: Apply when working on the Visual Studio Code and Pilot extension in apps/vscode - running a build from the editor, the shared build wrapper, the extension identifier and the one icon source behind all three targets.
category: specification
ai_load: on-demand
status: draft
created: 2026-09-18
related:
  - docs/issues/002-document-revision-viewer.md
  - docs/issues/done/004-desktop-application.md
  - docs/adr/ADR-006-standalone-product-and-editor-extensions.md
---

# INT-005 - The editor builds a bundle, not only reads one

## Metadata

- **Status**: 📋 Open
- **Type**: enhancement
- **Priority**: high
- **Created**: 2026-09-18
- **Author**: Zdeněk Kurc
- **Target**: `apps/vscode` (the extension), `packages/adapters` (the shared build),
  `apps/desktop` (adopts the shared build), `apps/pilot` (the declaration)
- **GitHub**: [#5](https://github.com/cassandragargoyle/revlens/issues/5)
- **Related**:
  - [INT-002 — Document revision viewer](002-document-revision-viewer.md) — the
    specification; `revlens build` and the data contract are described there
  - [INT-004 — Desktop application](done/004-desktop-application.md) — where the build
    form already exists, and the code this issue shares rather than copies
  - [ADR-006 — Standalone product and editor extensions](../adr/ADR-006-standalone-product-and-editor-extensions.md)
    — one extension, two hosts, and why the viewer may not be forked for either
  - [ADR-007 — A desktop application for readers](../adr/ADR-007-desktop-application-for-readers.md)
    — the editor stays the primary target; the window is the second one

## Feature Description

The extension is half a tool. It **opens** a bundle — the custom editor `revlens.bundle`
claims `*.revlens`, validates it and renders the viewer — but it cannot **build** one.
Producing the bundle means leaving the editor for `revlens build` with six flags, or
installing the desktop application, which grew a **File → Build a Bundle…** form in
INT-004.

Finish the extension, so that the revision analysis can be *run* and the result *read*
without leaving the window the document already lives in:

| Entry point | What it does |
| ----------- | ------------ |
| `revlens: Build a Bundle…` | Asks for the source, the repository, the baseline and where to write, runs the build, opens the result in the viewer |
| **Build Revision Bundle** on a folder | The same, from the explorer context menu, with the repository already filled in |
| `revlens: Rebuild This Bundle` | Runs the build that produced the open bundle again, with the same answers, and re-renders the tab |
| Progress and report | `withProgress` while it runs, and the report `revlens build` prints in an output channel afterwards |

Two smaller things belong in the same issue, because they are the same claim — that there
is one product, however it was installed:

- the extension identifier is written as it is used everywhere else:
  **`cassandragargoyle.revlens`**,
- the mark is **one drawing** with one renderer, not three PNGs that happen to agree today.

## Use Case

A reviewer has the repository open in Visual Studio Code. The document is in it, the
reviewer comments are in it, and the revisions being analysed are its own history. To see
what changed since the build the reviewers received, that reviewer today has to:

1. leave the editor for a terminal,
2. remember the six flags of `revlens build`, including which source adapter this
   engagement uses and where the records live,
3. find the written file, and open it back in the editor.

Steps 1 and 2 are where it stops being used. The desktop application solved this for
readers who are not in an editor (INT-004); the reader who *is* in an editor — the primary
target, per ADR-006 — was left with the command line.

A second use case is narrower and daily: a bundle is open, the analysis is re-run after a
fix, and the tab should show the new result without the reader reconstructing the six
flags a second time.

## Proposed Solution

### 1. One build, called from three places

`buildBundle` in [`packages/adapters/src/build.ts`](../../packages/adapters/src/build.ts)
is already shared by the CLI and the desktop window. What is *not* shared is everything
around it, and it is the part with the judgement in it:
[`apps/desktop/src/build.ts`](../../apps/desktop/src/build.ts) probes for git, writes the
message that names the missing program instead of a stack trace, refuses an empty
baseline, validates, serialises, and formats the report.

Lift that wrapper — `runBuild`, `gitVersion`, `missingGitMessage`, `listSources` and the
outcome types — into `packages/adapters`, beside the `buildBundle` it wraps. The desktop
file becomes the thin IPC layer it should have been, and the extension calls the same
function rather than growing a third copy of "is git installed".

> **Judgement call.** The alternative is a new `packages/build` for the host-facing layer,
> leaving `adapters` to mean only "reads a source". That is the tidier boundary and one
> more package to build, publish and reason about. This issue proposes widening
> `adapters`, because the wrapper has no dependency the adapters do not already have.
> Disagree here rather than after it is moved.

### 2. The command, and what it asks

`revlens.buildBundle`, a sequence of native pickers — no webview form, so it works in a
window with no workspace open:

| Asked | How | Default |
| ----- | --- | ------- |
| Source | `QuickPick` over `listSourceAdapters()`, showing each adapter's description | the only one, when a build knows one |
| Repository | folder picker | the workspace folder, or the folder the command came from |
| Baseline (`from`) | `InputBox` | the last answer for this repository |
| Head (`to`) | `InputBox`, may be left empty | empty, meaning the working revision |
| Records | file picker, may be skipped | the last answer |
| Output | save dialog | `<repository>/out/<name>.revlens` |

Then `withProgress` while it runs, the report in an output channel, and the written file
opened with `revlens.bundle` — the editor the extension already contributes.

The answers are remembered per repository in `workspaceState`, which is also what makes
**Rebuild This Bundle** possible.

> **Judgement call — how a rebuild knows what to run.** A bundle does **not** record what
> built it: `document.baseline` and `generator` are in the contract, the source adapter,
> the repository, the records path and the threshold are not. So either the extension
> remembers the answers per output file (proposed: no contract change, and nothing of the
> reader's machine ends up in a file that gets sent to other people), or the contract grows
> a provenance block — which is a change to INT-002, to the generated schema, and to what a
> bundle discloses about the machine it was built on. This issue proposes remembering, and
> a rebuild offers the form again when it has nothing remembered.

### 3. Pilot, which has no commands

Pilot's State A host offers a custom editor, a webview, configuration and a file watcher —
and no `commands.registerCommand`. [`host.ts`](../../apps/vscode/src/host.ts) already
probes for exactly that, so the commands simply do not register there and nothing breaks.
That is the floor, not the goal: the ask is that the analysis can be *run* in Pilot too.

The one surface both hosts have is the **webview**. The proposal:

- the page seam in `packages/viewer-page` learns to carry a small, host-supplied
  capability object — "this host can build" — beside the bundle it already injects,
- the viewer's existing empty and error states render a **Build…** affordance only when
  that flag is set, and post a message; the extension listens and runs the same
  `runBuild`,
- nothing host-specific enters `apps/web`: the viewer is told what is possible and draws
  the same control for whichever host said so, which is the capability probe of ADR-006
  applied to the page instead of the API.

Two unknowns to settle before this part is built, and they are why it is listed after the
command: whether a State A webview's `postMessage` reaches the extension at all, and
whether Pilot's host may write a file the reader chose. Both are questions for
`portunix-vscode`, and the answer belongs in `apps/pilot/pilot-plugin.json` either way —
`availableFeatures` is an assertion we make and have to keep true. If the answer is no,
this issue ships the VS Code half and records the reason here, rather than pretending.

### 4. The identifier, written the way it is used

The extension id is `<publisher>.<name>`, today `CassandraGargoyle.revlens`. Everything
that consumes it already lower-cases it: `scripts/package-extension.ts` names the file
with `publisher.toLowerCase()`, and `apps/pilot/pilot-plugin.json` carries
`cassandragargoyle.revlens`, which is the only form its `PLUGIN_ID` pattern accepts.

Set `"publisher": "cassandragargoyle"` in the manifest, so the identifier the marketplace
shows, the file name and the catalog entry are one string. The extension is not published
yet, so there is nothing to migrate.

### 5. One drawing, one renderer

The mark exists three times, from one drawing:

| File | Size | Consumer |
| ---- | ---- | -------- |
| `apps/vscode/icon.svg` | — | the drawing |
| `apps/vscode/icon.png` | 128×128 | the extension manifest, the Pilot catalog |
| `apps/web/src/assets/icon.png` | 128×128 | the viewer's favicon; a byte-identical copy, held in place by `apps/web/test/icon.test.ts` |
| `apps/desktop/build/icon.png` | 512×512 | electron-builder, and the window |

The drawing lives inside `apps/vscode/` although three targets use it, and the renders are
produced by hand with a headless browser. Move the drawing to a neutral path and give the
renders a script, so a change to the mark is one edit and one command.

> **Judgement call.** A rasteriser as a dependency (`sharp`, `resvg`) would make the script
> ordinary, and it is a dependency for a build step no reader runs. The alternative is
> keeping the headless browser call, which every developer machine can do and no CI image
> guarantees. Proposed: the script uses a browser if it finds one and says clearly what to
> install if it does not, and the committed PNGs stay committed.

### 6. Starting from nothing: an example the reader can generate

Everything above assumes the reader already has the material — a repository of chapters, a
change log under `docs/changes/`, comment rounds under `docs/comments/`. A first-time
reader has none of it, and the build form asks six questions about a shape nobody has
described to them. The honest answer to "what do I put where" is not a paragraph of
documentation; it is a working engagement they can open and read.

So both hosts offer **Try an Example…**:

| Host | Where |
| ---- | ----- |
| Visual Studio Code | `revlens: Try an Example…` in the palette |
| The desktop window | A third button on the welcome page, beside Open Bundle and Build a Bundle |

It asks which example and, when the example has more than one language, which language.
Then it asks for a folder — an empty one, or one it may write into — and does what a
reader would otherwise do by hand:

1. writes the example's `docs/` there, so the change log and the comment rounds are on
   disk where the reader can open them,
2. replays the committed snapshots into a real git repository beside it, with the dates
   the manifest gives,
3. runs the same `runBuild` the build command runs,
4. opens the bundle in the viewer.

What the reader is left with is a directory whose shape is the answer to their question,
and a document in front of them that was built from it. The next build is the same six
questions over their own material, and they have now seen what each one meant.

> **Judgement call — where it writes.** A temporary directory would make this one click
> instead of two. It is rejected: the point is that the reader *finds* the material
> afterwards and reads it, and a path under `%TEMP%` is a path nobody opens twice.

**The seeding moves into a package.** `scripts/seed-example.ts` is the only implementation
of "replay the snapshots into a repository", and make is its only caller. The editor and
the window need the same thing, so it moves beside `runBuild` in `packages/adapters` and
the script becomes the thin command-line wrapper it should have been — the same move §1
makes for the build wrapper, and for the same reason.

**The examples ship with the application.** They live in `examples/` and are not in the
`.vsix` or the packaged window today. Both bundlers copy them next to the viewer they
already copy, so `media/examples/` travels with `media/viewer/`. They are text and they
are small.

**An example says what it is.** A picker needs a title and a sentence per language, and an
example has neither in a form anything can read — `README.md` is for people. Each example
grows an `example.json`, with a contract in `examples/example.schema.json` beside the
`history.schema.json` already there, and `npm run example:check` validates it with the
rest.

**Three examples, because one is not a choice.** One example teaches its own shape; three
teach which parts are essential and which were that engagement's:

| Example | What a reader takes from it |
| ------- | --------------------------- |
| `01-revision-round` | A full round: five instructions, four comments, three chapters — the tool doing its job |
| `02-first-bundle` | The smallest thing that works: one chapter, one instruction, one comment. The shape with nothing else in it |
| `03-loose-ends` | The awkward one: a comment that never joins, a commit with no instruction behind it, a chapter rewritten past recognition — so the warnings in the report mean something before the reader meets them on their own material |

### The two corrections §2 needs

Building from the editor already exists and two things in it are wrong:

- the save dialog offers `bundle.revlens.json`. A compound extension is exactly what
  `AGENTS.md` says never to write: Pilot matches a plain `path.extname`, so a
  `*.revlens.json` file is one Pilot cannot open. The default is `*.revlens`.
- the explorer context menu pre-fills the folder as the **records**. The folder a reader
  right-clicks is the repository; that is what this issue said and what the menu's own
  label promises.

## Acceptance Criteria

- [ ] `revlens: Build a Bundle…` runs a build from Visual Studio Code and opens the written
      bundle in the `revlens.bundle` editor, without a terminal
- [ ] The command asks through native pickers only, and works with no folder open
- [ ] **Build Revision Bundle** appears on a folder in the explorer and pre-fills it as the
      repository
- [ ] `revlens: Rebuild This Bundle` re-runs the build behind the open bundle and
      re-renders the tab; with nothing remembered, it offers the form instead of failing
- [ ] Progress shows while the build runs, and the report `revlens build` prints lands in
      an output channel
- [ ] Without git on the `PATH`, the editor shows the message naming what is missing and
      where to get it — the same words the desktop window shows, from the same function
- [ ] A build started in the editor and the same build started from `revlens build` write
      the same bytes
- [ ] `runBuild` and its helpers live in one package; `apps/desktop/src/build.ts` calls it
      rather than owning it, and no third copy of the git probe exists
- [ ] The extension registers the build commands only where the host has `commands`, and
      opening a bundle in Pilot is unchanged
- [ ] Either Pilot can start a build through the webview seam, with `pilot-plugin.json`
      saying so, or this issue records why it cannot and `availableFeatures` stays honest
- [ ] Nothing host-specific is added to `apps/web`: the viewer draws a build affordance
      from a capability it is handed, not from knowing which host it is in
- [ ] The manifest publisher is `cassandragargoyle`, so the identifier, the `.vsix` file
      name and the Pilot catalog entry are the same string
- [ ] One drawing produces all three PNGs through a script, and the existing icon test
      still holds the viewer's copy identical to the extension's
- [ ] `revlens: Try an Example…` writes an example into a folder the reader chose, seeds
      the repository, builds the bundle and opens it — without the reader having any
      material of their own
- [ ] The desktop welcome page offers the same, as a third button
- [ ] What is written is readable afterwards: `docs/changes/` and `docs/comments/` on
      disk, a git repository beside them, and the bundle built from both
- [ ] Three examples are offered, and each says what it is in the language the reader
      picked
- [ ] `example.json` has a contract beside `history.schema.json`, and
      `npm run example:check` validates every example against it
- [ ] The seeding has one implementation: `scripts/seed-example.ts` calls it rather than
      owning it, and `make seed` still produces the repository it produced before
- [ ] The examples travel in the `.vsix` and in the packaged window, beside the viewer
- [ ] The build command's save dialog offers `*.revlens`, not the compound extension
      Pilot cannot match
- [ ] **Build Revision Bundle** on a folder pre-fills it as the repository
- [ ] `npm run lint`, `npm run typecheck`, `npm run schema:check`, `npm test`,
      `npm run build`, `npm run package:pilot` and `npm run verify:pilot-host` all pass
