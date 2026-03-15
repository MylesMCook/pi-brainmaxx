# Public Messaging

Maintainer note: this is an internal messaging reference for future README,
package-page, and landing-page work. It is not part of the user-facing docs
surface.

## Product Thesis

`pi-brainmaxx` gives Pi a repo-local brain it actually uses.

The enemy is not "lack of memory" in the abstract. The enemy is agent amnesia
caused by repo context sprawl: knowledge split across docs, habits, and old
sessions until Pi starts each serious session half-blank.

## Audience

Front-door audience:
- Pi users who want durable repo memory without another heavy framework

Secondary audience, for later expansion:
- agent builders who care about inspectable, repo-local memory systems

Rule:
- public copy should lead with Pi first, then widen the frame only after the
  Pi-only constraint is explicit

## Tone Rules

Write like this:
- direct
- adult
- persuasive
- specific
- calm confidence

Do not write like this:
- emojis
- startup hype
- AI mysticism
- playful jargon
- generic transformation copy
- claims that are not tied to current product behavior

Banned phrases:
- supercharge
- unlock
- 10x
- game-changing
- next-generation
- AI-powered productivity

## Category, Villain, Promise, Proof

Category:
- a project brain for Pi

Villain:
- agent amnesia
- repo context sprawl

Promise:
- repo-local memory that Pi actually uses on normal turns

Proof:
- `/brain-init`
- `/reflect`
- `/ruminate`
- plain markdown in the repo
- `pi -p` support
- repo-scoped Pi session history

## Message Hierarchy

Headline:
- Pi should not start every session blank.

Supporting line:
- `pi-brainmaxx` is a project brain for Pi: repo-local memory that Pi can read,
  extend, and mine over time.

Differentiation:
- repo-local
- inspectable
- small
- Pi-native
- not another orchestrator

Approved alternates:
- Give Pi a repo-local brain it can actually use.
- Stop repeating the same repo context to Pi.
- Give each repo a small `brain/` that Pi reads on normal turns.
- Turn scattered repo context into a brain Pi can actually start from.

## Objection Handling

Why not just use `AGENTS.md`?
- `AGENTS.md` is still the right place for stable instructions.
  `pi-brainmaxx` adds Pi-native entrypoints plus a workflow for accumulating
  durable repo memory over time.

Will this create sludge?
- The public surface is deliberately narrow. One starter brain, one operations
  note, one reflection path, one rumination path.

Do I have to learn a new workflow?
- No. Initialize once, work normally, reflect when a session teaches something,
  ruminate when enough history exists.

What happens to session history?
- `ruminate` is Pi-only and mines repo-scoped Pi sessions from local Pi agent
  state. It is not pretending every session everywhere should affect every repo.

## Proof Points Tied to Real Product Behavior

- `/brain-init` scaffolds a repo-local `brain/` without overwriting existing
  files
- `/brain-init --apply-bootstrap` creates one operations note when it is missing
- Pi reads `brain/index.md` and `brain/principles.md` on normal turns
- `/reflect` is a native Pi skill command
- `/ruminate` is a native Pi skill command
- both interactive Pi and `pi -p` are supported
- operational bootstrap reads only `AGENTS.md`, `README.md`, and `MEMORY.md`

## Public Surface Snippets

Package-page summary:
- A project brain for Pi: repo-local memory, reflection, and session-history
  rumination.

README hero:
- **Headline:** Pi should not start every session blank.
- **Subhead:** `pi-brainmaxx` is a project brain for Pi: repo-local memory that
  Pi can read, extend, and mine over time.

Short blurb:
- Turn scattered repo context into a small local `brain/` Pi reads on normal
  turns and improves with `/reflect` and `/ruminate`.

## Icon System

Default family:
- `lucide`

Usage rules:
- monochrome or `currentColor` only
- max 4 icons across README/package/site surfaces
- icons lead sections or proof bullets only
- never use icons as decoration

Locked icon IDs:
- initialize brain: `lucide:brain`
- reflect current session: `lucide:notebook-pen`
- ruminate on history: `lucide:history`
- repo-local markdown / inspectability: `lucide:file-text`

Selection method:
- `better-icons` is not currently available on this machine
- these IDs were verified through the Iconify Search API as a one-time fallback
- when `better-icons` is available locally, keep these IDs unless there is a
  strong reason to change them
