import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyBrainChanges, readBrainState, type ApplyBrainChangesResult, type BrainChange } from "./brain.js";
import { CODEX_RUMINATE_STAGE_FILE } from "./constants.js";

export type CodexRuminateStage = {
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

export type CodexStageInput = {
  findingsSummary: string;
  rationale: string;
  changes: BrainChange[];
};

const stagePath = (projectRoot: string): string => path.join(projectRoot, CODEX_RUMINATE_STAGE_FILE);

const normalizeChanges = (changes: BrainChange[]): BrainChange[] =>
  changes
    .filter((change): change is BrainChange => Boolean(change && typeof change.path === "string" && typeof change.content === "string"))
    .map((change) => ({
      path: change.path,
      content: change.content,
    }));

const validateStageInput = (input: CodexStageInput): CodexStageInput => {
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

const writeStage = async (projectRoot: string, stage: CodexRuminateStage): Promise<void> => {
  const target = stagePath(projectRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(stage, null, 2)}\n`);
};

export const getCodexRuminateStage = async (projectRoot: string): Promise<CodexRuminateStage | null> => {
  const target = stagePath(projectRoot);
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as Partial<CodexRuminateStage>;
    if (
      typeof parsed.stageId !== "string" ||
      typeof parsed.repoRoot !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.findingsSummary !== "string" ||
      typeof parsed.rationale !== "string" ||
      !Array.isArray(parsed.changes) ||
      (parsed.status !== "staged" && parsed.status !== "applied" && parsed.status !== "discarded")
    ) {
      throw new Error(`Malformed ${CODEX_RUMINATE_STAGE_FILE}`);
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
      return null;
    }
    throw error;
  }
};

export const stageCodexRuminate = async (
  projectRoot: string,
  input: CodexStageInput,
): Promise<CodexRuminateStage> => {
  if (!(await readBrainState(projectRoot))) {
    throw new Error("No project brain found. Run brainmaxx-init first.");
  }

  const validated = validateStageInput(input);
  const stage: CodexRuminateStage = {
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

export const discardCodexRuminateStage = async (projectRoot: string): Promise<CodexRuminateStage | null> => {
  const stage = await getCodexRuminateStage(projectRoot);
  if (!stage) {
    return null;
  }

  const discarded: CodexRuminateStage = {
    ...stage,
    status: "discarded",
  };
  await writeStage(projectRoot, discarded);
  return discarded;
};

export const applyCodexRuminateStage = async (
  projectRoot: string,
  expectedStageId?: string,
): Promise<{ stage: CodexRuminateStage; apply: ApplyBrainChangesResult }> => {
  const stage = await getCodexRuminateStage(projectRoot);
  if (!stage || stage.status !== "staged") {
    throw new Error("No staged Codex rumination preview is available.");
  }
  if (expectedStageId && stage.stageId !== expectedStageId) {
    throw new Error(`Staged Codex rumination preview ${expectedStageId} was not found.`);
  }

  const apply = await applyBrainChanges(projectRoot, stage.changes);
  const appliedStage: CodexRuminateStage = {
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
