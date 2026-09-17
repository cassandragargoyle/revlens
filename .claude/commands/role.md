# Switch Role

User requested to switch to role: **$ARGUMENTS**

## Instructions

1. **Normalize role name** - convert aliases:
   - `product-owner` → `product_owner`
   - `tester-linux` → `tester-linux`
   - `tester-windows` → `tester-windows`
   - `decision-maker` → `decision-maker`

2. **Verify role exists** - check if file `.claude/roles/{role_name}.md` exists

3. **If role exists:**
   - Update `CLAUDE.local.md` in project root with include reference to role file
   - Write content: `@.claude/roles/{role_name}.md`
   - Confirm the role switch and briefly summarize key points of the new role

4. **If role does not exist:**
   - List available roles from `.claude/roles/` directory
   - Ask user to select a valid role

## Available roles

| Command | File | Description |
| ------- | ---- | ----------- |
| `/role architect` | architect.md | Software Architect |
| `/role developer` | developer.md | Developer |
| `/role product-owner` | product_owner.md | Product Owner / Analyst |
| `/role techlead` | techlead.md | Tech Lead |
| `/role decision-maker` | decision-maker.md | Decision Maker |
| `/role tester` | tester.md | Tester (generic) |
| `/role tester-linux` | tester-linux.md | Tester (Linux) |
| `/role tester-windows` | tester-windows.md | Tester (Windows) |
| `/role user` | user.md | End User |
