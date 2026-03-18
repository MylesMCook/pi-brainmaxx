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

const BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "find", "grep", "ls"];

const createApi = () => {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<any> | any>>();
  const sentMessages: Array<{ message: { customType: string; content: string; display: boolean }; options?: unknown }> = [];
  let activeTools = [...BUILTIN_TOOL_NAMES];

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
    sendUserMessage() {},
    sendMessage(message: { customType: string; content: string; display: boolean }, options?: unknown) {
      sentMessages.push({ message, options });
    },
    appendEntry() {},
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(toolNames: string[]) {
      activeTools = [...toolNames];
    },
    getAllTools() {
      return [
        ...BUILTIN_TOOL_NAMES.map((name) => ({ name, description: `${name} tool` })),
        ...[...tools.values()].map((tool) => ({ name: tool.name, description: tool.name })),
      ];
    },
  };

  return { api, commands, tools, handlers, sentMessages, getActiveTools: () => [...activeTools] };
};

const tempRepo = async (): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-ext-"));
  await fs.writeFile(path.join(root, ".git"), "gitdir: fake\n");
  return root;
};

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const createSessionManager = (options?: {
  branch?: any[];
  entries?: any[];
  header?: { cwd: string; timestamp: string };
  leafId?: string | null;
  sessionFile?: string;
}) => {
  const branch = options?.branch ?? [];
  const entries = options?.entries ?? branch;
  return {
    getBranch() {
      return branch;
    },
    getEntries() {
      return entries;
    },
    getHeader() {
      return options?.header ?? null;
    },
    getLeafId() {
      return options?.leafId ?? null;
    },
    getSessionFile() {
      return options?.sessionFile;
    },
  };
};

const randomId = () => Math.random().toString(16).slice(2, 10);

const branchMessage = (role: string, extra: Record<string, unknown> = {}) => ({
  type: "message",
  id: randomId(),
  parentId: null,
  timestamp: new Date().toISOString(),
  message: {
    role,
    ...extra,
  },
});

test("brain-context registers pi-init and the internal Brainerd tools", () => {
  const { api, commands, tools } = createApi();

  brainContext(api as any);

  assert.deepEqual([...commands.keys()].sort(), ["pi-init"]);
  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      "brainerd_apply_changes",
      "brainerd_current_session",
      "brainerd_get_staged_ruminate",
      "brainerd_repo_sessions",
      "brainerd_stage_ruminate",
      "brainerd_sync_entrypoints",
    ],
  );
});

test("package skills expose the harness-prefixed Pi surfaces", () => {
  const packageSkills = loadSkillsFromDir({
    dir: path.join(packageRoot, "skills"),
    source: "path",
  });

  assert.deepEqual(
    packageSkills.skills.map((skill) => skill.name).sort(),
    ["pi-init", "pi-reflect", "pi-ruminate"],
  );
});

test("/pi-init command creates a project brain", async () => {
  const { api, commands } = createApi();
  const repoRoot = await tempRepo();
  const notifications: Array<{ message: string; level: string | undefined }> = [];

  brainContext(api as any);

  await commands.get("pi-init")?.handler("", {
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

test("/pi-init prints a bootstrap preview in non-interactive mode", async () => {
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
    await commands.get("pi-init")?.handler("", {
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

test("/pi-init reports unsupported arguments clearly", async () => {
  const { api, commands } = createApi();
  const repoRoot = await tempRepo();
  const notifications: Array<{ message: string; level: string | undefined }> = [];

  brainContext(api as any);

  await commands.get("pi-init")?.handler("--bogus", {
    cwd: repoRoot,
    hasUI: true,
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications.length, 1);
  assert.match(notifications[0]?.message ?? "", /Unsupported \/pi-init arguments/);
  assert.equal(notifications[0]?.level, "warning");
});

test("before_agent_start injects the ambient brain context when a brain exists", async () => {
  const { api, commands, handlers } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("pi-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });

  const beforeStart = handlers.get("before_agent_start");
  assert.ok(beforeStart);

  const result = await beforeStart?.[0]?.({}, { cwd: repoRoot, sessionManager: createSessionManager(), hasUI: false, ui: { notify() {} } });
  assert.equal(result?.message?.customType, "brainerd-context");
  assert.match(result?.message?.content ?? "", /# brain\/index\.md/);
  assert.match(result?.message?.content ?? "", /# brain\/principles\.md/);
});

test("input hook rewrites /pi-reflect to /skill:pi-reflect and narrows tools for the run", async () => {
  const { api, handlers, getActiveTools } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);

  const inputHandler = handlers.get("input")?.[0];
  const result = await inputHandler?.(
    { text: "/pi-reflect", source: "interactive" },
    { cwd: repoRoot, isIdle: () => true, hasUI: true, sessionManager: createSessionManager({ leafId: "leaf-1" }), ui: { notify() {} } },
  );

  assert.deepEqual(result, { action: "transform", text: "/skill:pi-reflect" });
  assert.deepEqual(getActiveTools().sort(), ["brainerd_apply_changes", "brainerd_current_session", "find", "grep", "read"]);
});

test("input hook rewrites /pi-ruminate to /skill:pi-ruminate and restores tools after agent_end", async () => {
  const { api, handlers, getActiveTools, sentMessages } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);

  const inputHandler = handlers.get("input")?.[0];
  const endHandler = handlers.get("agent_end")?.[0];
  const result = await inputHandler?.(
    { text: "/pi-ruminate", source: "interactive" },
    { cwd: repoRoot, isIdle: () => true, hasUI: true, sessionManager: createSessionManager({ leafId: "leaf-2" }), ui: { notify() {} } },
  );

  assert.deepEqual(result, { action: "transform", text: "/skill:pi-ruminate" });
  assert.deepEqual(getActiveTools().sort(), ["brainerd_repo_sessions", "brainerd_stage_ruminate", "find", "grep", "read"]);

  await endHandler?.({ messages: [{ role: "assistant", content: [{ type: "text", text: "Done" }] }] }, { hasUI: true });

  assert.deepEqual(getActiveTools(), BUILTIN_TOOL_NAMES);
  assert.match(sentMessages[0]?.message.content ?? "", /Brainerd summary:/);
});

test("brainerd internal tools are blocked outside explicit Pi skill runs", async () => {
  const { api, handlers } = createApi();
  brainContext(api as any);

  const result = await handlers.get("tool_call")?.[0]?.({ toolName: "brainerd_apply_changes" }, {});

  assert.deepEqual(result, {
    block: true,
    reason: "brainerd internal tool brainerd_apply_changes is only available during an explicit /pi-reflect or /pi-ruminate run.",
  });
});

test("brainerd_current_session returns the pre-invocation branch transcript", async () => {
  const { api, handlers, tools } = createApi();
  const repoRoot = await tempRepo();
  brainContext(api as any);

  const branch = [
    branchMessage("user", { content: [{ type: "text", text: "Remember this workflow" }] }),
    branchMessage("assistant", {
      content: [{ type: "text", text: "I will remember it." }],
      provider: "openai",
      model: "gpt-5.4",
    }),
    branchMessage("toolResult", {
      toolName: "read",
      content: [{ type: "text", text: "brain/index.md contents" }],
      isError: false,
    }),
  ];

  await handlers.get("input")?.[0]?.(
    { text: "/pi-reflect", source: "interactive" },
    { cwd: repoRoot, isIdle: () => true, hasUI: true, sessionManager: createSessionManager({ branch, leafId: "leaf-3" }), ui: { notify() {} } },
  );

  const result = await tools.get("brainerd_current_session")?.execute("tool", {}, undefined, undefined, {
    cwd: repoRoot,
    sessionManager: createSessionManager({
      branch,
      header: { cwd: repoRoot, timestamp: "2026-03-16T00:00:00.000Z" },
      leafId: "leaf-3",
    }),
  });

  assert.match(result?.content?.[0]?.text ?? "", /User: Remember this workflow/);
  assert.match(result?.content?.[0]?.text ?? "", /Assistant: I will remember it\./);
  assert.match(result?.content?.[0]?.text ?? "", /Tool read result: brain\/index\.md contents/);
});

test("brainerd_repo_sessions returns repo-scoped Pi session history", async () => {
  const { api, commands, tools } = createApi();
  const repoRoot = await tempRepo();
  const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-brainerd-tool-home-"));
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
  await commands.get("pi-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });

  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalHomeDrive = process.env.HOMEDRIVE;
  const originalHomePath = process.env.HOMEPATH;
  process.env.HOME = homeRoot;
  process.env.USERPROFILE = homeRoot;
  process.env.HOMEDRIVE = path.parse(homeRoot).root.replace(/\\$/, "").slice(0, 2);
  process.env.HOMEPATH = homeRoot.slice(process.env.HOMEDRIVE.length);
  try {
    const result = await tools.get("brainerd_repo_sessions")?.execute(
      "tool",
      { maxSessions: 5, maxCharsPerSession: 1000 },
      undefined,
      undefined,
      {
        cwd: repoRoot,
        sessionManager: createSessionManager(),
      },
    );

    assert.match(result?.content?.[0]?.text ?? "", /Sessions: 1/);
    assert.match(result?.content?.[0]?.text ?? "", /User: Remember this/);
  } finally {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.env.HOMEDRIVE = originalHomeDrive;
    process.env.HOMEPATH = originalHomePath;
  }
});

test("brainerd_stage_ruminate writes the Pi stage file and confirm transforms into apply mode", async () => {
  const { api, commands, handlers, tools, getActiveTools } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("pi-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });

  const stageResult = await tools.get("brainerd_stage_ruminate")?.execute(
    "tool",
    {
      findingsSummary: "Remote workflow was repeated across sessions.",
      rationale: "This is durable operating knowledge.",
      changes: [{ path: "brain/notes/remote-workflow.md", content: "# Remote Workflow\n\nUse tmux first.\n" }],
    },
    undefined,
    undefined,
    { cwd: repoRoot },
  );

  assert.match(stageResult?.content?.[0]?.text ?? "", /Staged rumination preview/);
  assert.ok(await fs.stat(path.join(repoRoot, "brain/.pi-ruminate-stage.json")));

  const result = await handlers.get("input")?.[0]?.(
    { text: "yes", source: "interactive" },
    {
      cwd: repoRoot,
      isIdle: () => true,
      hasUI: true,
      sessionManager: createSessionManager({ leafId: "leaf-4" }),
      ui: { notify() {} },
    },
  );

  assert.deepEqual(result, { action: "transform", text: "/skill:pi-ruminate" });
  assert.deepEqual(getActiveTools().sort(), ["brainerd_apply_changes", "brainerd_get_staged_ruminate", "find", "grep", "read"]);
});

test("ruminate reject follow-up discards the staged Pi preview without a model turn", async () => {
  const { api, commands, handlers, sentMessages, tools } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("pi-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });
  await tools.get("brainerd_stage_ruminate")?.execute(
    "tool",
    {
      findingsSummary: "Remote workflow repeated.",
      rationale: "Durable.",
      changes: [{ path: "brain/notes/remote-workflow.md", content: "# Remote Workflow\n" }],
    },
    undefined,
    undefined,
    { cwd: repoRoot },
  );

  const result = await handlers.get("input")?.[0]?.(
    { text: "no", source: "interactive" },
    {
      cwd: repoRoot,
      isIdle: () => true,
      hasUI: true,
      sessionManager: createSessionManager(),
      ui: { notify() {} },
    },
  );

  assert.deepEqual(result, { action: "handled" });
  assert.match(sentMessages[0]?.message.content ?? "", /no brain changes were written/i);
});

test("ruminate confirm follow-up in print mode stays preview-only", async () => {
  const { api, commands, handlers, tools } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("pi-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });
  await tools.get("brainerd_stage_ruminate")?.execute(
    "tool",
    {
      findingsSummary: "Durable pattern found.",
      rationale: "Durable.",
      changes: [{ path: "brain/notes/example.md", content: "# Example\n" }],
    },
    undefined,
    undefined,
    { cwd: repoRoot },
  );

  const output: string[] = [];
  const originalLog = console.log;
  let result: unknown;
  try {
    console.log = (message?: unknown) => output.push(String(message ?? ""));
    result = await handlers.get("input")?.[0]?.(
      { text: "yes", source: "interactive" },
      {
        cwd: repoRoot,
        isIdle: () => true,
        hasUI: false,
        sessionManager: createSessionManager(),
        ui: { notify() {} },
      },
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(result, { action: "handled" });
  assert.match(output.join("\n"), /pi -p \"\/pi-ruminate\" has no apply step/i);
  assert.match(output.join("\n"), /no brain changes were written/i);
});

test("brainerd_apply_changes applies a staged Pi rumination preview and syncs entrypoints", async () => {
  const { api, commands, tools } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("pi-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });

  const staged = await tools.get("brainerd_stage_ruminate")?.execute(
    "tool",
    {
      findingsSummary: "Remote workflow repeated.",
      rationale: "Durable.",
      changes: [{ path: "brain/notes/remote-workflow.md", content: "# Remote Workflow\n\nUse tmux first.\n" }],
    },
    undefined,
    undefined,
    { cwd: repoRoot },
  );

  const result = await tools.get("brainerd_apply_changes")?.execute(
    "tool",
    { stageId: staged?.details?.stageId },
    undefined,
    undefined,
    {
      cwd: repoRoot,
      sessionManager: createSessionManager(),
    },
  );

  assert.match(result?.content?.[0]?.text ?? "", /Changed: brain\/notes\/remote-workflow\.md/);
  assert.ok(await fs.stat(path.join(repoRoot, "brain/notes/remote-workflow.md")));
});

test("brainerd_apply_changes rejects paths outside brain notes and principles", async () => {
  const { api, commands, tools } = createApi();
  const repoRoot = await tempRepo();

  brainContext(api as any);
  await commands.get("pi-init")?.handler("", {
    cwd: repoRoot,
    hasUI: true,
    ui: { notify() {} },
  });

  const applyTool = tools.get("brainerd_apply_changes");
  assert.ok(applyTool);

  await assert.rejects(
    applyTool.execute(
      "tool",
      { changes: [{ path: "README.md", content: "# nope\n" }] },
      undefined,
      undefined,
      { cwd: repoRoot, sessionManager: createSessionManager() },
    ),
    /brain\/notes\/ or brain\/principles\//,
  );
});
