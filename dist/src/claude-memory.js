import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_IMPORTS_DIR } from "./constants.js";
import { exists, readFileIfPresent, resolveSafeRepoPath } from "./fs-helpers.js";
import { findClaudeProjectDirForRepo } from "./claude-sessions.js";
import { toPortablePath } from "./project-root.js";
const ensureTrailingNewline = (content) => (content.endsWith("\n") ? content : `${content}\n`);
const writeIfChanged = async (target, content) => {
    const current = await readFileIfPresent(target);
    if (current === content) {
        return false;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    return true;
};
const renderImportedMemory = (sourceFile, content) => [
    `<!-- Managed by Brainerd from Claude auto memory. Source: ${toPortablePath(sourceFile)} -->`,
    "",
    ensureTrailingNewline(content).trimEnd(),
    "",
].join("\n");
const listMemoryFiles = async (memoryDir) => {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => path.join(memoryDir, entry.name))
        .sort((left, right) => left.localeCompare(right));
};
export const syncClaudeMemoryImports = async (projectRoot, projectsRoot) => {
    const projectDir = await findClaudeProjectDirForRepo(projectRoot, projectsRoot);
    const importRoot = await resolveSafeRepoPath(projectRoot, CLAUDE_IMPORTS_DIR);
    if (!projectDir) {
        const existing = await exists(importRoot);
        if (existing) {
            await fs.rm(importRoot, { recursive: true, force: true });
        }
        return {
            projectDir: null,
            memoryDir: null,
            sourceFiles: [],
            imported: [],
            removed: existing ? [CLAUDE_IMPORTS_DIR] : [],
            skippedReason: "No Claude project directory matched this repo.",
        };
    }
    const memoryDir = path.join(projectDir, "memory");
    if (!(await exists(memoryDir))) {
        const existing = await exists(importRoot);
        if (existing) {
            await fs.rm(importRoot, { recursive: true, force: true });
        }
        return {
            projectDir,
            memoryDir: null,
            sourceFiles: [],
            imported: [],
            removed: existing ? [CLAUDE_IMPORTS_DIR] : [],
            skippedReason: "Claude auto memory has not been created for this project yet.",
        };
    }
    const sourceFiles = await listMemoryFiles(memoryDir);
    const imported = [];
    const expectedTargets = new Set();
    await fs.mkdir(importRoot, { recursive: true });
    for (const sourceFile of sourceFiles) {
        const relativeTarget = `${CLAUDE_IMPORTS_DIR}/${path.basename(sourceFile)}`;
        expectedTargets.add(relativeTarget);
        const target = await resolveSafeRepoPath(projectRoot, relativeTarget);
        const content = renderImportedMemory(sourceFile, await fs.readFile(sourceFile, "utf8"));
        if (await writeIfChanged(target, content)) {
            imported.push(relativeTarget);
        }
    }
    const removed = [];
    const existingEntries = await fs.readdir(importRoot, { withFileTypes: true });
    for (const entry of existingEntries) {
        if (!entry.isFile()) {
            continue;
        }
        const relativeTarget = `${CLAUDE_IMPORTS_DIR}/${entry.name}`;
        if (expectedTargets.has(relativeTarget)) {
            continue;
        }
        await fs.rm(await resolveSafeRepoPath(projectRoot, relativeTarget), { force: true });
        removed.push(relativeTarget);
    }
    return {
        projectDir,
        memoryDir,
        sourceFiles: sourceFiles.map((sourceFile) => toPortablePath(sourceFile)),
        imported,
        removed,
    };
};
