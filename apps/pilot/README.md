# revlens in Pilot

## Overview

**Repository**: `revlens`, `apps/pilot/`
**Language**: TypeScript, run through `tsx`
**Status**: Early

The Pilot target of the viewer. Pilot — the Electron application in
`portunix-vscode` — installs real VS Code extensions and runs them on a minimal host, so
what is Pilot-specific here is not code but **a packaging step and a declaration**: the
`.vsix` from `apps/vscode`, a catalog that offers it for `*.revlens` files, and an honest
account of how much of the extension that host can run.

## Building

```bash
npm run build          # the product, including the extension
npm run package:pilot  # dist/pilot-plugins/{*.vsix, catalog.json}
```

The build writes only under the repository. Nothing is copied into anyone's profile,
because Pilot keeps build and deploy apart on purpose: a build has to be inspectable and
repeatable, and a plain build must never mutate a running application.

To run Pilot against the result, point it at the directory:

```bash
PORTUNIX_PILOT_EXTENSIONS_DIR="<repo>/dist/pilot-plugins"
```

or copy the `.vsix` and `catalog.json` into `<userData>/extensions`. Pilot re-unpacks an
updated version on the next launch, or on **Tools → Re-run preflight**.

## What the reader sees

Opening a `.revlens` file with the plugin not yet enabled shows Pilot's consent dialog,
which quotes the compatibility verdict from `pilot-plugin.json`. The extension is not
loaded at startup and not loaded by the dialog — only by opening the file.

| Field | Value | Why |
| ----- | ----- | --- |
| `verdict` | `supported` | The document needs only the custom editor, the webview and configuration |
| `availableFeatures` | customEditor, webview, configuration, fileSystemWatcher | What the viewer actually uses |
| `unavailableFeatures` | none | The palette commands are not declared as needed |
| `fileTypes` | `revlens` | Pilot matches a plain extension, so bundles carry their own |

## Verifying it, without a screen

```bash
npm run package:pilot
npm run verify:pilot-host
```

`verify-host.ts` drives **Pilot's own compiled modules** — catalog validation, `.vsix`
unpack, the State A extension host — against the file this repository just built, with a
fake rendering surface in place of the Electron webview. It checks that the catalog is
accepted, that the editor is resolved without activating the extension, that the page
carries the bundle and points at the resource protocol, that the sandbox is scoped to the
viewer directory alone, and that a bundle failing its invariants shows the reason instead
of a document.

It needs a `portunix-vscode` checkout whose `src/electron` has been built. Without one it
**skips and exits 0**: a verification that could not run must not look like one that
passed, and must not fail a build that had no way of running it. Point it somewhere else
with `PORTUNIX_VSCODE_DIR`.

## Adding it to Pilot's curated catalog

The steps above install revlens as a local plugin. To have it shipped by `portunix-vscode`
itself, that repository would take revlens as a submodule under `plugins/` and add an entry
to `scripts/pilot-plugins.json`:

```json
{
  "id": "cassandragargoyle.revlens",
  "displayName": "revlens revision viewer",
  "submodule": "plugins/revlens",
  "fileTypes": ["revlens"],
  "compat": { "verdict": "supported", "availableFeatures": ["customEditor", "webview", "configuration", "fileSystemWatcher"], "unavailableFeatures": [], "notes": "..." }
}
```

That route needs one change there first: `build-pilot-plugins.mjs` packages the submodule
**root** as the extension, and revlens has a workspace at its root with the extension in
`apps/vscode/`. Either the seed grows a field naming the directory to package, or the build
hook runs this repository's `npm run package:pilot` when it finds one. Until that is
decided, the local route above is the supported one.

## Layout

```text
apps/pilot/
  pilot-plugin.json   # the curated half: what we assert about the plugin
  build.ts            # packages the .vsix and writes catalog.json beside it
  verify-host.ts      # runs the packaged extension on Pilot's real host
  src/catalog.ts      # the catalog shape, and the checks that keep it honest
  test/               # run by the workspace suite: npm test
```

---

**Created**: 2026-09-17
**Last Updated**: 2026-09-17
