import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initBrain } from "../src/brain.js";
import { applyOperationalBootstrap, planOperationalBootstrap } from "../src/bootstrap.js";

const tempProject = async (name = "repo"): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-bootstrap-"));
  const projectRoot = path.join(root, name);
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git/config"), "");
  return projectRoot;
};

const setOrigin = async (projectRoot: string, url: string): Promise<void> => {
  await fs.writeFile(path.join(projectRoot, ".git/config"), `[remote "origin"]\n\turl = ${url}\n`);
};

test("planOperationalBootstrap derives the operations note name from git origin and keeps content concise", async () => {
  const projectRoot = await tempProject();
  await setOrigin(projectRoot, "https://github.com/MylesMCook/beelink.git");
  await fs.writeFile(
    path.join(projectRoot, "AGENTS.md"),
    [
      "# Workflow and Habits",
      "",
      "- For reconnectable remote work, start with `tmux new-session -A -s beelink`, then launch `pi`.",
      "- No emojis.",
      "",
      "# Interfaces",
      "",
      "- Maestro handles delegated Linear repo work on this machine.",
      "- Grasshopper is the preferred retrieval engine.",
      "",
      "# Running Infrastructure",
      "",
      "| Service | Description |",
      "| --- | --- |",
      "| cloudflared.service | Cloudflare tunnel for funnydomainname.com |",
      "",
    ].join("\n"),
  );

  const plan = await planOperationalBootstrap(projectRoot);

  assert.equal(plan.status, "ready");
  assert.equal(plan.noteRelativePath, "brain/notes/beelink-operations.md");
  assert.match(plan.content, /tmux new-session -A -s beelink/);
  assert.match(plan.content, /Maestro handles delegated Linear repo work/);
  assert.match(plan.content, /Grasshopper is the preferred retrieval engine/);
  assert.match(plan.content, /cloudflared\.service: Cloudflare tunnel/);
  assert.doesNotMatch(plan.content, /No emojis/);
});

test("planOperationalBootstrap returns none when no source docs contain operational content", async () => {
  const projectRoot = await tempProject("empty");

  const plan = await planOperationalBootstrap(projectRoot);

  assert.equal(plan.status, "none");
  assert.match(plan.reason, /No concise operational content/);
});

test("applyOperationalBootstrap creates the operations note and updates the brain index", async () => {
  const projectRoot = await tempProject("scratch");
  await initBrain(projectRoot);
  await fs.writeFile(
    path.join(projectRoot, "README.md"),
    [
      "# Workflow",
      "",
      "- Run `pi` from the repo root for local work.",
      "- Use Linear for tracked tasks.",
      "",
    ].join("\n"),
  );

  const result = await applyOperationalBootstrap(projectRoot);
  const indexText = await fs.readFile(path.join(projectRoot, "brain/index.md"), "utf8");

  assert.equal(result.status, "created");
  assert.match(result.content, /Run `pi` from the repo root/);
  assert.match(indexText, /\[\[notes\/scratch-operations\.md\]\]/);
});

test("planOperationalBootstrap skips an existing operations note", async () => {
  const projectRoot = await tempProject("beelink-home");
  await initBrain(projectRoot);
  await setOrigin(projectRoot, "https://github.com/MylesMCook/beelink.git");
  await fs.mkdir(path.join(projectRoot, "brain/notes"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "brain/notes/beelink-operations.md"), "# Existing\n");

  const plan = await planOperationalBootstrap(projectRoot);

  assert.equal(plan.status, "exists");
  assert.match(plan.reason, /already exists/);
});
