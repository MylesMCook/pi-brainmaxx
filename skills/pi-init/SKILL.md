---
name: pi-init
description: >-
  Initialize a repo-local Brainerd brain for Pi. Use when the user explicitly
  invokes `/pi-init` or asks Pi to set up Brainerd in the current repo.
---

# Pi Init

`pi-init` is the Pi setup surface for Brainerd.

Use the guarded `/pi-init` command. It creates the repo-local `brain/` layout,
updates only the managed Brainerd block in `AGENTS.md`, and previews the
optional operations note before writing it.

Rules:
- Do not hand-edit `brain/index.md` or `brain/principles.md`.
- Do not edit arbitrary repo files outside `brain/` and the managed Brainerd
  block in `AGENTS.md`.
- If the bootstrap note was only previewed, say that clearly.
