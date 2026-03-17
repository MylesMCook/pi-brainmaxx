---
name: brainerd-ruminate
license: MIT
description: Mine older Codex session history for repeated corrections, preferences, missed durable knowledge, and recurring failure patterns in the current repo. Use when the user explicitly asks to ruminate with brainerd, review older Codex repo history, or apply or discard a previously staged rumination preview.
---

# Brainerd Ruminate

Mine older Codex sessions for durable patterns the current brain has missed.

## Workflow

1. Read `brain/index.md` and `brain/principles.md`.
2. Check for an already staged preview:

```bash
../../scripts/brainerd-codex.sh staged-ruminate
```

3. If a staged preview exists and the user is clearly asking to apply it, apply
   it with:

```bash
../../scripts/brainerd-codex.sh apply-staged-ruminate
```

4. If a staged preview exists and the user is clearly rejecting it, discard it
   with:

```bash
../../scripts/brainerd-codex.sh discard-staged-ruminate
```

5. Otherwise start a fresh preview:

```bash
../../scripts/brainerd-codex.sh repo-sessions
```

6. Use only the repo-scoped Codex history returned by that command.
7. If readiness is `insufficient` or `unsupported`, stop and report that no
   brain changes were written.
8. Identify repeated corrections, repeated preferences, missed durable project
   knowledge, and recurring failure patterns.
9. Present a concise findings summary first.
10. If there is a real durable finding, write a small JSON payload to
    `/tmp/brainerd-ruminate.json` with this shape:

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

11. Stage the preview only through:

```bash
../../scripts/brainerd-codex.sh stage-ruminate --input /tmp/brainerd-ruminate.json
```

12. Do not write brain files during the preview phase.
13. Tell the user the preview is staged and no brain changes were written yet.

## Rules

- A fresh rumination run is preview-only. Staging is not permission to write.
- Only apply through `apply-staged-ruminate`.
- Do not parse raw `~/.codex/sessions` files manually unless you are debugging
  the adapter itself.
- Do not dump transcript excerpts into the brain. Distill them into durable
  knowledge.
- Do not hand-edit `brain/index.md` or `brain/principles.md`; let the helper
  sync them.
- End with a short summary. If no write occurred, say explicitly: no brain
  changes were written.
