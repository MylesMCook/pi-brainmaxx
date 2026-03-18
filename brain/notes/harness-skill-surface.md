# Codex Skill Surface

- Public Brainerd surfaces should be harness-prefixed so the memory source is explicit at invocation time: `pi-*`, `codex-*`, and `claude-*`.
- If a Codex skill needs repo-local TypeScript helpers, call them through a small wrapper script under `scripts/`. Do not depend on `node --import tsx ../../src/...` from an installed skill path.
- Keep one shared `brain/` layout and one shared `AGENTS.md` contract across harnesses. Compatibility files like `CLAUDE.md` should stay thin shims.
