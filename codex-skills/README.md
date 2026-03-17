# Codex skills

These are the local Codex-side `Brainerd` skills that sit next to the Pi
package.

Install them by symlinking each skill into `~/.codex/skills/`:

```bash
ln -s /absolute/path/to/brainerd/codex-skills/brainerd-init ~/.codex/skills/brainerd-init
ln -s /absolute/path/to/brainerd/codex-skills/brainerd-reflect ~/.codex/skills/brainerd-reflect
ln -s /absolute/path/to/brainerd/codex-skills/brainerd-ruminate ~/.codex/skills/brainerd-ruminate
```

The skills expect to live inside this repo so they can call the stable wrapper:

```bash
../../scripts/brainerd-codex.sh ...
```

The Codex helper commands now mirror the Pi side more closely:
- `current-session` reads the current Codex thread from `CODEX_THREAD_ID`
- `repo-sessions` reads older repo-scoped Codex history
- `stage-ruminate` persists a preview-only rumination proposal under `brain/`
- `apply-staged-ruminate` applies exactly the staged proposal
- `apply-changes` applies validated `brain/` updates and syncs entrypoints
