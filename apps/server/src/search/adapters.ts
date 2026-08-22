import type { Client } from "@libsql/client";
import {
  assistantPartV1Schema,
  sourceLocatorV1Schema,
  type CorpusCoverage,
  type CorpusOriginKind,
  type OwnedSourceIdentity,
  type SourceLocatorV1,
  type StagedContentChunk,
  type StagedContentVersion,
} from "@avermate/agent-contracts";
import { extractText, getDocumentProxy } from "unpdf";
import { db } from "../db";
import {
  readStorageObject,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import { splitMarkdownSlides } from "../lib/study-document-content";
import { captureInlineAssets, type PendingContentAsset } from "./assets";
import {
  canonicalJson,
  estimateTokens,
  jsonValue,
  normalizeForSearch,
  sha256,
  utf8Size,
} from "./values";

type SqlClient = Pick<Client, "execute">;

export type ExtractedBlock = {
  text: string;
  locator: SourceLocatorV1;
  headingPath: string[] | null;
  evidenceKind: StagedContentChunk["evidenceKind"];
};

export type SourceDescriptor = {
  identity: OwnedSourceIdentity;
  title: string;
  yearId: string | null;
  subjectId: string | null;
  coverage: CorpusCoverage;
};

export type IndexableSourceSnapshot = SourceDescriptor & {
  versionKey: string;
  extractorId: string;
  extractorVersion: string;
  mimeType: string | null;
  language: string | null;
  metadata: Record<string, unknown>;
  blocks: readonly ExtractedBlock[];
  assets?: readonly PendingContentAsset[];
};

export type NativePdfExtraction = {
  totalPages: number;
  pages: readonly { page: number; text: string }[];
};

const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_PDF_PAGES = 10_000;
const MAX_PDF_TEXT_BYTES = 64 * 1024 * 1024;

/** Bounded, deterministic text-layer extraction. Empty pages stay explicit. */
export async function extractNativePdfText(
  bytes: ArrayBuffer | Uint8Array,
  options: { timeoutMs?: number } = {},
): Promise<NativePdfExtraction> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (input.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF exceeds the native extraction byte limit");
  }
  const pdf = await getDocumentProxy(input, {
    maxImageSize: 16_777_216,
    stopAtErrors: false,
  });
  if (pdf.numPages < 1 || pdf.numPages > MAX_PDF_PAGES) {
    await pdf.cleanup();
    throw new Error("PDF page count exceeds the native extraction limit");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      extractText(pdf, { mergePages: false }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("PDF native text extraction timed out")),
          options.timeoutMs ?? 45_000,
        );
      }),
    ]);
    const pages = result.text.map((text, index) => ({
      page: index + 1,
      text: text.replaceAll("\0", "").replace(/\r\n?/g, "\n").trim(),
    }));
    const byteSize = pages.reduce(
      (total, page) => total + utf8Size(page.text),
      0,
    );
    if (byteSize > MAX_PDF_TEXT_BYTES) {
      throw new Error("PDF text layer exceeds the extraction output limit");
    }
    return { totalPages: result.totalPages, pages };
  } finally {
    clearTimeout(timer);
    await pdf.cleanup().catch(() => undefined);
  }
}

export interface IndexableSourceAdapter {
  readonly kind: CorpusOriginKind;
  describe(identity: OwnedSourceIdentity): Promise<SourceDescriptor>;
  extract(identity: OwnedSourceIdentity): Promise<IndexableSourceSnapshot>;
}

function record(row: Record<string, unknown> | undefined, label: string) {
  if (!row) throw new Error(`${label} was not found or is not owned`);
  return row;
}

function identity(input: OwnedSourceIdentity, kind: CorpusOriginKind) {
  if (input.originKind !== kind) {
    throw new Error(`The ${kind} adapter cannot resolve ${input.originKind}`);
  }
  return input;
}

export function markdownBlocks(
  markdown: string,
  evidenceKind: ExtractedBlock["evidenceKind"] = "native-text",
) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ExtractedBlock[] = [];
  const headingPath: string[] = [];
  let start = 0;
  let current: string[] = [];
  let fence: string | null = null;
  const flush = (endExclusive: number) => {
    const text = current.join("\n").trim();
    if (text) {
      blocks.push({
        text,
        locator: {
          kind: "markdown",
          headingPath: [...headingPath],
          startLine: start + 1,
          endLine: Math.max(start + 1, endExclusive),
        },
        headingPath: [...headingPath],
        evidenceKind,
      });
    }
    current = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!;
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
    }
    const heading = !fence ? /^(#{1,6})\s+(.+?)\s*$/.exec(line) : null;
    if (heading) {
      flush(index);
      const depth = heading[1]!.length;
      headingPath.splice(depth - 1);
      headingPath[depth - 1] = heading[2]!.replace(/\s+#+$/, "").trim();
      start = index;
      current.push(line);
      continue;
    }
    if (!fence && line.trim() === "" && current.some((entry) => entry.trim())) {
      flush(index);
      start = index + 1;
      continue;
    }
    if (current.length === 0) start = index;
    current.push(line);
  }
  flush(lines.length);
  return blocks;
}

function textBlock(text: string): ExtractedBlock {
  return {
    text,
    locator: {
      kind: "text",
      startOffset: 0,
      endOffset: Math.max(1, text.length),
    },
    headingPath: null,
    evidenceKind: "native-text",
  };
}

function coverageForBlocks(
  blocks: readonly ExtractedBlock[],
  fallback: CorpusCoverage,
): CorpusCoverage {
  if (blocks.some((block) => block.evidenceKind === "ocr")) {
    return "searchable-ocr";
  }
  if (
    blocks.some(
      (block) =>
        block.evidenceKind === "native-text" ||
        block.evidenceKind === "transcript",
    )
  ) {
    return "searchable-native-text";
  }
  return blocks.some((block) => block.evidenceKind === "visual-only")
    ? "metadata-and-locators-only"
    : fallback;
}

export type MaterialSourceAdapterDependencies = {
  readObject?: typeof readStorageObject;
  extractPdf?: typeof extractNativePdfText;
};

export class MaterialSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "material" as const;
  constructor(
    private readonly client: SqlClient,
    private readonly dependencies: MaterialSourceAdapterDependencies = {},
  ) {}

  private async row(input: OwnedSourceIdentity) {
    identity(input, this.kind);
    const result = await this.client.execute({
      sql: `
        SELECT documents.*, files.mimeType, files.byteSize, files.storageKey,
          files.provider
        FROM material_documents AS documents
        LEFT JOIN files
          ON files.id = documents.fileId AND files.userId = documents.userId
        WHERE documents.id = ? AND documents.userId = ?
          AND documents.deletedAt IS NULL
        LIMIT 1
      `,
      args: [input.originId, input.ownerId],
    });
    return record(result.rows[0], "Material");
  }

  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.row(input);
    return {
      identity: input,
      title: String(row.title),
      yearId: String(row.yearId),
      subjectId: null,
      coverage:
        row.sourceType === "text"
          ? "searchable-native-text"
          : "metadata-and-locators-only",
    };
  }

  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const row = await this.row(input);
    const artifactResult = await this.client.execute({
      sql: `
        SELECT * FROM material_artifacts
        WHERE documentId = ? AND userId = ? AND status = 'ready'
        ORDER BY updatedAt, id
      `,
      args: [input.originId, input.ownerId],
    });
    const blocks: ExtractedBlock[] = [];
    const artifacts: Record<string, unknown>[] = [];
    let nativePdf: NativePdfExtraction | null = null;
    let nativePdfFailure: string | null = null;
    if (
      row.mimeType === "application/pdf" &&
      (row.provider === "local" || row.provider === "s3") &&
      typeof row.storageKey === "string"
    ) {
      try {
        const bytes = await (this.dependencies.readObject ?? readStorageObject)(
          row.provider as ManagedStorageProvider,
          row.storageKey,
          { maxBytes: MAX_PDF_BYTES },
        );
        nativePdf = await (
          this.dependencies.extractPdf ?? extractNativePdfText
        )(bytes);
        for (const page of nativePdf.pages) {
          if (!page.text) continue;
          blocks.push({
            text: page.text,
            locator: { kind: "pdf", page: page.page },
            headingPath: null,
            evidenceKind: "native-text",
          });
        }
      } catch (error) {
        nativePdfFailure =
          error instanceof Error ? error.name : "ExtractionError";
      }
    }
    const nativeTextPages = new Set(
      blocks.flatMap((block) =>
        block.evidenceKind === "native-text" && block.locator.kind === "pdf"
          ? [block.locator.page]
          : [],
      ),
    );
    const coveredPdfPages = new Set(nativeTextPages);
    if (row.sourceType === "text" && typeof row.textContent === "string") {
      if (row.textContent.trim()) blocks.push(textBlock(row.textContent));
    }
    for (const artifact of artifactResult.rows) {
      const segmentResult = await this.client.execute({
        sql: `
          SELECT * FROM material_artifact_segments
          WHERE artifactId = ? ORDER BY ordinal
        `,
        args: [artifact.id],
      });
      const kind = String(artifact.kind);
      const meta = jsonValue<Record<string, unknown> | null>(artifact.metaJson);
      artifacts.push({
        id: String(artifact.id),
        kind,
        updatedAt: Number(artifact.updatedAt),
        segmentCount: segmentResult.rows.length,
      });
      if (segmentResult.rows.length > 0) {
        for (const segment of segmentResult.rows) {
          const locator = sourceLocatorV1Schema.parse(
            jsonValue(segment.locatorJson),
          );
          if (
            kind === "ocr-markdown" &&
            locator.kind === "pdf" &&
            nativeTextPages.has(locator.page)
          ) {
            continue;
          }
          blocks.push({
            text: String(segment.text),
            locator,
            headingPath: null,
            evidenceKind:
              kind === "ocr-markdown"
                ? "ocr"
                : kind === "media-transcript" || meta?.kind === "youtube"
                  ? "transcript"
                  : "native-text",
          });
          if (locator.kind === "pdf") coveredPdfPages.add(locator.page);
        }
        continue;
      }
      if (kind === "web-markdown" && meta?.kind !== "youtube") {
        const content =
          typeof artifact.content === "string" ? artifact.content : "";
        blocks.push(...markdownBlocks(content));
        continue;
      }
      // Legacy OCR/media rows were flattened before exact boundaries were
      // persisted. Register only truthful, openable locators; never invent text.
      if (kind === "ocr-markdown") {
        const pages = Math.max(
          1,
          Math.min(10_000, Number(meta?.pageCount ?? 1)),
        );
        for (let page = 1; page <= pages; page += 1) {
          if (coveredPdfPages.has(page)) continue;
          blocks.push({
            text: String(row.title),
            locator: { kind: "pdf", page },
            headingPath: null,
            evidenceKind: "visual-only",
          });
          coveredPdfPages.add(page);
        }
      } else if (kind === "media-transcript") {
        const endMs = Math.max(1, Number(meta?.durationMs ?? 1));
        blocks.push({
          text: String(row.title),
          locator: {
            kind: String(row.mimeType).startsWith("video/") ? "video" : "audio",
            startMs: 0,
            endMs,
          },
          headingPath: null,
          evidenceKind: "visual-only",
        });
      }
    }
    if (row.mimeType === "application/pdf") {
      const pages = nativePdf?.totalPages ?? 1;
      for (let page = 1; page <= pages; page += 1) {
        if (coveredPdfPages.has(page)) continue;
        blocks.push({
          text: String(row.title),
          locator: { kind: "pdf", page },
          headingPath: null,
          evidenceKind: "visual-only",
        });
        coveredPdfPages.add(page);
      }
    }
    const captured = await captureInlineAssets(blocks);
    const coverage = coverageForBlocks(
      captured.blocks,
      row.sourceType === "text" ? "searchable-native-text" : "unsupported",
    );
    const metadata = {
      title: String(row.title),
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      storageKeyHash:
        typeof row.storageKey === "string" ? sha256(row.storageKey) : null,
      artifacts,
      pdfTextLayer:
        row.mimeType === "application/pdf"
          ? {
              attempted: row.provider === "local" || row.provider === "s3",
              totalPages: nativePdf?.totalPages ?? null,
              searchablePages: nativeTextPages.size,
              failure: nativePdfFailure,
            }
          : null,
      coverage,
      ...(coverage === "metadata-and-locators-only"
        ? { coverageReason: "exact-ocr-or-transcript-segments-required" }
        : {}),
    };
    return {
      identity: input,
      title: String(row.title),
      yearId: String(row.yearId),
      subjectId: null,
      coverage,
      versionKey: sha256(
        canonicalJson([
          "material-extractor-v2",
          row.updatedAt,
          row.fileId,
          row.textContent,
          artifacts,
          nativePdf?.pages.map((page) => [page.page, sha256(page.text)]),
        ]),
      ),
      extractorId: "avermate.material",
      extractorVersion: "2",
      mimeType:
        row.mimeType === null
          ? row.sourceType === "text"
            ? "text/plain"
            : null
          : String(row.mimeType),
      language: null,
      metadata,
      blocks: captured.blocks,
      assets: captured.assets,
    };
  }
}

class StudyDocumentSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "study-document" as const;
  constructor(private readonly client: SqlClient) {}

  private async row(input: OwnedSourceIdentity) {
    identity(input, this.kind);
    const result = await this.client.execute({
      sql: `SELECT * FROM study_documents WHERE id = ? AND userId = ? AND deletedAt IS NULL LIMIT 1`,
      args: [input.originId, input.ownerId],
    });
    return record(result.rows[0], "Study document");
  }

  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.row(input);
    return {
      identity: input,
      title: String(row.title),
      yearId: String(row.yearId),
      subjectId: row.subjectId === null ? null : String(row.subjectId),
      coverage: "searchable-native-text",
    };
  }

  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const row = await this.row(input);
    const body = String(row.bodyMarkdown ?? "");
    const meta = jsonValue<Record<string, unknown> | null>(row.metaJson);
    let blocks: ExtractedBlock[];
    if (row.kind === "slides") {
      blocks = splitMarkdownSlides(body)
        .map((text, index) => ({
          text,
          locator: { kind: "slides" as const, slide: index + 1 },
          headingPath: null,
          evidenceKind: "native-text" as const,
        }))
        .filter((block) => block.text.trim());
    } else if (body.trim()) {
      blocks = markdownBlocks(body);
    } else if (meta) {
      const structured = canonicalJson(meta);
      blocks = structured ? [textBlock(structured)] : [];
    } else {
      blocks = [];
    }
    const captured = await captureInlineAssets(blocks);
    return {
      identity: input,
      title: String(row.title),
      yearId: String(row.yearId),
      subjectId: row.subjectId === null ? null : String(row.subjectId),
      coverage: captured.blocks.length
        ? "searchable-native-text"
        : "unsupported",
      versionKey: `revision:${Number(row.revision)}`,
      extractorId: "avermate.study-document",
      extractorVersion: "1",
      mimeType: row.kind === "latex" ? "text/x-tex" : "text/markdown",
      language: null,
      metadata: {
        title: String(row.title),
        kind: row.kind,
        revision: row.revision,
      },
      blocks: captured.blocks,
      assets: captured.assets,
    };
  }
}

class RecordingSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "recording" as const;
  constructor(private readonly client: SqlClient) {}

  private async row(input: OwnedSourceIdentity) {
    identity(input, this.kind);
    const result = await this.client.execute({
      sql: `
        SELECT recordings.*, transcripts.text AS transcriptText,
          transcripts.segmentsJson, transcripts.segmentsVersion,
          transcripts.language, transcripts.provider,
          transcripts.updatedAt AS transcriptUpdatedAt
        FROM lecture_recordings AS recordings
        LEFT JOIN recording_transcripts AS transcripts
          ON transcripts.recordingId = recordings.id
          AND transcripts.userId = recordings.userId
        WHERE recordings.id = ? AND recordings.userId = ?
          AND recordings.deletedAt IS NULL
        LIMIT 1
      `,
      args: [input.originId, input.ownerId],
    });
    return record(result.rows[0], "Recording");
  }

  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.row(input);
    return {
      identity: input,
      title: String(row.title),
      yearId: String(row.yearId),
      subjectId: row.subjectId === null ? null : String(row.subjectId),
      coverage:
        row.segmentsJson === null
          ? "metadata-and-locators-only"
          : "searchable-native-text",
    };
  }

  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const row = await this.row(input);
    const segments =
      row.segmentsJson === null
        ? []
        : jsonValue<Array<{ startMs: number; endMs: number; text: string }>>(
            row.segmentsJson,
          );
    const blocks: ExtractedBlock[] = segments.map((segment) => ({
      text: segment.text,
      locator: {
        kind: "audio" as const,
        startMs: segment.startMs,
        endMs: Math.max(segment.startMs + 1, segment.endMs),
      },
      headingPath: null,
      evidenceKind: "transcript" as const,
    }));
    if (blocks.length === 0) {
      blocks.push({
        text: String(row.title),
        locator: {
          kind: "audio",
          startMs: 0,
          endMs: Math.max(1, Number(row.durationMs)),
        },
        headingPath: null,
        evidenceKind: "visual-only",
      });
    }
    const coverage = coverageForBlocks(blocks, "metadata-and-locators-only");
    return {
      identity: input,
      title: String(row.title),
      yearId: String(row.yearId),
      subjectId: row.subjectId === null ? null : String(row.subjectId),
      coverage,
      versionKey: sha256(
        canonicalJson([
          row.updatedAt,
          row.transcriptUpdatedAt,
          row.segmentsVersion,
          segments,
        ]),
      ),
      extractorId: "avermate.recording-transcript",
      extractorVersion: "1",
      mimeType: "text/vtt",
      language: row.language === null ? null : String(row.language),
      metadata: {
        title: String(row.title),
        provider: row.provider,
        exactSegments: segments.length > 0,
      },
      blocks,
    };
  }
}

class GradeSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "grade" as const;
  constructor(private readonly client: SqlClient) {}
  private async row(input: OwnedSourceIdentity) {
    identity(input, this.kind);
    const result = await this.client.execute({
      sql: `
        SELECT grades.*, subjects.name AS subjectName
        FROM grades JOIN subjects ON subjects.id = grades.subjectId
        WHERE grades.id = ? AND grades.userId = ? AND subjects.userId = ?
        LIMIT 1
      `,
      args: [input.originId, input.ownerId, input.ownerId],
    });
    return record(result.rows[0], "Grade");
  }
  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.row(input);
    return {
      identity: input,
      title: String(row.name),
      yearId: String(row.yearId),
      subjectId: String(row.subjectId),
      coverage: "searchable-native-text",
    };
  }
  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const row = await this.row(input);
    const text = [
      `Évaluation : ${String(row.name)}`,
      `Matière : ${String(row.subjectName)}`,
      `Note : ${Number(row.value)}/${Number(row.outOf)}`,
      `Coefficient : ${Number(row.coefficient)}`,
      row.note ? `Commentaire : ${String(row.note)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      identity: input,
      title: String(row.name),
      yearId: String(row.yearId),
      subjectId: String(row.subjectId),
      coverage: "searchable-native-text",
      versionKey: sha256(canonicalJson([row.updatedAt, text])),
      extractorId: "avermate.grade-fact",
      extractorVersion: "1",
      mimeType: "application/vnd.avermate.grade+text",
      language: "fr",
      metadata: {
        title: String(row.name),
        subjectName: String(row.subjectName),
      },
      blocks: [
        {
          text,
          locator: { kind: "grade", gradeId: input.originId },
          headingPath: null,
          evidenceKind: "native-text",
        },
      ],
    };
  }
}

class SubjectSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "subject" as const;
  constructor(private readonly client: SqlClient) {}
  private async row(input: OwnedSourceIdentity) {
    identity(input, this.kind);
    const result = await this.client.execute({
      sql: `SELECT * FROM subjects WHERE id = ? AND userId = ? LIMIT 1`,
      args: [input.originId, input.ownerId],
    });
    return record(result.rows[0], "Subject");
  }
  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.row(input);
    return {
      identity: input,
      title: String(row.name),
      yearId: String(row.yearId),
      subjectId: String(row.id),
      coverage: "searchable-native-text",
    };
  }
  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const row = await this.row(input);
    const text = [
      `Matière : ${String(row.name)}`,
      row.shortName ? `Abréviation : ${String(row.shortName)}` : "",
      `Coefficient : ${Number(row.coefficient)}`,
      Number(row.bonus) ? `Bonus : ${Number(row.bonus)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      ...(await this.describe(input)),
      versionKey: sha256(canonicalJson([row.updatedAt, text])),
      extractorId: "avermate.subject-fact",
      extractorVersion: "1",
      mimeType: "application/vnd.avermate.subject+text",
      language: "fr",
      metadata: { title: String(row.name) },
      blocks: [textBlock(text)],
    };
  }
}

/**
 * Indexes only immutable, completed human/model text parts. Tool payloads,
 * transient deltas, hidden provider state and non-text widgets never cross the
 * corpus boundary.
 */
export class ConversationSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "conversation" as const;
  constructor(private readonly client: SqlClient) {}

  private async row(input: OwnedSourceIdentity) {
    identity(input, this.kind);
    const result = await this.client.execute({
      sql: `SELECT threads.*, projects.yearId, projects.subjectId
        FROM assistant_threads AS threads
        LEFT JOIN study_projects AS projects
          ON projects.id = threads.projectId AND projects.userId = threads.userId
        WHERE threads.id = ? AND threads.userId = ?
          AND threads.deletedAt IS NULL LIMIT 1`,
      args: [input.originId, input.ownerId],
    });
    return record(result.rows[0], "Conversation");
  }

  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.row(input);
    return {
      identity: input,
      title: String(row.title),
      yearId: row.yearId === null ? null : String(row.yearId),
      subjectId: row.subjectId === null ? null : String(row.subjectId),
      coverage: "searchable-native-text",
    };
  }

  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const descriptor = await this.describe(input);
    const result = await this.client.execute({
      sql: `SELECT messages.id, messages.role, messages.partsJson,
          messages.partsVersion, messages.createdAt
        FROM assistant_messages AS messages
        JOIN assistant_threads AS threads ON threads.id = messages.threadId
        WHERE messages.threadId = ? AND threads.userId = ?
          AND threads.deletedAt IS NULL
          AND messages.status = 'complete'
          AND messages.role IN ('user', 'assistant')
        ORDER BY messages.createdAt, messages.id`,
      args: [input.originId, input.ownerId],
    });
    const blocks: ExtractedBlock[] = [];
    const versionParts: unknown[] = [];
    for (const row of result.rows) {
      const rawParts = jsonValue<unknown>(row.partsJson);
      if (!Array.isArray(rawParts)) continue;
      const messageParts: unknown[] = [];
      for (const candidate of rawParts) {
        const parsed = assistantPartV1Schema.safeParse(candidate);
        if (!parsed.success || parsed.data.type !== "text") continue;
        const markdown = parsed.data.markdown.trim();
        if (!markdown) continue;
        blocks.push({
          text: markdown,
          locator: {
            kind: "conversation",
            threadId: input.originId,
            messageId: String(row.id),
            partId: parsed.data.id,
            startOffset: 0,
            endOffset: markdown.length,
          },
          headingPath: null,
          evidenceKind: "native-text",
        });
        messageParts.push([parsed.data.id, sha256(markdown)]);
      }
      if (messageParts.length > 0) {
        versionParts.push([
          String(row.id),
          String(row.role),
          Number(row.partsVersion),
          messageParts,
        ]);
      }
    }
    return {
      ...descriptor,
      coverage:
        blocks.length > 0 ? "searchable-native-text" : "unsupported",
      versionKey: sha256(
        canonicalJson(["avermate.conversation-text-v1", versionParts]),
      ),
      extractorId: "avermate.conversation-text",
      extractorVersion: "1",
      mimeType: "application/vnd.avermate.conversation+markdown",
      language: null,
      metadata: {
        title: descriptor.title,
        completedMessageCount: versionParts.length,
        indexedTextPartCount: blocks.length,
      },
      blocks,
    };
  }
}

class ArtifactSourceAdapter implements IndexableSourceAdapter {
  readonly kind = "artifact" as const;
  constructor(private readonly client: SqlClient) {}
  private async row(input: OwnedSourceIdentity) {
    identity(input, this.kind);
    const result = await this.client.execute({
      sql: `
        SELECT artifacts.*, documents.title, documents.yearId,
          documents.subjectId
        FROM document_artifacts AS artifacts
        JOIN study_documents AS documents ON documents.id = artifacts.documentId
        WHERE artifacts.id = ? AND artifacts.userId = ?
          AND documents.userId = ? AND documents.deletedAt IS NULL
        LIMIT 1
      `,
      args: [input.originId, input.ownerId, input.ownerId],
    });
    return record(result.rows[0], "Artifact");
  }
  async describe(input: OwnedSourceIdentity): Promise<SourceDescriptor> {
    const row = await this.row(input);
    return {
      identity: input,
      title: `${String(row.title)} — ${String(row.kind)}`,
      yearId: String(row.yearId),
      subjectId: row.subjectId === null ? null : String(row.subjectId),
      coverage: "metadata-and-locators-only",
    };
  }
  async extract(input: OwnedSourceIdentity): Promise<IndexableSourceSnapshot> {
    const row = await this.row(input);
    const descriptor = await this.describe(input);
    const text = descriptor.title;
    return {
      ...descriptor,
      versionKey: sha256(
        canonicalJson([row.sourceRevision, row.updatedAt, row.fileId]),
      ),
      extractorId: "avermate.generated-artifact",
      extractorVersion: "1",
      mimeType: null,
      language: null,
      metadata: { title: descriptor.title, kind: row.kind, status: row.status },
      blocks: [
        {
          text,
          locator: { kind: "text", startOffset: 0, endOffset: text.length },
          headingPath: null,
          evidenceKind: "visual-only",
        },
      ],
    };
  }
}

export class IndexableSourceRegistry {
  private readonly adapters = new Map<
    CorpusOriginKind,
    IndexableSourceAdapter
  >();

  constructor(adapters: readonly IndexableSourceAdapter[]) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: IndexableSourceAdapter): this {
    if (this.adapters.has(adapter.kind)) {
      throw new Error(`Duplicate ${adapter.kind} corpus adapter`);
    }
    this.adapters.set(adapter.kind, adapter);
    return this;
  }

  adapter(kind: CorpusOriginKind) {
    const adapter = this.adapters.get(kind);
    if (!adapter)
      throw new Error(`No corpus adapter is registered for ${kind}`);
    return adapter;
  }

  describe(input: OwnedSourceIdentity) {
    return this.adapter(input.originKind).describe(input);
  }

  extract(input: OwnedSourceIdentity) {
    return this.adapter(input.originKind).extract(input);
  }
}

export function createCoreSourceRegistry(client: SqlClient = db.$client) {
  return new IndexableSourceRegistry([
    new MaterialSourceAdapter(client),
    new StudyDocumentSourceAdapter(client),
    new RecordingSourceAdapter(client),
    new GradeSourceAdapter(client),
    new SubjectSourceAdapter(client),
    new ConversationSourceAdapter(client),
    new ArtifactSourceAdapter(client),
  ]);
}

const MAX_CHUNK_CHARS = 262_144;
const MAX_CHUNKS = 100_000;

export function stagedVersionFromSnapshot(
  snapshot: IndexableSourceSnapshot,
  sourceId: string,
): StagedContentVersion {
  const chunks: StagedContentChunk[] = [];
  for (const block of snapshot.blocks) {
    sourceLocatorV1Schema.parse(block.locator);
    // A hard maximum may split an oversized semantic block; all normal blocks
    // preserve their page/heading/time boundary exactly.
    for (
      let offset = 0;
      offset < Math.max(1, block.text.length);
      offset += MAX_CHUNK_CHARS
    ) {
      const text = block.text.slice(offset, offset + MAX_CHUNK_CHARS);
      if (!text && block.evidenceKind !== "visual-only") continue;
      chunks.push({
        ordinal: chunks.length,
        text,
        normalizedText: normalizeForSearch(text),
        tokenEstimate: estimateTokens(text),
        contentHash: sha256(text),
        locator: block.locator,
        headingPath: block.headingPath,
        evidenceKind: block.evidenceKind,
      });
      if (chunks.length > MAX_CHUNKS) {
        throw new Error("The source exceeds the 100,000 chunk limit");
      }
    }
  }
  const contentHash = sha256(
    canonicalJson(
      chunks.map((chunk) => [
        chunk.contentHash,
        chunk.locator,
        chunk.evidenceKind,
      ]),
    ),
  );
  return {
    identity: snapshot.identity,
    sourceId,
    versionKey: snapshot.versionKey,
    contentHash,
    extractorId: snapshot.extractorId,
    extractorVersion: snapshot.extractorVersion,
    mimeType: snapshot.mimeType,
    language: snapshot.language,
    byteSize: snapshot.blocks.reduce(
      (total, block) => total + utf8Size(block.text),
      0,
    ),
    locatorSchemaVersion: 1,
    metadata: {
      ...snapshot.metadata,
      title: snapshot.title,
      coverage: snapshot.coverage,
      trust: "untrusted-source-content",
    },
    chunks,
  };
}
