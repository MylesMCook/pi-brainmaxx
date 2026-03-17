import { initBrain, syncOwnedEntryPoints } from "./brain.js";
import { applyOperationalBootstrap, planOperationalBootstrap, } from "./bootstrap.js";
import { planCodexAgentsUpdate, upsertCodexAgentsBlock } from "./codex-agents.js";
export const initCodexBrain = async (projectRoot, options = {}) => {
    await planCodexAgentsUpdate(projectRoot);
    const brain = await initBrain(projectRoot);
    const agents = await upsertCodexAgentsBlock(projectRoot);
    const bootstrap = options.applyBootstrap
        ? await applyOperationalBootstrap(projectRoot)
        : await planOperationalBootstrap(projectRoot);
    return {
        projectRoot,
        brain,
        agents,
        bootstrap,
    };
};
export const syncCodexBrain = async (projectRoot) => {
    return syncOwnedEntryPoints(projectRoot);
};
