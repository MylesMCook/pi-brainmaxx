#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { applyBrainChanges } from "./brain.js";
import { initClaudeBrain, syncClaudeBrain } from "./claude.js";
import { CLAUDE_SESSION_ENV_ID, CLAUDE_SESSION_ENV_TRANSCRIPT_PATH } from "./constants.js";
import { applyClaudeRuminateStage, discardClaudeRuminateStage, getClaudeRuminateStage, stageClaudeRuminate } from "./claude-stage.js";
import { collectClaudeRepoSessions, collectCurrentClaudeSession } from "./claude-sessions.js";
import { resolveProjectRoot } from "./project-root.js";
const usage = () => [
    "Usage:",
    "  Windows: scripts\\brainerd-claude.cmd init [--apply-bootstrap] [--cwd <path>]",
    "  POSIX:   scripts/brainerd-claude.sh init [--apply-bootstrap] [--cwd <path>]",
    "  Windows: scripts\\brainerd-claude.cmd sync [--cwd <path>]",
    "  POSIX:   scripts/brainerd-claude.sh sync [--cwd <path>]",
    "  Windows: scripts\\brainerd-claude.cmd repo-sessions [--cwd <path>] [--max-sessions <n>] [--max-chars-per-session <n>] [--min-sessions <n>] [--session-id <id>] [--transcript-path <path>]",
    "  POSIX:   scripts/brainerd-claude.sh repo-sessions [--cwd <path>] [--max-sessions <n>] [--max-chars-per-session <n>] [--min-sessions <n>] [--session-id <id>] [--transcript-path <path>]",
    "  Windows: scripts\\brainerd-claude.cmd current-session [--cwd <path>] [--session-id <id>] [--transcript-path <path>] [--max-chars <n>]",
    "  POSIX:   scripts/brainerd-claude.sh current-session [--cwd <path>] [--session-id <id>] [--transcript-path <path>] [--max-chars <n>]",
    "  Windows: scripts\\brainerd-claude.cmd apply-changes [--cwd <path>] [--input <json-file>]",
    "  POSIX:   scripts/brainerd-claude.sh apply-changes [--cwd <path>] [--input <json-file>]",
    "  Windows: scripts\\brainerd-claude.cmd stage-ruminate [--cwd <path>] [--input <json-file>]",
    "  POSIX:   scripts/brainerd-claude.sh stage-ruminate [--cwd <path>] [--input <json-file>]",
    "  Windows: scripts\\brainerd-claude.cmd staged-ruminate [--cwd <path>]",
    "  POSIX:   scripts/brainerd-claude.sh staged-ruminate [--cwd <path>]",
    "  Windows: scripts\\brainerd-claude.cmd apply-staged-ruminate [--cwd <path>] [--stage-id <id>]",
    "  POSIX:   scripts/brainerd-claude.sh apply-staged-ruminate [--cwd <path>] [--stage-id <id>]",
    "  Windows: scripts\\brainerd-claude.cmd discard-staged-ruminate [--cwd <path>]",
    "  POSIX:   scripts/brainerd-claude.sh discard-staged-ruminate [--cwd <path>]",
].join("\n");
const parseArgs = (argv) => {
    const [command, ...rest] = argv;
    if (command !== "init" &&
        command !== "sync" &&
        command !== "repo-sessions" &&
        command !== "current-session" &&
        command !== "apply-changes" &&
        command !== "stage-ruminate" &&
        command !== "staged-ruminate" &&
        command !== "apply-staged-ruminate" &&
        command !== "discard-staged-ruminate") {
        throw new Error(usage());
    }
    let cwd = process.cwd();
    let applyBootstrap = false;
    let maxSessions;
    let maxCharsPerSession;
    let minSessions;
    let sessionId;
    let transcriptPath;
    let maxChars;
    let input;
    let stageId;
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (token === "--apply-bootstrap") {
            applyBootstrap = true;
            continue;
        }
        const value = rest[index + 1];
        if ((token === "--cwd" ||
            token === "--max-sessions" ||
            token === "--max-chars-per-session" ||
            token === "--min-sessions" ||
            token === "--session-id" ||
            token === "--transcript-path" ||
            token === "--max-chars" ||
            token === "--input" ||
            token === "--stage-id") &&
            !value) {
            throw new Error(`Missing value for ${token}`);
        }
        switch (token) {
            case "--cwd":
                cwd = path.resolve(value);
                index += 1;
                break;
            case "--max-sessions":
                maxSessions = Number.parseInt(value, 10);
                index += 1;
                break;
            case "--max-chars-per-session":
                maxCharsPerSession = Number.parseInt(value, 10);
                index += 1;
                break;
            case "--min-sessions":
                minSessions = Number.parseInt(value, 10);
                index += 1;
                break;
            case "--session-id":
                sessionId = value;
                index += 1;
                break;
            case "--transcript-path":
                transcriptPath = path.resolve(value);
                index += 1;
                break;
            case "--max-chars":
                maxChars = Number.parseInt(value, 10);
                index += 1;
                break;
            case "--input":
                input = path.resolve(value);
                index += 1;
                break;
            case "--stage-id":
                stageId = value;
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
        sessionId,
        transcriptPath,
        maxChars,
        input,
        stageId,
    };
};
const readInputText = async (inputPath) => {
    if (inputPath) {
        return fs.readFile(inputPath, "utf8");
    }
    if (!process.stdin.isTTY) {
        const chunks = [];
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
const parseChangesInput = async (inputPath) => {
    const raw = await readInputText(inputPath);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Malformed JSON input: ${error.message}`);
    }
    const changes = parsed.changes;
    if (!Array.isArray(changes)) {
        throw new Error("JSON input must contain a changes array.");
    }
    return {
        changes: changes
            .filter((change) => Boolean(change && typeof change === "object"))
            .map((change) => ({
            path: String(change.path ?? ""),
            content: String(change.content ?? ""),
        })),
    };
};
const parseRuminateStageInput = async (inputPath) => {
    const raw = await readInputText(inputPath);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Malformed JSON input: ${error.message}`);
    }
    return {
        findingsSummary: String(parsed.findingsSummary ?? ""),
        rationale: String(parsed.rationale ?? ""),
        changes: Array.isArray(parsed.changes)
            ? (parsed.changes
                .filter((change) => Boolean(change && typeof change === "object"))
                .map((change) => ({
                path: String(change.path ?? ""),
                content: String(change.content ?? ""),
            })))
            : [],
    };
};
const printInit = async (cwd, applyBootstrap) => {
    const projectRoot = await resolveProjectRoot(cwd);
    const result = await initClaudeBrain(projectRoot, { applyBootstrap });
    console.log(`Brain initialized at ${path.join(projectRoot, "brain")} (${result.brainInit.created.length > 0 ? result.brainInit.created.join(", ") : "nothing new"}).`);
    console.log(`AGENTS.md: ${result.agents.status}`);
    console.log(`CLAUDE.md: ${result.shim.status}`);
    console.log(`Hook script: ${result.hookScript.status}`);
    console.log(`Claude settings: ${result.settings.status}`);
    console.log(`Claude memory imported: ${result.memory.imported.length > 0 ? result.memory.imported.join(", ") : "none"}`);
    console.log(`Claude memory removed: ${result.memory.removed.length > 0 ? result.memory.removed.join(", ") : "none"}`);
    if (result.bootstrap.status === "ready") {
        console.log("");
        console.log(`Operational bootstrap preview for ${result.bootstrap.noteRelativePath}`);
        console.log(result.bootstrap.content.trim());
        console.log("");
        console.log("Re-run with --apply-bootstrap to create this note.");
        return;
    }
    if (result.bootstrap.status === "created") {
        console.log(`Created ${result.bootstrap.noteRelativePath} from ${result.bootstrap.sourceFiles.join(", ")}.`);
        return;
    }
    console.log(result.bootstrap.reason);
};
const printSync = async (cwd) => {
    const projectRoot = await resolveProjectRoot(cwd);
    const result = await syncClaudeBrain(projectRoot);
    console.log(`Repo root: ${projectRoot}`);
    console.log(`Updated entrypoints: ${result.brain.updated.length > 0 ? result.brain.updated.join(", ") : "none"}`);
    console.log(`Skipped entrypoints: ${result.brain.skipped.length > 0 ? result.brain.skipped.join(", ") : "none"}`);
    console.log(`AGENTS.md: ${result.agents.status}`);
    console.log(`CLAUDE.md: ${result.shim.status}`);
    console.log(`Hook script: ${result.hookScript.status}`);
    console.log(`Claude settings: ${result.settings.status}`);
    console.log(`Claude memory imported: ${result.memory.imported.length > 0 ? result.memory.imported.join(", ") : "none"}`);
    console.log(`Claude memory removed: ${result.memory.removed.length > 0 ? result.memory.removed.join(", ") : "none"}`);
};
const printRepoSessions = async (cwd, options) => {
    const result = await collectClaudeRepoSessions({
        cwd,
        currentSessionId: options.sessionId ?? process.env[CLAUDE_SESSION_ENV_ID],
        currentTranscriptPath: options.transcriptPath ?? process.env[CLAUDE_SESSION_ENV_TRANSCRIPT_PATH],
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
const printCurrentSession = async (cwd, options) => {
    const session = await collectCurrentClaudeSession({
        cwd,
        sessionId: options.sessionId ?? process.env[CLAUDE_SESSION_ENV_ID],
        transcriptPath: options.transcriptPath ?? process.env[CLAUDE_SESSION_ENV_TRANSCRIPT_PATH],
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
const printApplyChanges = async (cwd, inputPath) => {
    const projectRoot = await resolveProjectRoot(cwd);
    const payload = await parseChangesInput(inputPath);
    const result = await applyBrainChanges(projectRoot, payload.changes);
    console.log(`Repo root: ${projectRoot}`);
    console.log(`Changed: ${result.changed.length > 0 ? result.changed.join(", ") : "none"}`);
    console.log(`Synced: ${result.synced.length > 0 ? result.synced.join(", ") : "none"}`);
};
const printStageRuminate = async (cwd, inputPath) => {
    const projectRoot = await resolveProjectRoot(cwd);
    const payload = await parseRuminateStageInput(inputPath);
    const stage = await stageClaudeRuminate(projectRoot, payload);
    console.log(`Repo root: ${projectRoot}`);
    console.log(`Stage id: ${stage.stageId}`);
    console.log(`Findings: ${stage.findingsSummary}`);
    console.log(`Rationale: ${stage.rationale}`);
    console.log(`Targets: ${stage.changes.map((change) => change.path).join(", ")}`);
    console.log("Write status: no brain changes were written");
};
const printStagedRuminate = async (cwd) => {
    const projectRoot = await resolveProjectRoot(cwd);
    const stage = await getClaudeRuminateStage(projectRoot);
    if (!stage || stage.status !== "staged") {
        console.log(`Repo root: ${projectRoot}`);
        console.log("No staged Claude rumination preview is available.");
        return;
    }
    console.log(`Repo root: ${projectRoot}`);
    console.log(`Stage id: ${stage.stageId}`);
    console.log(`Created: ${stage.createdAt}`);
    console.log(`Findings: ${stage.findingsSummary}`);
    console.log(`Rationale: ${stage.rationale}`);
    console.log(`Targets: ${stage.changes.map((change) => change.path).join(", ")}`);
};
const printApplyStagedRuminate = async (cwd, stageId) => {
    const projectRoot = await resolveProjectRoot(cwd);
    const { stage, apply } = await applyClaudeRuminateStage(projectRoot, stageId);
    console.log(`Repo root: ${projectRoot}`);
    console.log(`Applied stage: ${stage.stageId}`);
    console.log(`Changed: ${apply.changed.length > 0 ? apply.changed.join(", ") : "none"}`);
    console.log(`Synced: ${apply.synced.length > 0 ? apply.synced.join(", ") : "none"}`);
};
const printDiscardStagedRuminate = async (cwd) => {
    const projectRoot = await resolveProjectRoot(cwd);
    const stage = await discardClaudeRuminateStage(projectRoot);
    console.log(`Repo root: ${projectRoot}`);
    if (!stage) {
        console.log("No staged Claude rumination preview is available.");
        return;
    }
    console.log(`Discarded stage: ${stage.stageId}`);
    console.log("Write status: no brain changes were written");
};
const main = async () => {
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
                sessionId: args.sessionId,
                transcriptPath: args.transcriptPath,
                maxSessions: args.maxSessions,
                maxCharsPerSession: args.maxCharsPerSession,
                minSessions: args.minSessions,
            });
            return;
        case "current-session":
            await printCurrentSession(args.cwd, {
                sessionId: args.sessionId,
                transcriptPath: args.transcriptPath,
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
    console.error(error.message);
    process.exitCode = 1;
});
