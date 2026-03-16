import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { DEFAULT_CODEX_MIN_RUMINATION_SESSIONS } from "./constants.js";
import { exists } from "./fs-helpers.js";
import { isSameOrDescendant, resolveProjectRoot } from "./project-root.js";

const MAX_SESSION_HEADER_BYTES = 64 * 1024;
const TRANSCRIPT_FOOTER = "\n[brainmaxx] Transcript truncated to fit the Codex session history budget.";
const SUPPORTED_CODEX_ORIGINATORS = new Set(["codex_cli_rs", "codex_exec", "codex_vscode"]);

export type CodexRepoSession = {
  file: string;
  sessionId: string;
  cwd: string;
  startedAt: string;
  transcript: string;
  assistantModels: string[];
  messageCount: number;
};

export type CodexCurrentSession = CodexRepoSession & {
  repoRoot: string;
};

export type CodexRuminationReadiness =
  | { status: "ready"; reason: string }
  | { status: "insufficient"; reason: string }
  | { status: "unsupported"; reason: string };

export type CollectCodexRepoSessionsOptions = {
  cwd: string;
  currentThreadId?: string;
  sessionsRoot?: string;
  maxSessions?: number;
  maxCharsPerSession?: number;
  minSessions?: number;
};

export type CodexRepoSessionCollection = {
  repoRoot: string;
  sessions: CodexRepoSession[];
  warnings: string[];
  scannedFiles: number;
  candidateFiles: number;
  skippedFiles: number;
  readiness: CodexRuminationReadiness;
};

type SessionMetaRecord = {
  type: "session_meta";
  payload?: {
    id?: string;
    timestamp?: string;
    cwd?: string;
    originator?: string;
    cli_version?: string;
    model_provider?: string;
  };
};

type SessionMetaPayload = {
  id: string;
  timestamp: string;
  cwd: string;
  originator: string;
  cli_version: string;
  model_provider?: string;
};

type TurnContextRecord = {
  type: "turn_context";
  payload?: {
    model?: string;
  };
};

type ResponseItemRecord = {
  type: "response_item";
  payload?: {
    type?: string;
    role?: string;
    content?: unknown;
  };
};

type SessionRecord = SessionMetaRecord | TurnContextRecord | ResponseItemRecord | { type?: string };

const walkFiles = async (root: string): Promise<string[]> => {
  if (!(await exists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(target)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(target);
    }
  }

  return files;
};

const parseJsonLine = <T>(line: string, file: string): T => {
  try {
    return JSON.parse(line) as T;
  } catch (error) {
    throw new Error(`Malformed Codex session JSON in ${file}: ${(error as Error).message}`);
  }
};

const readFirstUsableLine = async (file: string): Promise<string> => {
  const handle = await fs.open(file, "r");
  const buffer = Buffer.alloc(MAX_SESSION_HEADER_BYTES);

  try {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      throw new Error(`Malformed Codex session file ${file}: missing session_meta record`);
    }
    const chunk = buffer.subarray(0, bytesRead);
    if (bytesRead === MAX_SESSION_HEADER_BYTES && chunk.indexOf(10) === -1) {
      throw new Error(`Malformed Codex session file ${file}: header exceeds ${MAX_SESSION_HEADER_BYTES} bytes`);
    }

    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim().length > 0) {
        return line;
      }
    }
  } finally {
    await handle.close();
  }

  throw new Error(`Malformed Codex session file ${file}: missing session_meta record`);
};

const readSessionMeta = async (file: string): Promise<SessionMetaPayload> => {
  const firstLine = await readFirstUsableLine(file);
  const record = parseJsonLine<SessionMetaRecord>(firstLine, file);

  if (record.type !== "session_meta") {
    throw new Error(`Malformed Codex session file ${file}: first usable record is not session_meta`);
  }

  const payload = record.payload;
  if (
    !payload ||
    typeof payload.id !== "string" ||
    typeof payload.timestamp !== "string" ||
    typeof payload.cwd !== "string" ||
    typeof payload.originator !== "string" ||
    typeof payload.cli_version !== "string"
  ) {
    throw new Error(`Malformed Codex session_meta payload in ${file}`);
  }

  if (!SUPPORTED_CODEX_ORIGINATORS.has(payload.originator)) {
    throw new Error(`Unsupported Codex session originator ${payload.originator} in ${file}`);
  }

  return {
    id: payload.id,
    timestamp: payload.timestamp,
    cwd: payload.cwd,
    originator: payload.originator,
    cli_version: payload.cli_version,
    model_provider: payload.model_provider,
  };
};

const extractMessageText = (content: unknown): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const typed = item as { type?: string; text?: string };
    if ((typed.type === "input_text" || typed.type === "output_text") && typeof typed.text === "string") {
      parts.push(typed.text);
    }
  }

  return parts;
};

const isInjectedContextMessage = (text: string): boolean => {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("# AGENTS.md instructions for ") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<permissions instructions>")
  );
};

const lineCount = (text: string): number => (text === "" ? 0 : text.split("\n").length);

const findSessionFileForThread = async (
  sessionsRoot: string,
  threadId: string,
): Promise<{ file: string; meta: SessionMetaPayload } | null> => {
  const files = (await walkFiles(sessionsRoot)).sort((a, b) => b.localeCompare(a));

  for (const file of files) {
    if (!path.basename(file).includes(threadId)) {
      continue;
    }

    try {
      const meta = await readSessionMeta(file);
      if (meta.id === threadId) {
        return { file, meta };
      }
    } catch {
      continue;
    }
  }

  for (const file of files) {
    try {
      const meta = await readSessionMeta(file);
      if (meta.id === threadId) {
        return { file, meta };
      }
    } catch {
      continue;
    }
  }

  return null;
};

const readSessionTranscript = async (
  file: string,
  maxCharsPerSession: number,
): Promise<{ transcript: string; assistantModels: string[]; messageCount: number; warnings: string[] }> => {
  const transcriptLines: string[] = [];
  const assistantModels = new Set<string>();
  const warnings: string[] = [];
  let transcriptLength = 0;
  let messageCount = 0;
  let truncated = false;

  const appendTranscript = (line: string): void => {
    if (truncated) {
      return;
    }

    const separator = transcriptLines.length === 0 ? "" : "\n\n";
    const nextLength = transcriptLength + separator.length + line.length;
    if (nextLength <= maxCharsPerSession) {
      transcriptLines.push(line);
      transcriptLength = nextLength;
      return;
    }

    const remaining = maxCharsPerSession - transcriptLength - separator.length - TRANSCRIPT_FOOTER.length;
    if (remaining > 0) {
      transcriptLines.push(line.slice(0, remaining));
      transcriptLength += separator.length + remaining;
    }
    truncated = true;
  };

  const stream = readline.createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of stream) {
    if (!line.trim()) {
      continue;
    }

    let record: SessionRecord;
    try {
      record = parseJsonLine<SessionRecord>(line, file);
    } catch (error) {
      warnings.push((error as Error).message);
      continue;
    }

    if (record.type === "turn_context") {
      const model = (record as TurnContextRecord).payload?.model;
      if (typeof model === "string" && model.trim().length > 0) {
        assistantModels.add(model);
      }
      continue;
    }

    if (record.type !== "response_item") {
      continue;
    }

    const payload = (record as ResponseItemRecord).payload;
    if (payload?.type !== "message" || (payload.role !== "user" && payload.role !== "assistant")) {
      continue;
    }

    const text = extractMessageText(payload.content).join("\n").trim();
    if (!text || isInjectedContextMessage(text)) {
      continue;
    }

    messageCount += 1;
    appendTranscript(`${payload.role === "user" ? "User" : "Assistant"}: ${text}`);
  }

  const transcript = transcriptLines.join("\n\n");
  return {
    transcript: truncated ? `${transcript}${TRANSCRIPT_FOOTER}` : transcript,
    assistantModels: Array.from(assistantModels).sort((a, b) => a.localeCompare(b)),
    messageCount,
    warnings,
  };
};

export const assessCodexRuminationReadiness = (
  collection: Pick<CodexRepoSessionCollection, "candidateFiles" | "sessions">,
  minSessions = DEFAULT_CODEX_MIN_RUMINATION_SESSIONS,
): CodexRuminationReadiness => {
  if (collection.candidateFiles === 0) {
    return {
      status: "insufficient",
      reason: "No repo-scoped Codex sessions were found.",
    };
  }

  if (collection.sessions.length === 0) {
    return {
      status: "unsupported",
      reason: "Repo-scoped Codex sessions were found, but none had readable supported transcript data.",
    };
  }

  if (collection.sessions.length < minSessions) {
    return {
      status: "insufficient",
      reason: `Only ${collection.sessions.length} readable repo-scoped Codex session(s) found; need at least ${minSessions} for rumination.`,
    };
  }

  return {
    status: "ready",
    reason: `${collection.sessions.length} readable repo-scoped Codex session(s) are available for rumination.`,
  };
};

export const collectCodexRepoSessions = async (
  options: CollectCodexRepoSessionsOptions,
): Promise<CodexRepoSessionCollection> => {
  const repoRoot = await resolveProjectRoot(options.cwd);
  const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), ".codex/sessions");
  const files = await walkFiles(sessionsRoot);
  const maxSessions = options.maxSessions ?? 25;
  const maxCharsPerSession = options.maxCharsPerSession ?? 8_000;
  const minSessions = options.minSessions ?? DEFAULT_CODEX_MIN_RUMINATION_SESSIONS;
  const warnings: string[] = [];
  const candidates: Array<{
    file: string;
    sessionId: string;
    cwd: string;
    startedAt: string;
  }> = [];
  let skippedFiles = 0;

  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    try {
      const meta = await readSessionMeta(file);
      if (options.currentThreadId && meta.id === options.currentThreadId) {
        continue;
      }
      if (!isSameOrDescendant(repoRoot, meta.cwd)) {
        continue;
      }

      candidates.push({
        file,
        sessionId: meta.id,
        cwd: meta.cwd,
        startedAt: meta.timestamp,
      });
    } catch (error) {
      warnings.push((error as Error).message);
      skippedFiles += 1;
    }
  }

  candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const sessions: CodexRepoSession[] = [];
  for (const candidate of candidates.slice(0, maxSessions)) {
    try {
      const { transcript, assistantModels, messageCount, warnings: sessionWarnings } = await readSessionTranscript(
        candidate.file,
        maxCharsPerSession,
      );
      warnings.push(...sessionWarnings);

      if (!transcript.trim() || messageCount === 0 || lineCount(transcript) === 0) {
        warnings.push(`No readable Codex conversation text found in ${candidate.file}`);
        skippedFiles += 1;
        continue;
      }

      sessions.push({
        file: candidate.file,
        sessionId: candidate.sessionId,
        cwd: candidate.cwd,
        startedAt: candidate.startedAt,
        transcript,
        assistantModels,
        messageCount,
      });
    } catch (error) {
      warnings.push((error as Error).message);
      skippedFiles += 1;
    }
  }

  let readiness = assessCodexRuminationReadiness(
    {
      candidateFiles: candidates.length,
      sessions,
    },
    minSessions,
  );

  if (readiness.status === "insufficient" && candidates.length === 0 && files.length > 0 && warnings.length > 0) {
    readiness = {
      status: "unsupported",
      reason: "Codex session files were found, but none matched the supported schema for this repo.",
    };
  }

  return {
    repoRoot,
    sessions,
    warnings,
    scannedFiles: files.length,
    candidateFiles: candidates.length,
    skippedFiles,
    readiness,
  };
};

export const collectCurrentCodexSession = async (options: {
  cwd: string;
  currentThreadId?: string;
  sessionsRoot?: string;
  maxChars?: number;
}): Promise<CodexCurrentSession> => {
  const repoRoot = await resolveProjectRoot(options.cwd);
  const currentThreadId = options.currentThreadId ?? process.env.CODEX_THREAD_ID;
  if (!currentThreadId) {
    throw new Error("No current Codex thread id found. Set CODEX_THREAD_ID or pass --current-thread-id.");
  }

  const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), ".codex/sessions");
  const located = await findSessionFileForThread(sessionsRoot, currentThreadId);
  if (!located) {
    throw new Error(`Could not locate a Codex session file for thread ${currentThreadId}.`);
  }

  if (!isSameOrDescendant(repoRoot, located.meta.cwd)) {
    throw new Error(
      `Current Codex thread ${currentThreadId} belongs to ${located.meta.cwd}, not repo root ${repoRoot}.`,
    );
  }

  const { transcript, assistantModels, messageCount, warnings } = await readSessionTranscript(
    located.file,
    options.maxChars ?? 8_000,
  );

  if (warnings.length > 0 && !transcript.trim()) {
    throw new Error(`Current Codex thread ${currentThreadId} has no readable conversation text.`);
  }

  if (!transcript.trim() || messageCount === 0 || lineCount(transcript) === 0) {
    throw new Error(`Current Codex thread ${currentThreadId} has no readable conversation text.`);
  }

  return {
    repoRoot,
    file: located.file,
    sessionId: located.meta.id,
    cwd: located.meta.cwd,
    startedAt: located.meta.timestamp,
    transcript,
    assistantModels,
    messageCount,
  };
};
