import { PI_RUMINATE_STAGE_FILE } from "./constants.js";
import { applyHarnessRuminateStage, discardHarnessRuminateStage, getHarnessRuminateStage, stageHarnessRuminate, } from "./ruminate-stage.js";
const PI_STAGE = {
    label: "Pi",
    stageFile: PI_RUMINATE_STAGE_FILE,
    missingBrainMessage: "No project brain found. Run /pi-init first.",
};
export const getPiRuminateStage = async (projectRoot) => getHarnessRuminateStage(projectRoot, PI_STAGE);
export const stagePiRuminate = async (projectRoot, input) => stageHarnessRuminate(projectRoot, PI_STAGE, input);
export const discardPiRuminateStage = async (projectRoot) => discardHarnessRuminateStage(projectRoot, PI_STAGE);
export const applyPiRuminateStage = async (projectRoot, expectedStageId) => applyHarnessRuminateStage(projectRoot, PI_STAGE, expectedStageId);
