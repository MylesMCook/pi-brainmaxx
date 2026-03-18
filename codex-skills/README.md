# Codex skills

These are the Codex-side Brainerd skills.

Install them by symlinking each skill into `~/.codex/skills/`:

```bash
ln -s /absolute/path/to/brainerd/codex-skills/codex-init ~/.codex/skills/codex-init
ln -s /absolute/path/to/brainerd/codex-skills/codex-reflect ~/.codex/skills/codex-reflect
ln -s /absolute/path/to/brainerd/codex-skills/codex-ruminate ~/.codex/skills/codex-ruminate
```

The skills expect to live inside this repo so they can call the stable wrapper:

```bash
../../scripts/brainerd-codex.sh ...
```

On Windows, use the matching `.cmd` wrapper instead:

```powershell
..\..\scripts\brainerd-codex.cmd ...
```

The Codex helper commands now mirror the Pi side more closely:
- `current-session` reads the current Codex thread from `CODEX_THREAD_ID`
- `repo-sessions` reads older repo-scoped Codex history
- `stage-ruminate` persists a preview-only rumination proposal under
  `brain/.codex-ruminate-stage.json`
- `apply-staged-ruminate` applies exactly the staged proposal
- `apply-changes` applies validated `brain/` updates and syncs entrypoints
