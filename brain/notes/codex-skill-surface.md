# Codex Skill Surface

- Public Codex install surfaces should expose one root skill name. For Brainerd, the public skill is `brainerd`; narrower mode skills like `brainerd-init`, `brainerd-reflect`, and `brainerd-ruminate` stay internal or secondary.
- If a Codex skill needs repo-local TypeScript helpers, call them through a small wrapper script under `scripts/`. Do not depend on `node --import tsx ../../src/...` from an installed skill path.
- Keep the public repo name, public skill name, and user-facing docs aligned. Extra name splits add confusion without adding capability.
- In Codex, Brainerd should feel ambient for reads and explicit for writes. If a repo already has a brain, read `brain/index.md` and `brain/principles.md` before non-trivial work without requiring `$brainerd`.
- If a repo has no brain, give one short init nudge. Do not auto-create `brain/`, and do not keep repeating the suggestion in the same conversation.
- Reflection and rumination remain explicit actions. Ambient Brainerd should never write memory on its own.
