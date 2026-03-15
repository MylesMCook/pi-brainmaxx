import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "@mariozechner/pi-coding-agent";
import brainContext from "../extensions/brain-context.js";

type RegisteredCommand = {
  description: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

type RegisteredTool = {
  name: string;
  execute: (...args: any[]) => Promise<any>;
};

const createApi = () => {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<any> | any>>();
  const sentMessages: Array<{ content: string; options?: unknown }> = [];

  const api = {
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command);
    },
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    on(name: string, handler: (event: any, ctx: any) => Promise<any> | any) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    sendUserMessage(content: string, options?: unknown) {
      sentMessages.push({ content, options });
    },
  };

  return { api, commands, tools, handlers, sentMessages };
};

const tempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-ext-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  return root;
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("brain-context registers the public commands and internal tools", () => {
  const { api, commands, tools } = createApi();

  brainContext(api as any);

  assert.deepEqual([...commands.keys()].sort(), ["brain-init"]);
  assert.deepEqual([...tools.keys()].sort(), ["brainmaxx_repo_sessions", "brainmaxx_sync_entrypoints"]);
});

test("reflect and ruminate stay package skills instead of extension commands", () => {
  const { api, commands } = createApi();
  const packageSkills = loadSkillsFromDir({
    dir: path.join(packageRoot, "skills"),
    source: "path",
  });

  brainContext(api as any);

  assert.deepEqual([...commands.keys()], ["brain-init"]);
  assert.deepEqual(
    packageSkills.skills.map((skill) => skill.name).sort(),
    ["reflect", "ruminate"],
  );
});

test("/brain-init command creates a project brain", async () => {
  const { api, commands } = createApi();
  const repoRoot = await tempRepo();
  const notifications: Array<{ message: string; level: string | undefined }> = [];

  brainContext(api as any);

  await commands.get("brain-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.ok(await fs.stat(path.join(repoRoot, "brain/index.md")));
  assert.ok(await fs.stat(path.join(repoRoot, "brain/principles.md")));
  assert.equal(notifications.length, 2);
  assert.match(notifications[0]?.message ?? "", /Brain initialized/);
  assert.match(notifications[1]?.message ?? "", /No concise operational content/);
});

test("/brain-init prints a bootstrap preview in non-interactive mode", async () => {
  const { api, commands } = createApi();
  const repoRoot = await tempRepo();
  const output: string[] = [];

  brainContext(api as any);
  await fs.writeFile(path.join(repoRoot, "AGENTS.md"), "- For reconnectable remote work, start with `tmux new-session -A -s beelink`, then run `pi`.\n");

  const originalLog = console.log;
  const originalWarn = console.warn;
  try {
    console.log = (message?: unknown) => output.push(String(message ?? ""));
    console.warn = (message?: unknown) => output.push(String(message ?? ""));
    await commands.get("brain-init")?.handler("", {
      cwd: repoRoot,
      hasUI: false,
      ui: { notify() {} },
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  assert.match(output.join("\n"), /Brain initialized/);
  assert.match(output.join("\n"), /Operational bootstrap preview/);
  assert.match(output.join("\n"), /tmux new-session -A -s beelink/);
  await assert.rejects(fs.access(path.join(repoRoot, "brain/notes")));
});

test("/brain-init applies bootstrap in non-interactive mode with --apply-bootstrap", async () => {
  const { api, commands } = createApi();
  const repoRoot = await tempRepo();
  const output: string[] = [];

  brainContext(api as any);
  await fs.writeFile(path.join(repoRoot, "AGENTS.md"), "- Maestro handles delegated Linear repo work in this repo.\n");

  const originalLog = console.log;
  try {
    console.log = (message?: unknown) => output.push(String(message ?? ""));
    await commands.get("brain-init")?.handler("--apply-bootstrap", {
      cwd: repoRoot,
      hasUI: false,
      ui: { notify() {} },
    });
  } finally {
    console.log = originalLog;
  }

  const notes = await fs.readdir(path.join(repoRoot, "brain/notes"));
  assert.equal(notes.length, 1);
  assert.match(output.join("\n"), /Created brain\/notes\/.+-operations\.md/);
});

test("/brain-init reports unsupported arguments clearly", async () => {
  const { api, commands } = createApi();
  const repoRoot = await tempRepo();
  const notifications: Array<{ message: string; level: string | undefined }> = [];

  brainContext(api as any);

  await commands.get("brain-init")?.handler("--bogus", {
    cwd: repoRoot,
    hasUI: true,
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? "", /Unsupported \/brain-init arguments/);
  assert.equal(notifications[0]?.level, "warning");
});

test("before_agent_start injects the ambient brain context when a brain exists", async () => {
  const { api, commands, handlers } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("brain-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });

  const beforeStart = handlers.get("before_agent_start");
  assert.ok(beforeStart);

  const result = await beforeStart?.[0]?.({}, { cwd: repoRoot });
  assert.equal(result?.message?.customType, "brainmaxx-context");
  assert.match(result?.message?.content ?? "", /# brain\/index\.md/);
  assert.match(result?.message?.content ?? "", /# brain\/principles\.md/);
});

test("brainmaxx_sync_entrypoints tool reports updated entrypoints", async () => {
  const { api, commands, tools } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("brain-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });
  await fs.mkdir(path.join(repoRoot, "brain/notes"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "brain/notes/repeated-pattern.md"), "# Repeated pattern\n");

  const result = await tools.get("brainmaxx_sync_entrypoints")?.execute(
    "tool",
    {},
    undefined,
    undefined,
    { cwd: repoRoot },
  );

  assert.match(result?.content?.[0]?.text ?? "", /Updated: brain\/index\.md/);
});

test("brainmaxx_repo_sessions tool returns repo-scoped session history", async () => {
  const { api, commands, tools } = createApi();
  const repoRoot = await tempRepo();
  const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainmaxx-tool-home-"));
  const sessionsRoot = path.join(homeRoot, ".pi/agent/sessions");
  const sessionFile = path.join(sessionsRoot, "older.jsonl");

  await fs.mkdir(sessionsRoot, { recursive: true });

  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({ type: "session", version: 3, id: "1", timestamp: "2026-03-15T00:00:00.000Z", cwd: repoRoot }),
      JSON.stringify({ type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "Remember this" }] } }),
      JSON.stringify({ type: "message", id: "a1", message: { role: "assistant", content: [{ type: "text", text: "Will do" }], provider: "openai-codex", model: "gpt-5.4" } }),
      "",
    ].join("\n"),
  );

  brainContext(api as any);
  await commands.get("brain-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });

  const originalHome = process.env.HOME;
  process.env.HOME = homeRoot;

  try {
    const result = await tools.get("brainmaxx_repo_sessions")?.execute(
      "tool",
      { maxSessions: 5, maxCharsPerSession: 1000 },
      undefined,
      undefined,
      {
        cwd: repoRoot,
        sessionManager: { getSessionFile: () => undefined },
      },
    );

    assert.match(result?.content?.[0]?.text ?? "", /Sessions: 1/);
    assert.match(result?.content?.[0]?.text ?? "", /User: Remember this/);
  } finally {
    process.env.HOME = originalHome;
  }
});
