---
name: deploy-local
description: 'Builds revlens from the working tree, runs the checks, and installs the result on this machine - the extension into Visual Studio Code and the desktop application as an AppImage. Use when the user wants to try the current state outside the source tree (e.g. "nasaď lokálně", "nainstaluj si to", "dej to do VS Code", "aktualizuj desktop aplikaci") or runs `/deploy-local [vscode | desktop | all]`.'
argument-hint: "[vscode | desktop | all]"
user-invocable: true
---

# Deploy Local

Build what is in the working tree and install it on this machine, so the next thing the
user opens is the code they are looking at.

## Context

- Communicate with the user in their preferred language; anything written to files is
  in **English**
- There is no server to deploy (see `AGENTS.md`, *Deployment*). "Local deploy" means two
  installs into the user's own profile, nothing else
- Pilot is **not** a target of this skill. Pilot keeps build and deploy apart on purpose
  (`apps/pilot/README.md`); do not copy anything into `~/.config/portunix-pilot`

## Targets

The argument picks the targets; with no argument, deploy **both**.

| Argument | Artifact | Installed to |
| -------- | -------- | ------------ |
| `vscode` | `dist/extension/cassandragargoyle.revlens-<version>.vsix` | VS Code, through `code --install-extension` |
| `desktop` | `dist/desktop/RevLens-<version>.AppImage` | `~/Applications/RevLens.AppImage`, with a launcher entry |
| `all` | both of the above | |

## STEP 1: Look at what is being deployed

```bash
git status --short
git log --oneline -1
node -p "require('./package.json').version"
```

Tell the user the branch, the last commit, the version, and whether the working tree is
dirty. A dirty tree is allowed - trying uncommitted work is the point - but say so,
because the installed version number will not identify what was installed.

If the version equals the one already installed (STEP 4 and STEP 5 show how to read it),
say that the install will replace a build with the same number.

## STEP 2: Checks - stop on the first failure

```bash
npm run lint
npm run typecheck
npm run schema:check
npm test
```

These are `make check`. Run them one by one so the failing one is named. If any fails,
**stop**: show the failing output, install nothing, and do not offer to skip the checks
unless the user asks for it.

## STEP 3: Build

```bash
npm run build
```

The full build: TypeScript, the schema, the viewer, the extension and the desktop bundle.
Both packaging steps below rely on `apps/web/dist/` being current.

## STEP 4: Visual Studio Code (`vscode`, `all`)

```bash
npm run package:vsix
code --install-extension dist/extension/cassandragargoyle.revlens-<version>.vsix --force
code --list-extensions --show-versions | grep -i revlens
```

- `--force` replaces an installed copy with the same version number
- If `code` is not on the PATH, stop this target and tell the user; do not search for
  other editor binaries
- A running VS Code window keeps the old extension until **Developer: Reload Window**;
  tell the user that

## STEP 5: The desktop application (`desktop`, `all`)

Linux only. On Windows, stop this target and point the user at the NSIS installer in
`dist/desktop/` - it installs per user and needs a click through.

```bash
npm run package:desktop
mkdir -p ~/Applications ~/.local/share/applications ~/.local/share/icons/hicolor/512x512/apps
install -m 755 dist/desktop/RevLens-<version>.AppImage ~/Applications/RevLens.AppImage
install -m 644 apps/desktop/build/icon.png ~/.local/share/icons/hicolor/512x512/apps/revlens.png
```

The installed file has a **fixed name** with no version in it, so the launcher entry and
anything the user pinned keep working after the next deploy. Check that a running
instance is not holding the old file first - the process is `revlens`, the
`executableName` in `electron-builder.yml`; matching the file name with `pgrep -f` would
find the shell that runs the check:

```bash
pgrep -x revlens
```

If it is running, ask the user to close it before installing.

Write the launcher entry only when it is missing or points somewhere else:

```ini
# ~/.local/share/applications/revlens.desktop
[Desktop Entry]
Type=Application
Name=RevLens
Comment=Document revision viewer
Exec=<home>/Applications/RevLens.AppImage %f
Icon=<home>/.local/share/icons/hicolor/512x512/apps/revlens.png
Terminal=false
Categories=Office;
StartupWMClass=revlens
```

Use the absolute home path in `Exec` and `Icon`; a desktop entry does not expand `~`.
`Icon` is a path rather than the theme name `revlens` on purpose: a running Plasma keeps
its icon cache from before the install and draws a blank document for a name it has not
seen, in the menu and in the task bar alike. A path is read from the file directly.

Then refresh the menu caches - `update-desktop-database` for GNOME and the others,
`kbuildsycoca6` for KDE, which does not read the first one:

```bash
update-desktop-database ~/.local/share/applications 2>/dev/null || true
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true
```

The AppImage needs FUSE to start. If the first launch fails with a FUSE error, tell the
user about `libfuse2` rather than extracting the image.

## STEP 6: Summary

Report what actually happened, per target:

- Version and commit deployed, and whether the tree was dirty
- Checks: each one passed, or which one failed
- VS Code: installed version as `code --list-extensions --show-versions` prints it, or
  skipped and why
- Desktop: the installed path and whether the launcher entry was written or kept, or
  skipped and why
- What the user has to do: reload the VS Code window, start RevLens again

A target that was skipped is reported as skipped, never as deployed.

## Rollback

- VS Code: `code --uninstall-extension cassandragargoyle.revlens`, or install an older
  `.vsix` with `--force`
- Desktop: an older `dist/desktop/RevLens-<version>.AppImage`, if one is still there,
  installed over `~/Applications/RevLens.AppImage`; remove the app with
  `rm ~/Applications/RevLens.AppImage ~/.local/share/applications/revlens.desktop`
