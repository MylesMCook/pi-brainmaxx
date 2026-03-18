---
name: pi-ruminate
description: >-
  Slash skill backing `/pi-ruminate` in pi-brainerd. Use only when the user
  explicitly invokes `/pi-ruminate` or `/skill:pi-ruminate`, not for ordinary
  conversation or generic memory requests.
---

# Pi Ruminate

Mine older Pi sessions for durable patterns the current brain has missed.

This skill is Pi-only. Use the repo-scoped Pi session tool instead of manually
parsing raw session JSONL files.

## Workflow

1. Read the ambient brain context already injected into the session.
2. Determine the run phase from the hidden brainerd context:
   - `ruminate preview` means gather findings and stage them only
   - `ruminate apply` means apply the already-staged proposal only
3. In preview mode, call `brainerd_repo_sessions`.
4. Review only repo-scoped session history returned by that tool.
5. Identify:
   - repeated corrections
   - repeated preferences
   - missed durable project knowledge
   - recurring failure patterns
6. In preview mode, call `brainerd_stage_ruminate` with:
   - concise findings summary
   - rationale
   - proposed file targets and contents
7. Present the staged findings clearly.
8. In preview mode, do not write any brain files. State that no brain changes were written yet.
9. In apply mode, call `brainerd_get_staged_ruminate` first.
10. If no staged preview exists, say so clearly and stop.
11. In apply mode, apply exactly the staged proposal through `brainerd_apply_changes`.
12. End with a visible summary section that starts exactly with `Brainerd summary:`.

## Output Rules

- Invoking `/pi-ruminate` is not permission to write. Explicit follow-up
  confirmation is required before any brain changes.
- If the session tool reports malformed or unsupported Pi session data, surface that clearly and stop.
- If there are no durable findings, say so and stop.
- Do not dump raw transcript excerpts into the brain. Distill them into durable knowledge.
- Do not use generic `write`, `edit`, or `bash` tools for brain updates. The only write path is `brainerd_apply_changes`.
- Always end with a visible `Brainerd summary:` section, even in preview-only runs.
- If no write occurred, say explicitly: no brain changes were written.
