# revlens editor extension

## Overview

**Repository**: `revlens`, `apps/vscode/`
**Language**: TypeScript, bundled with esbuild
**Status**: Early

Opens a revision bundle as the document it describes, inside the editor. The same
extension runs in **Visual Studio Code** and in the **Pilot** application — Pilot installs
real `.vsix` extensions and runs them on a small subset of the VS Code API, so there is one
extension with two targets rather than two extensions around one viewer.

The page in the webview is the viewer from `apps/web`, unchanged. It is handed the bundle
on the `__REVLENS_BUNDLE__` global — the same seam `revlens build --static` uses, because a
page loaded from a resource URI may not fetch a local JSON file.

## What it contributes

| Contribution | What it does | Pilot |
| ------------ | ------------ | ----- |
| Custom editor `revlens.bundle` | Opens `*.revlens` and `*.revlens.json` as the document | yes |
| `revlens.reloadOnChange` setting | Re-renders when the file changes, so a rebuild lands in the open tab | yes |
| `revlens: Open Revision Bundle` | Opens a bundle through this editor from the palette or the explorer | no |
| `revlens: Show Bundle Source` | Opens the raw JSON beside the document | no |
| `revlens: Reload Open Bundles` | Re-renders every open bundle by hand | no |

The commands are absent in Pilot because its host has no `commands.registerCommand`. The
extension asks the host what it can do rather than assuming (`src/host.ts`) and registers
only what is there; the document itself needs nothing beyond what both hosts offer.

## Building

From the repository root:

```bash
npm run build          # the whole product, the extension last
npm run build:vscode   # just the extension, after apps/web has been built
npm run watch:vscode   # rebuild on change while working on it
npm run package:vsix   # dist/cassandragargoyle.revlens-<version>.vsix
```

Install the packaged file with `code --install-extension <path to the .vsix>`.

## Debugging

Open the **repository root** in Visual Studio Code — not this folder — and press `F5`.
`.vscode/launch.json` holds three configurations:

| Configuration | What it does |
| ------------- | ------------ |
| Extension: the example bundle | Builds everything, turns `examples/01-revision-round` into `out/example/example.revlens`, and opens an Extension Development Host on it |
| Extension: as it stands, no rebuild | The same host without the build in front of it, for when `npm run watch:vscode` is already running |
| Extension: empty host | An empty host, for the commands and for opening a bundle by hand |

Breakpoints land in `apps/vscode/src`: esbuild writes a source map beside the bundle and
the configurations point at it.

This is `make demo` for the editor. The browser demo ends in `revlens serve`, which the
extension cannot use — it opens a file, not a URL — so the editor demo stops one step
earlier and writes a bundle under a name the custom editor claims:

```bash
npm run demo:vscode              # build everything and write out/example/example.revlens
npm run demo:vscode -- --no-build # only the bundle, when the build is current
make debug                       # the same, and open a host on it without a debugger
make debug LANGUAGE=cs           # the example written in Czech
```

One script does the work — [`scripts/demo-vscode.ts`](../../scripts/demo-vscode.ts) — and
`F5`, `npm run demo:vscode` and `make debug` all call it, so they cannot drift apart.

## Naming bundles

Write bundles as `*.revlens`:

```bash
node apps/cli/bin/revlens.js build --source engagement ... --out out/analysis.revlens
```

`*.revlens.json` opens in Visual Studio Code as well, but Pilot matches a plain
`path.extname`, which sees only `.json` in a compound name. A viewer claiming `json` would
be offered for every JSON file in the application, so it does not claim it — see
`apps/pilot/src/catalog.ts`.

## Layout

```text
apps/vscode/
  package.json          # the extension manifest; not an npm workspace member
  esbuild.mjs           # one CommonJS bundle, plus the built viewer copied into media/
  src/
    extension.ts        # activation; registers what the host supports
    bundle-editor.ts    # the custom readonly editor and the file watch
    bundle-file.ts      # read and validate a bundle before it is shown
    host.ts             # what this host can do
    webview-html.ts     # the viewer page: asset URIs, CSP, the embedded bundle
  test/                 # run by the workspace suite: npm test
```

`package.json` here is deliberately not an npm workspace member: the extension id has to be
`revlens`, which is the name of the root package, and two packages of one name in a
workspace is an error. It has no dependency section either — everything it needs is in the
bundle esbuild writes.

---

**Created**: 2026-09-17
**Last Updated**: 2026-09-17
