import { Buffer } from "node:buffer";
import { DEFAULT_INJECTION_MAX_BYTES, DEFAULT_INJECTION_MAX_LINES } from "./constants.js";
const lineCount = (text) => (text === "" ? 0 : text.split("\n").length);
const withinLimits = (text, maxBytes, maxLines) => Buffer.byteLength(text, "utf8") <= maxBytes && lineCount(text) <= maxLines;
const truncateText = (text, maxBytes, maxLines, footer) => {
    const lines = text.split("\n");
    const kept = [];
    for (const line of lines) {
        const candidate = [...kept, line, footer].join("\n");
        if (!withinLimits(candidate, maxBytes, maxLines)) {
            break;
        }
        kept.push(line);
    }
    let output = [...kept, footer].join("\n");
    while (!withinLimits(output, maxBytes, maxLines) && kept.length > 0) {
        kept.pop();
        output = [...kept, footer].join("\n");
    }
    return output;
};
const composeFullContext = (indexText, principlesText) => [
    "[brainerd]",
    "A project brain is present. Use this as durable repo memory.",
    "",
    "# brain/index.md",
    indexText.trim(),
    "",
    "# brain/principles.md",
    principlesText.trim(),
    "",
].join("\n");
const composePrinciplesOnly = (principlesText) => [
    "[brainerd]",
    "A project brain is present. `brain/index.md` was omitted from ambient context",
    "because the entrypoints exceeded the size guard. Open it directly if you need it.",
    "",
    "# brain/principles.md",
    principlesText.trim(),
    "",
].join("\n");
export const buildInjectedBrainMessage = (indexText, principlesText, limits = {}) => {
    const maxBytes = limits.maxBytes ?? DEFAULT_INJECTION_MAX_BYTES;
    const maxLines = limits.maxLines ?? DEFAULT_INJECTION_MAX_LINES;
    const full = composeFullContext(indexText, principlesText);
    if (withinLimits(full, maxBytes, maxLines)) {
        return { content: full, includedIndex: true, truncated: false };
    }
    const principlesOnly = composePrinciplesOnly(principlesText);
    if (withinLimits(principlesOnly, maxBytes, maxLines)) {
        return { content: principlesOnly, includedIndex: false, truncated: false };
    }
    const header = [
        "[brainerd]",
        "A project brain is present. Ambient context exceeded the size guard, so only",
        "a truncated slice of `brain/principles.md` is injected. Open the file directly",
        "if you need the full text.",
        "",
        "# brain/principles.md",
    ].join("\n");
    const footer = "[brainerd] `brain/principles.md` was truncated to fit the ambient context budget.";
    const truncatedPrinciples = truncateText(principlesText.trim(), maxBytes - Buffer.byteLength(`${header}\n`, "utf8"), maxLines - lineCount(`${header}\n`), footer);
    return {
        content: `${header}\n${truncatedPrinciples}\n`,
        includedIndex: false,
        truncated: true,
    };
};
