import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { applyOperationalBootstrap, planOperationalBootstrap } from "../src/bootstrap.js";
import { applyBrainChanges, initBrain, readEntrypoints, syncOwnedEntryPoints, } from "../src/brain.js";
import { collectCurrentSessionSnapshot } from "../src/current-session.js";
import { buildInjectedBrainMessage } from "../src/injection.js";
import { findGitRoot, resolveProjectRoot } from "../src/project-root.js";
import { collectRepoSessions } from "../src/sessions.js";
const APPLY_BOOTSTRAP_FLAG = "--apply-bootstrap";
const BRAINTYPE_CONTEXT = "brainerd-context";
const BRAINTYPE_STATUS = "brainerd-status";
const BRAINTYPE_STAGE = "brainerd-ruminate-stage";
const SUMMARY_MARKER = "Brainerd summary:";
const BUILTIN_DEFAULT_TOOLS = ["read", "bash", "edit", "write", "find", "grep", "ls"];
const REFLECT_TOOLS = ["read", "find", "grep", "brainerd_current_session", "brainerd_apply_changes"];
const RUMINATE_PREVIEW_TOOLS = ["read", "find", "grep", "brainerd_repo_sessions", "brainerd_stage_ruminate"];
const RUMINATE_APPLY_TOOLS = ["read", "find", "grep", "brainerd_get_staged_ruminate", "brainerd_apply_changes"];
const BLOCKED_RUN_TOOLS = new Set(["write", "edit", "bash"]);
const INTERNAL_BRAINERD_TOOLS = new Set([
    "brainerd_sync_entrypoints",
    "brainerd_current_session",
    "brainerd_repo_sessions",
    "brainerd_stage_ruminate",
    "brainerd_get_staged_ruminate",
    "brainerd_apply_changes",
]);
const CONFIRM_PHRASES = new Set(["yes", "apply it", "apply those findings", "go ahead", "confirm"]);
const REJECT_PHRASES = new Set(["no", "cancel", "discard", "dont apply", "don't apply"]);
const report = (message, level, ctx) => {
    if (ctx.hasUI) {
        ctx.ui.notify(message, level);
        return;
    }
    if (level === "error") {
        console.error(message);
        return;
    }
    if (level === "warning") {
        console.warn(message);
        return;
    }
    console.log(message);
};
const parseBrainInitArgs = (args) => {
    const tokens = args
        .trim()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
    if (tokens.length === 0) {
        return { applyBootstrap: false };
    }
    if (tokens.length === 1 && tokens[0] === APPLY_BOOTSTRAP_FLAG) {
        return { applyBootstrap: true };
    }
    throw new Error(`Unsupported /brain-init arguments: ${tokens.join(" ")}. Supported: ${APPLY_BOOTSTRAP_FLAG}`);
};
const formatBrainInitSummary = (projectRoot, created, synced) => {
    const createdLabel = created.length > 0 ? created.join(", ") : "nothing new";
    const syncedLabel = synced.length > 0 ? synced.join(", ") : "none";
    return `Brain initialized at ${path.join(projectRoot, "brain")} (${createdLabel}). Synced: ${syncedLabel}.`;
};
const formatBootstrapPreview = (noteRelativePath, sourceFiles, content) => {
    const lines = [
        `Operational bootstrap preview for ${noteRelativePath}`,
        sourceFiles.length > 0 ? `Sources: ${sourceFiles.join(", ")}` : "Sources: none",
        "",
        content.trim(),
    ];
    return lines.join("\n");
};
const normalizeReply = (text) => text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
const getToolsForMode = (mode) => {
    if (mode === "reflect") {
        return REFLECT_TOOLS;
    }
    if (mode === "ruminate-preview") {
        return RUMINATE_PREVIEW_TOOLS;
    }
    return RUMINATE_APPLY_TOOLS;
};
const parseSkillInvocation = (text) => {
    const trimmed = text.trim();
    if (/^\/reflect(?:\s+.*)?$/u.test(trimmed)) {
        const args = trimmed.slice("/reflect".length).trim();
        return { mode: "reflect", transformed: `/skill:reflect${args ? ` ${args}` : ""}` };
    }
    if (/^\/skill:reflect(?:\s+.*)?$/u.test(trimmed)) {
        return { mode: "reflect", transformed: null };
    }
    if (/^\/ruminate(?:\s+.*)?$/u.test(trimmed)) {
        const args = trimmed.slice("/ruminate".length).trim();
        return { mode: "ruminate-preview", transformed: `/skill:ruminate${args ? ` ${args}` : ""}` };
    }
    if (/^\/skill:ruminate(?:\s+.*)?$/u.test(trimmed)) {
        return { mode: "ruminate-preview", transformed: null };
    }
    return null;
};
const textFromContent = (content) => {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content
        .filter((part) => Boolean(part && typeof part === "object"))
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text ?? "")
        .join("\n");
};
const lastAssistantText = (messages) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === "assistant") {
            return textFromContent(message.content).trim();
        }
    }
    return "";
};
const getLatestRuminateStage = (entries) => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.type !== "custom" || entry.customType !== BRAINTYPE_STAGE) {
            continue;
        }
        const data = entry.data;
        if (!data ||
            typeof data.stageId !== "string" ||
            typeof data.repoRoot !== "string" ||
            typeof data.createdAt !== "string" ||
            typeof data.findingsSummary !== "string" ||
            typeof data.rationale !== "string" ||
            !Array.isArray(data.changes) ||
            (data.status !== "staged" && data.status !== "applied" && data.status !== "discarded")) {
            continue;
        }
        return {
            stageId: data.stageId,
            repoRoot: data.repoRoot,
            createdAt: data.createdAt,
            findingsSummary: data.findingsSummary,
            rationale: data.rationale,
            changes: data.changes
                .filter((change) => Boolean(change && typeof change.path === "string" && typeof change.content === "string"))
                .map((change) => ({ path: change.path, content: change.content })),
            status: data.status,
            changedFiles: Array.isArray(data.changedFiles) ? data.changedFiles.filter((item) => typeof item === "string") : [],
            syncedFiles: Array.isArray(data.syncedFiles) ? data.syncedFiles.filter((item) => typeof item === "string") : [],
        };
    }
    return null;
};
const emitStatus = (pi, content, hasUI = true) => {
    if (!hasUI) {
        console.log(content);
        return;
    }
    pi.sendMessage({
        customType: BRAINTYPE_STATUS,
        content,
        display: true,
    }, { triggerTurn: false });
};
const formatRunSummary = (result) => {
    if (!result) {
        return [
            SUMMARY_MARKER,
            "- no validated brain changes were written",
            "- Pi did not emit the expected summary, so this fallback was generated by the extension",
        ].join("\n");
    }
    const lines = [SUMMARY_MARKER];
    if (result.previewOnly) {
        lines.push("- preview-only: yes");
        lines.push("- no brain changes were written");
        return lines.join("\n");
    }
    lines.push(`- changes written: ${result.written ? "yes" : "no"}`);
    lines.push(`- changed files: ${result.changedFiles.length > 0 ? result.changedFiles.join(", ") : "none"}`);
    if (result.syncedFiles.length > 0) {
        lines.push(`- synced entrypoints: ${result.syncedFiles.join(", ")}`);
    }
    return lines.join("\n");
};
const renderRunInstructions = (mode, stage) => {
    if (mode === "reflect") {
        return [
            "[brainerd reflect run]",
            "Use only read/find/grep plus brainerd_current_session and brainerd_apply_changes.",
            "Do not use generic write, edit, or bash tools.",
            "Decide the smallest durable brain change, apply it with brainerd_apply_changes, and end with a visible section that starts exactly with 'Brainerd summary:'.",
        ].join("\n");
    }
    if (mode === "ruminate-preview") {
        return [
            "[brainerd ruminate preview run]",
            "Use brainerd_repo_sessions, then stage a preview with brainerd_stage_ruminate.",
            "Do not write directly to files in this phase.",
            "End with a visible section that starts exactly with 'Brainerd summary:' and state explicitly that no brain changes were written yet.",
        ].join("\n");
    }
    return [
        "[brainerd ruminate apply run]",
        stage ? `Apply exactly staged preview ${stage.stageId}.` : "If no staged preview exists, stop and report that no brain changes were written.",
        "Call brainerd_get_staged_ruminate first, then apply that staged proposal with brainerd_apply_changes.",
        "Do not invent new changes in apply mode.",
        "End with a visible section that starts exactly with 'Brainerd summary:'.",
    ].join("\n");
};
const createStageEntry = (projectRoot, summary, rationale, changes) => ({
    stageId: randomUUID(),
    repoRoot: projectRoot,
    createdAt: new Date().toISOString(),
    findingsSummary: summary.trim(),
    rationale: rationale.trim(),
    changes: changes.map((change) => ({ path: change.path, content: change.content })),
    status: "staged",
});
export default function brainContext(pi) {
    let activeRun = null;
    const restoreTools = () => {
        if (!activeRun) {
            return;
        }
        pi.setActiveTools(activeRun.previousTools);
    };
    const startRun = (mode, ctx) => {
        const previousTools = pi.getActiveTools?.() ?? BUILTIN_DEFAULT_TOOLS;
        const anchorEntryId = mode === "reflect" ? (ctx.sessionManager.getLeafId?.() ?? null) : null;
        activeRun = {
            mode,
            previousTools,
            anchorEntryId,
            result: null,
        };
        pi.setActiveTools(getToolsForMode(mode));
    };
    pi.registerCommand("brain-init", {
        description: "Initialize a project-local brain in the current repo",
        getArgumentCompletions: (prefix) => {
            if (APPLY_BOOTSTRAP_FLAG.startsWith(prefix)) {
                return [{ value: APPLY_BOOTSTRAP_FLAG, label: `${APPLY_BOOTSTRAP_FLAG} - write the proposed operations note` }];
            }
            return null;
        },
        handler: async (args, ctx) => {
            try {
                const { applyBootstrap } = parseBrainInitArgs(args);
                const gitRoot = await findGitRoot(ctx.cwd);
                const projectRoot = await resolveProjectRoot(ctx.cwd);
                const result = await initBrain(projectRoot);
                if (!gitRoot) {
                    report("No .git directory was found. /brain-init used the current directory as the project root.", "warning", ctx);
                }
                report(formatBrainInitSummary(projectRoot, result.created, result.synced), "info", ctx);
                const bootstrap = await planOperationalBootstrap(projectRoot);
                if (bootstrap.status !== "ready") {
                    report(bootstrap.reason, bootstrap.status === "exists" ? "info" : "warning", ctx);
                    return;
                }
                const preview = formatBootstrapPreview(bootstrap.noteRelativePath, bootstrap.sourceFiles, bootstrap.content);
                if (!ctx.hasUI) {
                    console.log(preview);
                    if (!applyBootstrap) {
                        console.log(`Re-run /brain-init ${APPLY_BOOTSTRAP_FLAG} to create this note.`);
                        return;
                    }
                    const applied = await applyOperationalBootstrap(projectRoot);
                    if (applied.status === "created") {
                        console.log(`Created ${applied.noteRelativePath} from ${applied.sourceFiles.join(", ")}. Synced: ${applied.synced.join(", ") || "none"}.`);
                        return;
                    }
                    console.warn(applied.reason);
                    return;
                }
                const confirmed = await ctx.ui.confirm("Apply operational bootstrap?", preview);
                if (!confirmed) {
                    report(`Operational bootstrap previewed for ${bootstrap.noteRelativePath}.`, "info", ctx);
                    return;
                }
                const applied = await applyOperationalBootstrap(projectRoot);
                if (applied.status === "created") {
                    report(`Created ${applied.noteRelativePath} from ${applied.sourceFiles.join(", ")}. Synced: ${applied.synced.join(", ") || "none"}.`, "info", ctx);
                    return;
                }
                report(applied.reason, applied.status === "exists" ? "info" : "warning", ctx);
            }
            catch (error) {
                const message = error.message;
                if (message.startsWith("Unsupported /brain-init arguments:")) {
                    report(message, "warning", ctx);
                    return;
                }
                report(`pi-brainerd failed to initialize the brain: ${message}`, "error", ctx);
            }
        },
    });
    pi.on("input", async (event, ctx) => {
        if (event.source === "extension") {
            return { action: "continue" };
        }
        const sessionManager = ctx.sessionManager;
        const staged = getLatestRuminateStage(sessionManager.getBranch());
        const normalized = normalizeReply(event.text);
        const skillInvocation = parseSkillInvocation(event.text);
        if ((!ctx.isIdle() && skillInvocation) || (!ctx.isIdle() && staged && (CONFIRM_PHRASES.has(normalized) || REJECT_PHRASES.has(normalized)))) {
            emitStatus(pi, "Brainerd runs must start when Pi is idle. Wait for the current turn to finish, then try again.", ctx.hasUI);
            return { action: "handled" };
        }
        if (staged?.status === "staged") {
            if (CONFIRM_PHRASES.has(normalized)) {
                if (!ctx.hasUI) {
                    emitStatus(pi, [
                        SUMMARY_MARKER,
                        "- preview-only: yes",
                        '- pi -p "/ruminate" has no apply step',
                        "- no brain changes were written",
                    ].join("\n"), ctx.hasUI);
                    return { action: "handled" };
                }
                startRun("ruminate-apply", { sessionManager });
                return { action: "transform", text: "/skill:ruminate" };
            }
            if (REJECT_PHRASES.has(normalized)) {
                pi.appendEntry(BRAINTYPE_STAGE, { ...staged, status: "discarded" });
                emitStatus(pi, `${SUMMARY_MARKER}\n- preview-only: yes\n- no brain changes were written`, ctx.hasUI);
                return { action: "handled" };
            }
        }
        if (!skillInvocation) {
            return { action: "continue" };
        }
        startRun(skillInvocation.mode, { sessionManager });
        if (skillInvocation.transformed) {
            return { action: "transform", text: skillInvocation.transformed };
        }
        return { action: "continue" };
    });
    pi.on("before_agent_start", async (_event, ctx) => {
        try {
            const projectRoot = await resolveProjectRoot(ctx.cwd);
            const entrypoints = await readEntrypoints(projectRoot);
            const parts = [];
            if (entrypoints) {
                parts.push(buildInjectedBrainMessage(entrypoints.index, entrypoints.principles).content);
            }
            if (activeRun) {
                const stage = activeRun.mode === "ruminate-apply"
                    ? getLatestRuminateStage(ctx.sessionManager.getBranch())
                    : null;
                parts.push(renderRunInstructions(activeRun.mode, stage));
            }
            if (parts.length === 0) {
                return;
            }
            return {
                message: {
                    customType: BRAINTYPE_CONTEXT,
                    content: parts.join("\n\n---\n\n"),
                    display: false,
                },
            };
        }
        catch (error) {
            if (ctx.hasUI) {
                ctx.ui.notify(`pi-brainerd skipped ambient brain loading: ${error.message}`, "warning");
            }
            console.warn(`pi-brainerd skipped ambient brain loading: ${error.message}`);
            return;
        }
    });
    pi.on("tool_call", async (event) => {
        if (!activeRun && INTERNAL_BRAINERD_TOOLS.has(event.toolName)) {
            return {
                block: true,
                reason: `brainerd internal tool ${event.toolName} is only available during an explicit /reflect or /ruminate run.`,
            };
        }
        if (!activeRun) {
            return;
        }
        const allowedTools = new Set(getToolsForMode(activeRun.mode));
        if (!allowedTools.has(event.toolName)) {
            return {
                block: true,
                reason: `brainerd skill run active: ${event.toolName} is not available in ${activeRun.mode}.`,
            };
        }
        if (BLOCKED_RUN_TOOLS.has(event.toolName)) {
            return {
                block: true,
                reason: `brainerd skill run active: ${event.toolName} is blocked. Use the brainerd tools instead.`,
            };
        }
    });
    pi.on("agent_end", async (event, ctx) => {
        if (!activeRun) {
            return;
        }
        const completedRun = activeRun;
        restoreTools();
        activeRun = null;
        if (lastAssistantText(event.messages).includes(SUMMARY_MARKER)) {
            return;
        }
        emitStatus(pi, formatRunSummary(completedRun.result), ctx?.hasUI ?? true);
    });
    pi.registerTool({
        name: "brainerd_sync_entrypoints",
        label: "Sync brain entrypoints",
        description: "Regenerate package-owned brain entrypoints after approved brain changes",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const projectRoot = await resolveProjectRoot(ctx.cwd);
            const result = await syncOwnedEntryPoints(projectRoot);
            const lines = [
                `Repo root: ${projectRoot}`,
                `Updated: ${result.updated.length > 0 ? result.updated.join(", ") : "none"}`,
                `Skipped: ${result.skipped.length > 0 ? result.skipped.join(", ") : "none"}`,
            ];
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                details: result,
            };
        },
    });
    pi.registerTool({
        name: "brainerd_current_session",
        label: "Current Pi session",
        description: "Return a normalized transcript of the current Pi session before the active reflect invocation",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const snapshot = collectCurrentSessionSnapshot(ctx.sessionManager, activeRun?.anchorEntryId ?? null);
            const lines = [
                `cwd: ${snapshot.cwd || ctx.cwd}`,
                `startedAt: ${snapshot.startedAt || "unknown"}`,
                `messages: ${snapshot.messageCount}`,
                `models: ${snapshot.assistantModels.length > 0 ? snapshot.assistantModels.join(", ") : "unknown"}`,
                "",
                snapshot.transcript || "[brainerd] No readable current-session transcript was found before this reflect invocation.",
            ];
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                details: snapshot,
            };
        },
    });
    pi.registerTool({
        name: "brainerd_repo_sessions",
        label: "Repo Pi sessions",
        description: "Load repo-scoped Pi session transcripts for rumination",
        parameters: Type.Object({
            maxSessions: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 25 })),
            maxCharsPerSession: Type.Optional(Type.Integer({ minimum: 500, maximum: 20_000, default: 8_000 })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const result = await collectRepoSessions({
                cwd: ctx.cwd,
                currentSessionFile: ctx.sessionManager.getSessionFile?.(),
                maxSessions: params.maxSessions,
                maxCharsPerSession: params.maxCharsPerSession,
            });
            const lines = [`Repo root: ${result.repoRoot}`, `Sessions: ${result.sessions.length}`];
            if (result.warnings.length > 0) {
                lines.push("", "Warnings:");
                for (const warning of result.warnings) {
                    lines.push(`- ${warning}`);
                }
            }
            for (const session of result.sessions) {
                lines.push("", `## ${session.startedAt}`, `cwd: ${session.cwd}`, `messages: ${session.messageCount}`, `models: ${session.assistantModels.length > 0 ? session.assistantModels.join(", ") : "unknown"}`, session.transcript || "[brainerd] No readable conversation text found.");
            }
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                details: result,
            };
        },
    });
    pi.registerTool({
        name: "brainerd_stage_ruminate",
        label: "Stage rumination findings",
        description: "Persist a preview of proposed rumination changes for later confirmation",
        parameters: Type.Object({
            findingsSummary: Type.String({ minLength: 1 }),
            rationale: Type.String({ minLength: 1 }),
            changes: Type.Array(Type.Object({
                path: Type.String({ minLength: 1 }),
                content: Type.String({ minLength: 1 }),
            }), { minItems: 1, maxItems: 12 }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const projectRoot = await resolveProjectRoot(ctx.cwd);
            const stage = createStageEntry(projectRoot, params.findingsSummary, params.rationale, params.changes);
            pi.appendEntry(BRAINTYPE_STAGE, stage);
            if (activeRun?.mode === "ruminate-preview") {
                activeRun.result = {
                    mode: "ruminate-preview",
                    previewOnly: true,
                    written: false,
                    changedFiles: [],
                    syncedFiles: [],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: `Staged rumination preview ${stage.stageId} with ${stage.changes.length} proposed change(s).`,
                    },
                ],
                details: stage,
            };
        },
    });
    pi.registerTool({
        name: "brainerd_get_staged_ruminate",
        label: "Get staged rumination preview",
        description: "Return the latest staged rumination preview for the current session",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
            const stage = getLatestRuminateStage(ctx.sessionManager.getBranch());
            if (!stage || stage.status !== "staged") {
                return {
                    content: [{ type: "text", text: "No staged rumination preview is available." }],
                    details: null,
                };
            }
            const lines = [
                `Stage: ${stage.stageId}`,
                `Repo root: ${stage.repoRoot}`,
                `Created: ${stage.createdAt}`,
                `Findings: ${stage.findingsSummary}`,
                `Rationale: ${stage.rationale}`,
                `Targets: ${stage.changes.map((change) => change.path).join(", ")}`,
            ];
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                details: stage,
            };
        },
    });
    pi.registerTool({
        name: "brainerd_apply_changes",
        label: "Apply validated brain changes",
        description: "Apply note or principle updates under brain/ and regenerate entrypoints",
        parameters: Type.Object({
            stageId: Type.Optional(Type.String({ minLength: 1 })),
            changes: Type.Optional(Type.Array(Type.Object({
                path: Type.String({ minLength: 1 }),
                content: Type.String({ minLength: 1 }),
            }), { minItems: 1, maxItems: 12 })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            const projectRoot = await resolveProjectRoot(ctx.cwd);
            let changes = params.changes ?? [];
            let appliedStage = null;
            if (params.stageId) {
                const stage = getLatestRuminateStage(ctx.sessionManager.getBranch());
                if (!stage || stage.status !== "staged" || stage.stageId !== params.stageId) {
                    throw new Error(`No staged rumination preview matched ${params.stageId}.`);
                }
                appliedStage = stage;
                changes = stage.changes;
            }
            if (changes.length === 0) {
                throw new Error("brainerd_apply_changes requires either changes or a staged stageId.");
            }
            const result = await applyBrainChanges(projectRoot, changes);
            if (appliedStage) {
                pi.appendEntry(BRAINTYPE_STAGE, {
                    ...appliedStage,
                    status: "applied",
                    changedFiles: result.changed,
                    syncedFiles: result.synced,
                });
            }
            if (activeRun) {
                activeRun.result = {
                    mode: activeRun.mode,
                    previewOnly: false,
                    written: result.changed.length > 0,
                    changedFiles: result.changed,
                    syncedFiles: result.synced,
                };
            }
            const lines = [
                `Changed: ${result.changed.length > 0 ? result.changed.join(", ") : "none"}`,
                `Synced: ${result.synced.length > 0 ? result.synced.join(", ") : "none"}`,
            ];
            return {
                content: [{ type: "text", text: lines.join("\n") }],
                details: result,
            };
        },
    });
}
