import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initBrain, syncOwnedEntryPoints, type BrainInitResult, type BrainSyncResult } from "./brain.js";
import {
  applyOperationalBootstrap,
  planOperationalBootstrap,
  type OperationalBootstrapApplyResult,
  type OperationalBootstrapPlan,
} from "./bootstrap.js";
import { syncClaudeMemoryImports, type ClaudeMemorySyncResult } from "./claude-memory.js";
import {
  CLAUDE_PROJECT_HOOK_FILE,
  CLAUDE_PROJECT_SETTINGS_FILE,
  CLAUDE_SHIM_FILE,
} from "./constants.js";
import { planCodexAgentsUpdate, upsertCodexAgentsBlock, type CodexAgentsUpdateResult } from "./codex-agents.js";
import { readFileIfPresent, resolveSafeRepoPath } from "./fs-helpers.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot =
  path.basename(moduleDir) === "src" && path.basename(path.dirname(moduleDir)) === "dist"
    ? path.dirname(path.dirname(moduleDir))
    : path.dirname(moduleDir);
const CLAUDE_SESSION_START_TEMPLATE = path.join(packageRoot, "scripts", "brainerd-claude-session-start.mjs");

type FileUpdateResult = {
  status: "created" | "updated" | "unchanged";
  path: string;
  content: string;
};

export type ClaudeInitOptions = {
  applyBootstrap?: boolean;
};

export type ClaudeSyncResult = {
  projectRoot: string;
  brain: BrainSyncResult;
  agents: CodexAgentsUpdateResult;
  shim: FileUpdateResult;
  hookScript: FileUpdateResult;
  settings: FileUpdateResult;
  memory: ClaudeMemorySyncResult;
};

export type ClaudeInitResult = ClaudeSyncResult & {
  brainInit: BrainInitResult;
  bootstrap: OperationalBootstrapPlan | OperationalBootstrapApplyResult;
};

const normalizeTrailingNewline = (content: string): string => (content.endsWith("\n") ? content : `${content}\n`);

const renderClaudeShim = (): string =>
  normalizeTrailingNewline(
    [
      "Follow whats in described in AGENTS.md",
      "",
      "@AGENTS.md",
    ].join("\n"),
  );

const updateTextFile = (current: string | null, next: string, relativePath: string): FileUpdateResult => ({
  status: current === null ? "created" : current === next ? "unchanged" : "updated",
  path: relativePath,
  content: next,
});

const upsertTextFile = async (projectRoot: string, relativePath: string, next: string): Promise<FileUpdateResult> => {
  const target = await resolveSafeRepoPath(projectRoot, relativePath);
  const current = await readFileIfPresent(target);
  const updated = updateTextFile(current, next, relativePath);
  if (current !== updated.content) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, updated.content);
  }
  return updated;
};

const updateClaudeSettingsContent = (content: string | null): FileUpdateResult => {
  const relativePath = CLAUDE_PROJECT_SETTINGS_FILE;
  const command = "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/brainerd-session-start.mjs\"";
  const parsed = content ? JSON.parse(content) as Record<string, unknown> : {};
  const root = parsed && typeof parsed === "object" ? { ...parsed } : {};
  const hooksRoot = root.hooks && typeof root.hooks === "object" ? { ...(root.hooks as Record<string, unknown>) } : {};
  const sessionStartGroups = Array.isArray(hooksRoot.SessionStart) ? [...(hooksRoot.SessionStart as unknown[])] : [];

  const hasCommand = sessionStartGroups.some((group) => {
    if (!group || typeof group !== "object") {
      return false;
    }
    const hooks = (group as { hooks?: unknown }).hooks;
    return Array.isArray(hooks) && hooks.some((hook) => {
      if (!hook || typeof hook !== "object") {
        return false;
      }
      return (hook as { type?: unknown; command?: unknown }).type === "command" &&
        (hook as { command?: unknown }).command === command;
    });
  });

  if (!hasCommand) {
    sessionStartGroups.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command,
        },
      ],
    });
  }

  hooksRoot.SessionStart = sessionStartGroups;
  root.hooks = hooksRoot;

  const next = `${JSON.stringify(root, null, 2)}\n`;
  return updateTextFile(content, next, relativePath);
};

const upsertClaudeSettings = async (projectRoot: string): Promise<FileUpdateResult> => {
  const target = await resolveSafeRepoPath(projectRoot, CLAUDE_PROJECT_SETTINGS_FILE);
  const current = await readFileIfPresent(target);
  const updated = updateClaudeSettingsContent(current);
  if (current !== updated.content) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, updated.content);
  }
  return updated;
};

const upsertClaudeHookScript = async (projectRoot: string): Promise<FileUpdateResult> => {
  const template = await fs.readFile(CLAUDE_SESSION_START_TEMPLATE, "utf8");
  return upsertTextFile(projectRoot, CLAUDE_PROJECT_HOOK_FILE, normalizeTrailingNewline(template));
};

const runClaudeSync = async (projectRoot: string): Promise<ClaudeSyncResult> => {
  const agents = await upsertCodexAgentsBlock(projectRoot);
  const shim = await upsertTextFile(projectRoot, CLAUDE_SHIM_FILE, renderClaudeShim());
  const hookScript = await upsertClaudeHookScript(projectRoot);
  const settings = await upsertClaudeSettings(projectRoot);
  const memory = await syncClaudeMemoryImports(projectRoot);
  const brain = await syncOwnedEntryPoints(projectRoot);

  return {
    projectRoot,
    brain,
    agents,
    shim,
    hookScript,
    settings,
    memory,
  };
};

export const initClaudeBrain = async (
  projectRoot: string,
  options: ClaudeInitOptions = {},
): Promise<ClaudeInitResult> => {
  await planCodexAgentsUpdate(projectRoot);
  const brainInit = await initBrain(projectRoot);
  const sync = await runClaudeSync(projectRoot);
  const bootstrap = options.applyBootstrap
    ? await applyOperationalBootstrap(projectRoot)
    : await planOperationalBootstrap(projectRoot);

  return {
    ...sync,
    brainInit,
    bootstrap,
  };
};

export const syncClaudeBrain = async (projectRoot: string): Promise<ClaudeSyncResult> => runClaudeSync(projectRoot);
