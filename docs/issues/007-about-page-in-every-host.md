---
title: INT-007 - About as a page in every host, not a dialog
description: Apply when working on the About page - apps/web's About component, the Help menu of apps/desktop, the About command of apps/vscode, and what a host hands the viewer page in packages/viewer-page.
category: specification
ai_load: on-demand
status: draft
created: 2026-10-22
related:
  - docs/issues/002-document-revision-viewer.md
  - docs/issues/done/004-desktop-application.md
  - docs/adr/ADR-006-standalone-product-and-editor-extensions.md
  - docs/adr/ADR-007-desktop-application-for-readers.md
---

# INT-007 - About as a page in every host, not a dialog

## Metadata

- **Status**: 📋 Open
- **Type**: enhancement
- **Priority**: low
- **Created**: 2026-10-22
- **Author**: Zdeněk Kurc
- **Target**: `apps/web` (the About page without a bundle, the build facts, the
  third-party list), `packages/viewer-page` (what a host hands the page), `apps/desktop`
  (Help → About), `apps/vscode` (an About command); `apps/pilot` only through the
  capability probe
- **GitHub**: [#7](https://github.com/cassandragargoyle/revlens/issues/7)
- **Related**:
  - [INT-002 — Document revision viewer](../002-document-revision-viewer.md) — where
    `#/about` is specified, "a page, not a modal"; this issue amends that section
  - [INT-004 — Desktop application](done/004-desktop-application.md) — the Help menu and
    the welcome page this issue changes
  - [ADR-006 — Standalone product and editor extensions](../adr/ADR-006-standalone-product-and-editor-extensions.md)
    — one viewer, no fork per host
  - [ADR-007 — Desktop application for readers](../adr/ADR-007-desktop-application-for-readers.md)
  - Reference: `portunix-reco-studio`
    [#60](https://github.com/cassandragargoyle/portunix-reco-studio/issues/60) and
    [#66](https://github.com/cassandragargoyle/portunix-reco-studio/issues/66) — the same
    road walked once already, from a message box through a modal window to a page of the
    main window

## Problem

RevLens has two answers to "what is this", and they disagree.

The viewer has a real About page. `#/about` in `apps/web` carries the cover image, how to
read the document, the three gates, which identifiers are durable, and the provenance of
the loaded bundle. INT-002 decided it is a page, not a modal, because it has to be
linkable and it has to print.

The desktop application does not use it. **Help → About RevLens** in
`apps/desktop/src/main.ts` calls `dialog.showMessageBox`: the name, the version, one
sentence. No picture, no licence, no build details, no way to copy the text into a bug
report. It is exactly the state Reco Studio started from in its #60.

Three more gaps sit behind it:

- **The page needs a bundle.** `About` takes a `BundleIndex`, so on the desktop welcome
  page (`/-/welcome`), where no document is open, there is nothing to show it with. The
  moment a first-time reader most needs to know what the tool is, it cannot say.
- **The editor extension has no About at all.** In Visual Studio Code and in Pilot the
  page is reachable only from the rail of an open bundle.
- **The page names RevLens but nothing it is built from.** Every host ships third-party
  code - React, Zod, the unified/remark parser, diff-match-patch, Electron and Chromium in
  the desktop - under licences (MIT, Apache 2.0, BSD) that ask for their notice to travel
  with the product. Nothing on screen carries it, and a reader reporting a problem cannot
  see which Electron, Chromium or Node.js runs the window.

Reco Studio found the same thing and ended in the same place: About is a page of the main
window, it scrolls, it is closed like everything else, and no second window or dialog
exists for it. A modal window was its middle step, and it was dropped because the content
grew taller than a Full HD screen and the window needed its own preload only for itself.
RevLens can skip that step - the page already exists.

## Proposed Solution

### One page, three ways in

The About page stays the `About` component of `apps/web`. No host writes its own, in line
with ADR-006 and the rule that `viewer-page` is never written twice.

| Host | How About opens | What it shows |
| ---- | --------------- | ------------- |
| Browser, static export | the rail, as today; `#/about` | the page, with the bundle |
| Desktop, a document open | **Help → About RevLens** switches the focused window to `#/about` | the page, with the bundle |
| Desktop, welcome page | **Help → About RevLens**, and a link on the welcome page | the page without a bundle |
| Visual Studio Code, Pilot | the rail inside a bundle; and a command **RevLens: About** | the page without a bundle, in one webview panel |

- **Desktop.** The Help menu item no longer calls `dialog.showMessageBox`; that call is
  removed. With a document open, the window navigates to `#/about` of the page it already
  shows, so the reader goes back to the same place. With no document open, the window
  loads the viewer page with no bundle, at `#/about`. **Back** and Escape return to where
  the reader came from - the document or the welcome page. No second `BrowserWindow`
  opens, and a second Help → About does nothing more than the first
- **Editor extension.** A command `revlens.about`, titled **About RevLens**, opens a
  webview panel with the viewer page without a bundle. A second call reveals the open
  panel; there is never more than one. Inside an open bundle the rail keeps working as it
  does. The command needs `commands.registerCommand` and `window.createWebviewPanel`;
  both are **probed** in `apps/vscode/src/host.ts`, and where Pilot lacks either, the
  command is not registered and About stays reachable from the rail. Nothing
  Pilot-specific is written in code

### The page without a bundle

`About` takes the index as optional. Without one, the parts that describe a document -
the gates with their values, the provenance block, the counts - are left out, and the
parts that describe the tool stay: the lead, the cover and its caption, how to read a
document, the identifiers, and the two new sections below. Leaving a section out is
better than showing it empty; an empty provenance block would read as "nothing was
recorded".

How the page learns it has no bundle is the same seam the bundle uses today: the host
puts nothing on `__REVLENS_BUNDLE__` and asks for `#/about`. `apps/web` does not learn
that a desktop or an editor exists - it only learns that a page can be opened without a
document, which the browser can do as well.

### This build

A new section, after the provenance block when there is one:

| Fact | Browser | Desktop | Editor |
| ---- | ------- | ------- | ------ |
| RevLens | ✓ | ✓ | ✓ |
| Host | browser | desktop | Visual Studio Code or Pilot, with its version |
| Electron, Chromium, Node.js | - | ✓ | from the host when it reports them |
| Operating system | - | ✓ | ✓ |

The host hands these facts to the page next to the bundle, through `buildViewerPage` in
`packages/viewer-page` (a second global, for example `__REVLENS_HOST__`), as plain data.
The page prints what it is given and leaves out a row it was not given, rather than
printing `unknown` for every fact a browser cannot know. The section ends with a
**Copy** button that puts the facts on the clipboard as text, because the point of the
section is to land in a bug report.

### Third-party software and the licence

A new section listing every third-party package that ships inside the host the reader is
using: name, version, licence, and the copyright line from its licence file, with a link
to the licence text. Then the RevLens line itself: **Copyright (c) 2026 CassandraGargoyle
Team, MIT License**, and the project link.

The list is **generated at build time** from the `package.json` and licence files of the
runtime dependencies, not written by hand. A hand-written list is correct on the day it
is written and wrong after the next `npm install`; Reco Studio's is hand-written and this
is the place to not repeat that. A test fails when a runtime dependency of a host's
bundle is missing from the list that host ships.

Links on the page open in the system browser in the desktop and in the editor - never
inside the window or the webview. The desktop already refuses navigation away from its
own origin; the page's links go through the host's existing way out (`shell.openExternal`
on the desktop, `env.openExternal` in the editor), and only `http:` and `https:` are
passed on.

### Judgement calls

These are decided here so they can be disagreed with before they are built:

- **No separate About window**, unlike Reco Studio #60. RevLens already has the page,
  and #66 showed that the window is a step to be dropped later
- **No tab model in the desktop.** Reco Studio opens About as a tab in an editor area;
  a RevLens window shows one document and has no tabs, so About replaces the window
  content and **Back** returns. Adding tabs for one page would be the larger change
- **No new banner image.** The cover image is already on the page and INT-002 explains
  why it is the right picture; Reco Studio needed a banner because it had none
- **The page stays in Czech**, like the rest of the viewer's text (`strings.ts`). The
  build facts and the licence texts are shown as they are, in English
- **Per-host third-party lists**, not one list of everything. The browser does not ship
  Electron, and a notice for code that is not there is noise

## Acceptance Criteria

- [ ] Help → About RevLens in the desktop shows the About page in the focused window;
      `dialog.showMessageBox` is no longer used for About, and no new window opens
- [ ] With a document open, Back and Escape return to the document; on the welcome page,
      Help → About and a link on the page show About without a bundle, and Back returns
      to the welcome page
- [ ] Without a bundle the page shows the lead, the cover, how to read a document, the
      identifiers, This build and Third-party software, and leaves out the gates, the
      provenance and the counts
- [ ] **This build** shows the RevLens version and, per host, the facts in the table
      above; the Copy button puts them on the clipboard as text
- [ ] **Third-party software** lists every runtime dependency shipped by that host, with
      version, licence and copyright, generated at build time; a test fails when one is
      missing
- [ ] The RevLens copyright and MIT licence line and the project link are on the page
- [ ] Visual Studio Code has the command **About RevLens**; it opens one webview panel and
      a second call reveals it
- [ ] In Pilot the command is registered only when the probe finds what it needs;
      otherwise About is reachable from the rail of an open bundle and nothing fails
- [ ] Links open in the system browser from the desktop and the editor; only `http:` and
      `https:` are passed on
- [ ] The page scrolls and is fully reachable in a 1000 × 600 window, in light and dark
      theme
- [ ] The packaged desktop (AppImage, Windows installer) and the `.vsix` show the page
      with the cover and the third-party list, not only a development run
- [ ] INT-002's About section is amended: the page opens without a bundle, and the two
      new sections are named there

## Testing

- `apps/web/test/about.test.tsx`: the page with and without an index; the sections left
  out without one; the build facts printed only when given; the Copy text
- `packages/viewer-page`: `buildViewerPage` without a bundle and with host facts - the
  global is set, the CSP still holds
- The third-party list: the generator over a fixture of packages; the per-host check that
  every runtime dependency is listed
- `apps/desktop/test`: the Help menu no longer reaches `dialog.showMessageBox`; the route
  for the page without a bundle
- `apps/vscode/test`: the command is registered when the probe finds it and skipped when
  it does not; a second call reveals the same panel
- Manual: the desktop on Linux and Windows, from the welcome page and from a document;
  Visual Studio Code and Pilot after `npm run package:pilot` and `verify:pilot-host`

## Rollback

Revert the commits. The Help menu goes back to `dialog.showMessageBox`, the
`revlens.about` command and its panel go away, `About` takes a required index again, and
the generated third-party list and its build step are removed. No bundle format changes,
so no bundle built in between is affected.
