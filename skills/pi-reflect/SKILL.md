---
name: pi-reflect
description: >-
  Slash skill backing `/pi-reflect` in pi-brainerd. Use only when the user
  explicitly invokes `/pi-reflect` or `/skill:pi-reflect`, not for ordinary
  conversation or generic memory requests.
---

# Pi Reflect

Persist durable knowledge from the current session into the repo-local `brain/`.

Use this skill only for durable repo memory:
- repeated preferences
- stable conventions
- non-obvious project knowledge
- important corrections that should prevent future confusion

Do not store:
- secrets
- one-off task details
- transient status
- generic skill instructions that belong in a skill instead

## Workflow

1. Read the ambient brain context already injected into the session.
2. Open additional `brain/` files only when you need them.
3. Call `brainerd_current_session` to get the normalized current-session transcript.
4. Distill the smallest set of durable changes that would actually help future Pi sessions.
5. Prefer updating an existing principle file when the learning is really a principle or preference.
6. Otherwise create one focused note under `brain/notes/<kebab-case-topic>.md`.
7. Apply changes only through `brainerd_apply_changes`.
8. End with a visible summary section that starts exactly with `Brainerd summary:`.

## Output Rules

- If there is nothing durable to preserve, say so explicitly and stop.
- The user invoking `/pi-reflect` is enough permission to apply the changes unless the correct target is genuinely ambiguous.
- Make the smallest useful brain change, not a brain dump.
- Do not use generic `write`, `edit`, or `bash` tools for brain updates. The only write path is `brainerd_apply_changes`.
- Always end with a visible `Brainerd summary:` section, even when no changes were needed. State:
  - whether changes were made or not
  - which files were changed (if any)
  - one-sentence rationale
