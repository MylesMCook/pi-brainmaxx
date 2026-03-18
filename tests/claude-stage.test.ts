import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initBrain } from "../src/brain.js";
import {
  applyClaudeRuminateStage,
  discardClaudeRuminateStage,
  getClaudeRuminateStage,
  stageClaudeRuminate,
} from "../src/claude-stage.js";

const tempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-stage-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  await initBrain(root);
  return root;
};

test("stageClaudeRuminate persists a staged preview under the Claude stage file", async () => {
  const projectRoot = await tempRepo();

  const stage = await stageClaudeRuminate(projectRoot, {
    findingsSummary: "Claude repeated the same memory correction.",
    rationale: "This belongs in durable repo memory.",
    changes: [{ path: "brain/notes/claude-memory.md", content: "# Claude Memory\n\nKeep imported Claude memory managed.\n" }],
  });

  const persisted = await getClaudeRuminateStage(projectRoot);
  assert.equal(persisted?.stageId, stage.stageId);
  assert.ok(await fs.stat(path.join(projectRoot, "brain/.claude-ruminate-stage.json")));
});

test("applyClaudeRuminateStage applies the staged proposal and updates its status", async () => {
  const projectRoot = await tempRepo();
  const stage = await stageClaudeRuminate(projectRoot, {
    findingsSummary: "Cross-harness rules belong in principles.",
    rationale: "The rule should survive harness changes.",
    changes: [{ path: "brain/principles/harness-memory.md", content: "# Harness Memory\n\nKeep seed imports managed and distill durable knowledge.\n" }],
  });

  const result = await applyClaudeRuminateStage(projectRoot, stage.stageId);
  assert.match(result.apply.changed.join("\n"), /brain\/principles\/harness-memory\.md/);

  const persisted = await getClaudeRuminateStage(projectRoot);
  assert.equal(persisted?.status, "applied");
});

test("discardClaudeRuminateStage marks the staged preview as discarded", async () => {
  const projectRoot = await tempRepo();
  await stageClaudeRuminate(projectRoot, {
    findingsSummary: "Preview only.",
    rationale: "The user rejected the proposal.",
    changes: [{ path: "brain/notes/example.md", content: "# Example\n" }],
  });

  const discarded = await discardClaudeRuminateStage(projectRoot);
  assert.equal(discarded?.status, "discarded");
});
