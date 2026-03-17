# Brainerd

Brainerd gives a repo a small local `brain/` directory for durable project
memory.

Current adapters:

- `@mmcook/pi-brainerd` for Pi
- `brainerd` for Codex via `skills.sh`

## What it does

- initializes `brain/`
- reflects durable learnings from the current conversation
- ruminates on older repo-scoped sessions
- keeps memory repo-local, plain markdown, and explicit

## Pi

Install:

```bash
pi install npm:@mmcook/pi-brainerd
```

Use:

```bash
/brain-init
/brain-init --apply-bootstrap
/reflect
/ruminate
```

If you edit the TypeScript sources, rebuild the packaged Codex runtime with:

```bash
npm run build
```

## Codex

If a repo already has a Brainerd brain, Codex can read `brain/index.md` and
`brain/principles.md` ambiently before non-trivial work.

For explicit actions, install the skill:

```bash
npx skills add https://github.com/MylesMCook/brainerd --skill brainerd
```

Then use `$brainerd` to initialize the repo brain, reflect durable knowledge,
or ruminate on older repo-scoped Codex sessions.

## Boundaries

- no automatic memory writes
- edit notes and principle files, not generated entrypoints
- Brainerd is repo-local, not a hosted memory service

## Attribution

Brainerd is inspired by
[`brainmaxxing`](https://github.com/poteto/brainmaxxing) by poteto.
