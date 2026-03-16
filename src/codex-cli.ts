#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { applyBrainChanges, type BrainChange } from "./brain.js";
import { initCodexBrain, syncCodexBrain } from "./codex.js";
import {
  collectCodexRepoSessions,
  collectCurrentCodexSession,
} from "./codex-sessions.js";
import {
  applyCodexRuminateStage,
  discardCodexRuminateStage,
  getCodexRuminateStage,
  stageCodexRuminate,
} from "./codex-stage.js";
import { resolveProjectRoot } from "./project-root.js";

type Command =
  | "init"
  | "sync"
  | "repo-sessions"
  | "current-session"
  | "apply-changes"
  | "stage-ruminate"
  | "staged-ruminate"
  | "apply-staged-ruminate"
  | "discard-staged-ruminate";

const usage = (): string =>
  [
    "Usage:",
    "  node --import tsx src/codex-cli.ts init [--apply-bootstrap] [--cwd <path>]",
    "  node --import tsx src/codex-cli.ts sync [--cwd <path>]",
    "  node --import tsx src/codex-cli.ts repo-sessions [--cwd <path>] [--max-sessions <n>] [--max-chars-per-session <n>] [--min-sessions <n>] [--current-thread-id <id>]",
    "  node --import tsx src/codex-cli.ts current-session [--cwd <path>] [--current-thread-id <id>] [--max-chars <n>]",
    "  node --import tsx src/codex-cli.ts apply-changes [--cwd <path>] [--input <json-file>]",
    "  node --import tsx src/codex-cli.ts stage-ruminate [--cwd <path>] [--input <json-file>]",
    "  node --import tsx src/codex-cli.ts staged-ruminate [--cwd <path>]",
    "  node --import tsx src/codex-cli.ts apply-staged-ruminate [--cwd <path>] [--stage-id <id>]",
    "  node --import tsx src/codex-cli.ts discard-staged-ruminate [--cwd <path>]",
  ].join("\n");

const parseArgs = (
  argv: string[],
): {
  command: Command;
  cwd: string;
  applyBootstrap: boolean;
  maxSessions?: number;
  maxCharsPerSession?: number;
  minSessions?: number;
  currentThreadId?: string;
  maxChars?: number;
  input?: string;
  stageId?: string;
} => {
  const [command, ...rest] = argv;
  if (
    command !== "init" &&
    command !== "sync" &&
    command !== "repo-sessions" &&
    command !== "current-session" &&
    command !== "apply-changes" &&
    command !== "stage-ruminate" &&
    command !== "staged-ruminate" &&
    command !== "apply-staged-ruminate" &&
    command !== "discard-staged-ruminate"
  ) {
    throw new Error(usage());
  }

  let cwd = process.cwd();
  let applyBootstrap = false;
  let maxSessions: number | undefined;
  let maxCharsPerSession: number | undefined;
  let minSessions: number | undefined;
  let currentThreadId: string | undefined;
  let maxChars: number | undefined;
  let input: string | undefined;
  let stageId: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--apply-bootstrap") {
      applyBootstrap = true;
      continue;
    }

    const value = rest[index + 1];
    if (
      (
        token === "--cwd" ||
        token === "--max-sessions" ||
        token === "--max-chars-per-session" ||
        token === "--min-sessions" ||
        token === "--current-thread-id" ||
        token === "--max-chars" ||
        token === "--input" ||
        token === "--stage-id"
      ) &&
      !value
    ) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (token) {
      case "--cwd":
        cwd = path.resolve(value!);
        index += 1;
        break;
      case "--max-sessions":
        maxSessions = Number.parseInt(value!, 10);
        index += 1;
        break;
      case "--max-chars-per-session":
        maxCharsPerSession = Number.parseInt(value!, 10);
        index += 1;
        break;
      case "--min-sessions":
        minSessions = Number.parseInt(value!, 10);
        index += 1;
        break;
      case "--current-thread-id":
        currentThreadId = value!;
        index += 1;
        break;
      case "--max-chars":
        maxChars = Number.parseInt(value!, 10);
        index += 1;
        break;
      case "--input":
        input = path.resolve(value!);
        index += 1;
        break;
      case "--stage-id":
        stageId = value!;
        index += 1;
        break;
      default:
        throw new Error(`Unsupported argument: ${token}`);
    }
  }

  return {
    command,
    cwd,
    applyBootstrap,
    maxSessions,
    maxCharsPerSession,
    minSessions,
    currentThreadId,
    maxChars,
    input,
    stageId,
  };
};

const readInputText = async (inputPath?: string): Promise<string> => {
  if (inputPath) {
    return fs.readFile(inputPath, "utf8");
  }

  if (!process.stdin.isTTY) {
    const chunks: string[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(String(chunk));
    }
    const text = chunks.join("");
    if (text.trim()) {
      return text;
    }
  }

  throw new Error("Provide --input <json-file> or pipe JSON on stdin.");
};

const parseChangesInput = async (inputPath?: string): Promise<{ changes: BrainChange[] }> => {
  const raw = await readInputText(inputPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON input: ${(error as Error).message}`);
  }

  const changes = (parsed as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) {
    throw new Error("JSON input must contain a changes array.");
  }

  return {
    changes: changes
      .filter((change): change is BrainChange => Boolean(change && typeof change === "object"))
      .map((change) => ({
        path: String((change as { path: unknown }).path ?? ""),
        content: String((change as { content: unknown }).content ?? ""),
      })),
  };
};

const parseRuminateStageInput = async (
  inputPath?: string,
): Promise<{ findingsSummary: string; rationale: string; changes: BrainChange[] }> => {
  const raw = await readInputText(inputPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON input: ${(error as Error).message}`);
  }

  return {
    findingsSummary: String((parsed as { findingsSummary?: unknown }).findingsSummary ?? ""),
    rationale: String((parsed as { rationale?: unknown }).rationale ?? ""),
    changes: Array.isArray((parsed as { changes?: unknown }).changes)
      ? ((parsed as { changes: unknown[] }).changes
          .filter((change): change is BrainChange => Boolean(change && typeof change === "object"))
          .map((change) => ({
            path: String((change as { path: unknown }).path ?? ""),
            content: String((change as { content: unknown }).content ?? ""),
          })))
      : [],
  };
};

const formatBrainSummary = (projectRoot: string, created: string[], synced: string[]): string => {
  const createdLabel = created.length > 0 ? created.join(", ") : "nothing new";
  const syncedLabel = synced.length > 0 ? synced.join(", ") : "none";
  return `Brain initialized at ${path.join(projectRoot, "brain")} (${createdLabel}). Synced: ${syncedLabel}.`;
};

const formatBootstrapPreview = (noteRelativePath: string, sourceFiles: string[], content: string): string =>
  [
    `Operational bootstrap preview for ${noteRelativePath}`,
    sourceFiles.length > 0 ? `Sources: ${sourceFiles.join(", ")}` : "Sources: none",
    "",
    content.trim(),
  ].join("\n");

const printInit = async (cwd: string, applyBootstrap: boolean): Promise<void> => {
  const projectRoot = await resolveProjectRoot(cwd);
  const result = await initCodexBrain(projectRoot, { applyBootstrap });

  console.log(formatBrainSummary(projectRoot, result.brain.created, result.brain.synced));
  console.log(`AGENTS.md: ${result.agents.status}`);

  if (result.bootstrap.status === "ready") {
    console.log("");
    console.log(formatBootstrapPreview(result.bootstrap.noteRelativePath, result.bootstrap.sourceFiles, result.bootstrap.content));
    console.log("");
    console.log("Re-run with --apply-bootstrap to create this note.");
    return;
  }

  if (result.bootstrap.status === "created") {
    console.log(
      `Created ${result.bootstrap.noteRelativePath} from ${result.bootstrap.sourceFiles.join(", ")}. Synced: ${result.bootstrap.synced.join(", ") || "none"}.`,
    );
    return;
  }

  console.log(result.bootstrap.reason);
};

const printSync = async (cwd: string): Promise<void> => {
  const projectRoot = await resolveProjectRoot(cwd);
  const result = await syncCodexBrain(projectRoot);

  console.log(`Repo root: ${projectRoot}`);
  console.log(`Updated: ${result.updated.length > 0 ? result.updated.join(", ") : "none"}`);
  console.log(`Skipped: ${result.skipped.length > 0 ? result.skipped.join(", ") : "none"}`);
};

const printRepoSessions = async (
  cwd: string,
  options: {
    currentThreadId?: string;
    maxSessions?: number;
    maxCharsPerSession?: number;
    minSessions?: number;
  },
): Promise<void> => {
  const result = await collectCodexRepoSessions({
    cwd,
    currentThreadId: options.currentThreadId ?? process.env.CODEX_THREAD_ID,
    maxSessions: options.maxSessions,
    maxCharsPerSession: options.maxCharsPerSession,
    minSessions: options.minSessions,
  });

  console.log(`Repo root: ${result.repoRoot}`);
  console.log(`Readiness: ${result.readiness.status}`);
  console.log(`Reason: ${result.readiness.reason}`);
  console.log(`Scanned files: ${result.scannedFiles}`);
  console.log(`Repo candidates: ${result.candidateFiles}`);
  console.log(`Readable sessions: ${result.sessions.length}`);
  console.log(`Skipped files: ${result.skippedFiles}`);

  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }

  for (const session of result.sessions) {
    console.log("");
    console.log(`## ${session.startedAt}`);
    console.log(`id: ${session.sessionId}`);
    console.log(`cwd: ${session.cwd}`);
    console.log(`messages: ${session.messageCount}`);
    console.log(`models: ${session.assistantModels.length > 0 ? session.assistantModels.join(", ") : "unknown"}`);
    console.log(session.transcript);
  }
};

const printCurrentSession = async (
  cwd: string,
  options: { currentThreadId?: string; maxChars?: number },
): Promise<void> => {
  const session = await collectCurrentCodexSession({
    cwd,
    currentThreadId: options.currentThreadId,
    maxChars: options.maxChars,
  });

  console.log(`Repo root: ${session.repoRoot}`);
  console.log(`Session file: ${session.file}`);
  console.log(`Session id: ${session.sessionId}`);
  console.log(`cwd: ${session.cwd}`);
  console.log(`startedAt: ${session.startedAt}`);
  console.log(`messages: ${session.messageCount}`);
  console.log(`models: ${session.assistantModels.length > 0 ? session.assistantModels.join(", ") : "unknown"}`);
  console.log("");
  console.log(session.transcript);
};

const printApplyChanges = async (cwd: string, inputPath?: string): Promise<void> => {
  const projectRoot = await resolveProjectRoot(cwd);
  const payload = await parseChangesInput(inputPath);
  const result = await applyBrainChanges(projectRoot, payload.changes);

  console.log(`Repo root: ${projectRoot}`);
  console.log(`Changed: ${result.changed.length > 0 ? result.changed.join(", ") : "none"}`);
  console.log(`Synced: ${result.synced.length > 0 ? result.synced.join(", ") : "none"}`);
};

const printStageRuminate = async (cwd: string, inputPath?: string): Promise<void> => {
  const projectRoot = await resolveProjectRoot(cwd);
  const payload = await parseRuminateStageInput(inputPath);
  const stage = await stageCodexRuminate(projectRoot, payload);

  console.log(`Repo root: ${projectRoot}`);
  console.log(`Stage id: ${stage.stageId}`);
  console.log(`Findings: ${stage.findingsSummary}`);
  console.log(`Rationale: ${stage.rationale}`);
  console.log(`Targets: ${stage.changes.map((change) => change.path).join(", ")}`);
  console.log("Write status: no brain changes were written");
};

const printStagedRuminate = async (cwd: string): Promise<void> => {
  const projectRoot = await resolveProjectRoot(cwd);
  const stage = await getCodexRuminateStage(projectRoot);
  if (!stage || stage.status !== "staged") {
    console.log(`Repo root: ${projectRoot}`);
    console.log("No staged Codex rumination preview is available.");
    return;
  }

  console.log(`Repo root: ${projectRoot}`);
  console.log(`Stage id: ${stage.stageId}`);
  console.log(`Created: ${stage.createdAt}`);
  console.log(`Findings: ${stage.findingsSummary}`);
  console.log(`Rationale: ${stage.rationale}`);
  console.log(`Targets: ${stage.changes.map((change) => change.path).join(", ")}`);
};

const printApplyStagedRuminate = async (cwd: string, stageId?: string): Promise<void> => {
  const projectRoot = await resolveProjectRoot(cwd);
  const { stage, apply } = await applyCodexRuminateStage(projectRoot, stageId);

  console.log(`Repo root: ${projectRoot}`);
  console.log(`Applied stage: ${stage.stageId}`);
  console.log(`Changed: ${apply.changed.length > 0 ? apply.changed.join(", ") : "none"}`);
  console.log(`Synced: ${apply.synced.length > 0 ? apply.synced.join(", ") : "none"}`);
};

const printDiscardStagedRuminate = async (cwd: string): Promise<void> => {
  const projectRoot = await resolveProjectRoot(cwd);
  const stage = await discardCodexRuminateStage(projectRoot);

  console.log(`Repo root: ${projectRoot}`);
  if (!stage) {
    console.log("No staged Codex rumination preview is available.");
    return;
  }
  console.log(`Discarded stage: ${stage.stageId}`);
  console.log("Write status: no brain changes were written");
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "init":
      await printInit(args.cwd, args.applyBootstrap);
      return;
    case "sync":
      await printSync(args.cwd);
      return;
    case "repo-sessions":
      await printRepoSessions(args.cwd, {
        currentThreadId: args.currentThreadId,
        maxSessions: args.maxSessions,
        maxCharsPerSession: args.maxCharsPerSession,
        minSessions: args.minSessions,
      });
      return;
    case "current-session":
      await printCurrentSession(args.cwd, {
        currentThreadId: args.currentThreadId,
        maxChars: args.maxChars,
      });
      return;
    case "apply-changes":
      await printApplyChanges(args.cwd, args.input);
      return;
    case "stage-ruminate":
      await printStageRuminate(args.cwd, args.input);
      return;
    case "staged-ruminate":
      await printStagedRuminate(args.cwd);
      return;
    case "apply-staged-ruminate":
      await printApplyStagedRuminate(args.cwd, args.stageId);
      return;
    case "discard-staged-ruminate":
      await printDiscardStagedRuminate(args.cwd);
  }
};

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
