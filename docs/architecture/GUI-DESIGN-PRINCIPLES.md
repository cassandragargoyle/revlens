---
title: GUI Design Guidelines
description: Apply when adding or changing anything the reader sees in the revlens viewer — icons, colours, spacing, interaction states — and when drawing the SVG that documents a window.
category: style-guide
ai_load: on-demand
status: active
created: 2026-09-17
last_updated: 2026-09-17
related:
  - docs/DESIGN-PRINCIPLES.md
  - docs/architecture/ui/main-window.svg
  - docs/architecture/ui/main-window.cs.svg
---

# GUI Design Guidelines

This document defines the visual conventions for everything revlens shows a reader: the
viewer in `apps/web`, the same viewer inside the Visual Studio Code and Pilot webview, and
the SVG drawings under [`ui/`](ui/) that document a window.

`apps/web/src/styles.css` is the source of truth. Where this document and the stylesheet
disagree, the stylesheet is right and this document is stale.

## Reference

- [Design Principles](../DESIGN-PRINCIPLES.md) — automatic over manual, zero configuration,
  convention over configuration, fail gracefully
- [`ui/main-window.svg`](ui/main-window.svg) — the main window, drawn from the code, with
  the interface strings in English; [`ui/main-window.cs.svg`](ui/main-window.cs.svg) is the
  same drawing with the strings the reader actually sees
- [ADR-006](../adr/ADR-006-standalone-product-and-editor-extensions.md) — why one viewer
  runs in three places and may not be forked for any of them

---

## Nothing Is Fetched

The static export `revlens build --static` writes must work from a file system with no
server, and the editor webview runs behind a content security policy that allows only the
viewer's own resources. So:

- No icon package, no web font, no stylesheet or script from a CDN
- Icons are inline SVG in the component that uses them
- Images are imported through the bundler, so they land in `assets/` next to the page

This is a constraint of the product, not a preference. A dependency that fetches anything
at runtime breaks the offline export and the webview at the same time.

## Icon Style

### Monochrome Icons Only

Icons are single-colour and stroke-based. This applies to the rail, the toolbars, the
lists and anything else that is not the document text.

| Avoid | Prefer |
| ----- | ------ |
| Coloured emoji (📁 📄 🔍) | Monochrome SVG path drawn in the source |
| Multi-colour fills | A single stroke in `currentColor` |
| Icon fonts, sprite sheets, packages | Inline `<svg>` in the component |

Colour in this interface means *which revision* a passage came from, and nothing else — see
[Colour](#colour). An icon that carries a colour of its own competes with that.

### Icon Construction

- **Stroke-based**: `fill="none"` with `stroke="currentColor"`, so the icon takes the
  colour of the control it sits in, pressed or not
- **Consistent weight**: `stroke-width="1.5"` at 20px
- **Rounded caps**: `stroke-linecap="round"`, `stroke-linejoin="round"`
- **Standard size**: a `0 0 20 20` viewBox at 20px for rail entries and toolbar buttons
- **Never named by the icon**: every icon carries `aria-hidden="true"` and
  `focusable="false"`, and the accessible name comes from the text label beside it — which
  the narrow rail hides from the eye and never from the accessibility tree

The shared `Glyph` wrapper in [`apps/web/src/components/Rail.tsx`](../../apps/web/src/components/Rail.tsx)
holds all of that in one place; a new icon is a `<path>` inside it, not a new `<svg>`.

### Icon Reference Shapes

The shapes the viewer already uses. A new icon should be as plain as these — at 20px, a
drawing with more than four strokes reads as a smudge.

| Item | Shape |
| ---- | ----- |
| Clean text | Four horizontal lines, the last one short |
| Marked-up text | The same lines with one diagonal stroke across them |
| Baseline | A dial with a counter-clockwise arrow around it |
| About | A circle with an `i` |
| Rail state switch | A panel with its edge marked and a chevron pointing the way |
| Rebuild | Two chasing arrows |

---

## Colour

### The Palette

Every colour is a custom property on `:root` in `apps/web/src/styles.css`. Components
reference the property, never the hex.

| Property | Value | Used for |
| -------- | ----- | -------- |
| `--bg` | `#fbfbfa` | The page behind the panes |
| `--surface` | `#ffffff` | Panes, header, rail, cards |
| `--ink` | `#1c1c1a` | Body text |
| `--ink-soft` | `#55534e` | Labels, icons at rest, secondary text |
| `--ink-faint` | `#8a8781` | Counts, timestamps, hints |
| `--line` | `#e2e0db` | Borders between panes and rows |
| `--line-strong` | `#c9c6c0` | Input borders, the window frame |
| `--accent` | `#2b6cb0` | The pressed state, focus rings, selection borders |
| `--accent-soft` | `#eaf1f9` | Hover, selected rows |
| `--inserted` / `--inserted-soft` | `#1a7f5a` / `#e6f4ee` | Insertions in the document |
| `--deleted` / `--deleted-soft` | `#a33a2c` / `#fbecea` | Deletions in the document |
| `--selected` | `#f6e2a8` | The one edit the inspector is showing |

There is one theme, and it is light: the viewer is a page of a document, and a document is
read on paper. If a dark theme is ever added it is added here, as a second block of the
same properties, and nowhere else.

### Colour Identifies the Revision

A marked passage is tinted with the colour of the revision that produced it, computed in
[`apps/web/src/colors.ts`](../../apps/web/src/colors.ts) from the revision's position in
the bundle. One instruction landing in three chapters is one colour in all three.

That is what colour is for in this tool. Do not spend it on anything else:

- No category colouring (folders yellow, files blue)
- No semantic colouring of icons (red for error, green for done) — an icon says what a
  control does, and its state says the rest
- No inline colour that bypasses the properties above

The kind of a change is shown by its marking, not by its hue: insertions are underlined,
deletions struck through, filtered-out passages dimmed. Those readings have to survive a
reader who cannot tell the hues apart.

---

## Layout

### Spacing

- A 4px grid: 4, 8, 12, 16, 24 for padding and margins between blocks
- 2px between rows of a list, where a wider gap would break the column into stripes
- 14px padding inside a pane, 8px inside the rail
- One exception, written down so it is not mistaken for drift: an icon row is 7px of
  padding around a 20px icon, so that the row is 34px and the icons line up with the text
  rows beside them

### Typography

| Element | Size | Weight | Property |
| ------- | ---- | ------ | -------- |
| Document text | 16.5px | 400 | `--font-text` (serif) |
| Interface text | 14px | 400 | `--font-ui` |
| Labels, list rows | 12.5px | 400 | `--font-ui` |
| Counts, hints, timestamps | 11px | 400 | `--font-ui`, `--ink-faint` |
| Section label | 10-12px | 600, uppercase, letter-spacing 0.08em | `--font-ui`, `--ink-faint` |
| Identifiers (`r-0142`, `K2-004`) | 10.5-12px | 400 | `--font-mono` |

The document uses a serif and the interface a sans: the reader has to be able to tell the
text being reviewed from the tool reviewing it.

### Interaction States

| State | Visual |
| ----- | ----- |
| Default | `--surface` behind, `--ink-soft` in front |
| Hover | `--accent-soft` background |
| Pressed (`aria-pressed="true"`) | `--accent` background, white text and icon |
| Selected row | `--accent-soft` background, `--accent` border |
| Disabled | 50% opacity, `cursor: default` |
| Focus-visible | 2px `--accent` outline |

A control that carries a state says so with `aria-pressed` or `aria-expanded`, and the
stylesheet hangs the appearance off that attribute. Never a class that says the same thing
a second time.

### Print

Print is a supported output, not an afterthought: a reader prints the marked-up document
and takes it to a meeting. Every `@media print` block follows two rules:

- The chrome goes: rail, panes, resizers, toolbars, the About page's back button
- The marks stay, but in black: an insertion keeps its underline and a deletion its strike,
  because a tint does not survive a monochrome printer

---

## SVG Drawings

The drawings in [`ui/`](ui/) document a window as it is, not as it was proposed. A change
to the layout re-draws them in the same commit, or the picture is wrong the moment it
ships.

1. Reuse the component's own path data for an icon, so the drawing cannot drift from the
   code it draws
2. A window is drawn twice. `<name>.cs.svg` carries the interface strings in Czech,
   exactly as `apps/web/src/strings.ts` has them; `<name>.svg` is the same drawing with
   those strings translated, so an English reader of the documentation can follow it.
   Geometry is identical in both — only the strings differ, and a run with an explicit
   `textLength` keeps that value so the tint and the rule under it stay put. Annotations
   are English in both, per the repository rule
3. Annotations are numbered discs in `--accent` (`#2b6cb0`) with a caption column on the
   right; a leader line only where the disc cannot sit on what it marks
4. Use the palette above for the interface, and the document's own colours for a marked
   passage
5. Keep the classes at the top of the file (`.ui`, `.mono`, `.doc`, `.ink`, `.soft`,
   `.faint`, `.cap`, `.capH`, `.bnum`) rather than styling each element
6. Give the `<svg>` a `<title>` and a `<desc>` — the drawing is documentation, and
   documentation is read by people who cannot see it

---

## Checklist for New UI Components

- [ ] Nothing is fetched at runtime: no package, no font, no CDN
- [ ] Icons are inline, monochrome, `stroke="currentColor"`, `aria-hidden`
- [ ] Colours come from the properties on `:root`, never a hex in a component
- [ ] Colour is not used to say what kind of thing something is
- [ ] Hover, pressed, disabled and focus-visible are all defined
- [ ] State lives on an ARIA attribute, and the stylesheet reads it from there
- [ ] Every control has an accessible name, including one that shows only an icon
- [ ] Spacing is on the 4px grid, or the exception is written down
- [ ] The component is hidden or flattened in `@media print`, whichever is right for it
- [ ] It works at half a screen's width, which is what the editor webview usually is
- [ ] Both drawings in `ui/` — `.svg` and `.cs.svg` — are re-drawn in the same commit
