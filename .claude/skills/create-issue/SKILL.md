---
name: create-issue
description: Guided workflow for writing a new issue for this repository - takes the number from GitHub, writes the canonical markdown file under docs/issues/, and reduces the GitHub issue to a summary and a link. Use when the user wants to raise, file, or write up an issue, a bug or a feature (e.g. "založ issue", "napiš issue na...", "tohle je bug, zapiš ho").
---

# Create Issue

Writing a new issue so that the file and the GitHub issue are one thing with two faces.

> This file is the source of truth. `SKILL.cs.md`, if it exists, is a Czech translation for
> human readers only - when you change this file, update the translation too.

## Context

- Talk to the user in **Czech**; the issue, like all documentation, is written in
  **English**.
- [`docs/contributing/ISSUE-MANAGEMENT.md`](../../../docs/contributing/ISSUE-MANAGEMENT.md)
  is the rule. If this skill and that document disagree, the document wins.

## CRITICAL RULE

**NEVER add "Co-Authored-By: Claude" to git commits or to code.** No AI attribution is
required.

**The number comes from GitHub, never from counting the files.** Two branches that both
count reach the same number.

## STEP 1: Understand what is being raised

Ask for whatever is missing, in Czech, and do not start writing until you have it:

- Is it a **bug**, an **enhancement** or a **task**?
- What is the observed behaviour, and what was expected instead? (a bug)
- What is the use case, and who has it? (an enhancement)
- Which package or app does it land in?
- How would somebody else tell that it is done?

Then **restate it in Czech in your own words** and ask whether you have it right.

**STOP** - Wait for confirmation.

## STEP 2: Check it is not already there

Search before adding:

```bash
grep -ril "<keyword>" docs/issues/
gh issue list --repo cassandragargoyle/revlens --search "<keyword>" --state all
```

If something close already exists, say so and ask whether to extend it instead.

## STEP 3: Take the number from GitHub

```bash
gh issue create --repo cassandragargoyle/revlens \
  --title "NNN: <title>" --body "<one-sentence summary; the body is set properly in step 5>"
```

GitHub answers with the URL; its number is `N`, and the file is `NNN` zero-padded to three.
The title cannot carry `NNN` before the number exists, so create it with the title you
intend and edit the number in with `gh issue edit` in step 5.

If `gh` cannot reach GitHub, follow *When GitHub Is Not Reachable* in the document: take the
next free number by hand, write `- **GitHub**: pending`, and say clearly that the issue is
not on GitHub yet.

## STEP 4: Write the file

`docs/issues/NNN-slug.md`, in the layout under *The file* in the document: frontmatter,
`# INT-NNN - Title`, the `## Metadata` block with the GitHub link, then the body and the
acceptance criteria.

Write it the way the issues already there are written: the reasoning belongs in the issue,
not only the request. Say what is a judgement call so it can be disagreed with before it is
built.

Show the user the file and ask - accept, adjust, or rewrite.

**STOP** - Wait for approval.

## STEP 5: Point GitHub at it

Set the title to `NNN: <title>` and the body to the summary and the link:

```bash
gh issue edit N --repo cassandragargoyle/revlens --title "NNN: <title>"
```

Body, written from a file rather than inline so the markdown survives:

```markdown
**Type:** <type> · **Priority:** <priority> · **Status:** 📋 Open

<one or two sentences>

📄 Full issue: [`docs/issues/NNN-slug.md`](https://github.com/cassandragargoyle/revlens/blob/main/docs/issues/NNN-slug.md)
```

Add the labels that fit: `gh issue edit N --repo cassandragargoyle/revlens --add-label bug`.

## STEP 6: Commit

```text
docs(issues): INT-NNN, <short summary>
```

**STOP** - Ask for confirmation of the message before committing.

## Next steps

`/implement-issue NNN` starts the work. `/finish-branch` closes the issue and archives the
file when it is done.
