# pi-brainmaxx

`@mylesmcook/pi-brainmaxx` is a Pi-native package that gives a repo a small
project-local `brain/`.

v0.2 stays narrow:
- `/brain-init` scaffolds a repo brain without overwriting existing files
- `/brain-init --apply-bootstrap` writes one small operations note when a repo
  does not have one yet
- normal Pi turns automatically read `brain/index.md` and `brain/principles.md`
- `/reflect` is a native Pi skill command for durable learnings from the current
  session
- `/ruminate` is a native Pi skill command for mining older Pi sessions

When `pi-brainmaxx` creates `brain/index.md` and `brain/principles.md`, treat
them as generated entrypoints. Edit the linked principle files and notes, not
the generated indexes themselves.

Install from a local path while developing:

```bash
pi install /absolute/path/to/pi-brainmaxx
```

Then, inside a repo:

```bash
/brain-init
/brain-init --apply-bootstrap
/reflect
/ruminate
```

`/brain-init` always prints a concise operational bootstrap preview when it can
extract useful content from `AGENTS.md`, `README.md`, or `MEMORY.md`.
Interactive Pi asks for confirmation before writing the note. `pi -p` prints the
preview and only writes the note when `--apply-bootstrap` is present.

Operational bootstrap writes exactly one note:

```text
brain/notes/<repo-name>-operations.md
```

That note is user-owned after creation. `pi-brainmaxx` creates it once and does
not rewrite it automatically.

This package is intentionally brain-first, not review-first. Existing review
workflows benefit indirectly because `brain/principles.md` exists and stays
coherent.

`/ruminate` is Pi-only and depends on Pi session files under `~/.pi/agent/sessions/`.
If Pi changes that format, the tool reports the mismatch clearly and the package
needs an update.
