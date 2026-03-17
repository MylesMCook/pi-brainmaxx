---
name: brainerd-reflect
license: MIT
description: Persist durable learnings from the current Codex conversation into the repo-local brain. Use when the user explicitly asks to reflect with brainerd, capture durable knowledge from this Codex thread, or update repo memory from this conversation.
---

# Brainerd Reflect

Persist durable knowledge from the current Codex conversation into the repo
brain.

## Workflow

1. Read `brain/index.md` and `brain/principles.md`.
2. Run:

```bash
../../scripts/brainerd-codex.sh current-session
```

3. Use that current-thread transcript as the source of truth for what just
   happened in this Codex conversation.
4. Open additional `brain/` files only when needed to choose the right target.
5. Distill the smallest durable change that would help future Codex or Pi
   sessions.
6. Prefer updating an existing principle file when the learning is really a
   principle or preference.
7. Otherwise target one focused note under `brain/notes/<kebab-case-topic>.md`.
8. When you are ready to apply the change, write a small JSON payload to
   `/tmp/brainerd-reflect.json` with this shape:

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
../../scripts/brainerd-codex.sh apply-changes --input /tmp/brainerd-reflect.json
```

## Rules

- The user invoking this skill is enough permission to write durable brain
  changes unless the correct target is genuinely ambiguous.
- Do not store secrets, one-off task state, or generic skill instructions.
- If there is nothing durable to preserve, say so and stop.
- Do not hand-edit `brain/index.md` or `brain/principles.md`; let the helper
  sync them.
- End with a short summary of what changed, which files changed, and why.
