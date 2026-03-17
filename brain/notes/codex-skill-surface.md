# Codex Skill Surface

- Public Codex install surfaces should expose one root skill name. For Brainerd, the public skill is `brainerd`; narrower mode skills like `brainerd-init`, `brainerd-reflect`, and `brainerd-ruminate` stay internal or secondary.
- If a Codex skill needs repo-local TypeScript helpers, call them through a small wrapper script under `scripts/`. Do not depend on `node --import tsx ../../src/...` from an installed skill path.
- Keep the public repo name, public skill name, and user-facing docs aligned. Extra name splits add confusion without adding capability.
