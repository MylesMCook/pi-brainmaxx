import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initBrain, syncOwnedEntryPoints } from "./brain.js";
import { applyOperationalBootstrap, planOperationalBootstrap, } from "./bootstrap.js";
import { syncClaudeMemoryImports } from "./claude-memory.js";
import { CLAUDE_PROJECT_HOOK_FILE, CLAUDE_PROJECT_SETTINGS_FILE, CLAUDE_SHIM_FILE, } from "./constants.js";
import { planCodexAgentsUpdate, upsertCodexAgentsBlock } from "./codex-agents.js";
import { readFileIfPresent, resolveSafeRepoPath } from "./fs-helpers.js";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.basename(moduleDir) === "src" && path.basename(path.dirname(moduleDir)) === "dist"
    ? path.dirname(path.dirname(moduleDir))
    : path.dirname(moduleDir);
const CLAUDE_SESSION_START_TEMPLATE = path.join(packageRoot, "scripts", "brainerd-claude-session-start.mjs");
const normalizeTrailingNewline = (content) => (content.endsWith("\n") ? content : `${content}\n`);
const renderClaudeShim = () => normalizeTrailingNewline([
    "Follow whats in described in AGENTS.md",
    "",
    "@AGENTS.md",
].join("\n"));
const updateTextFile = (current, next, relativePath) => ({
    status: current === null ? "created" : current === next ? "unchanged" : "updated",
    path: relativePath,
    content: next,
});
const upsertTextFile = async (projectRoot, relativePath, next) => {
    const target = await resolveSafeRepoPath(projectRoot, relativePath);
    const current = await readFileIfPresent(target);
    const updated = updateTextFile(current, next, relativePath);
    if (current !== updated.content) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, updated.content);
    }
    return updated;
};
const updateClaudeSettingsContent = (content) => {
    const relativePath = CLAUDE_PROJECT_SETTINGS_FILE;
    const command = "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/brainerd-session-start.mjs\"";
    const parsed = content ? JSON.parse(content) : {};
    const root = parsed && typeof parsed === "object" ? { ...parsed } : {};
    const hooksRoot = root.hooks && typeof root.hooks === "object" ? { ...root.hooks } : {};
    const sessionStartGroups = Array.isArray(hooksRoot.SessionStart) ? [...hooksRoot.SessionStart] : [];
    const hasCommand = sessionStartGroups.some((group) => {
        if (!group || typeof group !== "object") {
            return false;
        }
        const hooks = group.hooks;
        return Array.isArray(hooks) && hooks.some((hook) => {
            if (!hook || typeof hook !== "object") {
                return false;
            }
            return hook.type === "command" &&
                hook.command === command;
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
const upsertClaudeSettings = async (projectRoot) => {
    const target = await resolveSafeRepoPath(projectRoot, CLAUDE_PROJECT_SETTINGS_FILE);
    const current = await readFileIfPresent(target);
    const updated = updateClaudeSettingsContent(current);
    if (current !== updated.content) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, updated.content);
    }
    return updated;
};
const upsertClaudeHookScript = async (projectRoot) => {
    const template = await fs.readFile(CLAUDE_SESSION_START_TEMPLATE, "utf8");
    return upsertTextFile(projectRoot, CLAUDE_PROJECT_HOOK_FILE, normalizeTrailingNewline(template));
};
const runClaudeSync = async (projectRoot) => {
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
export const initClaudeBrain = async (projectRoot, options = {}) => {
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
export const syncClaudeBrain = async (projectRoot) => runClaudeSync(projectRoot);
