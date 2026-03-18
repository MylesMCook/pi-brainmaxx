# Brainerd Harness Surface Notes

## Status

Implemented in `v0.3.0`.

## Decision

The canonical user-facing surfaces are now harness-prefixed:

- Pi: `/pi-init`, `/pi-reflect`, `/pi-ruminate`
- Codex: `codex-init`, `codex-reflect`, `codex-ruminate`
- Claude: `claude-init`, `claude-reflect`, `claude-ruminate`

Pi still uses a narrow extension control layer around its `pi-reflect` and
`pi-ruminate` skills:

- raw input interception for `/pi-reflect`, `/pi-ruminate`,
  `/skill:pi-reflect`, and `/skill:pi-ruminate`
- per-run tool narrowing with `setActiveTools()`
- guarded internal tools for current-session extraction, repo history loading,
  rumination staging, staged preview retrieval, and safe brain writes
- fallback summary messages when the model fails to print one

`/pi-init` is the Pi setup command.

## Current Contract

### `/pi-reflect`

- still invoked as a skill
- the extension rewrites `/pi-reflect` to `/skill:pi-reflect`
- the run gets only:
  - `read`
  - `find`
  - `grep`
  - `brainerd_current_session`
  - `brainerd_apply_changes`
- brain writes are only allowed through `brainerd_apply_changes`
- the skill must end with a visible section that starts with `Brainerd summary:`

### `/pi-ruminate`

- still invoked as a skill
- the extension rewrites `/pi-ruminate` to `/skill:pi-ruminate`
- preview runs get only:
  - `read`
  - `find`
  - `grep`
  - `brainerd_repo_sessions`
  - `brainerd_stage_ruminate`
- apply runs get only:
  - `read`
  - `find`
  - `grep`
  - `brainerd_get_staged_ruminate`
  - `brainerd_apply_changes`
- preview is always first
- interactive Pi accepts a short plain-English confirmation like `yes` or
  `apply it`
- rejection like `no` or `cancel` discards the staged preview and writes nothing
- `pi -p "/pi-ruminate"` stays preview-only and has no apply step

## Guardrails

- `write`, `edit`, and `bash` are blocked during active brainerd runs
- `brainerd_apply_changes` only accepts markdown targets under:
  - `brain/notes/`
  - `brain/principles/`
- direct writes to generated entrypoints are rejected:
  - `brain/index.md`
  - `brain/principles.md`
  - `brain/.brainerd-version`
- entrypoint sync happens inside `brainerd_apply_changes`

## Why This Shape

This keeps the public workflow skill-native while making the dangerous parts
deterministic:

- the model still decides what durable knowledge matters
- the extension controls what data the skill sees
- the extension controls how writes happen
- the extension controls confirmation and fallback reporting

That is the smallest change that makes Pi reliable without turning `reflect` and
`ruminate` into first-class Pi commands.
