import { and, eq, isNull, notExists, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  files,
  gradeAttachments,
  jobRuntimeMetadata,
  jobs,
  learningConcepts,
  learningCopyAnalyses,
  learningObjectives,
  type LearningCopyProposalV1,
  type LearningCopyRegionProposalV1,
} from "../db/schema";
import {
  type MistralOcrResult,
  type OcrProvider,
  resolveOcrProvider,
} from "../lib/ocr";
import { readOwnedFileBytes } from "../lib/owned-file-storage";
import { readStorageObject } from "../lib/storage-backend";
import { sha256 } from "../search/values";

export const GRADE_COPY_ANALYSIS_JOB_KIND = "grade-copy.analyze";
export const GRADE_COPY_ANALYSIS_MODEL_REVISION =
  "grade-copy-analysis:proposal-v1";
const MAX_COPY_BYTES = 50 * 1024 * 1024;

export const gradeCopyAnalysisJobPayloadSchema = z
  .object({
    analysisId: z.string().min(1),
    expectedRevision: z.number().int().positive(),
    sourceDigest: z.string().min(1).max(256),
    modelRevision: z.string().min(1).max(256),
  })
  .strict();

export type GradeCopyAnalysisJobPayload = z.infer<
  typeof gradeCopyAnalysisJobPayloadSchema
>;

export type GradeCopyOcrRunner = (
  userId: string,
  file: { blob: Blob; name: string },
  options: { signal?: AbortSignal; operationId?: string; attempt?: number },
) => Promise<{
  result: MistralOcrResult;
  provider: OcrProvider["id"];
  model: string;
}>;

/** Owner-scoped provider adapter; a selected but unavailable Node fails closed. */
export async function runResolvedGradeCopyOcr(
  userId: string,
  file: { blob: Blob; name: string },
  options: { signal?: AbortSignal; operationId?: string; attempt?: number },
  dependencies: {
    resolveProvider?: typeof resolveOcrProvider;
  } = {},
) {
  const provider = await (
    dependencies.resolveProvider ?? resolveOcrProvider
  )(userId, { purpose: "learning.copy-analysis" });
  return {
    result: await provider.run(file, options),
    provider: provider.id,
    model: provider.model,
  };
}

function staleResult(analysisId: string) {
  return { analysisId, status: "stale" as const };
}

const ERROR_HINTS = [
  { pattern: /calcul|arithm|signe/i, taxonomy: "calculation" as const },
  { pattern: /notation|unité|unite|symbole/i, taxonomy: "notation" as const },
  {
    pattern: /justifi|démontr|demontr|argument/i,
    taxonomy: "justification" as const,
  },
  {
    pattern: /consigne|lis|lecture|question/i,
    taxonomy: "reading-instruction" as const,
  },
  {
    pattern: /méthode|methode|démarche|demarche/i,
    taxonomy: "method-strategy" as const,
  },
] as const;

function tokens(value: string) {
  return new Set(
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("fr")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 4),
  );
}

function suggestedObjectiveIds(
  text: string,
  objectives: Array<{ id: string; statement: string; conceptLabel: string }>,
) {
  const source = tokens(text);
  return objectives
    .map((objective) => {
      const target = tokens(`${objective.conceptLabel} ${objective.statement}`);
      let score = 0;
      for (const token of source) if (target.has(token)) score += 1;
      return { id: objective.id, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    )
    .slice(0, 3)
    .map((candidate) => candidate.id);
}

/** Conservative deterministic segmentation of provider page text. */
export function buildCopyProposal(
  result: MistralOcrResult,
  objectives: Array<{ id: string; statement: string; conceptLabel: string }>,
): LearningCopyProposalV1 {
  const pages = result.pages?.map((page) => ({
    page: page.providerIndex + 1,
    text: page.markdown,
  })) ?? [{ page: 1, text: result.markdown }];
  return {
    version: 1,
    sourceTextKind: "ocr",
    providerFileId: result.providerFileId,
    unsupportedInferences: [
      "lexical-error-suggestions",
      "grade-remains-unchanged",
      "explicit-score-only",
    ],
    pages: pages.map((page) => {
      const chunks = page.text
        .split(/\n\s*\n/g)
        .map((value) => value.trim())
        .filter(Boolean);
      const regions: LearningCopyRegionProposalV1[] = chunks.map(
        (text, index) => {
          const score =
            /(?:^|\s)(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)(?:\s|$)/.exec(
              text,
            );
          const hint = ERROR_HINTS.find((candidate) =>
            candidate.pattern.test(text),
          );
          const lower = text.toLocaleLowerCase("fr");
          const teacherLike =
            /(?:attention|erreur|faux|bien|revoir|corrig|manque)/i.test(lower);
          return {
            id: `p${page.page}-r${index + 1}`,
            page: page.page,
            kind: score
              ? "awarded-points"
              : teacherLike
                ? "teacher-comment"
                : /\?$/.test(text)
                  ? "question"
                  : "answer",
            text,
            confidence: score ? 0.98 : teacherLike ? 0.65 : 0.55,
            suggestedObjectiveIds: suggestedObjectiveIds(text, objectives),
            ...(score
              ? {
                  awarded: {
                    value: Number(score[1]!.replace(",", ".")),
                    outOf: Number(score[2]!.replace(",", ".")),
                  },
                }
              : {}),
            ...(hint
              ? {
                  suggestedError: {
                    taxonomy: hint.taxonomy,
                    explanation:
                      "Motif repéré dans l’annotation ; à vérifier sur la copie.",
                    severity: 0.5,
                    confidence: 0.55,
                  },
                }
              : {}),
          };
        },
      );
      return { ...page, regions };
    }),
  };
}

export async function runGradeCopyAnalysisJob(
  payload: unknown,
  options: {
    jobId: string;
    attempts?: number;
    maxAttempts?: number;
    signal?: AbortSignal;
    operationId?: string;
    runOcr?: GradeCopyOcrRunner;
    readStorageObject?: typeof readStorageObject;
    readOwnedFile?: typeof readOwnedFileBytes;
  },
) {
  const parsed = gradeCopyAnalysisJobPayloadSchema.parse(payload);
  const { analysisId, expectedRevision, sourceDigest, modelRevision } = parsed;
  const [job] = await db
    .select({ id: jobs.id, userId: jobs.userId })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, options.jobId),
        eq(jobs.kind, GRADE_COPY_ANALYSIS_JOB_KIND),
      ),
    )
    .limit(1);
  if (!job?.userId) return staleResult(analysisId);

  const [analysis] = await db
    .select()
    .from(learningCopyAnalyses)
    .where(
      and(
        eq(learningCopyAnalyses.id, analysisId),
        eq(learningCopyAnalyses.userId, job.userId),
      ),
    )
    .limit(1);
  if (
    !analysis ||
    analysis.revision !== expectedRevision ||
    analysis.sourceDigest !== sourceDigest ||
    analysis.modelRevision !== modelRevision
  ) {
    return staleResult(analysisId);
  }

  const [claimed] = await db
    .update(learningCopyAnalyses)
    .set({
      jobId: options.jobId,
      status: "running",
      safeError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(learningCopyAnalyses.id, analysisId),
        eq(learningCopyAnalyses.userId, job.userId),
        eq(learningCopyAnalyses.revision, expectedRevision),
        eq(learningCopyAnalyses.sourceDigest, sourceDigest),
        eq(learningCopyAnalyses.modelRevision, modelRevision),
        eq(learningCopyAnalyses.status, "queued"),
        // The worker may win the tiny enqueue-to-attach race. It may only fill
        // an empty fence; it can never replace another attempt's job id.
        or(
          eq(learningCopyAnalyses.jobId, options.jobId),
          isNull(learningCopyAnalyses.jobId),
        ),
      ),
    )
    .returning();
  if (!claimed) return staleResult(analysisId);

  try {
    options.signal?.throwIfAborted();
    const [source] = await db
      .select({ file: files })
      .from(learningCopyAnalyses)
      .innerJoin(
        gradeAttachments,
        and(
          eq(gradeAttachments.id, learningCopyAnalyses.attachmentId),
          eq(gradeAttachments.userId, learningCopyAnalyses.userId),
        ),
      )
      .innerJoin(
        files,
        and(
          eq(files.id, learningCopyAnalyses.sourceFileId),
          eq(files.id, gradeAttachments.fileId),
          eq(files.userId, learningCopyAnalyses.userId),
          eq(files.status, "stored"),
        ),
      )
      .where(
        and(
          eq(learningCopyAnalyses.id, analysisId),
          eq(learningCopyAnalyses.userId, job.userId),
          eq(learningCopyAnalyses.jobId, options.jobId),
          eq(learningCopyAnalyses.revision, expectedRevision),
          eq(learningCopyAnalyses.status, "running"),
        ),
      )
      .limit(1);
    if (!source) throw new Error("Owned grade copy analysis source not found");
    if (
      !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
        source.file.mimeType,
      )
    ) {
      throw new Error("Copy analysis accepts PDF, PNG, JPEG and WebP files");
    }

    const bytes = await (options.readOwnedFile ?? readOwnedFileBytes)(
      job.userId,
      source.file,
      {
        signal: options.signal,
        maxBytes: MAX_COPY_BYTES,
        dependencies: options.readStorageObject
          ? { readManagedObject: options.readStorageObject }
          : undefined,
      },
    );
    const objectives = await db
      .select({
        id: learningObjectives.id,
        statement: learningObjectives.statement,
        conceptLabel: learningConcepts.canonicalLabel,
      })
      .from(learningObjectives)
      .innerJoin(
        learningConcepts,
        eq(learningConcepts.id, learningObjectives.conceptId),
      )
      .where(
        and(
          eq(learningObjectives.userId, job.userId),
          eq(learningObjectives.yearId, analysis.yearId),
          eq(learningObjectives.subjectId, analysis.subjectId),
        ),
      );
    options.signal?.throwIfAborted();
    const [active] = await db
      .select({ id: learningCopyAnalyses.id })
      .from(learningCopyAnalyses)
      .where(
        and(
          eq(learningCopyAnalyses.id, analysisId),
          eq(learningCopyAnalyses.userId, job.userId),
          eq(learningCopyAnalyses.jobId, options.jobId),
          eq(learningCopyAnalyses.revision, expectedRevision),
          eq(learningCopyAnalyses.sourceDigest, sourceDigest),
          eq(learningCopyAnalyses.modelRevision, modelRevision),
          eq(learningCopyAnalyses.status, "running"),
          notExists(
            db
              .select({ value: sql`1` })
              .from(jobRuntimeMetadata)
              .where(
                and(
                  eq(jobRuntimeMetadata.jobId, options.jobId),
                  eq(jobRuntimeMetadata.cancellation, "requested"),
                ),
              ),
          ),
        ),
      )
      .limit(1);
    if (!active) return staleResult(analysisId);
    const ocr = await (options.runOcr ?? runResolvedGradeCopyOcr)(
      job.userId,
      {
        blob: new Blob([bytes], { type: source.file.mimeType }),
        name: `copie-${analysis.attachmentId}`,
      },
      {
        signal: options.signal,
        operationId: options.operationId ?? options.jobId,
        attempt: options.attempts,
      },
    );
    const ocrProvider = z.enum(["mistral", "node-local", "capability-registry"]).parse(ocr.provider);
    const ocrModel = z.string().trim().min(1).max(512).parse(ocr.model);
    options.signal?.throwIfAborted();
    const proposal = buildCopyProposal(ocr.result, objectives);
    const [published] = await db
      .update(learningCopyAnalyses)
      .set({
        status: "proposed",
        revision: expectedRevision + 1,
        provider: ocrProvider,
        model: ocrModel,
        pageCount: ocr.result.pageCount,
        proposalJson: proposal,
        safeError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(learningCopyAnalyses.id, analysisId),
          eq(learningCopyAnalyses.userId, job.userId),
          eq(learningCopyAnalyses.jobId, options.jobId),
          eq(learningCopyAnalyses.revision, expectedRevision),
          eq(learningCopyAnalyses.sourceDigest, sourceDigest),
          eq(learningCopyAnalyses.modelRevision, modelRevision),
          eq(learningCopyAnalyses.status, "running"),
          notExists(
            db
              .select({ value: sql`1` })
              .from(jobRuntimeMetadata)
              .where(
                and(
                  eq(jobRuntimeMetadata.jobId, options.jobId),
                  eq(jobRuntimeMetadata.cancellation, "requested"),
                ),
              ),
          ),
        ),
      )
      .returning({ id: learningCopyAnalyses.id });
    if (!published) return staleResult(analysisId);
    return {
      analysisId,
      status: "proposed" as const,
      pageCount: ocr.result.pageCount,
      proposalDigest: sha256(JSON.stringify(proposal)),
    };
  } catch (error) {
    const safeError = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 2_000);
    const [runtime] = await db
      .select({ cancellation: jobRuntimeMetadata.cancellation })
      .from(jobRuntimeMetadata)
      .where(eq(jobRuntimeMetadata.jobId, options.jobId))
      .limit(1);
    const cancelled = runtime?.cancellation === "requested";
    const retrying =
      !cancelled &&
      (options.attempts ?? 1) < (options.maxAttempts ?? options.attempts ?? 1);
    await db
      .update(learningCopyAnalyses)
      .set({
        status: cancelled ? "cancelled" : retrying ? "queued" : "failed",
        revision:
          cancelled || !retrying ? expectedRevision + 1 : expectedRevision,
        safeError: cancelled || retrying ? null : safeError,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(learningCopyAnalyses.id, analysisId),
          eq(learningCopyAnalyses.userId, job.userId),
          eq(learningCopyAnalyses.jobId, options.jobId),
          eq(learningCopyAnalyses.revision, expectedRevision),
          eq(learningCopyAnalyses.sourceDigest, sourceDigest),
          eq(learningCopyAnalyses.modelRevision, modelRevision),
          eq(learningCopyAnalyses.status, "running"),
        ),
      );
    throw error;
  }
}
