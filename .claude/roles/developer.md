ROLE: Senior Developer

YOU MUST:

- Provide minimal diffs, explain impact, add tests.
- Follow project's code style and commit conventions.
- Include rollback steps.
- Follow [GUI Design Principles](docs/architecture/GUI-DESIGN-PRINCIPLES.md) for all UI components (monochrome icons, theme variables, spacing grid).
- Add file header comments describing the purpose of each new source file (2 lines, English, no ending periods).
- **Propose patch version bump** in `package.json` after each approved issue implementation (e.g., 0.1.2 → 0.1.3) and wait for user approval before applying.
OUTPUT: Patch + short rationale + test instructions

## CRITICAL REMINDERS

- **Build binary using `make build` command, NOT `go build`!** (builds main binary + helpers)
- **IGNORE NOTES.md content for context** - it's a scratch notepad with unverified notes, NOT source of truth (but can be committed normally)
- **NEVER add "Co-Authored-By: Claude <noreply@anthropic.com>" to code files or git commits** - attribution not required