---
name: finish-branch
description: 'Guided workflow for finishing work on a feature branch - merges into the target branch (direct merge or PR), deletes the feature branch, and optionally updates the internal issue status to Implemented. Use when the user wants to finish, merge, or close out a feature/fix branch (e.g. "dokonči branch", "mergni feature branch", "uzavři issue").'
user-invocable: true
---

# Finish Branch

Finish work on a feature branch - merge into the main branch, clean up the
branch, and optionally update the issue status.

## Context

- Communicate with the user in their preferred language; code, comments, and
  commit messages are always in **English**.

## CRITICAL RULE

**NEVER add "Co-Authored-By: Claude" to git commits or to code.** No AI
attribution is required.

## STEP 1: Determine context

Ask the user for:

1. The feature branch name (or use the current branch)
2. The target branch to merge into (e.g. main, develop)

Verify the branch exists and contains commits.

## STEP 2: Merge and clean up

> **What is a PR (Pull Request)?** A request to integrate changes from a feature
> branch into the main branch. Used for code review in teams. For solo
> development you can merge directly.

Ask the user for their preferred approach:

### Option A: Direct merge (default for solo development)

Determine the source branch (the one the feature branch was created from) and
merge:

```bash
git checkout <source-branch>    # e.g. main, develop, release/v1.0
git merge feature/<issue-id>-<description>
git branch -d feature/<issue-id>-<description>
```

**STOP** - Wait for confirmation before performing the merge.

### Option B: Pull Request (for team collaboration)

Prepare the PR description:

- **Summary**: What this PR does
- **Motivation**: Why (link to the issue)
- **Changes**: List of changes
- **Testing**: Verification steps

Create the PR with `gh pr create`.

## STEP 3: Update the issue (optional)

Ask the user: "Is this issue fully complete?"

### If YES:

**First read `docs/contributing/ISSUE-MANAGEMENT.md`** and follow the section
*Closing and Archiving* — that document is the source of truth. The issue index
lives on GitHub Issues; there are **no tables or statistics in the repo to
maintain**. The steps below are a summary; if they conflict with the document,
the document wins.

1. **Edit the issue file** in `docs/issues/`:
   - **Change the status** in the `## Metadata` block: `- **Status**: 📋 Open` →
     `- **Status**: ✅ Implemented`
   - **Add the closing date** (if the file has a date field)
   - **Update the acceptance criteria** - check off completed criteria:
     - Change `- [ ]` to `- [x]` for implemented criteria
     - Leave `- [ ]` for criteria that were not implemented (with a note why)

   Example:

   ```markdown
   ## Acceptance Criteria

   - [x] The rail holds the three view modes and the about page
   - [x] The state of the rail is remembered per browser
   - [ ] The viewer renders correctly in the Pilot webview at half a screen's width -
         not verified, headless rendering unavailable on this machine
   ```

2. **Archive the file** — move it into `done/`:
   `git mv docs/issues/NNN-name.md docs/issues/done/NNN-name.md`

3. **Close the GitHub issue** `#N` (== `NNN`) and update the link in its body to
   the new `done/` path:
   `gh issue close N --repo cassandragargoyle/revlens --reason completed`
   (use `--reason "not planned"` for ❌ Closed / won't-fix)

Commit the issue status change:

```text
docs(<issue-id>): Close issue - implementation complete
```

### If NO:

Skip the status update. The issue stays open for further work.

## STEP 4: Summary

Show a summary:

- Merged into branch: `<name>`
- Feature branch deleted: yes/no
- Issue status updated: yes/no/skipped
- Next steps (if any)
