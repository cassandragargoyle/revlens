---
name: implement-issue
description: 'Guided workflow for implementing an internal issue from docs/issues/ - reads the issue, confirms understanding in Czech, creates a feature/fix branch, implements the code, proposes a patch version bump, and prepares the commit. Use when the user wants to implement, work on, or start coding an internal issue (e.g. "implementuj issue 042", "začni pracovat na issue").'
---

# Implement Issue

Workflow for implementing an internal issue - from reading the assignment through creating a branch, implementing the code and committing, up to preparing the PR description.

> This file is the source of truth. `SKILL.cs.md` is a Czech translation for
> human readers only — when you change this file, update the translation too.

## Context

- Talk to the user in **Czech**; code, comments and commit messages in **English**.
- This workflow requires the **Developer** role to be active.

## CRITICAL RULE

**NEVER add "Co-Authored-By: Claude" to git commits or to code.** No AI attribution is required.

## STEP 0: Check the role

Check the current role in `CLAUDE.local.md`. If the role is not **Developer**:

1. Tell the user that implementation requires the Developer role
2. Offer to switch the role with the `/role developer` command
3. **STOP** - Do not continue until the Developer role is active

## STEP 1: Get the issue

Ask me for the name or ID of the internal issue. Wait for my answer.

## STEP 2: Confirm understanding

After I give you the issue:

1. Read the issue file from `docs/issues/`
2. Restate the issue in your own words **in Czech**
3. Explain the necessary code changes **in Czech**
4. Ask me to confirm

**STOP** - Wait for my explicit confirmation before continuing.

## STEP 3: Create the branch

Create a git branch: `feature/<issue-id>-<short-description>` or `fix/<issue-id>-<short-description>`

- Use lowercase letters and dashes for the description
- Example: `feature/042-add-export-api`

Show the git command before running it.

## STEP 4: Implementation

- Make all the code changes in one continuous phase
- DO NOT ask questions unless something is genuinely ambiguous
- Modify only the relevant files
- Follow the project coding style

At the end provide a summary:

- Modified files
- Added methods/classes
- Removed code
- Key decisions

Ask me what I want:

- a) Accept as is
- b) Adjust specific parts
- c) Redo completely

**STOP** - Wait for my approval before continuing.

## STEP 4b: Version bump

After the implementation, before testing, propose a patch version bump in `package.json`:

- Current version: `X.Y.Z`
- Proposed version: `X.Y.(Z+1)`

**STOP** - Wait for approval before editing the version.

## STEP 5: Commit

Prepare the commit message:

```text
<type>(<issue-id>): <short summary>

- key change 1
- key change 2
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

**STOP** - Ask me to confirm the commit message before committing.

## Next steps

After finishing the implementation, use `/finish-branch` to:

- Merge the branch into the main branch
- Delete the feature branch
- Update the issue status to ✅ Implemented
