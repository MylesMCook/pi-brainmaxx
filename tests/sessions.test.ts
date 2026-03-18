import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectRepoSessions } from "../src/sessions.js";

const writeSession = async (
  sessionsRoot: string,
  cwd: string,
  name: string,
  lines: unknown[],
): Promise<string> => {
  const directory = path.join(sessionsRoot, `--${cwd.replaceAll("\\", "-").replaceAll("/", "-").replaceAll(":", "-")}--`);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
};

test("collectRepoSessions returns only repo-scoped sessions and excludes the current session", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const childCwd = path.join(projectRoot, "src");
  const otherRoot = path.join(tempRoot, "other");
  const sessionsRoot = path.join(tempRoot, "sessions");

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");
  await fs.mkdir(childCwd, { recursive: true });
  await fs.mkdir(otherRoot, { recursive: true });

  const current = await writeSession(sessionsRoot, projectRoot, "current.jsonl", [
    { type: "session", version: 3, id: "1", timestamp: "2026-03-15T00:00:00.000Z", cwd: projectRoot },
    { type: "message", id: "a", parentId: null, timestamp: "2026-03-15T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "Current" }] } },
  ]);

  await writeSession(sessionsRoot, childCwd, "child.jsonl", [
    { type: "session", version: 3, id: "2", timestamp: "2026-03-14T00:00:00.000Z", cwd: childCwd },
    { type: "message", id: "b", parentId: null, timestamp: "2026-03-14T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
    { type: "message", id: "c", parentId: "b", timestamp: "2026-03-14T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "World" }], provider: "openai-codex", model: "gpt-5.4" } },
  ]);

  await writeSession(sessionsRoot, otherRoot, "other.jsonl", [
    { type: "session", version: 3, id: "3", timestamp: "2026-03-13T00:00:00.000Z", cwd: otherRoot },
    { type: "message", id: "d", parentId: null, timestamp: "2026-03-13T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "Ignore me" }] } },
  ]);

  const result = await collectRepoSessions({
    cwd: childCwd,
    currentSessionFile: current,
    sessionsRoot,
  });

  assert.equal(result.repoRoot, projectRoot);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0]?.cwd, childCwd);
  assert.match(result.sessions[0]?.transcript ?? "", /User: Hello/);
  assert.match(result.sessions[0]?.transcript ?? "", /Assistant: World/);
});

test("collectRepoSessions reports unsupported Pi session versions as warnings", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const sessionsRoot = path.join(tempRoot, "sessions");

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");

  await writeSession(sessionsRoot, projectRoot, "bad.jsonl", [
    { type: "session", version: 99, id: "1", timestamp: "2026-03-15T00:00:00.000Z", cwd: projectRoot },
  ]);

  const result = await collectRepoSessions({
    cwd: projectRoot,
    sessionsRoot,
  });

  assert.equal(result.sessions.length, 0);
  assert.match(result.warnings[0] ?? "", /Unsupported Pi session version 99/);
});

test("collectRepoSessions reports malformed session files as warnings", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const sessionsRoot = path.join(tempRoot, "sessions");
  const directory = path.join(
    sessionsRoot,
    `--${projectRoot.replaceAll("\\", "-").replaceAll("/", "-").replaceAll(":", "-")}--`,
  );

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "bad.jsonl"), "{\"type\":\"session\",\"version\":3,\"cwd\":\n");

  const result = await collectRepoSessions({
    cwd: projectRoot,
    sessionsRoot,
  });

  assert.equal(result.sessions.length, 0);
  assert.match(result.warnings[0] ?? "", /Malformed Pi session JSON/);
});

test("collectRepoSessions skips malformed session bodies after a valid header", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const sessionsRoot = path.join(tempRoot, "sessions");
  const directory = path.join(
    sessionsRoot,
    `--${projectRoot.replaceAll("\\", "-").replaceAll("/", "-").replaceAll(":", "-")}--`,
  );

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "bad-body.jsonl"),
    [
      JSON.stringify({ type: "session", version: 3, id: "1", timestamp: "2026-03-15T00:00:00.000Z", cwd: projectRoot }),
      JSON.stringify({ type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "Still usable" }] } }),
      "{\"type\":\"message\",\"message\":",
      JSON.stringify({ type: "message", id: "a1", message: { role: "assistant", content: [{ type: "text", text: "Recovered" }], provider: "openai-codex", model: "gpt-5.4" } }),
      "",
    ].join("\n"),
  );

  const result = await collectRepoSessions({
    cwd: projectRoot,
    sessionsRoot,
  });

  assert.equal(result.sessions.length, 1);
  assert.match(result.sessions[0]?.transcript ?? "", /Still usable/);
  assert.match(result.sessions[0]?.transcript ?? "", /Recovered/);
  assert.match(result.warnings[0] ?? "", /Malformed Pi session JSON/);
});

test("collectRepoSessions rejects oversized session headers clearly", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const sessionsRoot = path.join(tempRoot, "sessions");
  const directory = path.join(
    sessionsRoot,
    `--${projectRoot.replaceAll("\\", "-").replaceAll("/", "-").replaceAll(":", "-")}--`,
  );

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "huge-header.jsonl"),
    `{\"type\":\"session\",\"version\":3,\"cwd\":\"${"x".repeat(70_000)}`,
  );

  const result = await collectRepoSessions({
    cwd: projectRoot,
    sessionsRoot,
  });

  assert.equal(result.sessions.length, 0);
  assert.match(result.warnings[0] ?? "", /header exceeds 65536 bytes/);
});
