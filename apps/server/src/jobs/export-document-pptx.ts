import { and, eq } from "drizzle-orm";
import PptxGenJS from "pptxgenjs";
import { z } from "zod";
import { db } from "../db";
import {
  documentArtifacts,
  files,
  studyDocumentExports,
  studyDocuments,
} from "../db/schema";
import { NonRetryableJobError } from "../lib/jobs";
import {
  markdownFenceToken,
  splitMarkdownSlides,
} from "../lib/study-document-content";
import { deleteFile, storeFile } from "../lib/storage";
import { recordUnownedFileCleanup } from "./ingest-link";

/**
 * PPTX v1 is deliberately text-first: headings, paragraphs, basic bullets and
 * fenced code are preserved. Math remains source text and images/themes are
 * deferred instead of being exported with misleading partial fidelity.
 */

export const EXPORT_DOCUMENT_PPTX_JOB_KIND = "export.documentPptx";
export const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const PPTX_MAX_GENERATED_SLIDES = 250;

const pageLimitError = () =>
  new NonRetryableJobError(
    `A PPTX export can contain at most ${PPTX_MAX_GENERATED_SLIDES} generated slides; split this deck into smaller documents`,
  );

const payloadSchema = z
  .object({
    documentId: z.string().min(1),
    revision: z.number().int().min(1),
  })
  .strict();

type ContentKind = "body" | "code";

export interface DocumentPptxPage {
  title: string;
  continuation: boolean;
  sourceSlide: number;
  lines: Array<{ kind: ContentKind; text: string }>;
}

/** Strip characters forbidden by XML 1.0 before PptxGenJS serializes text. */
export function sanitizeXmlText(value: string): string {
  const safe: string[] = [];
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (
      point === 0x09 ||
      point === 0x0a ||
      point === 0x0d ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff)
    ) {
      safe.push(character);
    }
  }
  return safe.join("");
}

function plainInlineMarkdown(value: string) {
  return sanitizeXmlText(
    value
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(^|[^\\])[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}

function slideParts(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const content: Array<{ kind: ContentKind; text: string }> = [];
  let title = "Untitled slide";
  let foundTitle = false;
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    const token = markdownFenceToken(line);
    if (token) {
      if (!fence) {
        fence = { marker: token.marker, length: token.length };
        continue;
      }
      if (
        token.marker === fence.marker &&
        token.length >= fence.length &&
        token.suffix.trim() === ""
      ) {
        fence = null;
        continue;
      }
    }

    if (fence) {
      content.push({ kind: "code", text: sanitizeXmlText(line) });
      continue;
    }
    if (!foundTitle) {
      const heading = /^#{1,2}\s+(\S.*)$/.exec(line);
      if (heading) {
        const headingText = plainInlineMarkdown(heading[1]!);
        const bounded = wrapPptxLineResult(headingText, 56, true, 3);
        title = bounded.prefix;
        const titleOverflow = bounded.remainder;
        if (titleOverflow) {
          // Keep pathological headings readable without discarding their tail.
          content.push({ kind: "body", text: titleOverflow });
        }
        foundTitle = true;
        continue;
      }
    }
    const bullet = /^\s*(?:[-*+] |\d+[.)] )(.*)$/.exec(line);
    const plain = plainInlineMarkdown(
      bullet?.[1] ?? line.replace(/^#{1,6}\s+/, ""),
    );
    if (plain)
      content.push({ kind: "body", text: `${bullet ? "• " : ""}${plain}` });
  }
  return { title: sanitizeXmlText(title) || "Untitled slide", content };
}

/** Linear Unicode-aware wrapping that never truncates visible text. */
export function wrapPptxLine(
  value: string,
  width: number,
  options: { preserveWords?: boolean } = {},
): string[] {
  return wrapPptxLineResult(value, width, options.preserveWords !== false)
    .lines;
}

function wrapPptxLineResult(
  value: string,
  width: number,
  preserveWords: boolean,
  maxLines = Number.POSITIVE_INFINITY,
) {
  const points = Array.from(value);
  if (points.length === 0) {
    return { lines: [""], prefix: "", remainder: "" };
  }
  const lines: string[] = [];
  let start = 0;

  while (start < points.length && lines.length < maxLines) {
    const limit = Math.min(points.length, start + width);
    let end = limit;
    if (preserveWords && limit < points.length) {
      let breakAt = -1;
      for (let index = start; index < limit; index += 1) {
        if (points[index] === " " || points[index] === "\t") breakAt = index;
      }
      if (breakAt >= start + Math.floor(width * 0.55)) end = breakAt;
    }
    lines.push(points.slice(start, end).join("").trimEnd());
    start = end;
    if (preserveWords) {
      while (points[start] === " " || points[start] === "\t") start += 1;
    }
  }
  return {
    lines,
    prefix: points.slice(0, start).join("").trimEnd(),
    remainder: points.slice(start).join("").trimStart(),
  };
}

function displayLines(parts: ReturnType<typeof slideParts>) {
  const result: Array<{ kind: ContentKind; text: string }> = [];
  for (const item of parts.content) {
    const wrapped = wrapPptxLine(item.text, item.kind === "code" ? 105 : 92, {
      preserveWords: item.kind !== "code",
    });
    for (const text of wrapped) result.push({ kind: item.kind, text });
  }
  return result;
}

const MAX_PAGE_UNITS = 42;
const BODY_LINE_UNITS = 4;
const CODE_LINE_UNITS = 3;
const CODE_RUN_PADDING_UNITS = 2;

function paginateSourceSlide(
  markdown: string,
  sourceSlide: number,
  remainingPages: number,
): DocumentPptxPage[] {
  if (remainingPages < 1) throw pageLimitError();
  const parts = slideParts(markdown);
  const lines = displayLines(parts);
  const pageUnits = titleLayout(parts.title).pageUnits;
  if (lines.length === 0) {
    return [
      { title: parts.title, continuation: false, sourceSlide, lines: [] },
    ];
  }

  const pages: DocumentPptxPage[] = [];
  let pageLines: DocumentPptxPage["lines"] = [];
  let used = 0;
  const flush = () => {
    if (pageLines.length === 0) return;
    if (pages.length >= remainingPages) throw pageLimitError();
    pages.push({
      title: parts.title,
      continuation: pages.length > 0,
      sourceSlide,
      lines: pageLines,
    });
    pageLines = [];
    used = 0;
  };

  for (const line of lines) {
    const startsCodeRun =
      line.kind === "code" && pageLines.at(-1)?.kind !== "code";
    const units =
      (line.kind === "code" ? CODE_LINE_UNITS : BODY_LINE_UNITS) +
      (startsCodeRun ? CODE_RUN_PADDING_UNITS : 0);
    if (pageLines.length > 0 && used + units > pageUnits) flush();
    const startsCodeRunOnPage =
      line.kind === "code" && pageLines.at(-1)?.kind !== "code";
    used +=
      (line.kind === "code" ? CODE_LINE_UNITS : BODY_LINE_UNITS) +
      (startsCodeRunOnPage ? CODE_RUN_PADDING_UNITS : 0);
    pageLines.push(line);
  }
  flush();
  return pages;
}

export function buildDocumentPptxPages(bodyMarkdown: string) {
  const pages: DocumentPptxPage[] = [];
  for (const [index, markdown] of splitMarkdownSlides(bodyMarkdown).entries()) {
    const sourcePages = paginateSourceSlide(
      markdown,
      index + 1,
      PPTX_MAX_GENERATED_SLIDES - pages.length,
    );
    pages.push(...sourcePages);
  }
  return pages;
}

function titleLayout(title: string) {
  const lines = wrapPptxLine(title, 56);
  const height = lines.length * 0.53 + 0.08;
  const dividerY = 0.3 + height + 0.18;
  const contentY = dividerY + 0.23;
  return {
    text: lines.join("\n"),
    fontSize: 35,
    height,
    dividerY,
    contentY,
    pageUnits: Math.min(MAX_PAGE_UNITS, Math.floor((6.68 - contentY) / 0.11)),
  };
}

function addPageContent(
  slide: PptxGenJS.Slide,
  lines: DocumentPptxPage["lines"],
  startY: number,
) {
  if (lines.length === 0) {
    slide.addText(" ", {
      x: 0.8,
      y: startY,
      w: 11.7,
      h: 0.4,
      margin: 0,
      fontFace: "Aptos",
      fontSize: 18,
      color: "334155",
    });
    return;
  }

  let y = startY;
  let start = 0;
  while (start < lines.length) {
    const kind = lines[start]!.kind;
    let end = start + 1;
    while (end < lines.length && lines[end]!.kind === kind) end += 1;
    const text = lines
      .slice(start, end)
      .map((line) => line.text)
      .join("\n");
    const lineCount = end - start;
    if (kind === "body") {
      const height = lineCount * 0.405;
      slide.addText(text, {
        x: 0.8,
        y,
        w: 11.7,
        h: height,
        margin: 0.04,
        fontFace: "Aptos",
        fontSize: 18,
        color: "334155",
        valign: "top",
        breakLine: false,
      });
      y += height;
    } else {
      const height = 0.22 + lineCount * 0.33;
      slide.addText(text, {
        x: 0.8,
        y,
        w: 11.7,
        h: height,
        margin: 0.14,
        fontFace: "Aptos Mono",
        fontSize: 15,
        color: "E2E8F0",
        fill: { color: "172033" },
        line: { color: "334155", width: 1 },
        valign: "top",
        breakLine: false,
      });
      y += height;
    }
    start = end;
  }
}

export async function generateDocumentPptx(bodyMarkdown: string) {
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "Avermate";
  presentation.subject = "Avermate study document export";
  presentation.company = "Avermate";
  presentation.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };

  const pages = buildDocumentPptxPages(bodyMarkdown);
  for (const [index, page] of pages.entries()) {
    const slide = presentation.addSlide();
    const title = titleLayout(page.title);
    slide.background = { color: "F8FAFC" };
    slide.addShape(presentation.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.12,
      h: 7.5,
      line: { color: "4F46E5", transparency: 100 },
      fill: { color: "4F46E5" },
    });
    slide.addText(title.text, {
      x: 0.7,
      y: 0.3,
      w: 11.95,
      h: title.height,
      margin: 0,
      fontFace: "Aptos Display",
      fontSize: title.fontSize,
      bold: true,
      color: "172033",
      valign: "middle",
      breakLine: false,
    });
    slide.addShape(presentation.ShapeType.line, {
      x: 0.7,
      y: title.dividerY,
      w: 11.95,
      h: 0,
      line: { color: "CBD5E1", width: 1 },
    });
    addPageContent(slide, page.lines, title.contentY);
    slide.addText(
      `${page.continuation ? "CONTINUED  •  " : ""}${index + 1} / ${pages.length}`,
      {
        x: 10.4,
        y: 7.02,
        w: 2.1,
        h: 0.22,
        margin: 0,
        align: "right",
        fontFace: "Aptos",
        fontSize: 10,
        color: "64748B",
      },
    );
  }

  const output = await presentation.write({
    outputType: "nodebuffer",
    compression: true,
  });
  if (!(output instanceof Uint8Array)) {
    throw new Error("PptxGenJS did not return an in-memory byte buffer");
  }
  return new Uint8Array(output);
}

function pptxFileName(title: string) {
  const withoutSuffix =
    sanitizeXmlText(title)
      .trim()
      .replace(/\.pptx$/i, "") || "document";
  let usedCodeUnits = 0;
  const characters: string[] = [];
  for (const character of withoutSuffix) {
    if (usedCodeUnits + character.length > 155) break;
    characters.push(character);
    usedCodeUnits += character.length;
  }
  return `${characters.join("")}.pptx`;
}

async function adoptedExport(documentId: string, revision: number) {
  const [result] = await db
    .select({
      fileId: studyDocumentExports.fileId,
      byteSize: files.byteSize,
      revision: studyDocumentExports.revision,
    })
    .from(studyDocumentExports)
    .innerJoin(files, eq(files.id, studyDocumentExports.fileId))
    .where(
      and(
        eq(studyDocumentExports.documentId, documentId),
        eq(studyDocumentExports.revision, revision),
      ),
    )
    .limit(1);
  return result ?? null;
}

async function setPptxArtifact(input: {
  documentId: string;
  revision: number;
  userId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  fileId?: string | null;
  log?: string | null;
}) {
  await db
    .insert(documentArtifacts)
    .values({
      documentId: input.documentId,
      kind: "pptx",
      variant: "default",
      sourceRevision: input.revision,
      status: input.status,
      fileId: input.fileId ?? null,
      log: input.log ?? null,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [
        documentArtifacts.documentId,
        documentArtifacts.kind,
        documentArtifacts.variant,
        documentArtifacts.sourceRevision,
      ],
      set: {
        status: input.status,
        fileId: input.fileId ?? null,
        log: input.log ?? null,
        updatedAt: new Date(),
      },
    });
}

export async function runExportDocumentPptxJob(
  payload: unknown,
  options: {
    signal?: AbortSignal;
    storeFile?: typeof storeFile;
    deleteFile?: typeof deleteFile;
    /** Test-only acknowledgement-loss seam, after the adoption INSERT. */
    afterAdopt?: () => Promise<void>;
  } = {},
) {
  const input = payloadSchema.parse(payload);
  options.signal?.throwIfAborted();
  const existingExport = await adoptedExport(input.documentId, input.revision);
  if (existingExport) {
    const [owner] = await db
      .select({ userId: studyDocuments.userId })
      .from(studyDocuments)
      .where(eq(studyDocuments.id, input.documentId))
      .limit(1);
    if (owner) {
      await setPptxArtifact({
        documentId: input.documentId,
        revision: input.revision,
        userId: owner.userId,
        status: "succeeded",
        fileId: existingExport.fileId,
      });
    }
    return existingExport;
  }

  const [document] = await db
    .select()
    .from(studyDocuments)
    .where(
      and(
        eq(studyDocuments.id, input.documentId),
        eq(studyDocuments.revision, input.revision),
      ),
    )
    .limit(1);
  if (!document) {
    throw new NonRetryableJobError(
      "The slide deck changed before export — start a new export",
    );
  }
  if (document.kind !== "slides") {
    throw new NonRetryableJobError("Only slide decks can be exported to PPTX");
  }

  await setPptxArtifact({
    documentId: document.id,
    revision: document.revision,
    userId: document.userId,
    status: "running",
  });

  let stored: Awaited<ReturnType<typeof storeFile>>;
  try {
    options.signal?.throwIfAborted();
    const bytes = await generateDocumentPptx(document.bodyMarkdown);
    options.signal?.throwIfAborted();
    const name = pptxFileName(document.title);
    const file = new File([bytes], name, { type: PPTX_MIME_TYPE });
    stored = await (options.storeFile ?? storeFile)({
      userId: document.userId,
      purpose: "document-export",
      file,
      nameHint: name,
    });
  } catch (error) {
    await setPptxArtifact({
      documentId: document.id,
      revision: document.revision,
      userId: document.userId,
      status: "failed",
      log:
        error instanceof Error
          ? error.message.slice(0, 64 * 1024)
          : "PPTX export failed",
    });
    throw error;
  }

  try {
    const [adopted] = await db
      .insert(studyDocumentExports)
      .values({
        documentId: document.id,
        revision: document.revision,
        fileId: stored.id,
        userId: document.userId,
      })
      .onConflictDoNothing()
      .returning({ fileId: studyDocumentExports.fileId });
    if (adopted) {
      await setPptxArtifact({
        documentId: document.id,
        revision: document.revision,
        userId: document.userId,
        status: "succeeded",
        fileId: stored.id,
      });
      await options.afterAdopt?.();
      return {
        fileId: stored.id,
        byteSize: stored.byteSize,
        revision: document.revision,
      };
    }

    const winner = await adoptedExport(document.id, document.revision);
    if (!winner)
      throw new Error("The adopted PPTX export could not be resolved");
    await recordUnownedFileCleanup(
      document.userId,
      stored.id,
      options.deleteFile ?? deleteFile,
    );
    await setPptxArtifact({
      documentId: document.id,
      revision: document.revision,
      userId: document.userId,
      status: "succeeded",
      fileId: winner.fileId,
    });
    return winner;
  } catch (error) {
    // Reconcile a possibly committed insert before treating the upload as
    // unowned. This is the lost-ack fence for the storage/DB boundary.
    const reconciled = await adoptedExport(document.id, document.revision);
    if (reconciled?.fileId === stored.id) {
      await setPptxArtifact({
        documentId: document.id,
        revision: document.revision,
        userId: document.userId,
        status: "succeeded",
        fileId: stored.id,
      });
      return reconciled;
    }
    await recordUnownedFileCleanup(
      document.userId,
      stored.id,
      options.deleteFile ?? deleteFile,
    );
    await setPptxArtifact({
      documentId: document.id,
      revision: document.revision,
      userId: document.userId,
      status: "failed",
      log: error instanceof Error ? error.message.slice(0, 64 * 1024) : "PPTX export failed",
    });
    throw error;
  }
}
