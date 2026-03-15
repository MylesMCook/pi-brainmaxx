import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAIN_DIR,
  BRAIN_VERSION_FILE,
  INDEX_ENTRYPOINT,
  NOTES_DIR,
  PACKAGE_VERSION,
  PRINCIPLES_ENTRYPOINT,
} from "./constants.js";
import { exists, readFileIfPresent } from "./fs-helpers.js";
import { toPortablePath } from "./project-root.js";

export type BrainState = {
  version: string;
  ownedFiles: string[];
};

export type BrainInitResult = {
  created: string[];
  preserved: string[];
  ownedFiles: string[];
  synced: string[];
};

export type BrainSyncResult = {
  updated: string[];
  skipped: string[];
};

export type BrainNoteWriteResult = {
  created: boolean;
  synced: string[];
};

const STARTER_BRAIN_ROOT = fileURLToPath(new URL("../brain", import.meta.url));
const LOCKFILE_NAME = ".brainmaxx.lock";
const LOCK_STALE_MS = 30_000;
const LOCK_INVALID_STALE_MS = 250;

const walkFiles = async (root: string): Promise<string[]> => {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(target)));
      continue;
    }
    if (entry.isFile()) {
      files.push(target);
    }
  }

  return files;
};

const starterFiles = async (): Promise<string[]> => {
  const files = await walkFiles(STARTER_BRAIN_ROOT);
  return files.sort((a, b) => a.localeCompare(b));
};

const starterRelativePath = (file: string): string =>
  toPortablePath(path.relative(path.dirname(STARTER_BRAIN_ROOT), file));

const toProjectPath = (projectRoot: string, relativePath: string): string => path.join(projectRoot, relativePath);

const uniqueSorted = (items: string[]): string[] => Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fileAgeMs = async (target: string): Promise<number | null> => {
  try {
    const stat = await fs.stat(target);
    return Date.now() - stat.mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const isAlivePid = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const staleLock = async (lockPath: string): Promise<boolean> => {
  const raw = await readFileIfPresent(lockPath);
  if (!raw) {
    const age = await fileAgeMs(lockPath);
    return age !== null && age > LOCK_INVALID_STALE_MS;
  }

  try {
    const parsed = JSON.parse(raw) as { pid?: number; createdAt?: string };
    if (typeof parsed.pid === "number" && !isAlivePid(parsed.pid)) {
      return true;
    }
    if (typeof parsed.createdAt === "string") {
      const createdAt = Date.parse(parsed.createdAt);
      if (Number.isFinite(createdAt) && Date.now() - createdAt > LOCK_STALE_MS) {
        return true;
      }
    }
  } catch {
    const age = await fileAgeMs(lockPath);
    return age !== null && age > LOCK_INVALID_STALE_MS;
  }

  return false;
};

const withBrainLock = async <T>(projectRoot: string, work: () => Promise<T>): Promise<T> => {
  const brainRoot = path.join(projectRoot, BRAIN_DIR);
  const lockPath = path.join(brainRoot, LOCKFILE_NAME);
  await fs.mkdir(brainRoot, { recursive: true });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        return await work();
      } finally {
        await handle.close();
        await fs.rm(lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      if (await staleLock(lockPath)) {
        await fs.rm(lockPath, { force: true });
        continue;
      }
      await sleep(100);
    }
  }

  throw new Error(`Timed out waiting for ${lockPath}`);
};

const waitForUnlocked = async (projectRoot: string): Promise<void> => {
  const lockPath = path.join(projectRoot, BRAIN_DIR, LOCKFILE_NAME);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await exists(lockPath))) {
      return;
    }
    if (await staleLock(lockPath)) {
      await fs.rm(lockPath, { force: true });
      return;
    }
    await sleep(100);
  }

  throw new Error(`Timed out waiting for ${lockPath}`);
};

export const readBrainState = async (projectRoot: string): Promise<BrainState | null> => {
  const raw = await readFileIfPresent(path.join(projectRoot, BRAIN_VERSION_FILE));
  if (!raw) {
    return null;
  }

  let parsed: Partial<BrainState>;
  try {
    parsed = JSON.parse(raw) as Partial<BrainState>;
  } catch (error) {
    throw new Error(`Malformed ${BRAIN_VERSION_FILE}: ${(error as Error).message}`);
  }
  if (typeof parsed.version !== "string" || !Array.isArray(parsed.ownedFiles)) {
    throw new Error(`Invalid ${BRAIN_VERSION_FILE}`);
  }

  return {
    version: parsed.version,
    ownedFiles: uniqueSorted(parsed.ownedFiles.filter((item): item is string => typeof item === "string")),
  };
};

const writeBrainState = async (projectRoot: string, state: BrainState): Promise<void> => {
  await fs.mkdir(path.join(projectRoot, BRAIN_DIR), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, BRAIN_VERSION_FILE),
    JSON.stringify(
      {
        version: state.version,
        ownedFiles: uniqueSorted(state.ownedFiles),
      },
      null,
      2,
    ) + "\n",
  );
};

export const initBrain = async (projectRoot: string): Promise<BrainInitResult> => {
  return withBrainLock(projectRoot, async () => {
    const starter = await starterFiles();
    const state = (await readBrainState(projectRoot)) ?? { version: PACKAGE_VERSION, ownedFiles: [] };
    const created: string[] = [];
    const preserved: string[] = [];

    for (const file of starter) {
      const relativePath = starterRelativePath(file);
      if (relativePath === BRAIN_VERSION_FILE) {
        continue;
      }

      const destination = toProjectPath(projectRoot, relativePath);
      if (await exists(destination)) {
        preserved.push(relativePath);
        continue;
      }

      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(file, destination);
      created.push(relativePath);
      state.ownedFiles.push(relativePath);
    }

    state.version = PACKAGE_VERSION;
    state.ownedFiles.push(BRAIN_VERSION_FILE);
    await writeBrainState(projectRoot, state);
    const sync = await syncOwnedEntryPointsUnlocked(projectRoot, {
      version: state.version,
      ownedFiles: uniqueSorted(state.ownedFiles),
    });

    return {
      created: uniqueSorted(created),
      preserved: uniqueSorted(preserved),
      ownedFiles: uniqueSorted(state.ownedFiles),
      synced: sync.updated,
    };
  });
};

type PrincipleDescriptor = {
  relativePath: string;
  title: string;
  summary: string;
};

const parseTitle = (content: string, fallback: string): string => {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim();
    }
  }
  return fallback;
};

const parseSummary = (content: string): string => {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    return trimmed.replace(/^[-*]\s+/, "").trim();
  }
  return "No summary yet.";
};

const readPrinciples = async (projectRoot: string): Promise<PrincipleDescriptor[]> => {
  const principlesRoot = path.join(projectRoot, "brain/principles");
  if (!(await exists(principlesRoot))) {
    return [];
  }

  const files = (await walkFiles(principlesRoot))
    .filter((file) => file.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const descriptors: PrincipleDescriptor[] = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const relativePath = toPortablePath(path.relative(path.join(projectRoot, "brain"), file));
    descriptors.push({
      relativePath,
      title: parseTitle(content, path.basename(file, ".md")),
      summary: parseSummary(content),
    });
  }

  return descriptors;
};

const readNotes = async (projectRoot: string): Promise<string[]> => {
  const notesRoot = path.join(projectRoot, NOTES_DIR);
  if (!(await exists(notesRoot))) {
    return [];
  }

  return (await walkFiles(notesRoot))
    .filter((file) => file.endsWith(".md"))
    .map((file) => toPortablePath(path.relative(path.join(projectRoot, "brain"), file)))
    .sort((a, b) => a.localeCompare(b));
};

const buildPrinciplesEntrypoint = (principles: PrincipleDescriptor[]): string => {
  const lines = [
    "# Principles",
    "",
    "<!-- Managed by pi-brainmaxx when this file is package-owned. Edit linked",
    "principle files instead of editing this entrypoint directly. -->",
    "",
    "Read this file first, then open the linked principle files that matter to the",
    "current task.",
    "",
  ];

  if (principles.length === 0) {
    lines.push("No principle files exist yet.");
  } else {
    for (const principle of principles) {
      lines.push(`- [[${principle.relativePath}]] - ${principle.summary}`);
    }
  }

  lines.push("");
  return lines.join("\n");
};

const buildIndexEntrypoint = (principles: PrincipleDescriptor[], notes: string[]): string => {
  const lines = [
    "# Brain",
    "",
    "<!-- Managed by pi-brainmaxx when this file is package-owned. Edit linked",
    "principle files or notes instead of editing this entrypoint directly. -->",
    "",
    "This project brain stores durable repo memory.",
    "",
    "## Entry Points",
    "",
    "- [[principles.md]] - Stable engineering principles, preferences, and defaults.",
    "",
  ];

  if (principles.length > 0) {
    lines.push("## Principle Files", "");
    for (const principle of principles) {
      lines.push(`- [[${principle.relativePath}]] - ${principle.title}`);
    }
    lines.push("");
  }

  lines.push("## Notes", "");
  if (notes.length === 0) {
    lines.push(
      "Create focused notes under `brain/notes/` when a durable learning does not fit",
      "an existing principle file.",
    );
  } else {
    for (const note of notes) {
      lines.push(`- [[${note}]]`);
    }
  }

  lines.push("");
  return lines.join("\n");
};

const writeIfChanged = async (target: string, content: string): Promise<boolean> => {
  const current = await readFileIfPresent(target);
  if (current === content) {
    return false;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return true;
};

const syncOwnedEntryPointsUnlocked = async (projectRoot: string, state: BrainState): Promise<BrainSyncResult> => {
  const principles = await readPrinciples(projectRoot);
  const notes = await readNotes(projectRoot);
  const updated: string[] = [];
  const skipped: string[] = [];

  if (state.ownedFiles.includes(PRINCIPLES_ENTRYPOINT)) {
    if (
      await writeIfChanged(
        path.join(projectRoot, PRINCIPLES_ENTRYPOINT),
        buildPrinciplesEntrypoint(principles),
      )
    ) {
      updated.push(PRINCIPLES_ENTRYPOINT);
    }
  } else {
    skipped.push(PRINCIPLES_ENTRYPOINT);
  }

  if (state.ownedFiles.includes(INDEX_ENTRYPOINT)) {
    if (await writeIfChanged(path.join(projectRoot, INDEX_ENTRYPOINT), buildIndexEntrypoint(principles, notes))) {
      updated.push(INDEX_ENTRYPOINT);
    }
  } else {
    skipped.push(INDEX_ENTRYPOINT);
  }

  return { updated, skipped };
};

const ensureTrailingNewline = (content: string): string => (content.endsWith("\n") ? content : `${content}\n`);

export const syncOwnedEntryPoints = async (projectRoot: string): Promise<BrainSyncResult> => {
  return withBrainLock(projectRoot, async () => {
    const state = await readBrainState(projectRoot);
    if (!state) {
      return { updated: [], skipped: [INDEX_ENTRYPOINT, PRINCIPLES_ENTRYPOINT] };
    }
    return syncOwnedEntryPointsUnlocked(projectRoot, state);
  });
};

export const readEntrypoints = async (projectRoot: string): Promise<{ index: string; principles: string } | null> => {
  await waitForUnlocked(projectRoot);
  const index = await readFileIfPresent(path.join(projectRoot, INDEX_ENTRYPOINT));
  const principles = await readFileIfPresent(path.join(projectRoot, PRINCIPLES_ENTRYPOINT));
  if (!index || !principles) {
    return null;
  }
  return { index, principles };
};

export const writeNoteIfMissing = async (
  projectRoot: string,
  noteRelativePath: string,
  content: string,
): Promise<BrainNoteWriteResult> => {
  const portablePath = toPortablePath(noteRelativePath);
  if (!portablePath.startsWith(`${NOTES_DIR}/`) || !portablePath.endsWith(".md")) {
    throw new Error(`Notes must live under ${NOTES_DIR}/ and end in .md`);
  }

  return withBrainLock(projectRoot, async () => {
    const state = await readBrainState(projectRoot);
    if (!state) {
      throw new Error("No project brain found. Run /brain-init first.");
    }

    const destination = path.join(projectRoot, portablePath);
    if (await exists(destination)) {
      return { created: false, synced: [] };
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, ensureTrailingNewline(content));

    const sync = await syncOwnedEntryPointsUnlocked(projectRoot, state);
    return {
      created: true,
      synced: sync.updated,
    };
  });
};
