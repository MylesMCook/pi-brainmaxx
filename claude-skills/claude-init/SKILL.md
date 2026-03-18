---
name: claude-init
license: MIT
description: Initialize a repo-local Brainerd brain for Claude, install the managed AGENTS.md block, write the thin CLAUDE.md shim, and sync Claude auto memory imports.
---

# Claude Init

Use this skill to initialize Brainerd for Claude in the current repo.

On Windows, replace `../../scripts/brainerd-claude.sh` with
`..\..\scripts\brainerd-claude.cmd` in the commands below.

## Workflow

1. Run:

```bash
../../scripts/brainerd-claude.sh init
```

2. Review the bootstrap preview before writing it.
3. Only apply the operations note when the user explicitly asked for it or
   confirms after seeing the preview:

```bash
../../scripts/brainerd-claude.sh init --apply-bootstrap
```

## Rules

- Only this skill may edit repo `AGENTS.md`, and only through the managed
  Brainerd block.
- Ensure repo `CLAUDE.md` stays a thin shim that says to follow `AGENTS.md`.
- Claude auto memory imports belong under `brain/imports/claude/`, not
  `brain/notes/`.
- End with a short summary of what was created, what was preserved, and whether
  bootstrap was only previewed or actually applied.
