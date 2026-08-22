import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { subjects } from "../db/schema/app";
import {
  documentArtifacts,
  studyDocumentReferences,
  studyDocumentExports,
  studyDocuments,
  type QuizContentV1,
  type StudyDocumentKind,
  type StudyDocumentMeta,
  type StudyDocumentReferenceKind,
} from "../db/schema/documents";
import { files } from "../db/schema/files";
import { EXPORT_DOCUMENT_PPTX_JOB_KIND } from "../jobs/export-document-pptx";
import { CLEANUP_UNOWNED_FILE_JOB_KIND } from "../jobs/ingest-link";
import { assertSameYear } from "../lib/domain-integrity";
import { newId } from "../lib/id";
import { enqueueJob } from "../lib/jobs";
import { badRequest, protectedProcedure } from "../lib/orpc";
import {
  requireGrade,
  requireMaterialDocument,
  requireLiveMaterialFolder,
  requireStudyDocument,
  requireSubject,
  requireYear,
} from "../lib/ownership";
import {
  studyDocumentContentIssue,
  studyDocumentMetaSchema,
  quizContentSchema,
  quizPromptContent,
  type QuizPromptContentV1,
} from "../lib/study-document-content";
import { renderStudyDocumentMarkdown } from "../lib/study-document-transclusion";
import {
  parseStudyDocumentFrontMatter,
  syncStudyDocumentFrontMatterTags,
  type StudyDocumentFrontMatter,
} from "../lib/study-document-frontmatter";
import { deleteFile, fileAccessUrl } from "../lib/storage";
import { materialTagIdsByTarget } from "./materials/tags";
import { createDocumentBuildRouter } from "./document-builds";
import {
  createDocumentArtifactsRouter,
  type DocumentArtifactsRouterDependencies,
} from "./document-artifacts";
import { quizAttemptsRouter } from "./quiz-attempts";
import { trashMaterialTarget } from "./materials/operations";

const BODY_MAX_BYTES = 512 * 1024;
const titleSchema = z.string().trim().min(1).max(160);
const sourceSchema = z
  .object({
    kind: z.enum(["subject", "materialDocument", "grade"]),
    referenceId: z.string().min(1),
  })
  .strict();
const sourcesSchema = z
  .array(sourceSchema)
  .max(100)
  .superRefine((sources, context) => {
    const seen = new Set<string>();
    for (const [index, source] of sources.entries()) {
      const key = `${source.kind}:${source.referenceId}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "A source can only be cited once",
          path: [index],
        });
      }
      seen.add(key);
    }
  });

function assertBodySize(bodyMarkdown: string) {
  if (new TextEncoder().encode(bodyMarkdown).byteLength > BODY_MAX_BYTES) {
    badRequest("A study document body must be 512 KiB or smaller");
  }
}

function assertContentContract(
  kind: StudyDocumentKind,
  bodyMarkdown: string,
  metaJson: StudyDocumentMeta | null,
) {
  const issue = studyDocumentContentIssue(kind, bodyMarkdown, metaJson);
  if (issue) badRequest(issue);
}

function hasMarkdownFrontMatter(kind: StudyDocumentKind) {
  return kind === "fiche" || kind === "note" || kind === "slides";
}

function normalizedMetadataName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase("fr");
}

async function frontMatterMetadata(
  userId: string,
  yearId: string,
  markdown: string,
): Promise<StudyDocumentFrontMatter & { subjectId?: string }> {
  const metadata = parseStudyDocumentFrontMatter(markdown);
  if (!metadata.subject) return metadata;
  const candidates = await db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(and(eq(subjects.userId, userId), eq(subjects.yearId, yearId)));
  const exactId = candidates.find(
    (candidate) => candidate.id === metadata.subject,
  );
  const matches = exactId
    ? [exactId]
    : candidates.filter(
        (candidate) =>
          normalizedMetadataName(candidate.name) ===
          normalizedMetadataName(metadata.subject!),
      );
  if (matches.length === 0) {
    badRequest(
      `The front-matter subject "${metadata.subject}" does not exist in this year`,
    );
  }
  if (matches.length > 1) {
    badRequest(
      `The front-matter subject "${metadata.subject}" is ambiguous; use its id`,
    );
  }
  return { ...metadata, subjectId: matches[0]!.id };
}

async function validateFolder(
  userId: string,
  yearId: string,
  folderId: string | null,
) {
  if (!folderId) return;
  const folder = await requireLiveMaterialFolder(userId, folderId);
  assertSameYear("Fiche folder", yearId, folder.yearId);
}

async function validateSubject(
  userId: string,
  yearId: string,
  subjectId: string | null,
) {
  if (!subjectId) return;
  const subject = await requireSubject(userId, subjectId);
  assertSameYear("Fiche subject", yearId, subject.yearId);
}

async function validateSources(
  userId: string,
  yearId: string,
  sources: readonly {
    kind: StudyDocumentReferenceKind;
    referenceId: string;
  }[],
) {
  await Promise.all(
    sources.map(async (source) => {
      if (source.kind === "subject") {
        const subject = await requireSubject(userId, source.referenceId);
        assertSameYear("Fiche source", yearId, subject.yearId);
        return;
      }
      if (source.kind === "materialDocument") {
        const material = await requireMaterialDocument(
          userId,
          source.referenceId,
        );
        assertSameYear("Fiche source", yearId, material.yearId);
        return;
      }
      const grade = await requireGrade(userId, source.referenceId);
      assertSameYear("Fiche source", yearId, grade.yearId);
    }),
  );
}

async function referencesFor(documentId: string) {
  return db
    .select({
      kind: studyDocumentReferences.kind,
      referenceId: studyDocumentReferences.referenceId,
    })
    .from(studyDocumentReferences)
    .where(eq(studyDocumentReferences.documentId, documentId))
    .orderBy(
      asc(studyDocumentReferences.kind),
      asc(studyDocumentReferences.referenceId),
    );
}

async function renderedProjection(
  document: typeof studyDocuments.$inferSelect,
) {
  if (
    document.kind !== "fiche" &&
    document.kind !== "note" &&
    document.kind !== "slides"
  ) {
    return {
      renderedMarkdown: document.bodyMarkdown,
      transclusionDependencies: [] as Array<{
        documentId: string;
        revision: number;
      }>,
    };
  }
  const rendered = await renderStudyDocumentMarkdown({
    userId: document.userId,
    yearId: document.yearId,
    documentId: document.id,
    markdown: document.bodyMarkdown,
  });
  return {
    renderedMarkdown: rendered.markdown,
    transclusionDependencies: rendered.dependencies,
  };
}

/**
 * Projection shared by every reader-facing collection/detail response.
 *
 * A quiz's corrections are authoring data. They are available only through
 * `getForEdit`; the normal list/get surface carries prompts and cardinalities
 * so a quiz can be described and started without shipping its answers.
 */
type ReaderStudyDocument = Omit<
  typeof studyDocuments.$inferSelect,
  "metaJson"
> & {
  metaJson:
    Exclude<StudyDocumentMeta, QuizContentV1> | QuizPromptContentV1 | null;
};

function readerDocumentProjection(
  document: typeof studyDocuments.$inferSelect,
): ReaderStudyDocument {
  // The content contract prevents answer-bearing quiz metadata on every other
  // kind. State that invariant in the public output type as well as at runtime.
  if (document.kind !== "quiz") return document as ReaderStudyDocument;
  const content = quizContentSchema.safeParse(document.metaJson);
  return {
    ...document,
    metaJson: content.success ? quizPromptContent(content.data) : null,
  };
}

const createInput = z
  .object({
    yearId: z.string().min(1),
    kind: z
      .enum(["fiche", "note", "mindmap", "slides", "latex", "quiz"])
      .default("fiche"),
    title: titleSchema,
    bodyMarkdown: z.string().default(""),
    metaJson: studyDocumentMetaSchema.nullable().default(null),
    folderId: z.string().nullable().default(null),
    subjectId: z.string().nullable().default(null),
  })
  .strict();

const updateInput = z
  .object({
    documentId: z.string().min(1),
    revision: z.number().int().min(1),
    title: titleSchema.optional(),
    bodyMarkdown: z.string().optional(),
    metaJson: studyDocumentMetaSchema.nullable().optional(),
    folderId: z.string().nullable().optional(),
    subjectId: z.string().nullable().optional(),
    sources: sourcesSchema.optional(),
  })
  .strict();

export interface DocumentsRouterDependencies {
  deleteFile?: typeof deleteFile;
  fileAccessUrl?: typeof fileAccessUrl;
  textToSpeechEnabled?: DocumentArtifactsRouterDependencies["textToSpeechEnabled"];
  /** Test-only barrier between the export snapshot and atomic delete batch. */
  afterDeleteSnapshot?: () => Promise<void> | void;
}

export function createDocumentsRouter(
  dependencies: DocumentsRouterDependencies = {},
) {
  const removeFile = dependencies.deleteFile ?? deleteFile;
  const resolveFileAccessUrl = dependencies.fileAccessUrl ?? fileAccessUrl;
  const buildRouter = createDocumentBuildRouter({
    fileAccessUrl: resolveFileAccessUrl,
  });
  const artifactsRouter = createDocumentArtifactsRouter({
    fileAccessUrl: resolveFileAccessUrl,
    textToSpeechEnabled: dependencies.textToSpeechEnabled,
  });
  return {
    ...buildRouter,
    artifacts: artifactsRouter,
    quiz: quizAttemptsRouter,
    list: protectedProcedure
      .input(
        z
          .object({
            yearId: z.string().min(1),
            /** undefined = whole year; null = documents at the tree root. */
            folderId: z.string().nullable().optional(),
            include: z.enum(["live", "trashed"]).default("live"),
          })
          .strict(),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        if (typeof input.folderId === "string") {
          await validateFolder(userId, input.yearId, input.folderId);
        }
        const folderFilter =
          input.folderId === undefined
            ? undefined
            : input.folderId === null
              ? isNull(studyDocuments.folderId)
              : eq(studyDocuments.folderId, input.folderId);
        const rows = await db
          .select()
          .from(studyDocuments)
          .where(
            and(
              eq(studyDocuments.userId, userId),
              eq(studyDocuments.yearId, input.yearId),
              folderFilter,
              input.include === "trashed"
                ? isNotNull(studyDocuments.deletedAt)
                : isNull(studyDocuments.deletedAt),
            ),
          )
          .orderBy(asc(studyDocuments.title), asc(studyDocuments.createdAt));
        const tagIds = await materialTagIdsByTarget({
          userId,
          yearId: input.yearId,
          targetKind: "study",
          targetIds: rows.map((row) => row.id),
        });
        return rows.map((row) => ({
          ...readerDocumentProjection(row),
          tagIds: tagIds.get(row.id) ?? [],
        }));
      }),

    get: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const document = await requireStudyDocument(
          context.session.user.id,
          input.documentId,
        );
        return {
          document: readerDocumentProjection(document),
          sources: await referencesFor(document.id),
          ...(await renderedProjection(document)),
        };
      }),

    /**
     * Full authoring projection. Unlike `get`, this deliberately includes a
     * quiz's corrections and must remain owner-scoped and off reader routes.
     */
    getForEdit: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const document = await requireStudyDocument(
          context.session.user.id,
          input.documentId,
        );
        return {
          document,
          sources: await referencesFor(document.id),
          ...(await renderedProjection(document)),
        };
      }),

    create: protectedProcedure
      .input(createInput)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        assertBodySize(input.bodyMarkdown);
        assertContentContract(input.kind, input.bodyMarkdown, input.metaJson);
        const metadata = hasMarkdownFrontMatter(input.kind)
          ? await frontMatterMetadata(userId, input.yearId, input.bodyMarkdown)
          : null;
        const title = metadata?.title ?? input.title;
        const subjectId = metadata?.subjectId ?? input.subjectId;
        await Promise.all([
          validateFolder(userId, input.yearId, input.folderId),
          validateSubject(userId, input.yearId, subjectId),
        ]);
        const [document] = await db
          .insert(studyDocuments)
          .values({
            ...input,
            title,
            subjectId,
            metaVersion: input.kind === "latex" ? 2 : 1,
            userId,
          })
          .returning();
        if (hasMarkdownFrontMatter(document.kind)) {
          await syncStudyDocumentFrontMatterTags({
            userId,
            yearId: document.yearId,
            documentId: document.id,
            markdown: document.bodyMarkdown,
          });
        }
        return {
          document,
          sources: [],
          ...(await renderedProjection(document)),
        };
      }),

    update: protectedProcedure
      .input(updateInput)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const existing = await requireStudyDocument(userId, input.documentId);
        if (input.bodyMarkdown !== undefined) {
          assertBodySize(input.bodyMarkdown);
        }
        assertContentContract(
          existing.kind,
          input.bodyMarkdown ?? existing.bodyMarkdown,
          input.metaJson === undefined ? existing.metaJson : input.metaJson,
        );
        const metadata =
          input.bodyMarkdown !== undefined &&
          hasMarkdownFrontMatter(existing.kind)
            ? await frontMatterMetadata(
                userId,
                existing.yearId,
                input.bodyMarkdown,
              )
            : null;
        const title = metadata?.title ?? input.title;
        const subjectId = metadata?.subjectId ?? input.subjectId;
        await Promise.all([
          input.folderId === undefined
            ? Promise.resolve()
            : validateFolder(userId, existing.yearId, input.folderId),
          subjectId === undefined
            ? Promise.resolve()
            : validateSubject(userId, existing.yearId, subjectId),
          input.sources === undefined
            ? Promise.resolve()
            : validateSources(userId, existing.yearId, input.sources),
        ]);

        const assignments: string[] = [];
        const updateArguments: (string | number | null)[] = [];
        const assign = (column: string, value: string | number | null) => {
          assignments.push(`"${column}" = ?`);
          updateArguments.push(value);
        };
        if (title !== undefined) assign("title", title);
        if (input.bodyMarkdown !== undefined) {
          assign("bodyMarkdown", input.bodyMarkdown);
        }
        if (input.metaJson !== undefined) {
          assign("metaVersion", existing.kind === "latex" ? 2 : 1);
          assign(
            "metaJson",
            input.metaJson === null ? null : JSON.stringify(input.metaJson),
          );
        }
        if (input.folderId !== undefined) assign("folderId", input.folderId);
        if (subjectId !== undefined) {
          assign("subjectId", subjectId);
        }
        assignments.push('"revision" = "revision" + 1');
        assign("updatedAt", Math.floor(Date.now() / 1_000));
        updateArguments.push(existing.id, userId, input.revision);

        const statements: {
          sql: string;
          args: (string | number | null)[];
        }[] = [
          {
            sql: `UPDATE "study_documents" SET ${assignments.join(", ")} WHERE "id" = ? AND "userId" = ? AND "revision" = ?`,
            args: updateArguments,
          },
          {
            /**
             * libSQL batches are transactional. `changes()` observes the CAS
             * immediately above; a stale revision deliberately violates NOT NULL,
             * aborting and rolling back the entire batch before references move.
             * This also works with the shared in-memory database used by the suite,
             * unlike libSQL's interactive-transaction connection on Windows.
             */
            sql: `INSERT INTO "study_document_references" ("documentId", "kind", "referenceId") SELECT NULL, 'subject', '__stale_revision__' WHERE changes() = 0`,
            args: [],
          },
        ];
        if (input.sources !== undefined) {
          statements.push({
            sql: `DELETE FROM "study_document_references" WHERE "documentId" = ?`,
            args: [existing.id],
          });
          for (const source of input.sources) {
            statements.push({
              sql: `INSERT INTO "study_document_references" ("documentId", "kind", "referenceId") VALUES (?, ?, ?)`,
              args: [existing.id, source.kind, source.referenceId],
            });
          }
        }

        try {
          await db.$client.batch(statements, "write");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message.includes("NOT NULL constraint failed") &&
            message.includes("study_document_references.documentId")
          ) {
            badRequest("This fiche changed elsewhere — reload");
          }
          throw error;
        }
        const updated = await requireStudyDocument(userId, existing.id);
        if (hasMarkdownFrontMatter(updated.kind)) {
          await syncStudyDocumentFrontMatterTags({
            userId,
            yearId: updated.yearId,
            documentId: updated.id,
            markdown: updated.bodyMarkdown,
          });
        }

        return {
          document: updated,
          sources: await referencesFor(updated.id),
          ...(await renderedProjection(updated)),
        };
      }),

    exportPptx: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const document = await requireStudyDocument(
          context.session.user.id,
          input.documentId,
        );
        if (document.kind !== "slides") {
          badRequest("Only slide decks can be exported to PPTX");
        }
        await db
          .insert(documentArtifacts)
          .values({
            documentId: document.id,
            kind: "pptx",
            variant: "default",
            sourceRevision: document.revision,
            status: "queued",
            userId: document.userId,
          })
          .onConflictDoNothing();
        const job = await enqueueJob({
          kind: EXPORT_DOCUMENT_PPTX_JOB_KIND,
          payload: { documentId: document.id, revision: document.revision },
          userId: document.userId,
          idempotencyKey: `${document.id}:${document.revision}`,
          maxAttempts: 3,
        });
        return { jobId: job.id, revision: document.revision };
      }),

    downloadPptx: protectedProcedure
      .input(
        z
          .object({
            documentId: z.string().min(1),
            revision: z.number().int().min(1),
          })
          .strict(),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireStudyDocument(userId, input.documentId);
        const [row] = await db
          .select({
            provider: files.provider,
            storageKey: files.storageKey,
            url: files.url,
            mimeType: files.mimeType,
            byteSize: files.byteSize,
          })
          .from(studyDocumentExports)
          .innerJoin(files, eq(files.id, studyDocumentExports.fileId))
          .where(
            and(
              eq(studyDocumentExports.documentId, input.documentId),
              eq(studyDocumentExports.revision, input.revision),
              eq(studyDocumentExports.userId, userId),
              eq(files.userId, userId),
              eq(files.status, "stored"),
            ),
          )
          .limit(1);
        if (!row) badRequest("This PowerPoint export is unavailable");
        return {
          url: await resolveFileAccessUrl(row),
          mimeType: row.mimeType,
          byteSize: row.byteSize,
        };
      }),

    delete: protectedProcedure
      .input(z.object({ documentId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const current = await requireStudyDocument(userId, input.documentId);
        if (!current.deletedAt) {
          await trashMaterialTarget(userId, "study", current.id);
          return { ok: true as const };
        }
        let deletedFileIds: string[] | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const document = await requireStudyDocument(userId, input.documentId);
          const [exports, artifacts] = await Promise.all([
            db
              .select({
                revision: studyDocumentExports.revision,
                fileId: studyDocumentExports.fileId,
              })
              .from(studyDocumentExports)
              .where(
                and(
                  eq(studyDocumentExports.documentId, document.id),
                  eq(studyDocumentExports.userId, userId),
                ),
              ),
            db
              .select({
                id: documentArtifacts.id,
                fileId: documentArtifacts.fileId,
              })
              .from(documentArtifacts)
              .where(
                and(
                  eq(documentArtifacts.documentId, document.id),
                  eq(documentArtifacts.userId, userId),
                ),
              ),
          ]);
          await dependencies.afterDeleteSnapshot?.();

          const now = Math.floor(Date.now() / 1_000);
          const cleanupBatchId = newId("cleanup");
          const knownPredicate =
            exports.length === 0
              ? "0"
              : exports
                  .map(() => '("revision" = ? AND "fileId" = ?)')
                  .join(" OR ");
          const knownArtifactPredicate =
            artifacts.length === 0
              ? "0"
              : artifacts
                  .map(() => '("id" = ? AND "fileId" IS ?)')
                  .join(" OR ");
          const statements = [
            {
              sql: `DELETE FROM "material_tag_links" WHERE "targetKind" = 'study' AND "targetId" = ?`,
              args: [document.id],
            },
            {
              sql: `DELETE FROM "jobs" WHERE "userId" = ? AND json_extract("payload", '$.artifactId') IN (SELECT "id" FROM "document_artifacts" WHERE "documentId" = ? AND "userId" = ?)`,
              args: [userId, document.id, userId],
            },
            {
              // Purge queued, running and completed export payloads. A worker
              // that already holds a lease will fail its FK adoption after the
              // domain delete and clean up its candidate in its own catch path.
              sql: `DELETE FROM "jobs" WHERE "userId" = ? AND "kind" = ? AND json_extract("payload", '$.documentId') = ?`,
              args: [userId, EXPORT_DOCUMENT_PPTX_JOB_KIND, document.id],
            },
            {
              sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__document_delete_artifact_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "document_artifacts" WHERE "documentId" = ? AND "userId" = ? AND NOT (${knownArtifactPredicate}))`,
              args: [
                now,
                userId,
                now,
                now,
                document.id,
                userId,
                ...artifacts.flatMap((entry) => [entry.id, entry.fileId]),
              ],
            },
            {
              // Snapshot/adoption fence. SQLite serializes this batch with an
              // export INSERT. If an export appeared after the read, force the
              // whole batch to roll back and retry with a complete snapshot.
              sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__document_delete_export_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "study_document_exports" WHERE "documentId" = ? AND "userId" = ? AND NOT (${knownPredicate}))`,
              args: [
                now,
                userId,
                now,
                now,
                document.id,
                userId,
                ...exports.flatMap((entry) => [entry.revision, entry.fileId]),
              ],
            },
            ...exports.map((entry) => ({
              sql: `INSERT OR IGNORE INTO "jobs" ("id", "kind", "payload", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "idempotencyKey", "userId", "createdAt", "updatedAt") SELECT ?, ?, ?, 1, 'queued', 0, 6, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "study_document_exports" WHERE "documentId" = ? AND "revision" = ? AND "fileId" = ? AND "userId" = ?)`,
              args: [
                newId("job"),
                CLEANUP_UNOWNED_FILE_JOB_KIND,
                JSON.stringify({ userId, fileId: entry.fileId }),
                now + 60,
                `${entry.fileId}:${cleanupBatchId}`,
                userId,
                now,
                now,
                document.id,
                entry.revision,
                entry.fileId,
                userId,
              ],
            })),
            ...artifacts.flatMap((entry) =>
              entry.fileId
                ? [
                    {
                      sql: `INSERT OR IGNORE INTO "jobs" ("id", "kind", "payload", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "idempotencyKey", "userId", "createdAt", "updatedAt") SELECT ?, ?, ?, 1, 'queued', 0, 6, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "document_artifacts" WHERE "id" = ? AND "documentId" = ? AND "fileId" = ? AND "userId" = ?)`,
                      args: [
                        newId("job"),
                        CLEANUP_UNOWNED_FILE_JOB_KIND,
                        JSON.stringify({ userId, fileId: entry.fileId }),
                        now + 60,
                        `${entry.fileId}:${cleanupBatchId}`,
                        userId,
                        now,
                        now,
                        entry.id,
                        document.id,
                        entry.fileId,
                        userId,
                      ],
                    },
                  ]
                : [],
            ),
            {
              sql: `DELETE FROM "study_documents" WHERE "id" = ? AND "userId" = ?`,
              args: [document.id, userId],
            },
            {
              sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__document_delete_domain_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "study_documents" WHERE "id" = ? AND "userId" = ?)`,
              args: [now, userId, now, now, document.id, userId],
            },
          ];
          try {
            await db.$client.batch(statements, "write");
            deletedFileIds = [
              ...new Set([
                ...exports.map((entry) => entry.fileId),
                ...artifacts.flatMap((entry) =>
                  entry.fileId ? [entry.fileId] : [],
                ),
              ]),
            ];
            break;
          } catch (error) {
            if (attempt === 3) throw error;
          }
        }
        if (!deletedFileIds) {
          throw new Error("The study document could not be deleted atomically");
        }
        await Promise.all(
          deletedFileIds.map((fileId) =>
            removeFile(userId, fileId, {
              deferOnProviderFailure: false,
            }).catch(() => undefined),
          ),
        );
        return { ok: true };
      }),
  };
}

export const documentsRouter = createDocumentsRouter();
