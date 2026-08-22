import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { documentArtifacts, files, studyDocumentBuilds } from "../db/schema";
import { BUILD_DOCUMENT_LATEX_JOB_KIND } from "../jobs/build-document-latex";
import { enqueueJob } from "../lib/jobs";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { reserveDurableRateLimit } from "../lib/rate-limit";
import {
  requireStudyDocument,
  requireStudyDocumentBuild,
} from "../lib/ownership";
import { fileAccessUrl } from "../lib/storage";

const publicBuild = {
  id: studyDocumentBuilds.id,
  documentId: studyDocumentBuilds.documentId,
  revision: studyDocumentBuilds.revision,
  status: studyDocumentBuilds.status,
  pdfFileId: studyDocumentBuilds.pdfFileId,
  createdAt: studyDocumentBuilds.createdAt,
  updatedAt: studyDocumentBuilds.updatedAt,
};

export const LATEX_BUILD_USER_RATE_LIMIT_PER_HOUR = 120;

export interface DocumentBuildRouterDependencies {
  fileAccessUrl?: typeof fileAccessUrl;
  reserveBuild?: typeof reserveDurableRateLimit;
}

export function createDocumentBuildRouter(
  dependencies: DocumentBuildRouterDependencies = {},
) {
  const resolveAccessUrl = dependencies.fileAccessUrl ?? fileAccessUrl;
  const reserveBuild = dependencies.reserveBuild ?? reserveDurableRateLimit;
  return {
    build: protectedProcedure
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
        const document = await requireStudyDocument(userId, input.documentId);
        if (document.deletedAt)
          badRequest("A trashed document cannot be built");
        if (document.kind !== "latex") {
          badRequest("Only LaTeX documents can be built");
        }
        if (document.revision !== input.revision) {
          badRequest("This LaTeX document changed — reload before building");
        }
        await reserveBuild({
          // Account-wide, so creating many documents cannot bypass the native
          // compiler budget. Revision/document idempotency is enforced below.
          subject: userId,
          action: "documents.buildLatex",
          limit: LATEX_BUILD_USER_RATE_LIMIT_PER_HOUR,
          windowMs: 60 * 60_000,
        });

        const [created] = await db
          .insert(studyDocumentBuilds)
          .values({
            documentId: document.id,
            revision: document.revision,
            status: "queued",
            userId,
          })
          .onConflictDoNothing()
          .returning();
        const [existing] = created
          ? [created]
          : await db
              .select()
              .from(studyDocumentBuilds)
              .where(
                and(
                  eq(studyDocumentBuilds.documentId, document.id),
                  eq(studyDocumentBuilds.revision, document.revision),
                  eq(studyDocumentBuilds.userId, userId),
                ),
              )
              .limit(1);
        if (!existing) throw new Error("The LaTeX build could not be created");

        await db
          .insert(documentArtifacts)
          .values({
            documentId: document.id,
            kind: "pdf",
            variant: "default",
            sourceRevision: document.revision,
            status: existing.status,
            fileId: existing.pdfFileId,
            log: existing.log,
            userId,
          })
          .onConflictDoUpdate({
            target: [
              documentArtifacts.documentId,
              documentArtifacts.kind,
              documentArtifacts.variant,
              documentArtifacts.sourceRevision,
            ],
            set: {
              status: existing.status,
              fileId: existing.pdfFileId,
              log: existing.log,
              updatedAt: new Date(),
            },
          });

        const wasFailed = existing.status === "failed";
        if (wasFailed) {
          await db
            .update(studyDocumentBuilds)
            .set({
              status: "queued",
              pdfFileId: null,
              log: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(studyDocumentBuilds.id, existing.id),
                eq(studyDocumentBuilds.userId, userId),
                eq(studyDocumentBuilds.status, "failed"),
              ),
            );
        }
        try {
          await enqueueJob({
            kind: BUILD_DOCUMENT_LATEX_JOB_KIND,
            payload: { buildId: existing.id },
            userId,
            idempotencyKey: existing.id,
            maxAttempts: 2,
            newAttemptAfterTerminal: wasFailed,
          });
        } catch (error) {
          if (created) {
            await db
              .delete(studyDocumentBuilds)
              .where(eq(studyDocumentBuilds.id, created.id));
          } else if (wasFailed) {
            await db
              .update(studyDocumentBuilds)
              .set({ status: "failed", log: "The build could not be queued" })
              .where(eq(studyDocumentBuilds.id, existing.id));
          }
          throw error;
        }
        return { buildId: existing.id };
      }),

    builds: {
      latest: protectedProcedure
        .input(z.object({ documentId: z.string().min(1) }).strict())
        .handler(async ({ context, input }) => {
          const userId = context.session.user.id;
          await requireStudyDocument(userId, input.documentId);
          const [build] = await db
            .select(publicBuild)
            .from(studyDocumentBuilds)
            .where(
              and(
                eq(studyDocumentBuilds.documentId, input.documentId),
                eq(studyDocumentBuilds.userId, userId),
              ),
            )
            .orderBy(
              desc(studyDocumentBuilds.revision),
              desc(studyDocumentBuilds.createdAt),
            )
            .limit(1);
          if (!build) return null;
          if (build.status !== "succeeded" || !build.pdfFileId) {
            return { ...build, pdfUrl: null };
          }
          const [pdf] = await db
            .select({
              provider: files.provider,
              storageKey: files.storageKey,
              url: files.url,
            })
            .from(files)
            .where(
              and(
                eq(files.id, build.pdfFileId),
                eq(files.userId, userId),
                eq(files.purpose, "latex-build"),
                eq(files.status, "stored"),
              ),
            )
            .limit(1);
          return {
            ...build,
            pdfUrl: pdf
              ? await resolveAccessUrl(pdf, { expiresIn: "1h" })
              : null,
          };
        }),

      log: protectedProcedure
        .input(z.object({ buildId: z.string().min(1) }).strict())
        .handler(async ({ context, input }) => {
          const build = await requireStudyDocumentBuild(
            context.session.user.id,
            input.buildId,
          );
          return { log: build.log ?? "" };
        }),
    },
  };
}

export const documentBuildRouter = createDocumentBuildRouter();
