import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initClaudeBrain, syncClaudeBrain } from "../src/claude.js";

const tempProject = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  return root;
};

test("initClaudeBrain wires AGENTS, CLAUDE shim, hook, settings, and Claude memory imports", async () => {
  const projectRoot = await tempProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-home-"));
  const projectsRoot = path.join(fakeHome, ".claude", "projects");
  const claudeProjectDir = path.join(projectsRoot, "repo-project");
  const memoryDir = path.join(claudeProjectDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  await fs.writeFile(
    path.join(claudeProjectDir, "session-a.jsonl"),
    [
      JSON.stringify({ sessionId: "session-a", cwd: projectRoot, timestamp: "2026-03-16T00:00:00.000Z" }),
      "",
    ].join("\n"),
  );
  await fs.writeFile(path.join(memoryDir, "MEMORY.md"), "# Memory\n\nFollow AGENTS.md.\n");

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;

  try {
    const result = await initClaudeBrain(projectRoot);
    const shim = await fs.readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
    const index = await fs.readFile(path.join(projectRoot, "brain/index.md"), "utf8");
    const settings = await fs.readFile(path.join(projectRoot, ".claude/settings.json"), "utf8");

    assert.equal(result.agents.status, "created");
    assert.match(shim, /Follow whats in described in AGENTS\.md/);
    assert.match(shim, /@AGENTS\.md/);
    assert.match(settings, /brainerd-session-start\.mjs/);
    assert.ok(await fs.stat(path.join(projectRoot, ".claude/hooks/brainerd-session-start.mjs")));
    assert.ok(await fs.stat(path.join(projectRoot, "brain/imports/claude/MEMORY.md")));
    assert.match(index, /Imported Claude Memory/);
    assert.match(index, /\[\[imports\/claude\/MEMORY\.md\]\]/);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  }
});

test("syncClaudeBrain keeps repo CLAUDE.md as a thin shim", async () => {
  const projectRoot = await tempProject();
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-sync-home-"));
  const projectsRoot = path.join(fakeHome, ".claude", "projects");
  const claudeProjectDir = path.join(projectsRoot, "repo-project");
  await fs.mkdir(claudeProjectDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeProjectDir, "session-a.jsonl"),
    [
      JSON.stringify({ sessionId: "session-a", cwd: projectRoot, timestamp: "2026-03-16T00:00:00.000Z" }),
      "",
    ].join("\n"),
  );

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;

  try {
    await initClaudeBrain(projectRoot);
    await fs.writeFile(path.join(projectRoot, "CLAUDE.md"), "# Wrong\n");

    await syncClaudeBrain(projectRoot);

    const shim = await fs.readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
    assert.equal(shim, "Follow whats in described in AGENTS.md\n\n@AGENTS.md\n");
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  }
});
