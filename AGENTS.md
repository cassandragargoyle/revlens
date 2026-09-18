# Development Instructions

## Project Information

- **GitHub Repository**: https://github.com/CassandraGargoyle/revlens
- **Project Name**: revlens
- **Primary Purpose**: A document revision viewer — the final text with every change
  highlighted in place, and the revision and reviewer comment behind each one
- **Primary Language**: TypeScript on Node.js 26.9+, npm workspaces
- **Platforms**: Linux, Windows (macOS development status TBD)

The tool was built inside `InfiniteCare-architecture` under `tools/revlens/` and moved
here with its git history; that copy still exists and will drift until it is removed or
pointed here. The specification is
[INT-002](docs/issues/002-document-revision-viewer.md) and the decisions behind the
shape of the tool are in [docs/adr/](docs/adr/).

## Security Guidelines

- Never run destructive commands without confirmation
- Always warn about potential data loss before executing risky operations
- Require explicit confirmation for operations that could lose implemented code

## Project Structure

- `/packages/core/` - The data contract, invariant validation, indexes, navigation, filters
- `/packages/adapters/` - git and Markdown plumbing, token blame, joining the records
- `/packages/viewer-page/` - The page a host embeds, and reading the file behind it; used
  by the editor extension and by the desktop application, never written twice
- `/packages/adapters/src/run-build.ts` - Running a build for a host, with the failures
  written as sentences a reader can act on; used by the desktop window and the editor
  extension, for the same reason `viewer-page` is
- `/apps/cli/` - `revlens build | validate | serve | sources`
- `/apps/server/` - Read-only HTTP API, static hosting, MCP server
- `/apps/web/` - The viewer (React + Vite)
- `/apps/vscode/` - The editor extension, for Visual Studio Code **and** for Pilot
- `/apps/pilot/` - The Pilot target: catalog, packaging, host verification
- `/apps/desktop/` - The Electron shell: a window with a file life-cycle, and the installers
- `/schema/` - `bundle.schema.json`, **generated** from the Zod schema in core, and
  `records/`, the hand-written contracts for the JSON an adapter reads
- `/fixtures/` - The anonymised sample bundle the unit tests run on
- `/scripts/` - Schema generation, benchmarks, extension packaging
- `/docs/adr/`, `/docs/issues/` - Decisions, and the specification
- `/docs/contributing/` - Methodology and conventions
- `/.claude/` - AI assistant configuration, and the `revlens` skill that drives the tool

Tests live beside the code they test, in `test/` inside each package or app, and the whole
suite runs from the root.

## Coding Guidelines & Development Instructions

### Strict Rules

- Code, code comments, and user messages must be in English (see [Multilingual Team Communication](docs/contributing/README.md#multilingual-team-communication))
- Communication with team members can be in their preferred language, but documentation remains in English
- When implementing new features, always check existing project structure first
- Prefer editing existing files over creating new ones
- Do not add "Generated with [Claude Code]" signatures to code or files
- Don't add "Generated with [Claude Code](https://claude.ai/code) Co-Authored-By: Claude <noreply@anthropic.com>" to code or other files
- **NEVER add "Co-Authored-By: Claude <noreply@anthropic.com>" to code files or git commits** - attribution not required
- All Markdown files must follow [Markdown Style Guide](docs/contributing/MARKDOWN-STYLE.md) — document categories,
  heading rules, metadata blocks, section numbering

See docs/contributing/CODE-STYLE-*.md for language-specific guidelines

### General Principles

- Follow existing conventions and styles in the project
- Always explore existing code before creating new implementations
- Maintain consistency with established patterns
- All program text (messages, labels, constants) in English
- Comments in English, written as phrases (no ending periods)
- English is the official project language per multilingual team guidelines

### Design Principles

**IMPORTANT:** All design and implementation decisions must follow [Design Principles](docs/DESIGN-PRINCIPLES.md).

Key priorities (in order):

1. **Automatic over manual** - prefer solutions that work without user intervention
2. **Zero configuration** - prefer solutions that work out of the box
3. **Convention over configuration** - follow established patterns
4. **Fail gracefully** - help users understand and recover from errors

### TODO Management

- Follow the established TODO format: `TODO:NNN [INITIALS]: description` (see [TODO Guidelines](docs/contributing/TODO-GUIDELINES.md))
- Use per-file sequential numbering (001, 002, 003, etc.)
- Refer to [docs/contributing/TODO-GUIDELINES.md](docs/contributing/TODO-GUIDELINES.md) for complete standards
- Use `TODO:XXX` as temporary placeholder, then request proper numbering

### Issue Tracking & Documentation

- An issue lives in two places at once: the file `docs/issues/NNN-slug.md` is the content,
  the GitHub issue `#N` is the number and the index, and they are one to one (`#3` ⇄
  `003-*.md` ⇄ **INT-003**)
- **GitHub owns the number** — create the issue there first and adopt what it gives you;
  never pick `NNN` by counting the files
- The GitHub body is a summary and a link, not a copy of the file
- A finished issue moves to `docs/issues/done/` and its GitHub issue is closed; there is no
  index table in the repository to maintain
- [docs/contributing/ISSUE-MANAGEMENT.md](docs/contributing/ISSUE-MANAGEMENT.md) is the
  workflow; the `create-issue`, `implement-issue` and `finish-branch` skills drive it

### Team Communication

- English is the primary language for all project communication (see [Multilingual Team Communication](docs/contributing/README.md#multilingual-team-communication))
- Use simple, clear English to accommodate non-native speakers
- Avoid idioms, colloquialisms, and culture-specific references
- Team initials assignment follows collision resolution (JS → JSm if JS exists) (see [Team Initials Assignment](docs/contributing/README.md#team-initials-assignment-and-collision-resolution))

### AI Assistant Guidelines

- Claude Code is the preferred AI assistant with pre-configured context
- Alternative AI tools require users to prepare their own context materials
- Follow established AI assistant best practices in [docs/contributing/AI-ASSISTANTS.md](docs/contributing/AI-ASSISTANTS.md)

### Translation Workflow

- Use `.translated/` directory structure for team member translations
- Follow ISO 639-1 language codes (cs, de, fr, etc.)
- Refer to [docs/contributing/TRANSLATION-WORKFLOW.md](docs/contributing/TRANSLATION-WORKFLOW.md) for complete process
- Translations are temporary and can be regenerated as needed

### Repository Management

- Main branch is `main` (not `master`)
- Issues tracked in project-specific locations
- License: MIT
- GitHub format: https://github.com/CassandraGargoyle/revlens

## Development Setup

### Prerequisites

- Node.js 26.9.0 or newer, with npm — the version is in `.nvmrc`, so `nvm use` picks it up
- git on the PATH — the adapters read history by calling it
- For `verify:pilot-host` only: a `portunix-vscode` checkout whose `src/electron` is built

### Initial Setup

```bash
git clone https://github.com/CassandraGargoyle/revlens.git
cd revlens
npm install
npm run build
```

### Build Instructions

```bash
npm run build           # everything: TypeScript, the schema, the viewer, the extension, the desktop
npm run build:web       # the viewer alone
npm run build:vscode    # the extension alone, after the viewer
npm run build:desktop   # the desktop application alone, after the viewer
npm run package:vsix    # dist/cassandragargoyle.revlens-<version>.vsix
npm run package:pilot   # dist/pilot-plugins/{*.vsix, catalog.json}
npm run package:desktop # dist/desktop/: an AppImage, a portable .exe and an installer, a .dmg
npm run dev             # the viewer with hot reload, against a running `serve`
npm run dev:desktop     # the desktop application from source: `-- <bundle>` opens one
```

## Testing

### Testing Framework

- Framework: Vitest, over the sources — `npm test` needs no prior build
- Test command: `npm test`
- Included by the root config: `packages/*/test/**` and `apps/*/test/**`

### Running Tests

```bash
npm test               # the whole suite
npm run test:watch     # while working
```

### Before Reporting Anything As Done

```bash
npm run lint
npm run typecheck
npm run schema:check
npm run build
npm test
```

When the editor extension changed, also:

```bash
npm run package:pilot
npm run verify:pilot-host   # skips with exit 0 without a portunix-vscode checkout
```

Report what actually ran. A verification that skipped is not one that passed.

## Project-Specific Information

### Dependencies

Zod for the contract, Fastify for the read-only API, React and Vite for the viewer,
Commander for the CLI, esbuild for the extension bundle. No runtime dependency is added
without a reason written down in the pull request: the static export and the editor page
must keep working offline, with no CDN.

### Architecture

Drawn in [ARCHITECTURE.md](ARCHITECTURE.md), with a Czech translation in
[ARCHITECTURE.cs.md](ARCHITECTURE.cs.md). The short version: the backend decides what the
changes are, the frontend decides how they are read, and `core` owns every rule both of
them have to agree on.

### Key Components

- **The contract is generated, not written twice.** `schema/bundle.schema.json` comes from
  `packages/core/src/schema.ts` via `npm run schema`; editing it by hand is undone on the
  next build and `npm run schema:check` fails when the committed file has drifted
- **A change to the contract is a change to INT-002** — write it there as well
- **Navigation, filtering and validation live in `packages/core`**, so the browser, the
  HTTP API and the MCP tools cannot disagree about which edits a revision produced. Never
  write those rules a second time in a UI
- **`out/` is not committed.** A bundle carries verbatim reviewer comments and the names
  of the people who made them; the material is internal

### The Editor Extension

One extension, two applications. Visual Studio Code has the whole API; the Pilot
application in `portunix-vscode` runs the same `.vsix` on a deliberately small subset — a
custom readonly editor, a webview, configuration defaults and a file watcher.

- The path that opens a document uses **only** what both hosts have
- Anything beyond it is probed for in `apps/vscode/src/host.ts`, never assumed
- What is Pilot-specific is a declaration in `apps/pilot/pilot-plugin.json`, not code
- Bundles are named `*.revlens.json`, and `*.revlens` is still claimed for the ones built
  before that. Pilot matches a file type as a **suffix**, longest match first
  (`portunix-vscode` #120), so the compound name works there and reads like the host's own
  `.graph.json` / `.glens.json` sidecars. Claiming plain `json` would still grab every JSON
  file in the application, and the Pilot seed refuses it
- **Building a bundle is `runBuild` from `packages/adapters`** — the same call the desktop
  window makes and the same code path the command line takes. It is never shelled out to
  and never starts `apps/server`; a host cannot assume a checkout, an npm and a `tsx` on
  the machine, and a second implementation of the build is worse than a larger bundle

Do not add a second extension, and do not fork the viewer for a host. If one host can do
something the other cannot, that belongs in the capability probe. The reasoning is
[ADR-006](docs/adr/ADR-006-standalone-product-and-editor-extensions.md).

### The Desktop Application

The fourth host, for readers who have neither a checkout nor an editor. The editor stays
the primary target; [ADR-007](docs/adr/ADR-007-desktop-application-for-readers.md) amends
ADR-006's packaging decision and names which platforms are supported.

- The page is the same one the webview shows, from `packages/viewer-page`. Do not write a
  second page builder, and do not teach `apps/web` that a desktop host exists
- `main.ts` is the only module that imports Electron, so the tests need no Electron process
- `electron` and `electron-builder` are devDependencies of `apps/desktop` alone; a test in
  `apps/desktop/test/packaging.test.ts` holds that line
- Building a bundle is `runBuild` from `@revlens/adapters`, shared with the editor
  extension; it never shells out to the CLI and never starts `apps/server`

### Configuration

`revlens.reloadOnChange` is the extension's only setting. The CLI is configured by its
arguments; `revlens sources` lists the adapters a build knows.

### Deployment

There is no server to deploy. What is released is the `.vsix` — installed in Visual Studio
Code with `code --install-extension`, or offered by Pilot from a catalog — and the
self-contained directory `revlens build --static` writes, which needs nothing at all.
