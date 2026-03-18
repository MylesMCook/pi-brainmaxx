import { CLAUDE_RUMINATE_STAGE_FILE } from "./constants.js";
import { applyHarnessRuminateStage, discardHarnessRuminateStage, getHarnessRuminateStage, stageHarnessRuminate, } from "./ruminate-stage.js";
const CLAUDE_STAGE = {
    label: "Claude",
    stageFile: CLAUDE_RUMINATE_STAGE_FILE,
    missingBrainMessage: "No project brain found. Run claude-init first.",
};
export const getClaudeRuminateStage = async (projectRoot) => getHarnessRuminateStage(projectRoot, CLAUDE_STAGE);
export const stageClaudeRuminate = async (projectRoot, input) => stageHarnessRuminate(projectRoot, CLAUDE_STAGE, input);
export const discardClaudeRuminateStage = async (projectRoot) => discardHarnessRuminateStage(projectRoot, CLAUDE_STAGE);
export const applyClaudeRuminateStage = async (projectRoot, expectedStageId) => applyHarnessRuminateStage(projectRoot, CLAUDE_STAGE, expectedStageId);
