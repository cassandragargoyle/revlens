# revlens desktop application

## Overview

**Repository**: `revlens`, `apps/desktop/`
**Language**: TypeScript, bundled with esbuild, packaged with electron-builder
**Status**: Early

The viewer in a window of its own, for readers who are not in an editor. A `*.revlens`
file is opened by double-clicking it, and a bundle is built from a repository through a
form instead of six command-line flags.

It is **not** a second viewer. The page in the window is the application from `apps/web`,
handed its bundle on the `__REVLENS_BUNDLE__` global — the same seam `revlens build
--static` and the editor extension use. Nothing in `apps/web` knows that a desktop host
exists.

The editor stays the primary target; this is the second one. See
[ADR-007](../../docs/adr/ADR-007-desktop-application-for-readers.md) for why both exist,
and [INT-004](../../docs/issues/done/004-desktop-application.md) for what was asked for.

## What it does

| The window | How |
| ---------- | --- |
| Opens a bundle | A command-line argument, **File → Open**, a file dropped on the window, or the `*.revlens` association |
| Remembers what was opened | **File → Open Recent**, and the operating system's own recent documents |
| Follows the file | Re-renders when a rebuild rewrites it; **Reload When the File Changes** turns it off, like `revlens.reloadOnChange` |
| Refuses a bundle it cannot trust | The validator's own reasons, in the window — the behaviour the extension has, because it is the same loader |
| Builds a bundle | **File → Build a Bundle…**, which runs what `revlens build` runs and writes the same bytes |

Without `git` on the `PATH`, building says what is missing and where to get it. Reading a
bundle that has already been built needs nothing at all — no git, no network, no server.

## Running it from source

```bash
npm install
npm run build          # the viewer has to exist before the window can show it
make desktop           # builds the example bundle and opens it in the application
```

`make desktop` is a wrapper over `npm run dev:desktop`, which takes a path of its own:

```bash
npm run dev:desktop -- out/example/example.revlens
```

If `npm install` reports that install scripts were not run, Electron's own postinstall —
the one that unpacks the runtime — is among them. Approve it once with
`npm install-scripts approve electron` and install again.

## Packaging

```bash
make package-desktop   # or: npm run package:desktop
```

Installers are written to `dist/desktop/` for the platform the command runs on:

| Platform | Artifact | Supported |
| -------- | -------- | --------- |
| Linux | AppImage | yes |
| Windows | portable `.exe`, NSIS installer | yes |
| macOS | `.dmg` | produced, **unsigned** — Gatekeeper will refuse it on a first open |

What is packed is `dist/` and `media/` and nothing else: esbuild has already bundled every
`@revlens/*` import into the two files in `dist/`, so no workspace symlink can end up
inside an installer.

## The window is locked down

- `contextIsolation` on, node integration off, `sandbox` on
- The preload exposes named calls — open, build, reveal, reload — never a raw channel
- The page is served over the `revlens-viewer:` scheme, so it keeps an origin, a
  Content-Security-Policy and a per-render nonce; `file://` would have none of them
- The asset handler answers only for paths inside the built viewer directory
- Nothing is fetched at runtime: no network, no CDN

## The icon

The drawing is `apps/vscode/icon.svg` — one mark for the product, rendered at the size
each consumer wants. The desktop needs 512×512, which electron-builder reads from
`build/icon.png`:

```bash
sed 's|width="128" height="128"|width="512" height="512"|' apps/vscode/icon.svg > /tmp/icon-512.svg
chrome --headless --default-background-color=00000000 --window-size=512,512 \
  --screenshot=apps/desktop/build/icon.png /tmp/icon-512.svg
```

## Layout

```text
apps/desktop/
  package.json           # the application manifest; electron and electron-builder live here alone
  esbuild.mjs            # two CommonJS bundles, plus the built viewer copied into media/
  electron-builder.yml   # the installers, the file association, the platforms
  build/icon.png         # the product mark at 512x512, rendered from apps/vscode/icon.svg;
                         # copied into media/ at build time, because the window needs it
                         # at runtime on Linux and build/ is not packed
  src/
    main.ts              # the only module that imports Electron: windows, menu, protocol, IPC
    preload.ts           # the one narrow bridge, plus the drop target
    window.ts            # the pages: the document, the empty window, the build form
    open.ts              # what counts as a bundle, argv, following the file
    build.ts             # runs the adapter, i.e. what `revlens build` runs
    settings.ts          # reloadOnChange and the recent documents
  test/                  # run by the workspace suite: npm test - no Electron process needed
```

Everything worth testing is outside `main.ts`, which is why the suite needs no Electron
process. `main.ts` is the routes; the decisions are in the other five.
