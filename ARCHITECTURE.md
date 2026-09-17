# RevLens Architecture

## Overview

How the work is split between the backend and the frontend, and why it is split there.

The short version: **the backend decides what the changes are, the frontend decides how
they are read, and `core` owns every rule both of them have to agree on.** Attribution is
resolved once at build time, so the browser never does offset arithmetic and a highlight
cannot drift out of alignment. Navigation and filtering live in `core` rather than in the
browser, because the HTTP API and the MCP tools answer the same questions and an assistant
that disagreed with the reader about which edits a revision produced would make the tool
useless as evidence.

The decisions behind this shape are recorded in
[ADR-004](docs/adr/ADR-004-revlens-attribution-token-blame.md) (the
attribution algorithm) and
[ADR-005](docs/adr/ADR-005-revlens-node-workspace-packaging.md) (the
runtime and packaging).

## Responsibility Split

```mermaid
flowchart TB
  subgraph sources["Sources of truth (read-only)"]
    direction LR
    git[("git history<br/>analysis chapters")]
    changes[("docs/changes/v*<br/>changes.json")]
    comments[("docs/comments/K*<br/>K*.json")]
  end

  subgraph backend["Backend — Node.js"]
    direction TB

    subgraph buildtime["Build time — @revlens/adapters"]
      parse["Parse chapters<br/>remark to blocks"]
      match["Match blocks<br/>Dice over bigrams"]
      blame["Token blame<br/>with tombstones"]
      join["Join commits to<br/>instructions and comments"]
      emit["Emit runs and edits<br/>+ build report"]
      parse --> match --> blame --> join --> emit
    end

    subgraph runtime["Runtime — @revlens/server"]
      api["HTTP API<br/>bundle, chapters, revisions"]
      mcp["MCP server<br/>stdio, with --mcp"]
      rebuild["POST /api/rebuild<br/>re-runs the adapter"]
      staticsrv["Static hosting<br/>of the built SPA"]
    end
  end

  subgraph core["@revlens/core — the shared contract"]
    direction LR
    zod["Zod schema<br/>+ generated JSON Schema"]
    inv["Invariant validation"]
    idx["BundleIndex<br/>every lookup, resolved once"]
    nav["Navigation rules<br/>next edit of this revision"]
    flt["Filters and free-text search"]
    sel["Selection and deep links"]
  end

  subgraph frontend["Frontend — React + Vite"]
    direction TB
    render["Render runs<br/>concatenate, never offsets"]
    mode["Mode switch<br/>clean / review / baseline"]
    timeline["Revision timeline<br/>+ chapter navigation"]
    inspector["Inspector<br/>what / when-who / why"]
    keys["Keyboard<br/>n p j k Escape"]
    hash["Deep links<br/>#/edit #/revision #/comment"]
    print["Print / export to PDF"]
  end

  bundle[("bundle.json<br/>one generated file")]

  sources --> buildtime
  emit --> bundle
  bundle --> runtime
  runtime -->|"JSON over HTTP"| frontend
  bundle -.->|"embedded, build --static"| frontend

  core -.->|"imported by"| buildtime
  core -.->|"imported by"| runtime
  core -.->|"imported by"| frontend

  classDef shared fill:#eef6ff,stroke:#2b6cb0,stroke-width:1px
  classDef store fill:#f7f7f7,stroke:#777,stroke-dasharray:3 3
  class core,zod,inv,idx,nav,flt,sel shared
  class bundle,git,changes,comments store
```

## Who Owns What

| Concern | Backend | `core` | Frontend | Why there |
| ------- | ------- | ------ | -------- | --------- |
| Reading git and the record files | yes | no | no | The browser has no filesystem, and the repository is the source of truth |
| Deciding which revision produced which text | yes | no | no | Attribution needs the whole history; it is resolved once, at build time |
| The data contract | no | yes | no | Authored in Zod, the JSON Schema generated from it, so types and schema cannot drift |
| Invariant validation | runs it | defines it | runs it | The CLI validates before writing, the viewer refuses a bundle it cannot trust |
| "Next edit of this revision" | no | yes | calls it | The HTTP API, the MCP tools and the browser must give the same answer |
| Filters and free-text search | no | yes | calls it | Same reason; the count a reader sees and the count an assistant reports are one number |
| Rendering runs into text | no | supplies the rule | yes | Concatenating non-deleted runs is the whole renderer |
| Mode switch, scrolling, keyboard, printing | no | no | yes | Reading decisions, with no bearing on what the changes are |
| Deep-link format | no | yes | parses it | A link pasted into an e-mail must open the same thing on a cold load |
| Serving the SPA and the bundle | yes | no | no | Local, bound to `127.0.0.1`; the material is internal |
| Driving the tool from an assistant | yes (`--mcp`) | supplies the answers | no | The MCP surface is a projection of `core`, not a second implementation |
| Opening a bundle in an editor | the extension reads the file | validates it | renders it unchanged | An editor is a third host for the same frontend, not a second viewer |

## Three Hosts, One Frontend

The viewer in `apps/web` runs in three places and is written once:

| Host | Where the bundle comes from | What starts it |
| ---- | --------------------------- | -------------- |
| A browser tab | `GET /api/bundle`, chapters on demand | `revlens serve` |
| A directory that can be zipped | `bundle-data.js`, on a global | `revlens build --static` |
| An editor tab | the same global, written into the page | the extension in `apps/vscode` |

`detectSource()` in `apps/web/src/data/source.ts` is the whole seam: a bundle on the global
wins over the API. It was written so that a `file://` page could work without fetching -
which turns out to be exactly the constraint a webview has, so the editor needed no change
to the viewer at all.

That extension is one extension for two applications, Visual Studio Code and Pilot, because
Pilot runs real `.vsix` extensions on a subset of the API. The document path uses only what
both hosts have; everything beyond it is probed for rather than assumed. See
[ADR-006](docs/adr/ADR-006-standalone-product-and-editor-extensions.md).

## Cold Load of a Deep Link

A link to one change, pasted into an e-mail, has to open that change in a 150-page
document without loading the document first.

```mermaid
sequenceDiagram
  autonumber
  actor R as Reader
  participant B as Browser (SPA)
  participant C as core (in the browser)
  participant S as Server (Fastify)

  R->>B: opens .../#/edit/E-004
  B->>C: parseHash("#/edit/E-004")
  C-->>B: selection = edit E-004
  B->>S: GET /api/bundle
  Note right of S: metadata, timeline, comments,<br/>edit index — no chapter text
  S-->>B: BundleSummary
  B->>C: resolveSelection(index, selection)
  C-->>B: edit, revision, comments, siblings, chapterId
  B->>S: GET /api/chapters/ch-02
  S-->>B: one chapter with its blocks and runs
  B->>R: chapter rendered, passage highlighted,<br/>inspector open, sibling list ready
  R->>B: presses n
  B->>C: nextEditOfRevision(index, "E-004")
  C-->>B: E-005 (same revision, another block)
  B->>R: scrolls to it, selection stays anchored
```

## Rebuild Driven by an Assistant

With `--mcp` the same process serves the browser and the assistant, so there is one
bundle and one rebuild — no second copy that can go stale.

```mermaid
sequenceDiagram
  autonumber
  actor A as Assistant (MCP client)
  participant M as MCP server (stdio)
  participant S as Server state
  participant AD as adapters
  participant B as Browser

  A->>M: tools/call revlens_rebuild
  M->>S: rebuild()
  S->>AD: re-run the source adapter
  AD-->>S: bundle + build report
  S->>S: validate, swap in place, bump version
  S-->>M: report — edits, unexplained, warnings
  M-->>A: "7 edits, 0 unexplained"
  A->>M: tools/call revlens_comment {id: "K2-004"}
  M->>S: index.editsOfComment("K2-004")
  S-->>M: E-003 (ch-01), E-007 (ch-02)
  M-->>A: the two changes the comment produced
  B->>S: GET /api/bundle (on next refresh)
  S-->>B: the rebuilt bundle
  Note over M,B: stdout carries protocol only —<br/>all logging goes to stderr
```

## Why the Bundle Sits in the Middle

```mermaid
flowchart LR
  subgraph expensive["Paid once, at build time"]
    h["Whole git history<br/>+ every record"]
  end
  subgraph cheap["Paid on every render"]
    v["Concatenate runs"]
  end
  h -->|"token blame"| bundle[("bundle.json")]
  bundle -->|"no offsets to recompute"| v

  style bundle fill:#eef6ff,stroke:#2b6cb0
```

Everything that is hard — walking the history, matching blocks across rewrites, carrying
attribution forward through later edits — happens once and lands in a file. Everything
the reader triggers is a lookup in a map or a concatenation of strings. That is the whole
performance story: the tool is fast on a 150-page document because the browser was never
asked to do the difficult part.

---

**Created**: 2026-09-16
**Last Updated**: 2026-09-16
