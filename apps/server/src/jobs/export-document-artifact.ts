import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  documentArtifacts,
  files,
  studyDocuments,
  type QuizContentV1,
} from "../db/schema";
import { NonRetryableJobError } from "../lib/jobs";
import { quizContentSchema } from "../lib/study-document-content";
import { renderStudyDocumentMarkdown } from "../lib/study-document-transclusion";
import { deleteFile, storeFile } from "../lib/storage";
import { runMistralTextToSpeech } from "../lib/text-to-speech";
import { recordUnownedFileCleanup } from "./ingest-link";

export const EXPORT_DOCUMENT_ARTIFACT_JOB_KIND = "export.documentArtifact";

const payloadSchema = z.object({ artifactId: z.string().min(1) }).strict();

function safeFileStem(value: string) {
  return (
    value
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 150) || "document"
  );
}

function oneLine(value: string) {
  return value
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quizCards(content: QuizContentV1) {
  return content.questions.map((question) => {
    if (question.kind === "mcq") {
      return [
        oneLine(question.prompt),
        oneLine(
          question.answers
            .map((index) => question.choices[index] ?? "")
            .join(" / "),
        ),
      ] as const;
    }
    if (question.kind === "open") {
      return [oneLine(question.prompt), oneLine(question.expected)] as const;
    }
    return [
      oneLine(question.text),
      oneLine(question.blanks.join(" / ")),
    ] as const;
  });
}

/** Deterministic, dependency-free cards for Anki's native TSV importer. */
export function ankiTsvForDocument(document: {
  title: string;
  bodyMarkdown: string;
  kind: string;
  metaJson: unknown;
}) {
  let cards: ReadonlyArray<readonly [string, string]> = [];
  if (document.kind === "quiz") {
    const parsed = quizContentSchema.safeParse(document.metaJson);
    if (!parsed.success) {
      throw new NonRetryableJobError("The quiz content is invalid");
    }
    cards = quizCards(parsed.data);
  } else {
    const lines = document.bodyMarkdown.replace(/\r\n?/g, "\n").split("\n");
    const explicit: Array<readonly [string, string]> = [];
    for (let index = 0; index < lines.length; index += 1) {
      const question = /^\s*Q\s*:\s*(.+)$/i.exec(lines[index] ?? "");
      const answer = /^\s*A\s*:\s*(.+)$/i.exec(lines[index + 1] ?? "");
      if (question && answer) {
        explicit.push([oneLine(question[1]!), oneLine(answer[1]!)]);
        index += 1;
      }
    }
    if (explicit.length > 0) {
      cards = explicit;
    } else {
      const sections: Array<readonly [string, string]> = [];
      let heading: string | null = null;
      let body: string[] = [];
      const flush = () => {
        const answer = oneLine(body.join(" "));
        if (heading && answer) sections.push([heading, answer]);
        body = [];
      };
      for (const line of lines) {
        const match = /^#{1,4}\s+(.+)$/.exec(line);
        if (match) {
          flush();
          heading = oneLine(match[1]!);
        } else if (heading && line.trim() && !/^(```|~~~)/.test(line.trim())) {
          body.push(line.replace(/^\s*[-*+]\s+/, ""));
        }
      }
      flush();
      cards = sections;
    }
  }
  if (cards.length === 0) {
    throw new NonRetryableJobError(
      "No cards could be derived; add Q:/A: pairs or headed sections",
    );
  }
  return [
    "#separator:tab",
    "#html:false",
    ...cards.map(([front, back]) => `${front}\t${back}`),
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export function standaloneHtmlForDocument(document: {
  title: string;
  bodyMarkdown: string;
}) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)}</title><style>body{max-width:56rem;margin:3rem auto;padding:0 1.5rem;font:16px/1.65 system-ui;color:#172033}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1{line-height:1.15}</style></head><body><h1>${escapeHtml(document.title)}</h1><pre>${escapeHtml(document.bodyMarkdown)}</pre></body></html>`;
}

/** Convert authored Markdown into deterministic narration without an LLM. */
export function narrationTextForDocument(document: {
  title: string;
  bodyMarkdown: string;
}) {
  const body = document.bodyMarkdown
    .replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " Extrait de code omis. ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gm, "")
    .replace(/^\s*>\s?(?:\[![^\]]+\]\s*)?/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\\\[|\\\]|\$\$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) {
    throw new NonRetryableJobError("The document has no narratable content");
  }
  return `Podcast Avermate. ${oneLine(document.title)}. ${body} Fin du document.`;
}

async function adoptedArtifact(artifactId: string) {
  const [row] = await db
    .select({
      id: documentArtifacts.id,
      status: documentArtifacts.status,
      fileId: documentArtifacts.fileId,
      byteSize: files.byteSize,
    })
    .from(documentArtifacts)
    .leftJoin(files, eq(files.id, documentArtifacts.fileId))
    .where(eq(documentArtifacts.id, artifactId))
    .limit(1);
  return row ?? null;
}

export async function runExportDocumentArtifactJob(
  payload: unknown,
  options: {
    signal?: AbortSignal;
    storeFile?: typeof storeFile;
    deleteFile?: typeof deleteFile;
    textToSpeech?: typeof runMistralTextToSpeech;
    /** Durable queue attempt; attempts after a crashed lease may reclaim `running`. */
    attempt?: number;
  } = {},
) {
  const { artifactId } = payloadSchema.parse(payload);
  const existing = await adoptedArtifact(artifactId);
  if (existing?.status === "succeeded" && existing.fileId) return existing;

  const [source] = await db
    .select({ artifact: documentArtifacts, document: studyDocuments })
    .from(documentArtifacts)
    .innerJoin(
      studyDocuments,
      eq(studyDocuments.id, documentArtifacts.documentId),
    )
    .where(eq(documentArtifacts.id, artifactId))
    .limit(1);
  if (!source)
    throw new NonRetryableJobError("The document artifact is unavailable");
  if (
    source.artifact.kind !== "anki" &&
    source.artifact.kind !== "html" &&
    source.artifact.kind !== "audio"
  ) {
    throw new NonRetryableJobError("This artifact generator is not available");
  }
  if (
    source.artifact.kind === "audio" &&
    source.document.kind !== "fiche" &&
    source.document.kind !== "note"
  ) {
    throw new NonRetryableJobError(
      "Podcasts can only be generated from a sheet or note",
    );
  }
  if (source.document.revision !== source.artifact.sourceRevision) {
    await db
      .update(documentArtifacts)
      .set({
        status: "failed",
        log: "The source changed before generation; regenerate the current revision",
        updatedAt: new Date(),
      })
      .where(eq(documentArtifacts.id, artifactId));
    throw new NonRetryableJobError(
      "The source changed before generation; regenerate the current revision",
    );
  }

  const generationRunId = crypto.randomUUID();
  const claimableStatuses =
    (options.attempt ?? 1) > 1
      ? (["queued", "failed", "running"] as const)
      : (["queued", "failed"] as const);
  const [claimed] = await db
    .update(documentArtifacts)
    .set({
      status: "running",
      log: null,
      metaVersion: 1,
      metaJson: { generationRunId },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(documentArtifacts.id, artifactId),
        inArray(documentArtifacts.status, claimableStatuses),
        isNull(documentArtifacts.fileId),
      ),
    )
    .returning({ id: documentArtifacts.id });
  if (!claimed) {
    const winner = await adoptedArtifact(artifactId);
    if (winner?.status === "succeeded" && winner.fileId) return winner;
    throw new Error("The document artifact is already being generated");
  }

  try {
    options.signal?.throwIfAborted();
    const isAnki = source.artifact.kind === "anki";
    const isAudio = source.artifact.kind === "audio";
    let content: string | ArrayBuffer;
    let extension: "tsv" | "html" | "mp3";
    let mimeType: "text/tab-separated-values" | "text/html" | "audio/mpeg";
    let metaJson: Record<string, unknown> | null = null;
    if (isAudio) {
      const rendered = await renderStudyDocumentMarkdown({
        userId: source.document.userId,
        yearId: source.document.yearId,
        documentId: source.document.id,
        markdown: source.document.bodyMarkdown,
      });
      const narration = narrationTextForDocument({
        ...source.document,
        bodyMarkdown: rendered.markdown,
      });
      const speech = await (options.textToSpeech ?? runMistralTextToSpeech)(
        source.document.userId,
        narration,
        { signal: options.signal },
      );
      content = Uint8Array.from(speech.audio).buffer as ArrayBuffer;
      extension = "mp3";
      mimeType = speech.mimeType;
      metaJson = {
        provider: "mistral",
        model: speech.model,
        voiceId: speech.voiceId,
        chunkCount: speech.chunkCount,
        characterCount: speech.characterCount,
        dependencies: rendered.dependencies,
        aiGenerated: true,
      };
    } else {
      content = isAnki
        ? ankiTsvForDocument(source.document)
        : standaloneHtmlForDocument(source.document);
      extension = isAnki ? "tsv" : "html";
      mimeType = isAnki ? "text/tab-separated-values" : "text/html";
    }
    const name = `${safeFileStem(source.document.title)}.${extension}`;
    const stored = await (options.storeFile ?? storeFile)({
      userId: source.document.userId,
      purpose: "document-artifact",
      file: new File([content], name, { type: mimeType }),
      nameHint: name,
    });
    try {
      const [published] = await db
        .update(documentArtifacts)
        .set({
          status: "succeeded",
          fileId: stored.id,
          log: null,
          metaVersion: 1,
          metaJson,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documentArtifacts.id, artifactId),
            eq(documentArtifacts.status, "running"),
            isNull(documentArtifacts.fileId),
            sql`json_extract(${documentArtifacts.metaJson}, '$.generationRunId') = ${generationRunId}`,
          ),
        )
        .returning({ id: documentArtifacts.id });
      if (!published) {
        await recordUnownedFileCleanup(
          source.document.userId,
          stored.id,
          options.deleteFile ?? deleteFile,
        );
        const winner = await adoptedArtifact(artifactId);
        if (winner?.status === "succeeded" && winner.fileId) return winner;
        throw new Error("The generated artifact could not be published");
      }
      return {
        id: artifactId,
        fileId: stored.id,
        byteSize: stored.byteSize,
        kind: source.artifact.kind,
        sourceRevision: source.artifact.sourceRevision,
      };
    } catch (error) {
      const reconciled = await adoptedArtifact(artifactId);
      if (reconciled?.fileId === stored.id) return reconciled;
      await recordUnownedFileCleanup(
        source.document.userId,
        stored.id,
        options.deleteFile ?? deleteFile,
      );
      throw error;
    }
  } catch (error) {
    await db
      .update(documentArtifacts)
      .set({
        status: "failed",
        log:
          error instanceof Error
            ? error.message.slice(0, 64 * 1024)
            : "Artifact generation failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentArtifacts.id, artifactId),
          eq(documentArtifacts.status, "running"),
          isNull(documentArtifacts.fileId),
          sql`json_extract(${documentArtifacts.metaJson}, '$.generationRunId') = ${generationRunId}`,
        ),
      );
    throw error;
  }
}
