#!/usr/bin/env node

import fs from "node:fs/promises";

const SESSION_ID_VAR = "BRAINERD_CLAUDE_SESSION_ID";
const TRANSCRIPT_PATH_VAR = "BRAINERD_CLAUDE_TRANSCRIPT_PATH";

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk));
  }
  return chunks.join("").trim();
};

const quoteShellValue = (value) =>
  `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")}"`;

const upsertExportLine = (lines, name, value) => {
  const next = lines.filter((line) => !line.startsWith(`export ${name}=`));
  if (typeof value === "string" && value.trim()) {
    next.push(`export ${name}=${quoteShellValue(value)}`);
  }
  return next;
};

const main = async () => {
  const raw = await readStdin();
  const payload = raw ? JSON.parse(raw) : {};
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) {
    return;
  }

  const sessionId =
    (typeof payload.session_id === "string" && payload.session_id) ||
    (typeof payload.sessionId === "string" && payload.sessionId) ||
    "";
  const transcriptPath =
    (typeof payload.transcript_path === "string" && payload.transcript_path) ||
    (typeof payload.transcriptPath === "string" && payload.transcriptPath) ||
    "";

  let lines = [];
  try {
    lines = (await fs.readFile(envFile, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  lines = upsertExportLine(lines, SESSION_ID_VAR, sessionId);
  lines = upsertExportLine(lines, TRANSCRIPT_PATH_VAR, transcriptPath);

  await fs.writeFile(envFile, `${lines.join("\n")}\n`);
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
