import { PI_RUMINATE_STAGE_FILE } from "./constants.js";
import {
  applyHarnessRuminateStage,
  discardHarnessRuminateStage,
  getHarnessRuminateStage,
  stageHarnessRuminate,
  type HarnessRuminateStage,
  type HarnessStageInput,
} from "./ruminate-stage.js";

const PI_STAGE = {
  label: "Pi",
  stageFile: PI_RUMINATE_STAGE_FILE,
  missingBrainMessage: "No project brain found. Run /pi-init first.",
} as const;

export type PiRuminateStage = HarnessRuminateStage;
export type PiStageInput = HarnessStageInput;

export const getPiRuminateStage = async (projectRoot: string): Promise<PiRuminateStage | null> =>
  getHarnessRuminateStage(projectRoot, PI_STAGE);

export const stagePiRuminate = async (projectRoot: string, input: PiStageInput): Promise<PiRuminateStage> =>
  stageHarnessRuminate(projectRoot, PI_STAGE, input);

export const discardPiRuminateStage = async (projectRoot: string): Promise<PiRuminateStage | null> =>
  discardHarnessRuminateStage(projectRoot, PI_STAGE);

export const applyPiRuminateStage = async (
  projectRoot: string,
  expectedStageId?: string,
): Promise<ReturnType<typeof applyHarnessRuminateStage>> =>
  applyHarnessRuminateStage(projectRoot, PI_STAGE, expectedStageId);
