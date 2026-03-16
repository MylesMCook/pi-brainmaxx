import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assessCodexRuminationReadiness,
  collectCurrentCodexSession,
  collectCodexRepoSessions,
} from "../src/codex-sessions.js";

const writeSession = async (
  sessionsRoot: string,
  dateParts: [string, string, string],
  name: string,
  lines: unknown[],
): Promise<string> => {
  const directory = path.join(sessionsRoot, ...dateParts);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await fs.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return file;
};

test("collectCodexRepoSessions returns only repo-scoped readable sessions and excludes the current thread", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-codex-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const childRoot = path.join(projectRoot, "src");
  const otherRoot = path.join(tempRoot, "other");
  const sessionsRoot = path.join(tempRoot, "sessions");

  await fs.mkdir(childRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");
  await fs.mkdir(otherRoot, { recursive: true });

  await writeSession(sessionsRoot, ["2026", "03", "14"], "current.jsonl", [
    {
      type: "session_meta",
      payload: {
        id: "current-thread",
        timestamp: "2026-03-14T01:00:00.000Z",
        cwd: projectRoot,
        originator: "codex_cli_rs",
        cli_version: "0.114.0",
      },
    },
    {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Ignore current" }] },
    },
  ]);

  await writeSession(sessionsRoot, ["2026", "03", "13"], "repo.jsonl", [
    {
      type: "session_meta",
      payload: {
        id: "older",
        timestamp: "2026-03-13T01:00:00.000Z",
        cwd: childRoot,
        originator: "codex_cli_rs",
        cli_version: "0.114.0",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions for /home/myles\n<INSTRUCTIONS>\n..." }],
      },
    },
    {
      type: "turn_context",
      payload: { model: "gpt-5.4" },
    },
    {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Summarize the workflow" }] },
    },
    {
      type: "response_item",
      payload: { type: "reasoning" },
    },
    {
      type: "response_item",
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Use tmux first." }] },
    },
    {
      type: "response_item",
      payload: { type: "function_call", name: "write_file" },
    },
  ]);

  await writeSession(sessionsRoot, ["2026", "03", "12"], "other.jsonl", [
    {
      type: "session_meta",
      payload: {
        id: "other",
        timestamp: "2026-03-12T01:00:00.000Z",
        cwd: otherRoot,
        originator: "codex_cli_rs",
        cli_version: "0.114.0",
      },
    },
    {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Wrong repo" }] },
    },
  ]);

  const result = await collectCodexRepoSessions({
    cwd: childRoot,
    currentThreadId: "current-thread",
    sessionsRoot,
    minSessions: 1,
  });

  assert.equal(result.repoRoot, projectRoot);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0]?.sessionId, "older");
  assert.match(result.sessions[0]?.transcript ?? "", /User: Summarize the workflow/);
  assert.match(result.sessions[0]?.transcript ?? "", /Assistant: Use tmux first/);
  assert.doesNotMatch(result.sessions[0]?.transcript ?? "", /AGENTS\.md instructions/);
  assert.deepEqual(result.sessions[0]?.assistantModels, ["gpt-5.4"]);
  assert.equal(result.readiness.status, "ready");
});

test("collectCodexRepoSessions reports unsupported session metadata clearly", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-codex-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const sessionsRoot = path.join(tempRoot, "sessions");

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");

  await writeSession(sessionsRoot, ["2026", "03", "14"], "bad.jsonl", [
    {
      type: "session_meta",
      payload: {
        id: "bad",
        timestamp: "2026-03-14T01:00:00.000Z",
        cwd: projectRoot,
        originator: "something-else",
        cli_version: "0.114.0",
      },
    },
  ]);

  const result = await collectCodexRepoSessions({
    cwd: projectRoot,
    sessionsRoot,
  });

  assert.equal(result.sessions.length, 0);
  assert.equal(result.readiness.status, "unsupported");
  assert.match(result.warnings[0] ?? "", /Unsupported Codex session originator/);
});

test("collectCodexRepoSessions reports insufficient readable history when fewer than five sessions exist", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-codex-sessions-"));
  const projectRoot = path.join(tempRoot, "repo");
  const sessionsRoot = path.join(tempRoot, "sessions");

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");

  for (let index = 0; index < 2; index += 1) {
    await writeSession(sessionsRoot, ["2026", "03", `1${index + 1}`], `s${index}.jsonl`, [
      {
        type: "session_meta",
        payload: {
          id: `s${index}`,
          timestamp: `2026-03-1${index + 1}T01:00:00.000Z`,
          cwd: projectRoot,
          originator: "codex_cli_rs",
          cli_version: "0.114.0",
        },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Question ${index}` }] },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `Answer ${index}` }] },
      },
    ]);
  }

  const result = await collectCodexRepoSessions({
    cwd: projectRoot,
    sessionsRoot,
  });

  assert.equal(result.sessions.length, 2);
  assert.equal(result.readiness.status, "insufficient");
  assert.match(result.readiness.reason, /need at least 5/);
});

test("assessCodexRuminationReadiness treats zero readable sessions as unsupported when candidates exist", () => {
  const readiness = assessCodexRuminationReadiness({
    candidateFiles: 3,
    sessions: [],
  });

  assert.equal(readiness.status, "unsupported");
  assert.match(readiness.reason, /none had readable supported transcript data/);
});

test("collectCurrentCodexSession returns the current thread transcript for the repo", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-codex-current-"));
  const projectRoot = path.join(tempRoot, "repo");
  const childRoot = path.join(projectRoot, "src");
  const sessionsRoot = path.join(tempRoot, "sessions");

  await fs.mkdir(childRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");

  const file = await writeSession(sessionsRoot, ["2026", "03", "16"], "rollout-2026-03-16T00-00-00-thread-1.jsonl", [
    {
      type: "session_meta",
      payload: {
        id: "thread-1",
        timestamp: "2026-03-16T00:00:00.000Z",
        cwd: childRoot,
        originator: "codex_cli_rs",
        cli_version: "0.114.0",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "# AGENTS.md instructions for /home/myles\n<INSTRUCTIONS>\n..." }],
      },
    },
    {
      type: "turn_context",
      payload: { model: "gpt-5.4" },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Keep the repo memory concise." }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Understood." }],
      },
    },
  ]);

  const result = await collectCurrentCodexSession({
    cwd: childRoot,
    currentThreadId: "thread-1",
    sessionsRoot,
  });

  assert.equal(result.repoRoot, projectRoot);
  assert.equal(result.file, file);
  assert.match(result.transcript, /User: Keep the repo memory concise/);
  assert.match(result.transcript, /Assistant: Understood/);
  assert.doesNotMatch(result.transcript, /AGENTS\.md instructions/);
});

test("collectCurrentCodexSession rejects a current thread from another repo", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-codex-current-"));
  const projectRoot = path.join(tempRoot, "repo");
  const otherRoot = path.join(tempRoot, "other");
  const sessionsRoot = path.join(tempRoot, "sessions");

  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".git"), "gitdir: fake\n");
  await fs.mkdir(otherRoot, { recursive: true });

  await writeSession(sessionsRoot, ["2026", "03", "16"], "rollout-2026-03-16T00-00-00-thread-2.jsonl", [
    {
      type: "session_meta",
      payload: {
        id: "thread-2",
        timestamp: "2026-03-16T00:00:00.000Z",
        cwd: otherRoot,
        originator: "codex_cli_rs",
        cli_version: "0.114.0",
      },
    },
  ]);

  await assert.rejects(
    collectCurrentCodexSession({
      cwd: projectRoot,
      currentThreadId: "thread-2",
      sessionsRoot,
    }),
    /belongs to .* not repo root/i,
  );
});
