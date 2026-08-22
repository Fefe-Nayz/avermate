import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { documentArtifacts, files, studyDocuments } from "../db/schema";
import { EXPORT_DOCUMENT_ARTIFACT_JOB_KIND } from "../jobs/export-document-artifact";
import { enqueueJob } from "../lib/jobs";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireStudyDocument } from "../lib/ownership";
import { fileAccessUrl } from "../lib/storage";
import { textToSpeechEnabled } from "../lib/text-to-speech";

const generatedKindSchema = z.enum(["anki", "html", "audio"]);

function artifactDependencies(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const dependencies = (value as { dependencies?: unknown }).dependencies;
  if (!Array.isArray(dependencies)) return [];
  return dependencies.slice(0, 100).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as { documentId?: unknown; revision?: unknown };
    return typeof value.documentId === "string" &&
      value.documentId.length > 0 &&
      typeof value.revision === "number" &&
      Number.isInteger(value.revision) &&
      value.revision > 0
      ? [{ documentId: value.documentId, revision: value.revision }]
      : [];
  });
}

export interface DocumentArtifactsRouterDependencies {
  fileAccessUrl?: typeof fileAccessUrl;
  textToSpeechEnabled?: typeof textToSpeechEnabled;
}

export function createDocumentArtifactsRouter(
  dependencies: DocumentArtifactsRouterDependencies = {},
) {
  const resolveAccessUrl = dependencies.fileAccessUrl ?? fileAccessUrl;
  const canUseTextToSpeech =
    dependencies.textToSpeechEnabled ?? textToSpeechEnabled;
  return {
    list: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireStudyDocument(userId, input.documentId);
        const rows = await db
          .select({ artifact: documentArtifacts, file: files })
          .from(documentArtifacts)
          .leftJoin(files, eq(files.id, documentArtifacts.fileId))
          .where(
            and(
              eq(documentArtifacts.documentId, document.id),
              eq(documentArtifacts.userId, userId),
            ),
          )
          .orderBy(
            desc(documentArtifacts.sourceRevision),
            desc(documentArtifacts.createdAt),
          );
        const dependencyIds = [
          ...new Set(
            rows.flatMap(({ artifact }) =>
              artifactDependencies(artifact.metaJson).map(
                (dependency) => dependency.documentId,
              ),
            ),
          ),
        ];
        const currentDependencies = dependencyIds.length
          ? await db
              .select({
                id: studyDocuments.id,
                revision: studyDocuments.revision,
              })
              .from(studyDocuments)
              .where(
                and(
                  eq(studyDocuments.userId, userId),
                  inArray(studyDocuments.id, dependencyIds),
                  isNull(studyDocuments.deletedAt),
                ),
              )
          : [];
        const dependencyRevision = new Map(
          currentDependencies.map((dependency) => [
            dependency.id,
            dependency.revision,
          ]),
        );
        return rows.map(({ artifact, file }) => ({
          id: artifact.id,
          documentId: artifact.documentId,
          kind: artifact.kind,
          variant: artifact.variant,
          sourceRevision: artifact.sourceRevision,
          status: artifact.status,
          log: artifact.log,
          metaVersion: artifact.metaVersion,
          metaJson: artifact.metaJson,
          fileId: artifact.fileId,
          byteSize:
            file?.status === "stored" && artifact.status === "succeeded"
              ? file.byteSize
              : null,
          mimeType:
            file?.status === "stored" && artifact.status === "succeeded"
              ? file.mimeType
              : null,
          stale:
            document.revision > artifact.sourceRevision ||
            artifactDependencies(artifact.metaJson).some(
              (dependency) =>
                dependencyRevision.get(dependency.documentId) !==
                dependency.revision,
            ),
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
        }));
      }),

    generate: protectedProcedure
      .input(
        z
          .object({
            documentId: z.string().min(1),
            kind: generatedKindSchema,
            variant: z.string().trim().min(1).max(80).default("default"),
          })
          .strict(),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const document = await requireStudyDocument(userId, input.documentId);
        if (document.deletedAt) {
          badRequest("A trashed document cannot generate artifacts");
        }
        if (input.kind === "anki" && document.kind === "mindmap") {
          badRequest("Mind maps cannot be exported to Anki yet");
        }
        if (
          input.kind === "audio" &&
          document.kind !== "fiche" &&
          document.kind !== "note"
        ) {
          badRequest("Podcasts can only be generated from a sheet or note");
        }
        if (input.kind === "audio" && input.variant !== "default") {
          badRequest("This podcast voice profile is not available");
        }
        if (input.kind === "audio" && !(await canUseTextToSpeech(userId))) {
          badRequest(
            "Podcast generation is not configured. Add a Mistral key in Settings → Integrations.",
          );
        }
        const [created] = await db
          .insert(documentArtifacts)
          .values({
            documentId: document.id,
            kind: input.kind,
            variant: input.variant,
            sourceRevision: document.revision,
            status: "queued",
            userId,
          })
          .onConflictDoNothing()
          .returning();
        const [artifact] = created
          ? [created]
          : await db
              .select()
              .from(documentArtifacts)
              .where(
                and(
                  eq(documentArtifacts.documentId, document.id),
                  eq(documentArtifacts.kind, input.kind),
                  eq(documentArtifacts.variant, input.variant),
                  eq(documentArtifacts.sourceRevision, document.revision),
                  eq(documentArtifacts.userId, userId),
                ),
              )
              .limit(1);
        if (!artifact) throw new Error("The document artifact was not created");
        const wasFailed = artifact.status === "failed";
        if (wasFailed) {
          await db
            .update(documentArtifacts)
            .set({
              status: "queued",
              log: null,
              fileId: null,
              metaJson: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(documentArtifacts.id, artifact.id),
                eq(documentArtifacts.userId, userId),
                eq(documentArtifacts.status, "failed"),
              ),
            );
        }
        if (artifact.status !== "succeeded" || !artifact.fileId || wasFailed) {
          const job = await enqueueJob({
            kind: EXPORT_DOCUMENT_ARTIFACT_JOB_KIND,
            payload: { artifactId: artifact.id },
            userId,
            idempotencyKey: artifact.id,
            maxAttempts: 3,
            newAttemptAfterTerminal: wasFailed,
          });
          return { artifactId: artifact.id, jobId: job.id, reused: false };
        }
        return { artifactId: artifact.id, jobId: null, reused: true };
      }),

    download: protectedProcedure
      .input(z.object({ artifactId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [row] = await db
          .select({ artifact: documentArtifacts, file: files })
          .from(documentArtifacts)
          .innerJoin(files, eq(files.id, documentArtifacts.fileId))
          .where(
            and(
              eq(documentArtifacts.id, input.artifactId),
              eq(documentArtifacts.userId, userId),
              eq(documentArtifacts.status, "succeeded"),
              eq(files.userId, userId),
              eq(files.status, "stored"),
            ),
          )
          .limit(1);
        if (!row) badRequest("This document artifact is unavailable");
        return {
          url: await resolveAccessUrl(row.file, { expiresIn: "1h" }),
          kind: row.artifact.kind,
          mimeType: row.file.mimeType,
          byteSize: row.file.byteSize,
          sourceRevision: row.artifact.sourceRevision,
        };
      }),
  };
}

export const documentArtifactsRouter = createDocumentArtifactsRouter();
