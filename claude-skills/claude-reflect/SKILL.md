---
name: claude-reflect
license: MIT
description: Persist durable learnings from the current Claude conversation into the repo-local brain using Claude session transcripts as the source of truth.
---

# Claude Reflect

Persist durable knowledge from the current Claude conversation into the repo
brain.

On Windows, replace `../../scripts/brainerd-claude.sh` with
`..\..\scripts\brainerd-claude.cmd` in the commands below.

## Workflow

1. Read `brain/index.md` and `brain/principles.md`.
2. Run:

```bash
../../scripts/brainerd-claude.sh current-session
```

3. Use that current Claude-session transcript as the source of truth for what
   just happened.
4. Open additional `brain/` files only when needed to choose the right target.
5. Distill the smallest durable change that would help future Claude, Codex, or
   Pi work.
6. Prefer updating an existing principle file when the learning is really a
   principle or preference.
7. Otherwise target one focused note under `brain/notes/<kebab-case-topic>.md`.
8. When you are ready to apply the change, write a small JSON payload to
   `/tmp/claude-reflect.json` with this shape:

```json
{
  "changes": [
    {
      "path": "brain/notes/example.md",
      "content": "# Example\n\nDurable note content.\n"
    }
  ]
}
```

9. Apply the change only through:

```bash
../../scripts/brainerd-claude.sh apply-changes --input /tmp/claude-reflect.json
```

## Rules

- The user invoking this skill is enough permission to write durable brain
  changes unless the correct target is genuinely ambiguous.
- Never copy imported Claude memory files verbatim into user-owned notes.
- Do not store secrets, one-off task state, or generic skill instructions.
- Do not hand-edit `brain/index.md` or `brain/principles.md`; let the helper
  sync them.
- End with a short summary of what changed, which files changed, and why.
