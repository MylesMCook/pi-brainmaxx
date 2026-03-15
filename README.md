# pi-brainmaxx

Pi should not start every session blank.

`@mmcook/pi-brainmaxx` is a project brain for Pi. It gives each repo a
small, inspectable `brain/` that Pi reads on normal turns, extends with
`/reflect`, and mines with `/ruminate`.

## In 2 minutes

Public registry install is not live yet. Today, use a local path or the public
GitHub repo:

```bash
pi install /absolute/path/to/pi-brainmaxx
pi install git:https://github.com/MylesMCook/pi-brainmaxx
```

Once npm propagation catches up, the registry install will be:

```bash
pi install npm:@mmcook/pi-brainmaxx
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
- `/reflect` captures durable learnings from the current Pi session
- `/ruminate` mines older Pi sessions for repeated corrections, preferences, and
  missed durable knowledge
- the included extension reads `brain/index.md` and `brain/principles.md` on
  normal turns

`pi -p` works too:

```bash
pi -p "/brain-init"
pi -p "/brain-init --apply-bootstrap"
```

If you want the package attached to project settings instead of your global Pi
agent state, use:

```bash
pi install -l git:https://github.com/MylesMCook/pi-brainmaxx
```

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
3. `/reflect` writes durable learnings from the current session.
4. `/ruminate` mines repo-scoped Pi history when enough sessions exist.

This package stays intentionally small. It does not try to become another
orchestrator, another dashboard, or a generic memory platform.

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

- Pi-only, not a generic agent-memory layer
- Repo-local, not a hosted memory service
- GitHub install is live; npm registry install is pending publish
- `ruminate` depends on Pi's current session format
- if Pi changes that format, `ruminate` reports the mismatch and needs an update

Operational bootstrap writes exactly one note:

```text
brain/notes/<repo-name>-operations.md
```

That note is user-owned after creation. `pi-brainmaxx` creates it once and does
not rewrite it automatically.
