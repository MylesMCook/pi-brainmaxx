import fs from "node:fs/promises";
import path from "node:path";
const exists = async (target) => {
    try {
        await fs.access(target);
        return true;
    }
    catch {
        return false;
    }
};
export const findGitRoot = async (cwd) => {
    let current = path.resolve(cwd);
    while (true) {
        if (await exists(path.join(current, ".git"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
};
export const resolveProjectRoot = async (cwd) => {
    return (await findGitRoot(cwd)) ?? path.resolve(cwd);
};
export const toPortablePath = (value) => value.split(path.sep).join("/");
export const isSameOrDescendant = (root, candidate) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};
