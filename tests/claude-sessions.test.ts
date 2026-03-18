import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectClaudeRepoSessions, collectCurrentClaudeSession } from "../src/claude-sessions.js";

const tempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-sessions-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  return root;
};

const writeClaudeSession = async (
  projectDir: string,
  sessionId: string,
  cwd: string,
  timestamp: string,
  transcriptLabel: string,
): Promise<string> => {
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({ sessionId, cwd, timestamp }),
      JSON.stringify({ type: "queue-operation", message: { role: "assistant", content: [{ type: "text", text: "ignore queue" }] } }),
      JSON.stringify({
        message: {
          role: "user",
          content: [
            { type: "text", text: `User says ${transcriptLabel}` },
            { type: "tool_result", content: [{ text: `Tool says ${transcriptLabel}` }] },
          ],
        },
      }),
      JSON.stringify({ type: "progress", message: { role: "assistant", content: [{ type: "text", text: "ignore progress" }] } }),
      JSON.stringify({
        message: {
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: `Assistant says ${transcriptLabel}` }],
        },
      }),
      "",
    ].join("\n"),
  );
  return sessionFile;
};

test("collectClaudeRepoSessions reads top-level project sessions and ignores subagents plus non-transcript records", async () => {
  const repoRoot = await tempRepo();
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-projects-"));
  const projectDir = path.join(projectsRoot, "repo-project");
  await fs.mkdir(path.join(projectDir, "subagents"), { recursive: true });

  await writeClaudeSession(projectDir, "session-a", repoRoot, "2026-03-16T00:00:00.000Z", "primary");
  await fs.writeFile(
    path.join(projectDir, "subagents", "agent-1.jsonl"),
    JSON.stringify({ sessionId: "subagent", cwd: repoRoot, timestamp: "2026-03-16T00:00:01.000Z" }) + "\n",
  );

  const result = await collectClaudeRepoSessions({
    cwd: repoRoot,
    projectsRoot,
    minSessions: 1,
    maxSessions: 5,
    maxCharsPerSession: 4000,
  });

  assert.equal(result.readiness.status, "ready");
  assert.equal(result.sessions.length, 1);
  assert.match(result.sessions[0]?.transcript ?? "", /User: User says primary/);
  assert.match(result.sessions[0]?.transcript ?? "", /Tool result: Tool says primary/);
  assert.match(result.sessions[0]?.transcript ?? "", /Assistant: Assistant says primary/);
  assert.doesNotMatch(result.sessions[0]?.transcript ?? "", /ignore queue/);
  assert.doesNotMatch(result.sessions[0]?.transcript ?? "", /subagent/);
});

test("collectCurrentClaudeSession prefers explicit transcriptPath and sessionId over newest-file fallback", async () => {
  const repoRoot = await tempRepo();
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-claude-current-"));
  const projectDir = path.join(projectsRoot, "repo-project");
  await fs.mkdir(projectDir, { recursive: true });

  const older = await writeClaudeSession(projectDir, "session-old", repoRoot, "2026-03-15T00:00:00.000Z", "older");
  const newer = await writeClaudeSession(projectDir, "session-new", repoRoot, "2026-03-16T00:00:00.000Z", "newer");

  const byTranscript = await collectCurrentClaudeSession({
    cwd: repoRoot,
    projectsRoot,
    transcriptPath: older,
  });
  assert.equal(byTranscript.sessionId, "session-old");

  const bySessionId = await collectCurrentClaudeSession({
    cwd: repoRoot,
    projectsRoot,
    sessionId: "session-old",
  });
  assert.equal(bySessionId.sessionId, "session-old");

  const fallback = await collectCurrentClaudeSession({
    cwd: repoRoot,
    projectsRoot,
  });
  assert.equal(fallback.sessionId, "session-new");
  assert.equal(path.resolve(fallback.file), path.resolve(newer));
});
