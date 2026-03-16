# pi-brainmaxx

Pi should not start every session blank.

`@mmcook/pi-brainmaxx` is a project brain for Pi. It gives each repo a
small, inspectable `brain/` that Pi reads on normal turns, extends with
`/reflect`, and mines with `/ruminate`.

## In 2 minutes

Install from npm, a local path, or the public GitHub repo:

```bash
pi install npm:@mmcook/pi-brainmaxx
pi install /absolute/path/to/pi-brainmaxx
pi install git:https://github.com/MylesMCook/pi-brainmaxx
```

Then, inside a repo:

```bash
/brain-init
/brain-init --apply-bootstrap
/reflect
/ruminate
```

What to expect:
- `/brain-init` scaffolds a repo-local `brain/` without overwriting existing
  files
- `/brain-init --apply-bootstrap` writes one operations note when the repo does
  not already have one
- `/reflect` captures durable learnings from the current Pi session and prints a
  summary of what was written, which files changed, and why
- `/ruminate` mines older Pi sessions for repeated corrections, preferences, and
  missed durable knowledge; it presents findings first and only writes to
  `brain/` after you confirm in the current conversation
- the included extension reads `brain/index.md` and `brain/principles.md` on
  normal turns and provides the guarded SDK tools behind `/reflect` and
  `/ruminate`

`pi -p` works too:

```bash
pi -p "/brain-init"
pi -p "/brain-init --apply-bootstrap"
pi -p "/reflect"           # may write, prints summary
pi -p "/ruminate"          # preview-only, no apply step in print mode
```

If you want the package attached to project settings instead of your global Pi
agent state, use:

```bash
pi install -l npm:@mmcook/pi-brainmaxx
```

There is now an internal Codex adapter in `codex-skills/`, but Pi remains the
only published package surface.

## Why this exists

Most repo context is real, but scattered. Some of it lives in `AGENTS.md`. Some
of it lives in `README.md`. Some of it only exists in corrections you gave Pi
last week and now have to repeat. `pi-brainmaxx` is for turning that sprawl into
a small brain Pi can actually use.

## Why not just use AGENTS.md?

You still should use `AGENTS.md` for stable instructions. `pi-brainmaxx` is not
a replacement for it. The value here is narrower and more specific: Pi-native
entrypoints, a lightweight operations note, and a workflow for capturing and
mining learnings over time.

`AGENTS.md` still carries:
- stable operating rules
- environment facts
- house style and constraints

`pi-brainmaxx` adds:
- repo-local entrypoints Pi reads on normal turns
- an operations note bootstrapped from existing docs
- learnings captured with `/reflect`
- patterns recovered later with `/ruminate`

## How it works

1. `/brain-init` creates the starter brain.
2. Pi reads `brain/index.md` and `brain/principles.md` on normal turns.
3. `/reflect` writes durable learnings from the current session and prints a
   summary of what changed.
4. `/ruminate` mines repo-scoped Pi history when enough sessions exist. It shows
   findings first; writes only happen after you confirm in the same interactive
   Pi conversation. `pi -p` stays preview-only.

`/reflect` and `/ruminate` stay public skills. The package extension backs them
with narrow SDK tools for session extraction, staging, safe brain writes, and
fallback summaries. That keeps the workflow skill-native without giving generic
file writes to those runs.

This package stays intentionally small. It does not try to become another
orchestrator, another dashboard, or a generic memory platform.

## Codex adapter

The repo now also carries a Codex-native second consumer:
- `codex-skills/brainmaxx-init`
- `codex-skills/brainmaxx-reflect`
- `codex-skills/brainmaxx-ruminate`

Those skills use the same `brain/` corpus and a managed `AGENTS.md` block:

```md
<!-- brainmaxx:start -->
...
<!-- brainmaxx:end -->
```

Only `brainmaxx-init` updates that block. Reflection and rumination write only
under `brain/`.

On the Codex side, the skills now use real Codex session data too:
- `brainmaxx-reflect` reads the current thread from `CODEX_THREAD_ID`
- `brainmaxx-ruminate` reads repo-scoped Codex session history from
  `~/.codex/sessions`
- rumination uses a staged preview under `brain/` and applies only through the
  staged helper path

With regard to the core idea, `pi-brainmaxx` is inspired by
[`brainmaxxing`](https://github.com/poteto/brainmaxxing) by poteto. The
implementation here is Pi-native and specific to this package.

## Example outcome

Before:
- the remote workflow lives partly in `AGENTS.md`, partly in `README.md`, and
  partly in old session corrections
- Pi needs the same operational reminders again

After:
- `/brain-init --apply-bootstrap` creates `brain/notes/<repo-name>-operations.md`
- the extension feeds `brain/index.md` and `brain/principles.md` into normal Pi
  turns
- `/reflect` and `/ruminate` give you a path to keep that memory current

Generated entrypoints:
- `brain/index.md`
- `brain/principles.md`

User-owned after creation:
- `brain/principles/*.md`
- `brain/notes/<repo-name>-operations.md`

When `pi-brainmaxx` updates `brain/index.md` and `brain/principles.md`, treat
them as generated entrypoints. Edit the linked principle files and notes, not
the generated indexes themselves.

## Current limits

- Pi is the only published package surface today
- Codex support is local and adapter-specific, not a published package yet
- Repo-local, not a hosted memory service
- `ruminate` depends on Pi's current session format
- if Pi changes that format, `ruminate` reports the mismatch and needs an update
- Codex rumination is still an evidence-gated adapter and depends on the
  current raw Codex session format under `~/.codex/sessions`
- `reflect` and `ruminate` stay skills, so the model still decides what durable
  knowledge matters; the extension only constrains data access, write paths, and
  confirmation flow

Operational bootstrap writes exactly one note:

```text
brain/notes/<repo-name>-operations.md
```

That note is user-owned after creation. `pi-brainmaxx` creates it once and does
not rewrite it automatically.
