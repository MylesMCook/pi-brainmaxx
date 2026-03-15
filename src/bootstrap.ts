import fs from "node:fs/promises";
import path from "node:path";
import { NOTES_DIR } from "./constants.js";
import { exists, readFileIfPresent } from "./fs-helpers.js";
import { toPortablePath } from "./project-root.js";
import { writeNoteIfMissing } from "./brain.js";

const SOURCE_DOCS = ["AGENTS.md", "README.md", "MEMORY.md"] as const;

const CATEGORY_LIMITS = {
  workflow: 3,
  interfaces: 3,
  services: 2,
} as const;

type Category = keyof typeof CATEGORY_LIMITS;

type Section = {
  heading: string | null;
  lines: string[];
};

type Candidate = {
  category: Category;
  text: string;
  sourceFile: string;
};

export type OperationalBootstrapPlan =
  | {
      status: "ready";
      noteRelativePath: string;
      sourceFiles: string[];
      content: string;
    }
  | {
      status: "exists" | "none";
      noteRelativePath: string;
      sourceFiles: string[];
      reason: string;
    };

export type OperationalBootstrapApplyResult =
  | {
      status: "created";
      noteRelativePath: string;
      sourceFiles: string[];
      synced: string[];
      content: string;
    }
  | {
      status: "exists" | "none";
      noteRelativePath: string;
      sourceFiles: string[];
      reason: string;
    };

const parseSections = (content: string): Section[] => {
  const sections: Section[] = [{ heading: null, lines: [] }];
  let current = sections[0];

  for (const line of content.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      current = { heading: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    current.lines.push(line);
  }

  return sections;
};

const cleanupInlineMarkdown = (value: string): string => {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeBullet = (value: string): string => {
  return cleanupInlineMarkdown(value).replace(/^[-*]\s+/, "").trim();
};

const isTableSeparator = (line: string): boolean => /^\|\s*[:\-| ]+\|\s*$/.test(line.trim());

const parseTableCells = (line: string): string[] =>
  line
    .trim()
    .split("|")
    .map((cell) => cleanupInlineMarkdown(cell))
    .filter((cell) => cell.length > 0);

const tableRowToBullet = (cells: string[]): string | null => {
  if (cells.length === 0) {
    return null;
  }
  if (cells.length === 1) {
    return cells[0] ?? null;
  }
  return `${cells[0]}: ${cells.slice(1).join(" | ")}`;
};

const extractSectionItems = (section: Section): string[] => {
  const items: string[] = [];
  const lines = section.lines;
  let inCodeFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || trimmed.length === 0) {
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const parts = [normalizeBullet(trimmed)];
      let next = index + 1;
      while (next < lines.length) {
        const continuation = lines[next] ?? "";
        const continuationTrimmed = continuation.trim();
        if (
          continuationTrimmed.length === 0 ||
          /^#{1,6}\s+/.test(continuationTrimmed) ||
          /^[-*]\s+/.test(continuationTrimmed) ||
          continuationTrimmed.startsWith("|") ||
          continuationTrimmed.startsWith("```")
        ) {
          break;
        }
        if (/^\s{2,}\S/.test(continuation) || /^\s+\S/.test(continuation)) {
          parts.push(cleanupInlineMarkdown(continuationTrimmed));
          next += 1;
          continue;
        }
        break;
      }
      index = next - 1;
      items.push(parts.join(" "));
      continue;
    }

    if (trimmed.startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1] ?? "")) {
      index += 1;
      while (index + 1 < lines.length) {
        const rowLine = lines[index + 1] ?? "";
        if (!rowLine.trim().startsWith("|")) {
          break;
        }
        index += 1;
        const bullet = tableRowToBullet(parseTableCells(rowLine));
        if (bullet) {
          items.push(bullet);
        }
      }
      continue;
    }

    if (trimmed.length <= 180) {
      items.push(cleanupInlineMarkdown(trimmed));
    }
  }

  return items;
};

const isOperationalLine = (value: string): boolean =>
  /tmux|ssh|mosh|pi\b|session|workflow|remote|phone|echo\b|command|service|systemd|maestro|grasshopper|linear|issue|review|task|backlog|todo|delegate|retrieval|tunnel|proxy|docker|network|backup|cloudflare|auth|inspector|mcp/i.test(
    value,
  );

const categoryForHeading = (heading: string | null, sourceFile: string): Category | null => {
  const value = heading?.toLowerCase() ?? "";
  if (
    /workflow|habit|remote continuity|remote workflow|session start|preferences|workspace facts|phone access|operating principles|ssh/.test(
      value,
    )
  ) {
    return "workflow";
  }
  if (/interfaces|maestro|grasshopper|linear|available infrastructure|delegation/.test(value)) {
    return "interfaces";
  }
  if (/running infrastructure|systemd services|networking|docker containers|gotchas/.test(value)) {
    return "services";
  }

  if (!heading) {
    if (sourceFile === "AGENTS.md") {
      return "workflow";
    }
    if (sourceFile === "README.md") {
      return "interfaces";
    }
    if (sourceFile === "MEMORY.md") {
      return "services";
    }
  }

  return null;
};

const selectCandidates = (files: Array<{ sourceFile: string; content: string }>): Candidate[] => {
  const seen = new Set<string>();
  const collected: Candidate[] = [];

  for (const file of files) {
    const sections = parseSections(file.content);
    let matchedAnySection = false;

    for (const section of sections) {
      const category = categoryForHeading(section.heading, file.sourceFile);
      if (!category) {
        continue;
      }
      matchedAnySection = true;
      for (const item of extractSectionItems(section)) {
        if (!isOperationalLine(item)) {
          continue;
        }
        const normalized = item.toLowerCase();
        if (seen.has(normalized)) {
          continue;
        }
        seen.add(normalized);
        collected.push({ category, text: item, sourceFile: file.sourceFile });
      }
    }

    if (matchedAnySection) {
      continue;
    }

    for (const item of extractSectionItems({ heading: null, lines: file.content.split("\n") })) {
      if (!isOperationalLine(item)) {
        continue;
      }
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      collected.push({ category: "interfaces", text: item, sourceFile: file.sourceFile });
    }
  }

  return collected;
};

const buildNoteContent = (title: string, candidates: Candidate[]): string => {
  const lines = [`# ${title}`, ""];

  for (const category of Object.keys(CATEGORY_LIMITS) as Category[]) {
    const limit = CATEGORY_LIMITS[category];
    const items = candidates.filter((candidate) => candidate.category === category).slice(0, limit);
    for (const item of items) {
      lines.push(`- ${item.text}`);
    }
  }

  lines.push("");
  return lines.join("\n");
};

const readGitDir = async (projectRoot: string): Promise<string | null> => {
  const gitPath = path.join(projectRoot, ".git");

  try {
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }
    if (stat.isFile()) {
      const raw = await fs.readFile(gitPath, "utf8");
      const match = raw.match(/^gitdir:\s*(.+)$/m);
      if (match?.[1]) {
        return path.resolve(projectRoot, match[1].trim());
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  return null;
};

const readOriginUrl = async (projectRoot: string): Promise<string | null> => {
  const gitDir = await readGitDir(projectRoot);
  if (!gitDir) {
    return null;
  }
  const config = await readFileIfPresent(path.join(gitDir, "config"));
  if (!config) {
    return null;
  }

  const match = config.match(/\[remote "origin"\][^\[]*?url\s*=\s*(.+)\s*$/m);
  return match?.[1]?.trim() ?? null;
};

const slugify = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
};

const parseRepoSlug = async (projectRoot: string): Promise<string> => {
  const origin = await readOriginUrl(projectRoot);
  if (origin) {
    const match = origin.match(/([^/:]+?)(?:\.git)?$/);
    if (match?.[1]) {
      return slugify(match[1]);
    }
  }
  return slugify(path.basename(projectRoot));
};

const titleCaseSlug = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const planOperationalBootstrap = async (projectRoot: string): Promise<OperationalBootstrapPlan> => {
  const repoSlug = await parseRepoSlug(projectRoot);
  const noteRelativePath = toPortablePath(path.join(NOTES_DIR, `${repoSlug}-operations.md`));
  const notePath = path.join(projectRoot, noteRelativePath);

  if (await exists(notePath)) {
    return {
      status: "exists",
      noteRelativePath,
      sourceFiles: [],
      reason: `Operational note already exists at ${noteRelativePath}.`,
    };
  }

  const sourceFiles: Array<{ sourceFile: string; content: string }> = [];
  for (const sourceFile of SOURCE_DOCS) {
    const content = await readFileIfPresent(path.join(projectRoot, sourceFile));
    if (content) {
      sourceFiles.push({ sourceFile, content });
    }
  }

  const candidates = selectCandidates(sourceFiles);
  if (candidates.length === 0) {
    return {
      status: "none",
      noteRelativePath,
      sourceFiles: sourceFiles.map((file) => file.sourceFile),
      reason: "No concise operational content was found in AGENTS.md, README.md, or MEMORY.md.",
    };
  }

  const noteTitle = `${titleCaseSlug(repoSlug)} Operations`;
  return {
    status: "ready",
    noteRelativePath,
    sourceFiles: Array.from(new Set(candidates.map((candidate) => candidate.sourceFile))),
    content: buildNoteContent(noteTitle, candidates),
  };
};

export const applyOperationalBootstrap = async (projectRoot: string): Promise<OperationalBootstrapApplyResult> => {
  const plan = await planOperationalBootstrap(projectRoot);
  if (plan.status !== "ready") {
    return plan;
  }

  const result = await writeNoteIfMissing(projectRoot, plan.noteRelativePath, plan.content);
  if (!result.created) {
    return {
      status: "exists",
      noteRelativePath: plan.noteRelativePath,
      sourceFiles: plan.sourceFiles,
      reason: `Operational note already exists at ${plan.noteRelativePath}.`,
    };
  }

  return {
    status: "created",
    noteRelativePath: plan.noteRelativePath,
    sourceFiles: plan.sourceFiles,
    synced: result.synced,
    content: plan.content,
  };
};
