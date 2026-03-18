import {
  CODEX_RUMINATE_STAGE_FILE,
  LEGACY_BRAINMAXX_RUMINATE_STAGE_FILE,
  LEGACY_RUMINATE_STAGE_FILE,
} from "./constants.js";
import {
  applyHarnessRuminateStage,
  discardHarnessRuminateStage,
  getHarnessRuminateStage,
  stageHarnessRuminate,
  type HarnessRuminateStage,
  type HarnessStageInput,
} from "./ruminate-stage.js";

const CODEX_STAGE = {
  label: "Codex",
  stageFile: CODEX_RUMINATE_STAGE_FILE,
  legacyStageFiles: [LEGACY_RUMINATE_STAGE_FILE, LEGACY_BRAINMAXX_RUMINATE_STAGE_FILE],
  missingBrainMessage: "No project brain found. Run codex-init first.",
} as const;

export type CodexRuminateStage = HarnessRuminateStage;
export type CodexStageInput = HarnessStageInput;

export const getCodexRuminateStage = async (projectRoot: string): Promise<CodexRuminateStage | null> =>
  getHarnessRuminateStage(projectRoot, CODEX_STAGE);

export const stageCodexRuminate = async (
  projectRoot: string,
  input: CodexStageInput,
): Promise<CodexRuminateStage> => stageHarnessRuminate(projectRoot, CODEX_STAGE, input);

export const discardCodexRuminateStage = async (projectRoot: string): Promise<CodexRuminateStage | null> =>
  discardHarnessRuminateStage(projectRoot, CODEX_STAGE);

export const applyCodexRuminateStage = async (
  projectRoot: string,
  expectedStageId?: string,
): Promise<ReturnType<typeof applyHarnessRuminateStage>> =>
  applyHarnessRuminateStage(projectRoot, CODEX_STAGE, expectedStageId);
