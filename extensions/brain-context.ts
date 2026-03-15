import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { applyOperationalBootstrap, planOperationalBootstrap } from "../src/bootstrap.js";
import { buildInjectedBrainMessage } from "../src/injection.js";
import {
  initBrain,
  readEntrypoints,
  syncOwnedEntryPoints,
} from "../src/brain.js";
import { findGitRoot, resolveProjectRoot } from "../src/project-root.js";
import { collectRepoSessions } from "../src/sessions.js";

const APPLY_BOOTSTRAP_FLAG = "--apply-bootstrap";

const report = (
  message: string,
  level: "info" | "warning" | "error",
  ctx: { hasUI?: boolean; ui: { notify(message: string, level?: "info" | "warning" | "error"): void } },
): void => {
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

const parseBrainInitArgs = (args: string): { applyBootstrap: boolean } => {
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

const formatBrainInitSummary = (projectRoot: string, created: string[], synced: string[]): string => {
  const createdLabel = created.length > 0 ? created.join(", ") : "nothing new";
  const syncedLabel = synced.length > 0 ? synced.join(", ") : "none";
  return `Brain initialized at ${path.join(projectRoot, "brain")} (${createdLabel}). Synced: ${syncedLabel}.`;
};

const formatBootstrapPreview = (noteRelativePath: string, sourceFiles: string[], content: string): string => {
  const lines = [
    `Operational bootstrap preview for ${noteRelativePath}`,
    sourceFiles.length > 0 ? `Sources: ${sourceFiles.join(", ")}` : "Sources: none",
    "",
    content.trim(),
  ];
  return lines.join("\n");
};

export default function brainContext(pi: ExtensionAPI): void {
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
            console.log(
              `Created ${applied.noteRelativePath} from ${applied.sourceFiles.join(", ")}. Synced: ${applied.synced.join(", ") || "none"}.`,
            );
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
          report(
            `Created ${applied.noteRelativePath} from ${applied.sourceFiles.join(", ")}. Synced: ${applied.synced.join(", ") || "none"}.`,
            "info",
            ctx,
          );
          return;
        }

        report(applied.reason, applied.status === "exists" ? "info" : "warning", ctx);
      } catch (error) {
        const message = (error as Error).message;
        if (message.startsWith("Unsupported /brain-init arguments:")) {
          report(message, "warning", ctx);
          return;
        }
        report(`pi-brainmaxx failed to initialize the brain: ${message}`, "error", ctx);
      }
    },
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    try {
      const projectRoot = await resolveProjectRoot(ctx.cwd);
      const entrypoints = await readEntrypoints(projectRoot);
      if (!entrypoints) {
        return;
      }

      const injection = buildInjectedBrainMessage(entrypoints.index, entrypoints.principles);
      return {
        message: {
          customType: "brainmaxx-context",
          content: injection.content,
          display: false,
        },
      };
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(`pi-brainmaxx skipped ambient brain loading: ${(error as Error).message}`, "warning");
      }
      console.warn(`pi-brainmaxx skipped ambient brain loading: ${(error as Error).message}`);
      return;
    }
  });

  pi.registerTool({
    name: "brainmaxx_sync_entrypoints",
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
    name: "brainmaxx_repo_sessions",
    label: "Repo Pi sessions",
    description: "Load repo-scoped Pi session transcripts for rumination",
    parameters: Type.Object({
      maxSessions: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 25 })),
      maxCharsPerSession: Type.Optional(Type.Integer({ minimum: 500, maximum: 20_000, default: 8_000 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await collectRepoSessions({
        cwd: ctx.cwd,
        currentSessionFile: ctx.sessionManager.getSessionFile(),
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
        lines.push(
          "",
          `## ${session.startedAt}`,
          `cwd: ${session.cwd}`,
          `messages: ${session.messageCount}`,
          `models: ${session.assistantModels.length > 0 ? session.assistantModels.join(", ") : "unknown"}`,
          session.transcript || "[brainmaxx] No readable conversation text found.",
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result,
      };
    },
  });
}
