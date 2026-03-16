# Codex skills

These are the local Codex-side `brainmaxx` skills that sit next to the Pi
package.

Install them by symlinking each skill into `~/.codex/skills/`:

```bash
ln -s /absolute/path/to/pi-brainmaxx/codex-skills/brainmaxx-init ~/.codex/skills/brainmaxx-init
ln -s /absolute/path/to/pi-brainmaxx/codex-skills/brainmaxx-reflect ~/.codex/skills/brainmaxx-reflect
ln -s /absolute/path/to/pi-brainmaxx/codex-skills/brainmaxx-ruminate ~/.codex/skills/brainmaxx-ruminate
```

The skills expect to live inside this repo so they can call:

```bash
node --import tsx ../../src/codex-cli.ts ...
```

The Codex helper commands now mirror the Pi side more closely:
- `current-session` reads the current Codex thread from `CODEX_THREAD_ID`
- `repo-sessions` reads older repo-scoped Codex history
- `stage-ruminate` persists a preview-only rumination proposal under `brain/`
- `apply-staged-ruminate` applies exactly the staged proposal
- `apply-changes` applies validated `brain/` updates and syncs entrypoints
