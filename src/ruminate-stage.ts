import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyBrainChanges, readBrainState, type ApplyBrainChangesResult, type BrainChange } from "./brain.js";
import { resolveSafeRepoPath } from "./fs-helpers.js";

export type HarnessRuminateStage = {
  stageId: string;
  repoRoot: string;
  createdAt: string;
  findingsSummary: string;
  rationale: string;
  changes: BrainChange[];
  status: "staged" | "applied" | "discarded";
  changedFiles?: string[];
  syncedFiles?: string[];
};

export type HarnessStageInput = {
  findingsSummary: string;
  rationale: string;
  changes: BrainChange[];
};

export type HarnessStageConfig = {
  label: string;
  stageFile: string;
  legacyStageFiles?: readonly string[];
  missingBrainMessage: string;
};

const normalizeChanges = (changes: BrainChange[]): BrainChange[] =>
  changes
    .filter((change): change is BrainChange => Boolean(change && typeof change.path === "string" && typeof change.content === "string"))
    .map((change) => ({
      path: change.path,
      content: change.content,
    }));

const validateStageInput = (config: HarnessStageConfig, input: HarnessStageInput): HarnessStageInput => {
  const findingsSummary = input.findingsSummary.trim();
  const rationale = input.rationale.trim();
  const changes = normalizeChanges(input.changes);

  if (!findingsSummary) {
    throw new Error(`${config.label} rumination staging requires a non-empty findingsSummary.`);
  }
  if (!rationale) {
    throw new Error(`${config.label} rumination staging requires a non-empty rationale.`);
  }
  if (changes.length === 0) {
    throw new Error(`${config.label} rumination staging requires at least one proposed brain change.`);
  }

  return {
    findingsSummary,
    rationale,
    changes,
  };
};

const allStageFiles = (config: HarnessStageConfig): string[] =>
  [config.stageFile, ...(config.legacyStageFiles ?? [])].filter((value, index, items) => items.indexOf(value) === index);

const writeStage = async (projectRoot: string, config: HarnessStageConfig, stage: HarnessRuminateStage): Promise<void> => {
  const target = await resolveSafeRepoPath(projectRoot, config.stageFile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(stage, null, 2)}\n`);

  for (const legacyFile of allStageFiles(config)) {
    if (legacyFile === config.stageFile) {
      continue;
    }
    await fs.rm(await resolveSafeRepoPath(projectRoot, legacyFile), { force: true });
  }
};

export const getHarnessRuminateStage = async (
  projectRoot: string,
  config: HarnessStageConfig,
): Promise<HarnessRuminateStage | null> => {
  for (const relativePath of allStageFiles(config)) {
    const target = await resolveSafeRepoPath(projectRoot, relativePath);
    try {
      const raw = await fs.readFile(target, "utf8");
      const parsed = JSON.parse(raw) as Partial<HarnessRuminateStage>;
      if (
        typeof parsed.stageId !== "string" ||
        typeof parsed.repoRoot !== "string" ||
        typeof parsed.createdAt !== "string" ||
        typeof parsed.findingsSummary !== "string" ||
        typeof parsed.rationale !== "string" ||
        !Array.isArray(parsed.changes) ||
        (parsed.status !== "staged" && parsed.status !== "applied" && parsed.status !== "discarded")
      ) {
        throw new Error(`Malformed ${path.relative(projectRoot, target)}`);
      }
      if (path.resolve(parsed.repoRoot) !== path.resolve(projectRoot)) {
        throw new Error(`Staged ${config.label} rumination preview belongs to ${parsed.repoRoot}, not ${projectRoot}.`);
      }

      return {
        stageId: parsed.stageId,
        repoRoot: parsed.repoRoot,
        createdAt: parsed.createdAt,
        findingsSummary: parsed.findingsSummary,
        rationale: parsed.rationale,
        changes: normalizeChanges(parsed.changes),
        status: parsed.status,
        changedFiles: Array.isArray(parsed.changedFiles) ? parsed.changedFiles.filter((item): item is string => typeof item === "string") : [],
        syncedFiles: Array.isArray(parsed.syncedFiles) ? parsed.syncedFiles.filter((item): item is string => typeof item === "string") : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return null;
};

export const stageHarnessRuminate = async (
  projectRoot: string,
  config: HarnessStageConfig,
  input: HarnessStageInput,
): Promise<HarnessRuminateStage> => {
  if (!(await readBrainState(projectRoot))) {
    throw new Error(config.missingBrainMessage);
  }

  const validated = validateStageInput(config, input);
  const stage: HarnessRuminateStage = {
    stageId: randomUUID(),
    repoRoot: projectRoot,
    createdAt: new Date().toISOString(),
    findingsSummary: validated.findingsSummary,
    rationale: validated.rationale,
    changes: validated.changes,
    status: "staged",
  };
  await writeStage(projectRoot, config, stage);
  return stage;
};

export const discardHarnessRuminateStage = async (
  projectRoot: string,
  config: HarnessStageConfig,
): Promise<HarnessRuminateStage | null> => {
  const stage = await getHarnessRuminateStage(projectRoot, config);
  if (!stage) {
    return null;
  }

  const discarded: HarnessRuminateStage = {
    ...stage,
    status: "discarded",
  };
  await writeStage(projectRoot, config, discarded);
  return discarded;
};

export const applyHarnessRuminateStage = async (
  projectRoot: string,
  config: HarnessStageConfig,
  expectedStageId?: string,
): Promise<{ stage: HarnessRuminateStage; apply: ApplyBrainChangesResult }> => {
  const stage = await getHarnessRuminateStage(projectRoot, config);
  if (!stage || stage.status !== "staged") {
    throw new Error(`No staged ${config.label} rumination preview is available.`);
  }
  if (expectedStageId && stage.stageId !== expectedStageId) {
    throw new Error(`Staged ${config.label} rumination preview ${expectedStageId} was not found.`);
  }

  const apply = await applyBrainChanges(projectRoot, stage.changes);
  const appliedStage: HarnessRuminateStage = {
    ...stage,
    status: "applied",
    changedFiles: apply.changed,
    syncedFiles: apply.synced,
  };
  await writeStage(projectRoot, config, appliedStage);
  return {
    stage: appliedStage,
    apply,
  };
};
