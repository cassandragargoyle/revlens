---
title: Issue Management
description: Apply when creating, numbering, updating or archiving an issue — the markdown file under docs/issues/ is the content, the GitHub issue is the number and the index, and the two stay one to one.
category: workflow
ai_load: on-demand
status: active
created: 2026-09-17
last_updated: 2026-09-17
applies_to:
  - docs/issues/**
related:
  - docs/contributing/ISSUE-DEVELOPMENT-METHODOLOGY.md
  - docs/contributing/MARKDOWN-FRONTMATTER.md
---

# Issue Management

## Overview

An issue lives in **two places that stay one to one**:

- **The markdown file** `docs/issues/NNN-slug.md` — the **canonical content**. The full
  description, the reasoning, the acceptance criteria. It is versioned with the code, it
  works offline, and it is what the assistant reads and writes.
- **The GitHub issue** `#N` — the **number authority** and the index. It carries a summary
  and a link to the file, nothing more. GitHub gives the numbering, the `Fixes #N` linking
  from a pull request, the notifications and the visibility to anyone outside the team.

`#N` matches exactly one file `NNN`: `#3` ⇄ `003-viewer-left-rail.md`, which the documents
call **INT-003**. The three names are the same issue.

**There is no table of issues in this repository.** The index is GitHub. A list maintained
by hand conflicts on every merge and duplicates what GitHub already shows.

## Directory Structure

```text
docs/issues/
├── README.md              # a stub that points at GitHub Issues
├── NNN-slug.md            # open, in progress, on hold
└── done/
    ├── README.md          # the same stub
    └── NNN-slug.md        # implemented, resolved, closed
```

A file moves into `done/` when the issue reaches a terminal status, and at that moment its
GitHub issue is closed. Nothing else changes: no index, no statistics.

## The Number Belongs to GitHub

Create the GitHub issue **first**, and take the number it gives you. GitHub numbers
monotonically and never reuses a number, so the files and the issues cannot drift apart as
long as nobody picks a number by hand.

Do not choose `NNN` by scanning the directory. That is how two branches end up writing the
same number.

## Creating an Issue

Both paths end in the same state: a canonical file, and a GitHub issue that summarises it
and links to it.

### Path A — somebody working in the repository

The developer, the tester or the architect writes the issue as a file, and the GitHub issue
is its shop window.

1. **Take the number**, with a body you will replace in step 3:

   ```bash
   gh issue create --repo cassandragargoyle/revlens \
     --title "NNN: <title>" --body "<summary, see step 3>"
   ```

2. **Write the file** `docs/issues/NNN-slug.md` — see [The file](#the-file). Everything of
   substance goes here.

3. **Set the GitHub issue body** to the summary and the link, never the whole content:

   ```markdown
   **Type:** enhancement · **Priority:** medium · **Status:** 📋 Open

   <one or two sentences>

   📄 Full issue: [`docs/issues/NNN-slug.md`](https://github.com/cassandragargoyle/revlens/blob/main/docs/issues/NNN-slug.md)
   ```

   ```bash
   gh issue edit N --repo cassandragargoyle/revlens --body-file <(...)
   ```

### Path B — somebody reporting from outside

A user files the **whole report on GitHub** and never touches the repository. A maintainer
then:

1. Triages it. If it is accepted, its number `#N` is the file number.
2. Writes `docs/issues/NNN-slug.md` from the report, which becomes the source of truth from
   then on.
3. Reduces the GitHub body to the summary and the link, as in Path A step 3. The original
   report survives in the issue's edit history, and the discussion stays on GitHub where
   the reporter can follow it.

### The file

The layout the existing issues use, and the one the assistant writes:

```markdown
---
title: INT-NNN - Short title
description: Apply when <the situation this issue governs>.
category: specification
ai_load: on-demand
status: draft
created: YYYY-MM-DD
related:
  - docs/issues/002-document-revision-viewer.md
---

# INT-NNN - Short title

## Metadata

- **Status**: 📋 Open
- **Type**: enhancement | bug | task
- **Priority**: high | medium | low
- **Created**: YYYY-MM-DD
- **Author**: Name
- **Target**: the package or app this lands in
- **GitHub**: [#N](https://github.com/cassandragargoyle/revlens/issues/N)
- **Related**:
  - [INT-002 — Document revision viewer](002-document-revision-viewer.md) — why it matters here

## Feature Description

## Use Case

## Proposed Solution

## Acceptance Criteria

- [ ] One line per thing that has to be true, each one checkable by somebody else
```

A bug report replaces the middle three sections with **Current behaviour**, **Expected
behaviour** and **Steps to reproduce**, and keeps the acceptance criteria — a bug is fixed
when something that was not true is true.

Frontmatter follows [MARKDOWN-FRONTMATTER.md](MARKDOWN-FRONTMATTER.md); `status` there is
the document's lifecycle (`draft` while it is a proposal, `active` once it describes what
was built), which is not the issue's status in the Metadata block.

## Statuses

| Status | Meaning | Archived |
| ------ | ------- | -------- |
| 📋 Open | Waiting for work | No |
| 🔄 In Progress | Being worked on now | No |
| ⏸️ On Hold | Paused on purpose | No |
| ✅ Implemented | Built, and the acceptance criteria are met | Yes |
| ✅ Resolved | Dealt with, for issues that are not a change to the code | Yes |
| ❌ Closed | Will not be done: superseded, duplicate, cannot reproduce | Yes |

## Closing and Archiving

When an issue reaches a terminal status:

1. **Update the file**: the Metadata status, the closing date, and the acceptance criteria —
   `- [x]` for what was done, `- [ ]` left open **with the reason on the same line** for
   what was not. An unchecked box with no explanation is a lie of omission.
2. **Move it**: `git mv docs/issues/NNN-slug.md docs/issues/done/NNN-slug.md`
3. **Close the GitHub issue** and repoint its link at the new path:

   ```bash
   gh issue close N --repo cassandragargoyle/revlens --reason completed
   ```

   Use `--reason "not planned"` for ❌ Closed.

Commit it as `docs(NNN): close issue - implementation complete`. The skill
[`finish-branch`](../../.claude/skills/finish-branch/SKILL.md) does these three steps after
a merge.

## When GitHub Is Not Reachable

Take the next free number the old way — one more than the highest anywhere under
`docs/issues/`, **including `done/`** — write `- **GitHub**: pending` in the Metadata, and
create the GitHub issue as soon as you can. If GitHub then hands out a different number,
the file is renamed to match. This is the exception; the rule is that GitHub goes first.

## Backfilling What Already Exists

The issues written before GitHub Issues existed have to be created there in order, because
a number cannot be chosen:

- Walk from `1` to the highest file number with **no skips**, creating each issue with the
  summary and the link. An open issue stays open; one that is already done is created and
  then closed.
- A number with no file still has to consume its `#N`: create a placeholder titled
  `NNN: (reserved — no issue)` and close it, or everything after it is off by one.

For this repository that means `#1` is a placeholder — INT-001 is an issue of another
project, referenced by INT-002 but never written here — followed by `#2` and `#3`.

## Types and Labels

| Label | For |
| ----- | --- |
| `bug` | A defect, a regression, a security problem |
| `enhancement` | New behaviour, or better behaviour |
| `task` | Documentation, maintenance, infrastructure |
| `question` | Something to decide before it can be an issue |

Priority is `critical`, `high`, `medium` or `low`, and it lives in the file's Metadata as
well as on the GitHub label, because the file has to be readable without GitHub.
