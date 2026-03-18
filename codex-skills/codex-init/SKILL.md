---
name: codex-init
license: MIT
description: Initialize a repo-local brainerd brain for Codex. Use when the user asks to set up brainerd in a repo, create the repo brain, or install the managed AGENTS.md block that tells Codex to read the brain entrypoints.
---

# Codex Init

Use this skill to initialize brainerd for Codex in the current repo.

On Windows, replace `../../scripts/brainerd-codex.sh` with
`..\..\scripts\brainerd-codex.cmd` in the commands below.

## Workflow

1. Run:

```bash
../../scripts/brainerd-codex.sh init
```

2. This creates any missing `brain/` managed files and installs or updates the
   managed `AGENTS.md` block.
3. Review the bootstrap preview.
4. Do not create the operations note unless the user explicitly asked for it or
   confirms after seeing the preview.
5. To apply the bootstrap note, run:

```bash
../../scripts/brainerd-codex.sh init --apply-bootstrap
```

## Rules

- Only this skill may edit `AGENTS.md`, and only through the managed
  `brainerd` block.
- Do not edit any repo files outside `brain/` and the managed `AGENTS.md`
  block.
- If `AGENTS.md` contains multiple `brainerd` managed blocks, stop and surface
  the error instead of editing the file.
- End with a short summary of what was created, what was preserved, and whether
  bootstrap was only previewed or actually applied.
