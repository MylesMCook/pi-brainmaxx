import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncClaudeMemoryImports } from "../src/claude-memory.js";

const tempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-memory-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  return root;
};

test("syncClaudeMemoryImports mirrors Claude memory files into brain/imports/claude and removes stale files", async () => {
  const repoRoot = await tempRepo();
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-projects-"));
  const projectDir = path.join(projectsRoot, "repo-project");
  const memoryDir = path.join(projectDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  await fs.writeFile(
    path.join(projectDir, "session-a.jsonl"),
    [
      JSON.stringify({ sessionId: "session-a", cwd: repoRoot, timestamp: "2026-03-16T00:00:00.000Z" }),
      "",
    ].join("\n"),
  );
  await fs.writeFile(path.join(memoryDir, "MEMORY.md"), "# Memory\n\nKeep the CLAUDE shim thin.\n");
  await fs.writeFile(path.join(memoryDir, "workflow.md"), "# Workflow\n\nSeed the brain from Claude memory.\n");

  const staleRoot = path.join(repoRoot, "brain/imports/claude");
  await fs.mkdir(staleRoot, { recursive: true });
  await fs.writeFile(path.join(staleRoot, "stale.md"), "# stale\n");

  const result = await syncClaudeMemoryImports(repoRoot, projectsRoot);
  const imported = await fs.readFile(path.join(repoRoot, "brain/imports/claude", "MEMORY.md"), "utf8");

  assert.equal(result.projectDir, projectDir);
  assert.deepEqual(result.imported.sort(), ["brain/imports/claude/MEMORY.md", "brain/imports/claude/workflow.md"]);
  assert.deepEqual(result.removed, ["brain/imports/claude/stale.md"]);
  assert.match(imported, /Managed by Brainerd from Claude auto memory/);
  assert.match(imported, /Keep the CLAUDE shim thin/);
});
