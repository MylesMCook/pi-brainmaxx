import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { DEFAULT_CODEX_MIN_RUMINATION_SESSIONS } from "./constants.js";
import { exists } from "./fs-helpers.js";
import { isSameOrDescendant, resolveProjectRoot } from "./project-root.js";

const MAX_SESSION_HEADER_BYTES = 128 * 1024;
const TRANSCRIPT_FOOTER = "\n[brainerd] Transcript truncated to fit the Claude session history budget.";

export type ClaudeRepoSession = {
  file: string;
  sessionId: string;
  cwd: string;
  startedAt: string;
  transcript: string;
  assistantModels: string[];
  messageCount: number;
};

export type ClaudeCurrentSession = ClaudeRepoSession & {
  repoRoot: string;
};

export type ClaudeRuminationReadiness =
  | { status: "ready"; reason: string }
  | { status: "insufficient"; reason: string }
  | { status: "unsupported"; reason: string };

export type CollectClaudeRepoSessionsOptions = {
  cwd: string;
  currentSessionId?: string;
  currentTranscriptPath?: string;
  projectsRoot?: string;
  maxSessions?: number;
  maxCharsPerSession?: number;
  minSessions?: number;
};

export type CollectCurrentClaudeSessionOptions = {
  cwd: string;
  sessionId?: string;
  transcriptPath?: string;
  projectsRoot?: string;
  maxChars?: number;
};

export type ClaudeRepoSessionCollection = {
  repoRoot: string;
  sessions: ClaudeRepoSession[];
  warnings: string[];
  scannedFiles: number;
  candidateFiles: number;
  skippedFiles: number;
  readiness: ClaudeRuminationReadiness;
};

export type ClaudeSessionMeta = {
  file: string;
  projectDir: string;
  sessionId: string;
  cwd: string;
  startedAt: string;
};

type ClaudeRecord = {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
  };
};

const resolveClaudeProjectsRoot = (override?: string): string =>
  override ? path.resolve(override) : path.join(os.homedir(), ".claude", "projects");

const listTopLevelSessionFiles = async (projectsRoot: string): Promise<string[]> => {
  if (!(await exists(projectsRoot))) {
    return [];
  }

  const projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }
    const projectDir = path.join(projectsRoot, projectEntry.name);
    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path.join(projectDir, entry.name));
      }
    }
  }

  return files;
};

const parseJsonLine = <T>(line: string, file: string): T => {
  try {
    return JSON.parse(line) as T;
  } catch (error) {
    throw new Error(`Malformed Claude session JSON in ${file}: ${(error as Error).message}`);
  }
};

const readHeaderChunk = async (file: string): Promise<string[]> => {
  const handle = await fs.open(file, "r");
  const buffer = Buffer.alloc(MAX_SESSION_HEADER_BYTES);

  try {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      throw new Error(`Malformed Claude session file ${file}: missing records`);
    }
    const chunk = buffer.subarray(0, bytesRead);
    if (bytesRead === MAX_SESSION_HEADER_BYTES && chunk.indexOf(10) === -1) {
      throw new Error(`Malformed Claude session file ${file}: header exceeds ${MAX_SESSION_HEADER_BYTES} bytes`);
    }
    return chunk
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } finally {
    await handle.close();
  }
};

export const readClaudeSessionMeta = async (file: string): Promise<ClaudeSessionMeta> => {
  const headerLines = await readHeaderChunk(file);

  for (const line of headerLines) {
    const record = parseJsonLine<ClaudeRecord>(line, file);
    if (
      typeof record.sessionId === "string" &&
      typeof record.cwd === "string" &&
      typeof record.timestamp === "string"
    ) {
      return {
        file,
        projectDir: path.dirname(file),
        sessionId: record.sessionId,
        cwd: record.cwd,
        startedAt: record.timestamp,
      };
    }
  }

  throw new Error(`Malformed Claude session file ${file}: no record with sessionId, cwd, and timestamp was found`);
};

const appendTranscript = (
  transcriptLines: string[],
  line: string,
  state: { length: number; truncated: boolean },
  maxCharsPerSession: number,
): void => {
  if (state.truncated) {
    return;
  }

  const separator = transcriptLines.length === 0 ? "" : "\n\n";
  const nextLength = state.length + separator.length + line.length;
  if (nextLength <= maxCharsPerSession) {
    transcriptLines.push(line);
    state.length = nextLength;
    return;
  }

  const remaining = maxCharsPerSession - state.length - separator.length - TRANSCRIPT_FOOTER.length;
  if (remaining > 0) {
    transcriptLines.push(line.slice(0, remaining));
    state.length += separator.length + remaining;
  }
  state.truncated = true;
};

const extractNestedText = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractNestedText(item));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const typed = value as { text?: unknown; content?: unknown };
  const parts: string[] = [];
  if (typeof typed.text === "string") {
    parts.push(typed.text);
  }
  if (typed.content !== undefined) {
    parts.push(...extractNestedText(typed.content));
  }
  return parts;
};

const extractClaudeTextParts = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const typed = item as { type?: string; text?: string };
    if (typed.type === "text" && typeof typed.text === "string") {
      parts.push(typed.text);
    }
  }
  return parts;
};

const extractClaudeToolResults = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const typed = item as { type?: string; content?: unknown };
    if (typed.type !== "tool_result") {
      continue;
    }
    const text = extractNestedText(typed.content)
      .join("\n")
      .trim();
    if (text) {
      parts.push(text);
    }
  }
  return parts;
};

const readClaudeSessionTranscript = async (
  file: string,
  maxCharsPerSession: number,
): Promise<{ transcript: string; assistantModels: string[]; messageCount: number; warnings: string[] }> => {
  const transcriptLines: string[] = [];
  const assistantModels = new Set<string>();
  const warnings: string[] = [];
  const state = { length: 0, truncated: false };
  let messageCount = 0;

  const stream = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of stream) {
    if (!line.trim()) {
      continue;
    }

    let record: ClaudeRecord;
    try {
      record = parseJsonLine<ClaudeRecord>(line, file);
    } catch (error) {
      warnings.push((error as Error).message);
      continue;
    }

    if (record.type === "queue-operation" || record.type === "progress" || record.type === "file-history-snapshot") {
      continue;
    }

    const role = record.message?.role;
    if (role === "user") {
      const userText = extractClaudeTextParts(record.message?.content).join("\n").trim();
      if (userText) {
        messageCount += 1;
        appendTranscript(transcriptLines, `User: ${userText}`, state, maxCharsPerSession);
      }
      for (const toolResult of extractClaudeToolResults(record.message?.content)) {
        messageCount += 1;
        appendTranscript(transcriptLines, `Tool result: ${toolResult}`, state, maxCharsPerSession);
      }
      continue;
    }

    if (role === "assistant") {
      const assistantText = extractClaudeTextParts(record.message?.content).join("\n").trim();
      if (!assistantText) {
        continue;
      }
      messageCount += 1;
      if (typeof record.message?.model === "string" && record.message.model.trim()) {
        assistantModels.add(record.message.model.trim());
      }
      appendTranscript(transcriptLines, `Assistant: ${assistantText}`, state, maxCharsPerSession);
    }
  }

  const transcript = transcriptLines.join("\n\n");
  return {
    transcript: state.truncated ? `${transcript}${TRANSCRIPT_FOOTER}` : transcript,
    assistantModels: Array.from(assistantModels).sort((a, b) => a.localeCompare(b)),
    messageCount,
    warnings,
  };
};

const sortSessionMeta = (left: ClaudeSessionMeta, right: ClaudeSessionMeta): number => {
  const timeDelta = Date.parse(right.startedAt) - Date.parse(left.startedAt);
  if (Number.isFinite(timeDelta) && timeDelta !== 0) {
    return timeDelta;
  }
  return right.file.localeCompare(left.file);
};

const loadClaudeSessionMetas = async (
  projectsRoot: string,
): Promise<{ metas: ClaudeSessionMeta[]; warnings: string[]; scannedFiles: number; skippedFiles: number }> => {
  const files = await listTopLevelSessionFiles(projectsRoot);
  const metas: ClaudeSessionMeta[] = [];
  const warnings: string[] = [];
  let skippedFiles = 0;

  for (const file of files) {
    try {
      metas.push(await readClaudeSessionMeta(file));
    } catch (error) {
      warnings.push((error as Error).message);
      skippedFiles += 1;
    }
  }

  metas.sort(sortSessionMeta);
  return {
    metas,
    warnings,
    scannedFiles: files.length,
    skippedFiles,
  };
};

export const findClaudeProjectDirForRepo = async (
  projectRoot: string,
  projectsRoot?: string,
): Promise<string | null> => {
  const resolvedProjectsRoot = resolveClaudeProjectsRoot(projectsRoot);
  const { metas } = await loadClaudeSessionMetas(resolvedProjectsRoot);
  const matching = metas.find((meta) => isSameOrDescendant(projectRoot, meta.cwd));
  return matching?.projectDir ?? null;
};

export const collectClaudeRepoSessions = async (
  options: CollectClaudeRepoSessionsOptions,
): Promise<ClaudeRepoSessionCollection> => {
  const repoRoot = await resolveProjectRoot(options.cwd);
  const resolvedProjectsRoot = resolveClaudeProjectsRoot(options.projectsRoot);
  const maxSessions = options.maxSessions ?? 25;
  const maxCharsPerSession = options.maxCharsPerSession ?? 8_000;
  const minSessions = options.minSessions ?? DEFAULT_CODEX_MIN_RUMINATION_SESSIONS;
  const currentTranscriptPath = options.currentTranscriptPath ? path.resolve(options.currentTranscriptPath) : null;

  const loaded = await loadClaudeSessionMetas(resolvedProjectsRoot);
  const candidates = loaded.metas.filter((meta) => {
    if (!isSameOrDescendant(repoRoot, meta.cwd)) {
      return false;
    }
    if (currentTranscriptPath && path.resolve(meta.file) === currentTranscriptPath) {
      return false;
    }
    if (options.currentSessionId && meta.sessionId === options.currentSessionId) {
      return false;
    }
    return true;
  });

  const sessions: ClaudeRepoSession[] = [];
  const warnings = [...loaded.warnings];

  for (const meta of candidates.slice(0, maxSessions)) {
    const transcript = await readClaudeSessionTranscript(meta.file, maxCharsPerSession);
    warnings.push(...transcript.warnings);
    sessions.push({
      file: meta.file,
      sessionId: meta.sessionId,
      cwd: meta.cwd,
      startedAt: meta.startedAt,
      transcript: transcript.transcript,
      assistantModels: transcript.assistantModels,
      messageCount: transcript.messageCount,
    });
  }

  const readiness: ClaudeRuminationReadiness =
    sessions.length >= minSessions
      ? { status: "ready", reason: `Found ${sessions.length} repo-scoped Claude sessions.` }
      : sessions.length > 0
        ? {
            status: "insufficient",
            reason: `Found only ${sessions.length} repo-scoped Claude session(s); need at least ${minSessions}.`,
          }
        : {
            status: "unsupported",
            reason: "No repo-scoped Claude session history was found.",
          };

  return {
    repoRoot,
    sessions,
    warnings,
    scannedFiles: loaded.scannedFiles,
    candidateFiles: candidates.length,
    skippedFiles: loaded.skippedFiles,
    readiness,
  };
};

export const collectCurrentClaudeSession = async (
  options: CollectCurrentClaudeSessionOptions,
): Promise<ClaudeCurrentSession> => {
  const repoRoot = await resolveProjectRoot(options.cwd);
  const resolvedProjectsRoot = resolveClaudeProjectsRoot(options.projectsRoot);
  const loaded = await loadClaudeSessionMetas(resolvedProjectsRoot);
  const transcriptPath = options.transcriptPath ? path.resolve(options.transcriptPath) : null;

  let meta: ClaudeSessionMeta | undefined;
  if (transcriptPath) {
    meta = loaded.metas.find((candidate) => path.resolve(candidate.file) === transcriptPath);
    if (!meta && (await exists(transcriptPath))) {
      meta = await readClaudeSessionMeta(transcriptPath);
    }
  }
  if (!meta && options.sessionId) {
    meta = loaded.metas.find((candidate) => candidate.sessionId === options.sessionId && isSameOrDescendant(repoRoot, candidate.cwd));
  }
  if (!meta) {
    meta = loaded.metas.find((candidate) => isSameOrDescendant(repoRoot, candidate.cwd));
  }
  if (!meta) {
    throw new Error("No current Claude session was found for this repo.");
  }

  const transcript = await readClaudeSessionTranscript(meta.file, options.maxChars ?? 8_000);
  return {
    repoRoot,
    file: meta.file,
    sessionId: meta.sessionId,
    cwd: meta.cwd,
    startedAt: meta.startedAt,
    transcript: transcript.transcript,
    assistantModels: transcript.assistantModels,
    messageCount: transcript.messageCount,
  };
};
