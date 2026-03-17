import fs from "node:fs/promises";
import { readFileIfPresent, resolveSafeRepoPath } from "./fs-helpers.js";
export const BRAINERD_AGENTS_BLOCK_START = "<!-- brainerd:start -->";
export const BRAINERD_AGENTS_BLOCK_END = "<!-- brainerd:end -->";
export const LEGACY_MANAGED_BLOCK_START = "<!-- brainmaxx:start -->";
export const LEGACY_MANAGED_BLOCK_END = "<!-- brainmaxx:end -->";
const AGENTS_FILE = "AGENTS.md";
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockRegexes = [
    new RegExp(`${escapeRegex(BRAINERD_AGENTS_BLOCK_START)}[\\s\\S]*?${escapeRegex(BRAINERD_AGENTS_BLOCK_END)}`, "g"),
    new RegExp(`${escapeRegex(LEGACY_MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegex(LEGACY_MANAGED_BLOCK_END)}`, "g"),
];
const normalizeTrailingNewline = (value) => (value.endsWith("\n") ? value : `${value}\n`);
const findManagedBlocks = (content) => {
    const matches = [];
    for (const regex of blockRegexes) {
        for (const match of content.matchAll(regex)) {
            if (match.index === undefined) {
                continue;
            }
            matches.push({ start: match.index, end: match.index + match[0].length });
        }
    }
    return matches.sort((a, b) => a.start - b.start);
};
export const renderCodexAgentsBlock = () => [
    BRAINERD_AGENTS_BLOCK_START,
    "brainerd managed block",
    "",
    "This repo uses Brainerd.",
    "Before non-trivial repo work, read `brain/index.md` and `brain/principles.md`.",
    "Treat them as durable repo memory. Edit linked principle files or notes, not",
    "the generated entrypoints themselves. Use explicit Brainerd actions for",
    "init, reflect, or ruminate; do not perform memory writes automatically.",
    BRAINERD_AGENTS_BLOCK_END,
].join("\n");
export const stripCodexManagedBlock = (content) => {
    const stripped = blockRegexes.reduce((next, regex) => next.replace(regex, ""), content).replace(/\n{3,}/g, "\n\n").trim();
    return stripped === "" ? "" : `${stripped}\n`;
};
export const updateCodexAgentsContent = (content) => {
    const managedBlock = renderCodexAgentsBlock();
    const normalizedBlock = normalizeTrailingNewline(managedBlock);
    if (content === null) {
        return {
            status: "created",
            path: AGENTS_FILE,
            content: normalizedBlock,
        };
    }
    const blocks = findManagedBlocks(content);
    if (blocks.length > 1) {
        throw new Error(`Multiple Brainerd managed blocks found in ${AGENTS_FILE}. Clean them up manually before re-running brainerd-init.`);
    }
    const normalizedContent = normalizeTrailingNewline(content);
    if (blocks.length === 1) {
        const block = blocks[0];
        const updated = normalizedContent.slice(0, block.start) + managedBlock + normalizedContent.slice(block.end);
        const withNewline = normalizeTrailingNewline(updated);
        return {
            status: withNewline === normalizedContent ? "unchanged" : "updated",
            path: AGENTS_FILE,
            content: withNewline,
        };
    }
    const separator = normalizedContent.trim().length === 0 ? "" : "\n";
    return {
        status: "updated",
        path: AGENTS_FILE,
        content: `${normalizedContent}${separator}${normalizedBlock}`,
    };
};
export const upsertCodexAgentsBlock = async (projectRoot) => {
    const agentsPath = await resolveSafeRepoPath(projectRoot, AGENTS_FILE);
    const current = await readFileIfPresent(agentsPath);
    const updated = updateCodexAgentsContent(current);
    if (current !== updated.content) {
        await fs.writeFile(agentsPath, updated.content);
    }
    return updated;
};
export const planCodexAgentsUpdate = async (projectRoot) => {
    const agentsPath = await resolveSafeRepoPath(projectRoot, AGENTS_FILE);
    const current = await readFileIfPresent(agentsPath);
    return updateCodexAgentsContent(current);
};
