import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAIN_DIR, BRAIN_VERSION_FILE, CLAUDE_IMPORTS_DIR, INDEX_ENTRYPOINT, LEGACY_VERSION_FILE, NOTES_DIR, PACKAGE_VERSION, PRINCIPLES_ENTRYPOINT, } from "./constants.js";
import { exists, normalizeRepoRelativePath, readFileIfPresent, resolveSafeRepoPath } from "./fs-helpers.js";
import { toPortablePath } from "./project-root.js";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.basename(moduleDir) === "src" && path.basename(path.dirname(moduleDir)) === "dist"
    ? path.dirname(path.dirname(moduleDir))
    : path.dirname(moduleDir);
const STARTER_BRAIN_ROOT = path.join(packageRoot, "brain");
const LOCKFILE_NAME = ".brainerd.lock";
const LOCK_STALE_MS = 30_000;
const LOCK_INVALID_STALE_MS = 250;
const walkFiles = async (root) => {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const files = [];
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
const starterFiles = async () => {
    const files = await walkFiles(STARTER_BRAIN_ROOT);
    return files
        .filter((file) => {
        const relativePath = toPortablePath(path.relative(path.dirname(STARTER_BRAIN_ROOT), file));
        return !relativePath.startsWith(`${NOTES_DIR}/`);
    })
        .sort((a, b) => a.localeCompare(b));
};
const starterRelativePath = (file) => toPortablePath(path.relative(path.dirname(STARTER_BRAIN_ROOT), file));
const uniqueSorted = (items) => Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fileAgeMs = async (target) => {
    try {
        const stat = await fs.stat(target);
        return Date.now() - stat.mtimeMs;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
};
const isAlivePid = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === "EPERM";
    }
};
const staleLock = async (lockPath) => {
    const raw = await readFileIfPresent(lockPath);
    if (!raw) {
        const age = await fileAgeMs(lockPath);
        return age !== null && age > LOCK_INVALID_STALE_MS;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.pid === "number" && !isAlivePid(parsed.pid)) {
            return true;
        }
        if (typeof parsed.createdAt === "string") {
            const createdAt = Date.parse(parsed.createdAt);
            if (Number.isFinite(createdAt) && Date.now() - createdAt > LOCK_STALE_MS) {
                return true;
            }
        }
    }
    catch {
        const age = await fileAgeMs(lockPath);
        return age !== null && age > LOCK_INVALID_STALE_MS;
    }
    return false;
};
const withBrainLock = async (projectRoot, work) => {
    const brainRoot = await resolveSafeRepoPath(projectRoot, BRAIN_DIR);
    const lockPath = await resolveSafeRepoPath(projectRoot, `${BRAIN_DIR}/${LOCKFILE_NAME}`);
    await fs.mkdir(brainRoot, { recursive: true });
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            const handle = await fs.open(lockPath, "wx");
            try {
                await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
                return await work();
            }
            finally {
                await handle.close();
                await fs.rm(lockPath, { force: true });
            }
        }
        catch (error) {
            if (error.code !== "EEXIST") {
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
const waitForUnlocked = async (projectRoot) => {
    const lockPath = await resolveSafeRepoPath(projectRoot, `${BRAIN_DIR}/${LOCKFILE_NAME}`);
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
export const readBrainState = async (projectRoot) => {
    const statePath = await resolveSafeRepoPath(projectRoot, BRAIN_VERSION_FILE);
    const legacyStatePath = await resolveSafeRepoPath(projectRoot, LEGACY_VERSION_FILE);
    const raw = (await readFileIfPresent(statePath)) ??
        (await readFileIfPresent(legacyStatePath));
    if (!raw) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Malformed ${BRAIN_VERSION_FILE}: ${error.message}`);
    }
    if (typeof parsed.version !== "string" || !Array.isArray(parsed.ownedFiles)) {
        throw new Error(`Invalid ${BRAIN_VERSION_FILE}`);
    }
    return {
        version: parsed.version,
        ownedFiles: uniqueSorted(parsed.ownedFiles
            .filter((item) => typeof item === "string")
            .map((item) => (item === LEGACY_VERSION_FILE ? BRAIN_VERSION_FILE : item))),
    };
};
const writeBrainState = async (projectRoot, state) => {
    const brainRoot = await resolveSafeRepoPath(projectRoot, BRAIN_DIR);
    const statePath = await resolveSafeRepoPath(projectRoot, BRAIN_VERSION_FILE);
    await fs.mkdir(brainRoot, { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({
        version: state.version,
        ownedFiles: uniqueSorted(state.ownedFiles),
    }, null, 2) + "\n");
    await fs.rm(path.join(projectRoot, LEGACY_VERSION_FILE), { force: true });
};
export const initBrain = async (projectRoot) => {
    return withBrainLock(projectRoot, async () => {
        const starter = await starterFiles();
        const state = (await readBrainState(projectRoot)) ?? { version: PACKAGE_VERSION, ownedFiles: [] };
        const created = [];
        const preserved = [];
        for (const file of starter) {
            const relativePath = starterRelativePath(file);
            if (relativePath === BRAIN_VERSION_FILE) {
                continue;
            }
            const destination = await resolveSafeRepoPath(projectRoot, relativePath);
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
const parseTitle = (content, fallback) => {
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("# ")) {
            return trimmed.slice(2).trim();
        }
    }
    return fallback;
};
const parseSummary = (content) => {
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        return trimmed.replace(/^[-*]\s+/, "").trim();
    }
    return "No summary yet.";
};
const readPrinciples = async (projectRoot) => {
    const principlesRoot = await resolveSafeRepoPath(projectRoot, "brain/principles");
    if (!(await exists(principlesRoot))) {
        return [];
    }
    const files = (await walkFiles(principlesRoot))
        .filter((file) => file.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b));
    const descriptors = [];
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
const readNotes = async (projectRoot) => {
    const notesRoot = await resolveSafeRepoPath(projectRoot, NOTES_DIR);
    if (!(await exists(notesRoot))) {
        return [];
    }
    return (await walkFiles(notesRoot))
        .filter((file) => file.endsWith(".md"))
        .map((file) => toPortablePath(path.relative(path.join(projectRoot, "brain"), file)))
        .sort((a, b) => a.localeCompare(b));
};
const readManagedImports = async (projectRoot, relativeRoot) => {
    const importRoot = await resolveSafeRepoPath(projectRoot, relativeRoot);
    if (!(await exists(importRoot))) {
        return [];
    }
    return (await walkFiles(importRoot))
        .filter((file) => file.endsWith(".md"))
        .map((file) => toPortablePath(path.relative(path.join(projectRoot, "brain"), file)))
        .sort((a, b) => a.localeCompare(b));
};
const buildPrinciplesEntrypoint = (principles) => {
    const lines = [
        "# Principles",
        "",
        "<!-- Managed by pi-brainerd when this file is package-owned. Edit linked",
        "principle files instead of editing this entrypoint directly. -->",
        "",
        "Read this file first, then open the linked principle files that matter to the",
        "current task.",
        "",
    ];
    if (principles.length === 0) {
        lines.push("No principle files exist yet.");
    }
    else {
        for (const principle of principles) {
            lines.push(`- [[${principle.relativePath}]] - ${principle.summary}`);
        }
    }
    lines.push("");
    return lines.join("\n");
};
const buildIndexEntrypoint = (principles, notes, claudeImports) => {
    const lines = [
        "# Brain",
        "",
        "<!-- Managed by pi-brainerd when this file is package-owned. Edit linked",
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
        lines.push("Create focused notes under `brain/notes/` when a durable learning does not fit", "an existing principle file.");
    }
    else {
        for (const note of notes) {
            lines.push(`- [[${note}]]`);
        }
    }
    if (claudeImports.length > 0) {
        lines.push("", "## Imported Claude Memory", "");
        lines.push("These files are managed imports from Claude auto memory. Distill durable learnings into notes or principles instead of editing the imports directly.");
        lines.push("");
        for (const managedImport of claudeImports) {
            lines.push(`- [[${managedImport}]]`);
        }
    }
    lines.push("");
    return lines.join("\n");
};
const writeIfChanged = async (projectRoot, relativePath, content) => {
    const target = await resolveSafeRepoPath(projectRoot, relativePath);
    const current = await readFileIfPresent(target);
    if (current === content) {
        return false;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    return true;
};
const syncOwnedEntryPointsUnlocked = async (projectRoot, state) => {
    const principles = await readPrinciples(projectRoot);
    const notes = await readNotes(projectRoot);
    const claudeImports = await readManagedImports(projectRoot, CLAUDE_IMPORTS_DIR);
    const updated = [];
    const skipped = [];
    if (state.ownedFiles.includes(PRINCIPLES_ENTRYPOINT)) {
        if (await writeIfChanged(projectRoot, PRINCIPLES_ENTRYPOINT, buildPrinciplesEntrypoint(principles))) {
            updated.push(PRINCIPLES_ENTRYPOINT);
        }
    }
    else {
        skipped.push(PRINCIPLES_ENTRYPOINT);
    }
    if (state.ownedFiles.includes(INDEX_ENTRYPOINT)) {
        if (await writeIfChanged(projectRoot, INDEX_ENTRYPOINT, buildIndexEntrypoint(principles, notes, claudeImports))) {
            updated.push(INDEX_ENTRYPOINT);
        }
    }
    else {
        skipped.push(INDEX_ENTRYPOINT);
    }
    return { updated, skipped };
};
const ensureTrailingNewline = (content) => (content.endsWith("\n") ? content : `${content}\n`);
const isAllowedBrainChangePath = (relativePath) => {
    if (!relativePath.endsWith(".md")) {
        return false;
    }
    if (relativePath === INDEX_ENTRYPOINT || relativePath === PRINCIPLES_ENTRYPOINT || relativePath === BRAIN_VERSION_FILE) {
        return false;
    }
    return relativePath.startsWith(`${NOTES_DIR}/`) || relativePath.startsWith("brain/principles/");
};
export const syncOwnedEntryPoints = async (projectRoot) => {
    return withBrainLock(projectRoot, async () => {
        const state = await readBrainState(projectRoot);
        if (!state) {
            return { updated: [], skipped: [INDEX_ENTRYPOINT, PRINCIPLES_ENTRYPOINT] };
        }
        return syncOwnedEntryPointsUnlocked(projectRoot, state);
    });
};
export const readEntrypoints = async (projectRoot) => {
    await waitForUnlocked(projectRoot);
    const index = await readFileIfPresent(await resolveSafeRepoPath(projectRoot, INDEX_ENTRYPOINT));
    const principles = await readFileIfPresent(await resolveSafeRepoPath(projectRoot, PRINCIPLES_ENTRYPOINT));
    if (!index || !principles) {
        return null;
    }
    return { index, principles };
};
export const writeNoteIfMissing = async (projectRoot, noteRelativePath, content) => {
    const portablePath = normalizeRepoRelativePath(noteRelativePath);
    if (!portablePath.startsWith(`${NOTES_DIR}/`) || !portablePath.endsWith(".md")) {
        throw new Error(`Notes must live under ${NOTES_DIR}/ and end in .md`);
    }
    return withBrainLock(projectRoot, async () => {
        const state = await readBrainState(projectRoot);
        if (!state) {
            throw new Error("No project brain found. Run pi-init, codex-init, or claude-init first.");
        }
        const destination = await resolveSafeRepoPath(projectRoot, portablePath);
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
export const applyBrainChanges = async (projectRoot, changes) => {
    const normalizedChanges = changes.map((change) => ({
        path: normalizeRepoRelativePath(change.path),
        content: ensureTrailingNewline(change.content),
    }));
    const seenPaths = new Set();
    for (const change of normalizedChanges) {
        if (!isAllowedBrainChangePath(change.path)) {
            throw new Error(`Brain changes must target markdown files under ${NOTES_DIR}/ or brain/principles/. Rejected: ${change.path}`);
        }
        if (seenPaths.has(change.path)) {
            throw new Error(`Duplicate brain change target: ${change.path}`);
        }
        seenPaths.add(change.path);
    }
    return withBrainLock(projectRoot, async () => {
        const state = await readBrainState(projectRoot);
        if (!state) {
            throw new Error("No project brain found. Run pi-init, codex-init, or claude-init first.");
        }
        const changed = [];
        for (const change of normalizedChanges) {
            if (await writeIfChanged(projectRoot, change.path, change.content)) {
                changed.push(change.path);
            }
        }
        const sync = await syncOwnedEntryPointsUnlocked(projectRoot, state);
        return {
            changed: uniqueSorted(changed),
            synced: sync.updated,
        };
    });
};
