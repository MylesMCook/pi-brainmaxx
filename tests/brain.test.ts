import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initBrain, readBrainState, syncOwnedEntryPoints, writeNoteIfMissing } from "../src/brain.js";

const tempProject = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-brain-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  return root;
};

test("brain-init creates the managed files and records ownership", async () => {
  const projectRoot = await tempProject();

  const result = await initBrain(projectRoot);
  const state = await readBrainState(projectRoot);

  assert.ok(result.created.includes("brain/index.md"));
  assert.ok(result.created.includes("brain/principles.md"));
  assert.ok(state);
  assert.ok(state.ownedFiles.includes("brain/index.md"));
  assert.ok(state.ownedFiles.includes("brain/principles.md"));
});

test("brain-init preserves existing managed files instead of overwriting them", async () => {
  const projectRoot = await tempProject();
  await fs.mkdir(path.join(projectRoot, "brain/principles"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "brain/index.md"), "# My index\n");

  const result = await initBrain(projectRoot);
  const persisted = await fs.readFile(path.join(projectRoot, "brain/index.md"), "utf8");
  const state = await readBrainState(projectRoot);

  assert.ok(result.preserved.includes("brain/index.md"));
  assert.equal(persisted, "# My index\n");
  assert.ok(state);
  assert.equal(state.ownedFiles.includes("brain/index.md"), false);
});

test("syncOwnedEntryPoints only rewrites package-owned entrypoints", async () => {
  const projectRoot = await tempProject();
  await initBrain(projectRoot);
  await fs.mkdir(path.join(projectRoot, "brain/notes"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "brain/notes/repeated-failure.md"), "# Repeated failure\n\nDocument it.\n");

  const result = await syncOwnedEntryPoints(projectRoot);
  const indexText = await fs.readFile(path.join(projectRoot, "brain/index.md"), "utf8");

  assert.ok(result.updated.includes("brain/index.md"));
  assert.match(indexText, /\[\[notes\/repeated-failure\.md\]\]/);
});

test("syncOwnedEntryPoints skips user-owned entrypoints", async () => {
  const projectRoot = await tempProject();
  await initBrain(projectRoot);

  const statePath = path.join(projectRoot, "brain/.brainmaxx-version");
  const state = JSON.parse(await fs.readFile(statePath, "utf8")) as { version: string; ownedFiles: string[] };
  state.ownedFiles = state.ownedFiles.filter((file) => file !== "brain/index.md");
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

  await fs.writeFile(path.join(projectRoot, "brain/index.md"), "# Custom index\n");
  const result = await syncOwnedEntryPoints(projectRoot);
  const persisted = await fs.readFile(path.join(projectRoot, "brain/index.md"), "utf8");

  assert.ok(result.skipped.includes("brain/index.md"));
  assert.equal(persisted, "# Custom index\n");
});

test("brain mutations serialize safely when init runs concurrently", async () => {
  const projectRoot = await tempProject();

  const [first, second] = await Promise.all([initBrain(projectRoot), initBrain(projectRoot)]);
  const state = await readBrainState(projectRoot);

  assert.ok(state);
  assert.ok(state.ownedFiles.includes("brain/index.md"));
  assert.ok(first.created.length > 0 || second.created.length > 0);
});

test("brain-init reclaims a stale lock file", async () => {
  const projectRoot = await tempProject();
  await fs.mkdir(path.join(projectRoot, "brain"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, "brain/.brainmaxx.lock"),
    JSON.stringify({ pid: 999_999_999, createdAt: "2000-01-01T00:00:00.000Z" }),
  );

  const result = await initBrain(projectRoot);

  assert.ok(result.created.includes("brain/index.md"));
  await assert.rejects(fs.access(path.join(projectRoot, "brain/.brainmaxx.lock")));
});

test("writeNoteIfMissing creates a note once and syncs the index", async () => {
  const projectRoot = await tempProject();
  await initBrain(projectRoot);

  const first = await writeNoteIfMissing(
    projectRoot,
    "brain/notes/repo-operations.md",
    "# Repo Operations\n\n- Use `pi` for interactive work.\n",
  );
  const second = await writeNoteIfMissing(
    projectRoot,
    "brain/notes/repo-operations.md",
    "# Repo Operations\n\n- Different content.\n",
  );
  const indexText = await fs.readFile(path.join(projectRoot, "brain/index.md"), "utf8");

  assert.equal(first.created, true);
  assert.ok(first.synced.includes("brain/index.md"));
  assert.equal(second.created, false);
  assert.match(indexText, /\[\[notes\/repo-operations\.md\]\]/);
});
