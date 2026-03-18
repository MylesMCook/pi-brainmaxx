import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initBrain } from "../src/brain.js";
import {
  applyCodexRuminateStage,
  discardCodexRuminateStage,
  getCodexRuminateStage,
  stageCodexRuminate,
} from "../src/codex-stage.js";

const tempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-codex-stage-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  await initBrain(root);
  return root;
};

test("stageCodexRuminate persists a staged preview under brain/", async () => {
  const projectRoot = await tempRepo();

  const stage = await stageCodexRuminate(projectRoot, {
    findingsSummary: "Prefer updating the existing note.",
    rationale: "Repeated sessions converged on the same file target.",
    changes: [{ path: "brain/notes/brain-style.md", content: "# Brain Style\n\n- Update existing notes first.\n" }],
  });

  assert.equal(stage.status, "staged");

  const persisted = await getCodexRuminateStage(projectRoot);
  assert.ok(persisted);
  assert.equal(persisted?.stageId, stage.stageId);
  assert.equal(persisted?.changes[0]?.path, "brain/notes/brain-style.md");
  assert.ok(await fs.stat(path.join(projectRoot, "brain/.codex-ruminate-stage.json")));
});

test("applyCodexRuminateStage applies the staged proposal and updates its status", async () => {
  const projectRoot = await tempRepo();
  const stage = await stageCodexRuminate(projectRoot, {
    findingsSummary: "Cross-cutting rules belong in principles.",
    rationale: "This should be reusable durable guidance.",
    changes: [{ path: "brain/principles/memory-placement.md", content: "# Memory Placement\n\nCross-cutting rules belong in principles.\n" }],
  });

  const result = await applyCodexRuminateStage(projectRoot, stage.stageId);

  assert.match(result.apply.changed.join("\n"), /brain\/principles\/memory-placement\.md/);
  assert.ok(await fs.stat(path.join(projectRoot, "brain/principles/memory-placement.md")));

  const persisted = await getCodexRuminateStage(projectRoot);
  assert.equal(persisted?.status, "applied");
  assert.deepEqual(persisted?.changedFiles, result.apply.changed);
});

test("discardCodexRuminateStage marks the staged preview as discarded", async () => {
  const projectRoot = await tempRepo();
  await stageCodexRuminate(projectRoot, {
    findingsSummary: "Preview only.",
    rationale: "The user rejected the proposal.",
    changes: [{ path: "brain/notes/example.md", content: "# Example\n" }],
  });

  const discarded = await discardCodexRuminateStage(projectRoot);

  assert.equal(discarded?.status, "discarded");
  const persisted = await getCodexRuminateStage(projectRoot);
  assert.equal(persisted?.status, "discarded");
});

test("getCodexRuminateStage rejects a staged preview copied from another repo", async () => {
  const projectRoot = await tempRepo();
  const foreignRoot = await tempRepo();
  await fs.writeFile(
    path.join(projectRoot, "brain/.brainerd-ruminate-stage.json"),
    JSON.stringify(
      {
        stageId: "foreign-stage",
        repoRoot: foreignRoot,
        createdAt: new Date().toISOString(),
        findingsSummary: "Foreign stage",
        rationale: "Should not apply across repos.",
        changes: [{ path: "brain/notes/example.md", content: "# Example\n" }],
        status: "staged",
      },
      null,
      2,
    ) + "\n",
  );

  await assert.rejects(
    getCodexRuminateStage(projectRoot),
    /belongs to .* not /,
  );
});
