import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { studyDocuments } from "../db/schema";
import { markdownFenceToken } from "./study-document-content";

export const TRANSCLUSION_MAX_DEPTH = 3;
export const TRANSCLUSION_MAX_BYTES = 2 * 1024 * 1024;
const TRANSCLUSION_TRUNCATED =
  "\n\n> Transclusion truncated at the 2 MiB render limit.\n";

const IMPORT_LINE =
  /^\s*@import\s+"fiche:([^"#\s]+)(?:#([^"]+))?"\s*(?:<!--.*-->)?\s*$/;

export interface TransclusionDependency {
  documentId: string;
  revision: number;
}

function normalizedHeading(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A literal percent sign is a valid heading character; keep it literal.
  }
  return decoded
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[*_`~]/g, "")
    .trim()
    .toLocaleLowerCase("fr");
}

function sectionMarkdown(markdown: string, requested: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const wanted = normalizedHeading(requested);
  let start = -1;
  let level = 0;
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const token = markdownFenceToken(lines[index] ?? "");
    if (token) {
      if (!fence) fence = { marker: token.marker, length: token.length };
      else if (
        token.marker === fence.marker &&
        token.length >= fence.length &&
        token.suffix.trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index] ?? "");
    if (!heading) continue;
    const currentLevel = heading[1]!.length;
    if (start < 0 && normalizedHeading(heading[2]!) === wanted) {
      start = index;
      level = currentLevel;
      continue;
    }
    if (start >= 0 && currentLevel <= level) {
      return lines.slice(start, index).join("\n").trim();
    }
  }
  return start >= 0 ? lines.slice(start).join("\n").trim() : null;
}

function bounded(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= TRANSCLUSION_MAX_BYTES) return value;
  const suffixBytes = new TextEncoder().encode(
    TRANSCLUSION_TRUNCATED,
  ).byteLength;
  let end = Math.max(0, TRANSCLUSION_MAX_BYTES - suffixBytes);
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return (
    new TextDecoder().decode(bytes.subarray(0, end)) + TRANSCLUSION_TRUNCATED
  );
}

interface ExpansionBudget {
  remaining: number;
  truncated: boolean;
}

function appendWithinBudget(
  output: string[],
  value: string,
  budget: ExpansionBudget,
) {
  const bytes = new TextEncoder().encode(value);
  // Reserve one byte for the newline introduced by `join` at this level.
  const available = Math.max(0, budget.remaining - 1);
  if (bytes.byteLength <= available) {
    output.push(value);
    budget.remaining -= bytes.byteLength + 1;
    return true;
  }
  let end = Math.min(bytes.byteLength, available);
  while (end > 0 && end < bytes.byteLength && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  if (end > 0) output.push(new TextDecoder().decode(bytes.subarray(0, end)));
  budget.remaining = 0;
  budget.truncated = true;
  return false;
}

async function expand(input: {
  userId: string;
  yearId: string;
  documentId: string;
  markdown: string;
  depth: number;
  stack: ReadonlySet<string>;
  dependencies: Map<string, number>;
  budget: ExpansionBudget;
}): Promise<string> {
  const lines = input.markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const [lineIndex, line] of lines.entries()) {
    if (input.budget.remaining <= 0) {
      if (lineIndex < lines.length) input.budget.truncated = true;
      break;
    }
    const token = markdownFenceToken(line);
    if (token) {
      if (!fence) fence = { marker: token.marker, length: token.length };
      else if (
        token.marker === fence.marker &&
        token.length >= fence.length &&
        token.suffix.trim() === ""
      ) {
        fence = null;
      }
      if (!appendWithinBudget(output, line, input.budget)) break;
      continue;
    }
    const match = fence ? null : IMPORT_LINE.exec(line);
    if (!match) {
      if (!appendWithinBudget(output, line, input.budget)) break;
      continue;
    }
    const targetId = match[1]!;
    if (input.stack.has(targetId)) {
      appendWithinBudget(
        output,
        "> Import impossible: cycle de documents détecté.",
        input.budget,
      );
      continue;
    }
    if (input.depth >= TRANSCLUSION_MAX_DEPTH) {
      appendWithinBudget(
        output,
        "> Import impossible: profondeur maximale de 3 atteinte.",
        input.budget,
      );
      continue;
    }
    const [target] = await db
      .select({
        id: studyDocuments.id,
        bodyMarkdown: studyDocuments.bodyMarkdown,
        revision: studyDocuments.revision,
      })
      .from(studyDocuments)
      .where(
        and(
          eq(studyDocuments.id, targetId),
          eq(studyDocuments.userId, input.userId),
          eq(studyDocuments.yearId, input.yearId),
          isNull(studyDocuments.deletedAt),
        ),
      )
      .limit(1);
    if (!target) {
      appendWithinBudget(
        output,
        "> Import impossible: document ou section indisponible.",
        input.budget,
      );
      continue;
    }
    const selected = match[2]
      ? sectionMarkdown(target.bodyMarkdown, match[2])
      : target.bodyMarkdown;
    if (selected === null) {
      appendWithinBudget(
        output,
        "> Import impossible: document ou section indisponible.",
        input.budget,
      );
      continue;
    }
    input.dependencies.set(target.id, target.revision);
    const expanded = await expand({
      ...input,
      documentId: target.id,
      markdown: selected,
      depth: input.depth + 1,
      stack: new Set([...input.stack, target.id]),
    });
    if (expanded) output.push(expanded);
  }
  return output.join("\n");
}

export async function renderStudyDocumentMarkdown(input: {
  userId: string;
  yearId: string;
  documentId: string;
  markdown: string;
}) {
  const dependencies = new Map<string, number>();
  const suffixBytes = new TextEncoder().encode(
    TRANSCLUSION_TRUNCATED,
  ).byteLength;
  const budget: ExpansionBudget = {
    remaining: TRANSCLUSION_MAX_BYTES - suffixBytes,
    truncated: false,
  };
  const expanded = await expand({
    ...input,
    depth: 0,
    stack: new Set([input.documentId]),
    dependencies,
    budget,
  });
  const markdown = bounded(
    budget.truncated ? expanded + TRANSCLUSION_TRUNCATED : expanded,
  );
  return {
    markdown,
    dependencies: [...dependencies.entries()].map(([documentId, revision]) => ({
      documentId,
      revision,
    })),
  };
}
