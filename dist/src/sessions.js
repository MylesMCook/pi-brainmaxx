import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { SUPPORTED_SESSION_VERSIONS } from "./constants.js";
import { isSameOrDescendant, resolveProjectRoot } from "./project-root.js";
const isMessageEntry = (entry) => entry.type === "message";
const MAX_SESSION_HEADER_BYTES = 64 * 1024;
const exists = async (target) => {
    try {
        await fs.access(target);
        return true;
    }
    catch {
        return false;
    }
};
const walkFiles = async (root) => {
    if (!(await exists(root))) {
        return [];
    }
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = [];
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
const parseJsonLine = (line, file) => {
    try {
        return JSON.parse(line);
    }
    catch (error) {
        throw new Error(`Malformed Pi session JSON in ${file}: ${error.message}`);
    }
};
const readFirstLine = async (file) => {
    const handle = await fs.open(file, "r");
    const chunks = [];
    const buffer = Buffer.alloc(1024);
    let totalBytes = 0;
    try {
        while (true) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) {
                break;
            }
            const chunk = Buffer.from(buffer.subarray(0, bytesRead));
            totalBytes += chunk.length;
            if (totalBytes > MAX_SESSION_HEADER_BYTES) {
                throw new Error(`Malformed Pi session file ${file}: header exceeds ${MAX_SESSION_HEADER_BYTES} bytes`);
            }
            const newlineIndex = chunk.indexOf(10);
            if (newlineIndex >= 0) {
                chunks.push(chunk.subarray(0, newlineIndex));
                break;
            }
            chunks.push(chunk);
        }
    }
    finally {
        await handle.close();
    }
    return Buffer.concat(chunks).toString("utf8");
};
const readSessionHeader = async (file) => {
    const headerLine = await readFirstLine(file);
    if (!headerLine) {
        throw new Error(`Malformed Pi session file ${file}: missing header`);
    }
    const header = parseJsonLine(headerLine, file);
    if (header.type !== "session") {
        throw new Error(`Malformed Pi session file ${file}: first entry is not a session header`);
    }
    if (!SUPPORTED_SESSION_VERSIONS.includes(header.version)) {
        throw new Error(`Unsupported Pi session version ${header.version} in ${file}`);
    }
    if (typeof header.cwd !== "string" || typeof header.timestamp !== "string") {
        throw new Error(`Malformed Pi session header in ${file}`);
    }
    return header;
};
const textFromContent = (content) => {
    if (typeof content === "string") {
        return [content];
    }
    if (!Array.isArray(content)) {
        return [];
    }
    const parts = [];
    for (const block of content) {
        if (!block || typeof block !== "object") {
            continue;
        }
        const typed = block;
        if (typed.type === "text" && typeof typed.text === "string") {
            parts.push(typed.text);
        }
    }
    return parts;
};
const TRANSCRIPT_FOOTER = "\n[brainerd] Transcript truncated to fit the session history budget.";
const readSessionTranscript = async (file, maxCharsPerSession) => {
    const transcriptLines = [];
    const assistantModels = new Set();
    const warnings = [];
    let messageCount = 0;
    let transcriptLength = 0;
    let truncated = false;
    const appendTranscript = (line) => {
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
    let lineNumber = 0;
    for await (const line of stream) {
        if (!line) {
            continue;
        }
        lineNumber += 1;
        if (lineNumber === 1) {
            continue;
        }
        let entry;
        try {
            entry = parseJsonLine(line, file);
        }
        catch (error) {
            warnings.push(error.message);
            continue;
        }
        if (!isMessageEntry(entry) || !entry.message?.role) {
            continue;
        }
        const role = entry.message.role;
        const text = textFromContent(entry.message.content).join("\n").trim();
        if (!text) {
            continue;
        }
        messageCount += 1;
        if (role === "assistant" && entry.message.provider && entry.message.model) {
            assistantModels.add(`${entry.message.provider}/${entry.message.model}`);
        }
        if (role === "user") {
            appendTranscript(`User: ${text}`);
            continue;
        }
        if (role === "assistant") {
            appendTranscript(`Assistant: ${text}`);
            continue;
        }
        if (role === "toolResult") {
            const prefix = entry.message.isError
                ? `Tool ${entry.message.toolName ?? "unknown"} error`
                : `Tool ${entry.message.toolName ?? "unknown"} result`;
            appendTranscript(`${prefix}: ${text}`);
        }
    }
    const transcript = transcriptLines.join("\n\n");
    return {
        transcript: truncated ? `${transcript}${TRANSCRIPT_FOOTER}` : transcript,
        assistantModels: Array.from(assistantModels).sort((a, b) => a.localeCompare(b)),
        messageCount,
        warnings,
    };
};
export const collectRepoSessions = async (options) => {
    const repoRoot = await resolveProjectRoot(options.cwd);
    const sessionsRoot = options.sessionsRoot ?? path.join(os.homedir(), ".pi/agent/sessions");
    const files = await walkFiles(sessionsRoot);
    const currentSessionFile = options.currentSessionFile ? path.resolve(options.currentSessionFile) : undefined;
    const maxSessions = options.maxSessions ?? 25;
    const maxCharsPerSession = options.maxCharsPerSession ?? 8_000;
    const candidates = [];
    const warnings = [];
    for (const file of files.sort((a, b) => a.localeCompare(b))) {
        if (currentSessionFile && path.resolve(file) === currentSessionFile) {
            continue;
        }
        try {
            const header = await readSessionHeader(file);
            if (!isSameOrDescendant(repoRoot, header.cwd)) {
                continue;
            }
            candidates.push({ file, header });
        }
        catch (error) {
            warnings.push(error.message);
        }
    }
    candidates.sort((a, b) => b.header.timestamp.localeCompare(a.header.timestamp));
    const sessions = [];
    for (const candidate of candidates.slice(0, maxSessions)) {
        try {
            const { transcript, assistantModels, messageCount, warnings: sessionWarnings } = await readSessionTranscript(candidate.file, maxCharsPerSession);
            warnings.push(...sessionWarnings);
            sessions.push({
                file: candidate.file,
                cwd: candidate.header.cwd,
                startedAt: candidate.header.timestamp,
                transcript,
                assistantModels,
                messageCount,
            });
        }
        catch (error) {
            warnings.push(error.message);
        }
    }
    return { repoRoot, sessions, warnings };
};
