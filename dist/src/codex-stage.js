import { CODEX_RUMINATE_STAGE_FILE, LEGACY_BRAINMAXX_RUMINATE_STAGE_FILE, LEGACY_RUMINATE_STAGE_FILE, } from "./constants.js";
import { applyHarnessRuminateStage, discardHarnessRuminateStage, getHarnessRuminateStage, stageHarnessRuminate, } from "./ruminate-stage.js";
const CODEX_STAGE = {
    label: "Codex",
    stageFile: CODEX_RUMINATE_STAGE_FILE,
    legacyStageFiles: [LEGACY_RUMINATE_STAGE_FILE, LEGACY_BRAINMAXX_RUMINATE_STAGE_FILE],
    missingBrainMessage: "No project brain found. Run codex-init first.",
};
export const getCodexRuminateStage = async (projectRoot) => getHarnessRuminateStage(projectRoot, CODEX_STAGE);
export const stageCodexRuminate = async (projectRoot, input) => stageHarnessRuminate(projectRoot, CODEX_STAGE, input);
export const discardCodexRuminateStage = async (projectRoot) => discardHarnessRuminateStage(projectRoot, CODEX_STAGE);
export const applyCodexRuminateStage = async (projectRoot, expectedStageId) => applyHarnessRuminateStage(projectRoot, CODEX_STAGE, expectedStageId);
