import { z } from "zod";
import type {
  LatexMetaV2,
  MindmapContentV1,
  MindmapNodeV1,
  QuizContentV1,
  QuizContentV2,
  QuizQuestionV1,
  QuizQuestionV2,
  StudyDocumentKind,
  StudyDocumentMeta,
} from "../db/schema/documents";

export const MINDMAP_MAX_DEPTH = 8;
export const MINDMAP_MAX_NODES = 500;
export const SLIDES_MAX_COUNT = 100;
export const STUDY_DOCUMENT_META_MAX_BYTES = 512 * 1024;
export const QUIZ_MAX_QUESTIONS = 200;

/**
 * The only quiz shape a reader may receive before an attempt is submitted.
 *
 * Correct answers stay in `QuizQuestionV1` on the server. Keeping a separate
 * type for prompts makes an accidental `return document.metaJson` visible at
 * the API boundary instead of relying on the browser to ignore secret fields.
 */
export type QuizPromptV1 =
  | {
      kind: "mcq";
      prompt: string;
      choices: string[];
      answerCount: number;
    }
  | { kind: "open"; prompt: string }
  | { kind: "cloze"; text: string; blankCount: number };

export interface QuizPromptContentV1 {
  version: 1 | 2;
  questions: Array<
    QuizPromptV1 & {
      id?: string;
      objectiveIds?: string[];
      difficulty?: number | null;
    }
  >;
}

export function quizPrompt(question: QuizQuestionV1): QuizPromptV1 {
  if (question.kind === "mcq") {
    return {
      kind: question.kind,
      prompt: question.prompt,
      choices: question.choices,
      answerCount: question.answers.length,
    };
  }
  if (question.kind === "open") {
    return { kind: question.kind, prompt: question.prompt };
  }
  return {
    kind: question.kind,
    text: question.text,
    blankCount: question.blanks.length,
  };
}

export function quizPromptContent(
  content: QuizContentV1 | QuizContentV2,
): QuizPromptContentV1 {
  return {
    version: content.version,
    questions: content.questions.map((question) => ({
      ...quizPrompt(question),
      ...(content.version === 2
        ? {
            id: (question as QuizQuestionV2).id,
            objectiveIds: (question as QuizQuestionV2).objectiveIds,
            difficulty: (question as QuizQuestionV2).difficulty,
          }
        : {}),
    })),
  };
}

const MINDMAP_NODE_KEYS = new Set(["id", "label", "children", "note"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the complete tree with an explicit stack. This runs while `root` is
 * still `unknown`, so even adversarially deep JSON never enters recursive Zod
 * parsing (or a recursive clone) before the depth fence rejects it.
 */
function mindmapLimitIssue(content: {
  version: 1;
  root: unknown;
}): string | null {
  const ids = new Set<string>();
  const seenObjects = new WeakSet<object>();
  const stack: { node: unknown; depth: number }[] = [
    { node: content.root, depth: 1 },
  ];
  let count = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    count += 1;
    if (count > MINDMAP_MAX_NODES) {
      return `A mind map can contain at most ${MINDMAP_MAX_NODES} nodes`;
    }
    if (current.depth > MINDMAP_MAX_DEPTH) {
      return `A mind map can be at most ${MINDMAP_MAX_DEPTH} levels deep`;
    }
    if (!isRecord(current.node)) {
      return "Every mind map node must be an object";
    }
    if (seenObjects.has(current.node)) {
      return "A mind map cannot contain cycles or reuse a node object";
    }
    seenObjects.add(current.node);

    const unknownKey = Object.keys(current.node).find(
      (key) => !MINDMAP_NODE_KEYS.has(key),
    );
    if (unknownKey) {
      return `Mind map nodes cannot contain the property ${unknownKey}`;
    }

    const id = current.node.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      return "Every mind map node requires a non-empty id";
    }
    if (id.trim().length > 160) {
      return "Mind map node ids can contain at most 160 characters";
    }
    if (ids.has(id.trim())) {
      return `Mind map node id ${id.trim()} is duplicated`;
    }
    ids.add(id.trim());

    const label = current.node.label;
    if (typeof label !== "string" || label.trim().length === 0) {
      return "Every mind map node requires a non-empty label";
    }
    if (label.trim().length > 120) {
      return "Mind map node labels can contain at most 120 characters";
    }
    if (
      current.node.note !== undefined &&
      (typeof current.node.note !== "string" ||
        current.node.note.length > 8 * 1024)
    ) {
      return "Mind map node notes can contain at most 8 KiB";
    }
    if (
      current.node.children !== undefined &&
      !Array.isArray(current.node.children)
    ) {
      return "Mind map node children must be an array";
    }

    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: current.depth + 1 });
    }
  }
  return null;
}

/** Preserve the former trimmed id/label contract without recursive cloning. */
function normalizeMindmap(content: {
  version: 1;
  root: unknown;
}): MindmapContentV1 {
  const sourceRoot = content.root as MindmapNodeV1;
  const root: MindmapNodeV1 = {
    id: sourceRoot.id.trim(),
    label: sourceRoot.label.trim(),
    ...(sourceRoot.note === undefined ? {} : { note: sourceRoot.note }),
    ...(sourceRoot.children === undefined ? {} : { children: [] }),
  };
  const stack: Array<{ source: MindmapNodeV1; target: MindmapNodeV1 }> = [
    { source: sourceRoot, target: root },
  ];
  while (stack.length > 0) {
    const { source, target } = stack.pop()!;
    if (!source.children) continue;
    const children = source.children.map((child) => ({
      id: child.id.trim(),
      label: child.label.trim(),
      ...(child.note === undefined ? {} : { note: child.note }),
      ...(child.children === undefined ? {} : { children: [] }),
    }));
    target.children = children;
    for (let index = source.children.length - 1; index >= 0; index -= 1) {
      stack.push({ source: source.children[index]!, target: children[index]! });
    }
  }
  return { version: 1, root };
}

const mindmapContentStructureSchema = z
  .object({
    version: z.literal(1),
    // The router deliberately keeps the tree opaque. The domain contract
    // below is the first and only deep validator, and it is iterative.
    // An object+catchall remains representable in MCP JSON Schema, unlike a
    // z.custom escape hatch, while nested values are still left untouched.
    root: z
      .object({})
      .catchall(z.unknown()) as unknown as z.ZodType<MindmapNodeV1>,
  })
  .strict();

export const mindmapContentSchema = mindmapContentStructureSchema
  .superRefine((content, context) => {
    const issue = mindmapLimitIssue(content);
    if (issue) context.addIssue({ code: "custom", message: issue });
  })
  .transform(normalizeMindmap);

export const slidesMetaSchema = z.object({ version: z.literal(1) }).strict();

const quizText = z
  .string()
  .trim()
  .min(1)
  .max(8 * 1024);
const quizQuestionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("mcq"),
      prompt: quizText,
      choices: z.array(quizText.max(1_024)).min(2).max(12),
      answers: z.array(z.number().int().nonnegative()).min(1).max(12),
      why: z
        .string()
        .max(8 * 1024)
        .optional(),
    })
    .strict()
    .superRefine((question, context) => {
      const unique = new Set(question.answers);
      if (unique.size !== question.answers.length) {
        context.addIssue({
          code: "custom",
          message: "Quiz answers must be unique",
        });
      }
      if (
        question.answers.some((answer) => answer >= question.choices.length)
      ) {
        context.addIssue({
          code: "custom",
          message: "A quiz answer points outside its choice list",
        });
      }
    }),
  z
    .object({ kind: z.literal("open"), prompt: quizText, expected: quizText })
    .strict(),
  z
    .object({
      kind: z.literal("cloze"),
      text: quizText,
      blanks: z.array(quizText.max(1_024)).min(1).max(50),
    })
    .strict(),
]);

const quizContentV1Schema = z
  .object({
    version: z.literal(1),
    questions: z.array(quizQuestionSchema).min(1).max(QUIZ_MAX_QUESTIONS),
  })
  .strict() satisfies z.ZodType<QuizContentV1>;

const quizSourceProofSchema = z
  .object({
    sourceKind: z.enum(["material", "study-document", "grade-copy"]),
    sourceId: z.string().trim().min(1).max(256),
    sourceVersion: z.string().trim().min(1).max(256),
    locator: z.record(z.string(), z.unknown()),
  })
  .strict();
const quizV2MetadataSchema = z.object({
  id: z.string().trim().min(1).max(256),
  objectiveIds: z.array(z.string().trim().min(1).max(256)).max(20),
  difficulty: z.number().min(0).max(1).nullable(),
  sourceProofs: z.array(quizSourceProofSchema).max(20),
  rubricRevision: z.string().trim().min(1).max(120),
  rubric: z.record(z.string(), z.unknown()),
  generationProvenance: z.record(z.string(), z.unknown()).optional(),
  validationState: z.enum(["draft", "reviewed", "rejected"]),
});
const quizQuestionV2Schema = z.discriminatedUnion("kind", [
  quizQuestionSchema.options[0].extend(quizV2MetadataSchema.shape),
  quizQuestionSchema.options[1].extend(quizV2MetadataSchema.shape),
  quizQuestionSchema.options[2].extend(quizV2MetadataSchema.shape),
]);
const quizContentV2Schema = z
  .object({
    version: z.literal(2),
    questions: z.array(quizQuestionV2Schema).min(1).max(QUIZ_MAX_QUESTIONS),
  })
  .strict() as z.ZodType<QuizContentV2>;

export const quizContentSchema = z.union([
  quizContentV1Schema,
  quizContentV2Schema,
]);

/**
 * `entry` names the one source file materialised in the isolated build folder.
 * Restrict it to a basename so document metadata can never escape that folder.
 */
export const latexMetaSchema = z
  .object({
    engine: z.enum(["pdflatex", "xelatex", "lualatex"]),
    entry: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(
        /^[\p{L}\p{N}_.-]+\.tex$/u,
        "The LaTeX entry must be a .tex file name without directories",
      )
      .optional(),
  })
  .strict() satisfies z.ZodType<LatexMetaV2>;

export const basicDocumentMetaSchema = z
  .object({
    emoji: z.string().max(32).optional(),
    color: z.string().max(64).optional(),
  })
  .strict();

export const studyDocumentMetaSchema = z.union([
  mindmapContentStructureSchema,
  latexMetaSchema,
  quizContentSchema,
  slidesMetaSchema,
  basicDocumentMetaSchema,
]);

export interface MarkdownFenceToken {
  marker: "`" | "~";
  length: number;
  suffix: string;
}

/**
 * Remove CommonMark container prefixes before looking for a fence. In
 * particular, `- ```js` opens a fence inside a list item and its contents must
 * not be mistaken for slide separators.
 */
function withoutMarkdownContainers(line: string) {
  let remainder = line;
  while (true) {
    const quote = /^ {0,3}>[\t ]?/.exec(remainder);
    if (quote) {
      remainder = remainder.slice(quote[0].length);
      continue;
    }
    const list = /^ {0,3}(?:[-+*]|\d{1,9}[.)])[\t ]+/.exec(remainder);
    if (list) {
      remainder = remainder.slice(list[0].length);
      continue;
    }
    break;
  }
  return remainder.replace(/^ {0,3}/, "");
}

export function markdownFenceToken(line: string): MarkdownFenceToken | null {
  const match = /^(`{3,}|~{3,})(.*)$/.exec(withoutMarkdownContainers(line));
  if (!match) return null;
  const token = match[1]!;
  const suffix = match[2]!;
  if (token[0] === "`" && suffix.includes("`")) return null;
  return {
    marker: token[0] as "`" | "~",
    length: token.length,
    suffix,
  };
}

/** Split thematic-break lines only when they are outside fenced code. */
export function splitMarkdownSlides(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const slides: string[] = [];
  let current: string[] = [];
  let fence: Omit<MarkdownFenceToken, "suffix"> | null = null;

  for (const line of lines) {
    const token = markdownFenceToken(line);
    if (token) {
      if (!fence) {
        fence = { marker: token.marker, length: token.length };
      } else if (
        token.marker === fence.marker &&
        token.length >= fence.length &&
        token.suffix.trim() === ""
      ) {
        fence = null;
      }
      current.push(line);
      continue;
    }
    if (!fence && line.trim() === "---") {
      slides.push(current.join("\n").trim());
      current = [];
      continue;
    }
    current.push(line);
  }
  slides.push(current.join("\n").trim());
  return slides;
}

function metaTooLarge(metaJson: StudyDocumentMeta): boolean {
  return (
    new TextEncoder().encode(JSON.stringify(metaJson)).byteLength >
    STUDY_DOCUMENT_META_MAX_BYTES
  );
}

export function studyDocumentContentIssue(
  kind: StudyDocumentKind,
  bodyMarkdown: string,
  metaJson: StudyDocumentMeta | null,
): string | null {
  if (kind === "mindmap") {
    if (bodyMarkdown.length > 0) {
      return "A mind map stores its content as structured JSON; its Markdown body must be empty";
    }
    const parsed = mindmapContentSchema.safeParse(metaJson);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? "Invalid mind map content";
    }
    return metaTooLarge(parsed.data)
      ? "Study document metadata must be 512 KiB or smaller"
      : null;
  }
  if (metaJson !== null && metaTooLarge(metaJson)) {
    return "Study document metadata must be 512 KiB or smaller";
  }
  if (kind === "slides") {
    const parsed = slidesMetaSchema.safeParse(metaJson);
    if (!parsed.success) {
      return "A slide deck requires metaJson { version: 1 }";
    }
    const count = splitMarkdownSlides(bodyMarkdown).length;
    return count > SLIDES_MAX_COUNT
      ? `A slide deck can contain at most ${SLIDES_MAX_COUNT} slides`
      : null;
  }
  if (kind === "latex") {
    const parsed = latexMetaSchema.safeParse(metaJson);
    return parsed.success
      ? null
      : (parsed.error.issues[0]?.message ??
          "A LaTeX document requires a valid compiler engine");
  }
  if (kind === "quiz") {
    if (bodyMarkdown.trim()) {
      return "A quiz stores its questions as structured JSON; its Markdown body must be empty";
    }
    const parsed = quizContentSchema.safeParse(metaJson);
    return parsed.success
      ? null
      : (parsed.error.issues[0]?.message ?? "Invalid quiz content");
  }
  if (metaJson === null) return null;
  const parsed = basicDocumentMetaSchema.safeParse(metaJson);
  return parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "Invalid document metadata");
}
