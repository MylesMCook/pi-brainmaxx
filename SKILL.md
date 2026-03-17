---
name: brainerd
description: Manage a repo-local Brainerd brain in Codex. Use when the user wants to initialize Brainerd in a repo, reflect durable knowledge from the current Codex conversation, or ruminate on older repo-scoped Codex sessions to improve repo memory.
license: MIT
---

# Brainerd

Use this skill to manage the repo-local `brain/` from Codex.

This skill covers three jobs:

- `init` for first-time setup
- `reflect` for durable knowledge from the current Codex conversation
- `ruminate` for older repo-scoped Codex history

## Choose the mode

- If the user wants to set up Brainerd in this repo, use `init`.
- If the user wants to preserve something from the current Codex thread, use
  `reflect`.
- If the user wants to mine older repo-scoped Codex sessions, use `ruminate`.

## Init

Run:

```bash
scripts/brainerd-codex.sh init
```

Review the bootstrap preview before applying it.

Only apply the operations note when the user explicitly asked for it or confirms
after seeing the preview:

```bash
scripts/brainerd-codex.sh init --apply-bootstrap
```

Rules:

- Only `init` may edit `AGENTS.md`.
- Only the managed Brainerd block in `AGENTS.md` may be edited.
- If multiple managed Brainerd blocks exist, stop and surface the error.

## Reflect

1. Read `brain/index.md` and `brain/principles.md`.
2. Get the current Codex-thread transcript:

```bash
scripts/brainerd-codex.sh current-session
```

3. Distill the smallest durable brain change that would help future work.
4. Prefer updating an existing principle file when the learning is really a
   principle or preference.
5. Otherwise target one focused note under `brain/notes/<kebab-case-topic>.md`.
6. Write a small JSON payload to `/tmp/brainerd-reflect.json`:

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

7. Apply the change only through:

```bash
scripts/brainerd-codex.sh apply-changes --input /tmp/brainerd-reflect.json
```

Rules:

- Do not store secrets, one-off task state, or generic skill instructions.
- Do not hand-edit `brain/index.md` or `brain/principles.md`.
- If there is nothing durable to preserve, say so and stop.

## Ruminate

1. Read `brain/index.md` and `brain/principles.md`.
2. Check for an already staged preview:

```bash
scripts/brainerd-codex.sh staged-ruminate
```

3. If a staged preview exists and the user is clearly asking to apply it:

```bash
scripts/brainerd-codex.sh apply-staged-ruminate
```

4. If a staged preview exists and the user is clearly rejecting it:

```bash
scripts/brainerd-codex.sh discard-staged-ruminate
```

5. Otherwise start a fresh preview:

```bash
scripts/brainerd-codex.sh repo-sessions
```

6. Use only the repo-scoped Codex history returned by that command.
7. If readiness is `insufficient` or `unsupported`, stop and report that no
   brain changes were written.
8. Present a concise findings summary first.
9. If there is a real durable finding, write a small JSON payload to
   `/tmp/brainerd-ruminate.json`:

```json
{
  "findingsSummary": "One durable repo-memory gap was repeated across sessions.",
  "rationale": "This rule appeared in multiple repo-scoped Codex sessions.",
  "changes": [
    {
      "path": "brain/principles/example.md",
      "content": "# Example\n\nDurable principle content.\n"
    }
  ]
}
```

10. Stage the preview only through:

```bash
scripts/brainerd-codex.sh stage-ruminate --input /tmp/brainerd-ruminate.json
```

Rules:

- A fresh rumination run is preview-only.
- Only apply through `apply-staged-ruminate`.
- Do not parse raw `~/.codex/sessions` files manually unless you are debugging
  the adapter itself.
- Do not dump transcript excerpts into the brain.

## Summary

End with a short summary of what changed, what was only previewed, or why no
brain changes were written.
