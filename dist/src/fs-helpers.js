import fs from "node:fs/promises";
import path from "node:path";
import { isSameOrDescendant, toPortablePath } from "./project-root.js";
export const exists = async (target) => {
    try {
        await fs.access(target);
        return true;
    }
    catch {
        return false;
    }
};
export const readFileIfPresent = async (target) => {
    try {
        return await fs.readFile(target, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
};
export const resolveSafeWriteTarget = async (root, relativePath) => {
    const normalizedRelativePath = toPortablePath(relativePath);
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(root, relativePath);
    if (!isSameOrDescendant(resolvedRoot, resolvedTarget)) {
        throw new Error(`Refusing to write outside the project root: ${normalizedRelativePath}`);
    }
    let current = resolvedRoot;
    for (const segment of normalizedRelativePath.split("/").filter(Boolean)) {
        current = path.join(current, segment);
        try {
            const stat = await fs.lstat(current);
            if (stat.isSymbolicLink()) {
                throw new Error(`Refusing to write through symlinked path: ${normalizedRelativePath}`);
            }
        }
        catch (error) {
            if (error.code === "ENOENT") {
                break;
            }
            throw error;
        }
    }
    return resolvedTarget;
};
export const normalizeRepoRelativePath = (value) => {
    const portable = toPortablePath(value);
    const normalized = path.posix.normalize(portable);
    if (normalized === "." ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        path.posix.isAbsolute(normalized)) {
        throw new Error(`Refusing to use a path outside the repo: ${value}`);
    }
    return normalized;
};
export const resolveSafeRepoPath = async (projectRoot, relativePath) => {
    const normalized = normalizeRepoRelativePath(relativePath);
    const absolute = path.resolve(projectRoot, normalized);
    if (!isSameOrDescendant(projectRoot, absolute)) {
        throw new Error(`Refusing to use a path outside the repo: ${relativePath}`);
    }
    let current = projectRoot;
    for (const segment of normalized.split("/")) {
        if (!segment) {
            continue;
        }
        current = path.join(current, segment);
        try {
            const stat = await fs.lstat(current);
            if (stat.isSymbolicLink()) {
                throw new Error(`Refusing to follow a symlinked repo path: ${normalized}`);
            }
        }
        catch (error) {
            if (error.code === "ENOENT") {
                break;
            }
            throw error;
        }
    }
    return absolute;
};
