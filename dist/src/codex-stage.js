import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyBrainChanges, readBrainState } from "./brain.js";
import { CODEX_RUMINATE_STAGE_FILE, LEGACY_RUMINATE_STAGE_FILE } from "./constants.js";
import { resolveSafeRepoPath } from "./fs-helpers.js";
const normalizeChanges = (changes) => changes
    .filter((change) => Boolean(change && typeof change.path === "string" && typeof change.content === "string"))
    .map((change) => ({
    path: change.path,
    content: change.content,
}));
const validateStageInput = (input) => {
    const findingsSummary = input.findingsSummary.trim();
    const rationale = input.rationale.trim();
    const changes = normalizeChanges(input.changes);
    if (!findingsSummary) {
        throw new Error("Codex rumination staging requires a non-empty findingsSummary.");
    }
    if (!rationale) {
        throw new Error("Codex rumination staging requires a non-empty rationale.");
    }
    if (changes.length === 0) {
        throw new Error("Codex rumination staging requires at least one proposed brain change.");
    }
    return {
        findingsSummary,
        rationale,
        changes,
    };
};
const writeStage = async (projectRoot, stage) => {
    const target = await resolveSafeRepoPath(projectRoot, CODEX_RUMINATE_STAGE_FILE);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(stage, null, 2)}\n`);
    await fs.rm(await resolveSafeRepoPath(projectRoot, LEGACY_RUMINATE_STAGE_FILE), { force: true });
};
export const getCodexRuminateStage = async (projectRoot) => {
    for (const relativePath of [CODEX_RUMINATE_STAGE_FILE, LEGACY_RUMINATE_STAGE_FILE]) {
        const target = await resolveSafeRepoPath(projectRoot, relativePath);
        try {
            const raw = await fs.readFile(target, "utf8");
            const parsed = JSON.parse(raw);
            if (typeof parsed.stageId !== "string" ||
                typeof parsed.repoRoot !== "string" ||
                typeof parsed.createdAt !== "string" ||
                typeof parsed.findingsSummary !== "string" ||
                typeof parsed.rationale !== "string" ||
                !Array.isArray(parsed.changes) ||
                (parsed.status !== "staged" && parsed.status !== "applied" && parsed.status !== "discarded")) {
                throw new Error(`Malformed ${path.relative(projectRoot, target)}`);
            }
            if (path.resolve(parsed.repoRoot) !== path.resolve(projectRoot)) {
                throw new Error(`Staged Codex rumination preview belongs to ${parsed.repoRoot}, not ${projectRoot}.`);
            }
            return {
                stageId: parsed.stageId,
                repoRoot: parsed.repoRoot,
                createdAt: parsed.createdAt,
                findingsSummary: parsed.findingsSummary,
                rationale: parsed.rationale,
                changes: normalizeChanges(parsed.changes),
                status: parsed.status,
                changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles.filter((item) => typeof item === "string") : [],
                syncedFiles: Array.isArray(parsed.syncedFiles) ? parsed.syncedFiles.filter((item) => typeof item === "string") : [],
            };
        }
        catch (error) {
            if (error.code === "ENOENT") {
                continue;
            }
            throw error;
        }
    }
    return null;
};
export const stageCodexRuminate = async (projectRoot, input) => {
    if (!(await readBrainState(projectRoot))) {
        throw new Error("No project brain found. Run brainerd-init first.");
    }
    const validated = validateStageInput(input);
    const stage = {
        stageId: randomUUID(),
        repoRoot: projectRoot,
        createdAt: new Date().toISOString(),
        findingsSummary: validated.findingsSummary,
        rationale: validated.rationale,
        changes: validated.changes,
        status: "staged",
    };
    await writeStage(projectRoot, stage);
    return stage;
};
export const discardCodexRuminateStage = async (projectRoot) => {
    const stage = await getCodexRuminateStage(projectRoot);
    if (!stage) {
        return null;
    }
    const discarded = {
        ...stage,
        status: "discarded",
    };
    await writeStage(projectRoot, discarded);
    return discarded;
};
export const applyCodexRuminateStage = async (projectRoot, expectedStageId) => {
    const stage = await getCodexRuminateStage(projectRoot);
    if (!stage || stage.status !== "staged") {
        throw new Error("No staged Codex rumination preview is available.");
    }
    if (expectedStageId && stage.stageId !== expectedStageId) {
        throw new Error(`Staged Codex rumination preview ${expectedStageId} was not found.`);
    }
    const apply = await applyBrainChanges(projectRoot, stage.changes);
    const appliedStage = {
        ...stage,
        status: "applied",
        changedFiles: apply.changed,
        syncedFiles: apply.synced,
    };
    await writeStage(projectRoot, appliedStage);
    return {
        stage: appliedStage,
        apply,
    };
};
