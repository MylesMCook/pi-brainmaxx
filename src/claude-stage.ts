import { CLAUDE_RUMINATE_STAGE_FILE } from "./constants.js";
import {
  applyHarnessRuminateStage,
  discardHarnessRuminateStage,
  getHarnessRuminateStage,
  stageHarnessRuminate,
  type HarnessRuminateStage,
  type HarnessStageInput,
} from "./ruminate-stage.js";

const CLAUDE_STAGE = {
  label: "Claude",
  stageFile: CLAUDE_RUMINATE_STAGE_FILE,
  missingBrainMessage: "No project brain found. Run claude-init first.",
} as const;

export type ClaudeRuminateStage = HarnessRuminateStage;
export type ClaudeStageInput = HarnessStageInput;

export const getClaudeRuminateStage = async (projectRoot: string): Promise<ClaudeRuminateStage | null> =>
  getHarnessRuminateStage(projectRoot, CLAUDE_STAGE);

export const stageClaudeRuminate = async (projectRoot: string, input: ClaudeStageInput): Promise<ClaudeRuminateStage> =>
  stageHarnessRuminate(projectRoot, CLAUDE_STAGE, input);

export const discardClaudeRuminateStage = async (projectRoot: string): Promise<ClaudeRuminateStage | null> =>
  discardHarnessRuminateStage(projectRoot, CLAUDE_STAGE);

export const applyClaudeRuminateStage = async (
  projectRoot: string,
  expectedStageId?: string,
): Promise<ReturnType<typeof applyHarnessRuminateStage>> =>
  applyHarnessRuminateStage(projectRoot, CLAUDE_STAGE, expectedStageId);
