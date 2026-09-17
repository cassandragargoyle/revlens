---
title: INT-003 - Left rail for the viewer's main window
description: Apply when changing the layout of the revlens viewer's main window - the leftmost icon rail that holds the three view modes and the About page, in a narrow icons-only and a wide icons-with-labels state.
category: specification
ai_load: on-demand
status: active
created: 2026-09-17
related:
  - docs/issues/002-document-revision-viewer.md
  - docs/adr/ADR-006-standalone-product-and-editor-extensions.md
---

# INT-003 - Left rail for the viewer's main window

## Metadata

- **Status**: Implemented
- **Type**: enhancement
- **Priority**: medium
- **Created**: 2026-09-17
- **Implemented**: 2026-09-17
- **Author**: Zdeněk Kurc
- **Target**: `apps/web` (React + Vite viewer), drawing in `docs/architecture/ui/`
- **Related**:
  - [INT-002 — Document revision viewer](002-document-revision-viewer.md) — the viewer this
    re-arranges; its [Frontend](002-document-revision-viewer.md#frontend) section describes
    the window as it stands today
  - [ADR-006 — Standalone product and editor extensions](../adr/ADR-006-standalone-product-and-editor-extensions.md)
    — the same viewer runs inside the Visual Studio Code and Pilot webview
  - [`docs/architecture/ui/main-window.svg`](../architecture/ui/main-window.svg) — the
    current window, drawn from the code

## Feature Description

Add a **left rail** as the leftmost column of the viewer's main window — the shape
ChatGPT uses: a vertical strip of entries that shows in **two states**,

1. **narrow** — icons only, one column wide,
2. **wide** — the same icons with their Czech labels beside them,

with one control that switches between the two.

The rail sits **before** the existing column that holds **Kapitoly**, **Revize** and
**Připomínky**, so the window reads left to right as: rail, navigation column, document,
inspector.

The rail carries the four entries that change *what the window shows*, rather than *which
part of the document it shows*:

| Entry | Czech label (`strings.ts`) | What it does |
| ----- | -------------------------- | ------------ |
| Clean text | `Čistopis` | view mode `clean` — the final text as the reader gets it |
| With changes | `Se změnami` | view mode `review` — insertions underlined, deletions struck |
| Baseline | `Původní verze` | view mode `baseline` — the text the reviewers received |
| About | `O nástroji` | the `#/about` page |

## Use Case

The window has four columns of content and one header, and the header currently does three
different jobs at once: it names the document, it switches the view mode, and it opens the
About page. Two problems follow from that.

**The mode switch is the most-used control in the tool and it is the least visible one.**
It sits in the middle of a header line whose other contents — title, document name,
version, baseline, the count of unexplained changes, the build time — are all read once and
then ignored. A reader who switches between *Čistopis* and *Se změnami* on every second
paragraph reaches across the whole window to do it.

**The header has no room left.** Every new piece of provenance competes with the mode
switch for the same line, and on a narrow window — the Visual Studio Code and Pilot webview
is routinely half a screen wide — the header already has to drop content to fit.

A rail fixes both: it is a column that grows downwards rather than sideways, it keeps the
mode switch at a fixed, reachable place, and in its narrow state it costs about 48 px of
width, which is less than the mode buttons cost in the header today.

## Proposed Solution

### Where it sits

`apps/web/src/styles.css` declares the window as a five-column grid:

```css
.app {
  grid-template-columns: var(--pane-left, 290px) 4px minmax(0, 1fr) 4px var(--pane-right, 360px);
}
```

It becomes six columns, the rail first and not resizable:

```css
.app {
  grid-template-columns: var(--rail) var(--pane-left, 290px) 4px minmax(0, 1fr) 4px var(--pane-right, 360px);
}
```

The rail has two widths, not a dragged one: `--rail` is the narrow width in the icons-only
state and the wide width in the icons-with-labels state. The two side panes keep their
resizers and their remembered widths; the rail is deliberately **not** a third resizable
column, because a rail whose width is a continuum has no icons-only state.

The rail spans the document row, under the header — it is a column of the body, not a
replacement for the header. The header keeps the document, its version, the baseline it is
compared against, the count of unexplained changes and the build time.

### The two states

- **Narrow** — icon only, the label being the accessible name and the tooltip.
- **Wide** — icon and label side by side, the label being exactly the string the header
  button shows today.

One control switches between them, at the top of the rail, in the place ChatGPT puts it.
Which state the viewer is in is a **per-viewer convenience**, so it is remembered the way
the pane widths already are: `localStorage`, every access guarded, and its absence never a
reason the page fails to render — see `apps/web/src/state/usePaneWidths.ts`, whose
`STORAGE_KEY` convention (`revlens:…`) the rail follows.

The **default is narrow**, and that follows from the principles rather than from taste:
the viewer's whole point is the document, the editor webview is often half a screen wide,
and a tool that opens with two columns of chrome before the text has spent width it has
not earned.

### What moves out of the header

The three mode buttons and the *O nástroji* button move **into the rail and out of the
header**. They are not duplicated. Two controls for one state is two places to keep in
agreement and two answers to "is it pressed?" — the rail is the one place.

This is the one part of the proposal that is a judgement call rather than a consequence of
the request, and it is written here so it can be disagreed with before it is built.

### What does not move

**Kapitoly**, **Revize** and **Připomínky** stay where they are, in the column to the
right of the rail, together with the filter above them. They are not rail entries, even
though the shape would allow it: they choose *which way into the document* the reader
takes, and each one needs the list, the filter and the counts that sit under it. The rail
entries choose *how the text is rendered*, and carry nothing underneath.

### Icons

Inline SVG in the viewer's own source, no icon package and no font from a CDN. The static
export and the editor page must keep working offline with nothing fetched — that is a
standing constraint of this repository, not a preference.

Each icon carries `aria-hidden`, and the accessible name comes from the label, so the
narrow state is not a row of unnamed buttons to a screen reader.

### Behaviour and accessibility

- The rail is a `nav`; the three mode entries form one group, marked with `aria-pressed` as
  the header buttons are today, because exactly one mode is active at a time. *O nástroji*
  is a toggle, separated from the three by a divider.
- The state switch is a button reporting `aria-expanded`, and the rail's state is reflected
  on the container so the stylesheet can do the rest.
- Keyboard: the rail is in the tab order before the navigation column, and the arrow keys
  move between its entries. The document keys (`n`, `p`, `j`, `k`, `Esc`) are untouched.
- Print: the rail is hidden, as the other chrome already is in the `@media print` blocks.

### The drawing

`docs/architecture/ui/main-window.svg` is drawn from the code and is the only picture of
the window. It is re-drawn as part of this change, with the rail in both states, or it is
wrong the moment this ships.

### Non-goals

- No new setting. `revlens.reloadOnChange` stays the extension's only one — the rail's
  state is remembered, not configured.
- No change to the bundle, the schema, the API or the MCP tools. This is layout; `core`
  does not learn about it.
- No second rail on the right, and no move of the inspector.
- No mobile or touch layout. The viewer's target is a desktop window and an editor webview.

## Acceptance Criteria

- [x] The main window has a leftmost rail, before the **Kapitoly / Revize / Připomínky**
      column, spanning the body under the header
- [x] The rail has a narrow state showing icons only and a wide state showing the same
      icons with their labels, and one control switches between them
- [x] The rail holds **Čistopis**, **Se změnami**, **Původní verze** and **O nástroji**,
      with the labels taken from the existing `cs.mode.*` and `cs.about.open` strings
- [x] Selecting a mode entry changes the document exactly as the header buttons do today,
      and the active mode is marked on the rail
- [x] **O nástroji** opens `#/about` and the entry is marked while that page is open; the
      deep link still works on a cold load
- [x] The header no longer carries the mode buttons or the About button, and there is no
      second control anywhere for either
- [x] The state of the rail is remembered per browser through `localStorage`, defaults to
      narrow, and its absence or failure never stops the page rendering
- [x] Icons are inline SVG from the repository; nothing is fetched at runtime, and
      `revlens build --static` still works from the file system with no server
- [x] Every rail entry has an accessible name in the narrow state; the mode group is
      keyboard-reachable and arrow-navigable, and the state switch reports `aria-expanded`
- [x] The rail is hidden in print
- [ ] The viewer renders correctly in the Visual Studio Code and Pilot webview at half a
      screen's width, with the rail narrow — not verified by eye; headless rendering on the
      build machine stopped producing screenshots. The stylesheet is asserted instead, in
      `apps/web/test/layout.test.ts`
- [x] `docs/architecture/ui/main-window.svg` is re-drawn with the rail in both states
- [x] The end-to-end web test drives the rail: switching modes, opening About, and
      toggling narrow and wide
- [x] `npm run lint`, `npm run typecheck`, `npm run build` and `npm test` pass

## Notes

- The labels are already written and already Czech. This change adds no wording beyond the
  rail's own: the name of the state switch, and a group heading if the divider needs one.
  Both belong in `apps/web/src/strings.ts` under a new `cs.rail` key — English identifiers
  with Czech values, like everything else there.
- The files this touches: `apps/web/src/App.tsx` (the header and the grid's contents), a
  new `apps/web/src/components/Rail.tsx`, `apps/web/src/styles.css` (the grid at `.app`),
  `apps/web/src/strings.ts`, and a new hook beside `usePaneWidths.ts` for the remembered
  state.
- Decided while building: the rail does **not** carry the keyboard help. It stays in the
  documentation on the *O nástroji* page, where `cs.keyboard` is already read out. The left
  column still shows a second copy of it; that duplicate is untouched by this change.
- Added while building, beyond the four entries above: **Přegenerovat** is a fifth entry,
  below *O nástroji*, and it appears only where a bundle is served and there is an adapter
  to run again (`source.kind === 'api'`). It left the header for the same reason the others
  did. It is an action, not a state, so nothing about it stays pressed.
