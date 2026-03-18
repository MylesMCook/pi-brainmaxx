# Brainerd

Brainerd is the project brain.

`@mmcook/pi-brainerd` is still the published package name, but the repo now
ships three harness surfaces against the same repo-local `brain/`:

- Pi: `pi-init`, `pi-reflect`, `pi-ruminate`
- Codex: `codex-init`, `codex-reflect`, `codex-ruminate`
- Claude: `claude-init`, `claude-reflect`, `claude-ruminate`

## Install the Pi package

```bash
pi install npm:@mmcook/pi-brainerd
pi install /absolute/path/to/brainerd
pi install git:https://github.com/MylesMCook/brainerd
```

If you want the package attached to project settings instead of your global Pi
agent state:

```bash
pi install -l npm:@mmcook/pi-brainerd
```

## Use it in a repo

```bash
/pi-init
/pi-init --apply-bootstrap
/pi-reflect
/pi-ruminate
```

`pi -p` works too:

```bash
pi -p "/pi-init"
pi -p "/pi-init --apply-bootstrap"
pi -p "/pi-reflect"
pi -p "/pi-ruminate"
```

Source checkouts keep a prebuilt Codex helper runtime under `dist/`. If you edit
the TypeScript sources, rebuild it with:

```bash
npm run build
```

Brainerd also carries a temporary npm override for `fast-xml-parser` to avoid a
transitive AWS/Pi XML parser advisory in the development toolchain. Remove that
override once upstream Pi and AWS dependencies no longer pin the vulnerable
range.

On Windows, invoke the harness helpers through the `.cmd` wrappers:

```powershell
scripts\brainerd-codex.cmd ...
scripts\brainerd-claude.cmd ...
```

On POSIX, keep using the `.sh` wrappers.

## What it does

- `pi-init`, `codex-init`, and `claude-init` scaffold a repo-local `brain/`
  without overwriting existing
  files.
- The `*-reflect` surfaces capture durable learnings from the current harness
  session and write only under `brain/`.
- The `*-ruminate` surfaces review older repo-scoped sessions, stage findings
  first, and write only after the harness-specific confirmation flow.
- `claude-init` also writes the repo `CLAUDE.md` shim, installs the
  `SessionStart` hook, and imports Claude auto memory into
  `brain/imports/claude/`.

## What Brainerd is

Brainerd is the shared idea and the shared `brain/` layout. The point is simple:
keep durable repo memory in plain markdown that an agent can actually use.

Stable instructions can still live in `AGENTS.md`. Brainerd handles the smaller,
more specific layer:

- generated entrypoints under `brain/`
- focused notes under `brain/notes/`
- durable learnings captured from actual sessions

## Harness adapters

- Pi uses the package extension plus the `pi-*` skills and commands.
- Codex uses `AGENTS.md` for ambient reads and the `codex-*` skills for writes.
- Claude uses the thin `CLAUDE.md` shim, a `SessionStart` hook that captures
  `session_id` and `transcript_path`, and the `claude-*` skills for writes.

## Codex

In Codex, Brainerd has two layers:

- ambient read behavior when a repo already has a Brainerd brain
- explicit actions for `init`, `reflect`, and `ruminate`

Install the root router skill with `skills.sh`:

```bash
npx skills add https://github.com/MylesMCook/brainerd --skill brainerd
```

If you want the harness-specific skills exposed too, use full-depth discovery:

```bash
npx skills add https://github.com/MylesMCook/brainerd --full-depth --skill codex-init codex-reflect codex-ruminate
```

If a repo has `brain/.brainerd-version`, or both `brain/index.md` and
`brain/principles.md`, Codex should treat Brainerd as active and read those
entrypoints before non-trivial repo work.

This repo also carries Codex-side skills:

- `codex-skills/codex-init`
- `codex-skills/codex-reflect`
- `codex-skills/codex-ruminate`

And Claude-side skills:

- `claude-skills/claude-init`
- `claude-skills/claude-reflect`
- `claude-skills/claude-ruminate`

The root `brainerd` skill is only the umbrella router now.

Brainerd uses the same `brain/` corpus and a managed `AGENTS.md` block:

```md
<!-- brainerd:start -->
...
<!-- brainerd:end -->
```

Only the harness-specific `*-init` surfaces update that block. Reflection and
rumination stay explicit and write only under `brain/`.

## Ownership

Generated entrypoints:

- `brain/index.md`
- `brain/principles.md`

User-owned after creation:

- `brain/principles/*.md`
- `brain/notes/*.md`

Managed imports:

- `brain/imports/claude/*.md`

Edit the linked principle files and notes, not the generated entrypoints.

## Limits

- Pi is the only published package surface today, under `@mmcook/pi-brainerd`.
- Codex and Claude still ride on the same package repo even though the package
  name stays Pi-branded in this pass.
- Brainerd is repo-local. It is not a hosted memory service.

## Attribution

With regard to the core idea, Brainerd is inspired by
[`brainmaxxing`](https://github.com/poteto/brainmaxxing) by poteto.
