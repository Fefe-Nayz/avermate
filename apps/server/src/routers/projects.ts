import type { InValue } from "@libsql/client";
import {
  corpusOriginKindSchema,
  lexicalSearchModeSchema,
  sourceLocatorV1Schema,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { CORPUS_INDEX_SOURCE_JOB_KIND } from "../jobs/corpus";
import { newId } from "../lib/id";
import { enqueueJob } from "../lib/jobs";
import {
  badRequest,
  conflict,
  notFound,
  protectedProcedure,
} from "../lib/orpc";
import { CoreCitationResolver } from "../search/citations";
import {
  RoutedCorpusContentReader,
  type AuthorizedCorpusChunkRow,
} from "../search/corpus-content-reader";
import { hybridCorpusSearch } from "../search/hybrid";
import { coreCorpusIndexService } from "../search/index-service";
import {
  lexicalCursor,
  SqliteFts5LexicalSearchBackend,
} from "../search/lexical";
import {
  corpusEmbeddingConfiguration,
  createOwnedCorpusVectorRuntime,
} from "../search/vector-runtime";
import {
  readOwnedProjectRetrievalPolicy,
  setOwnedProjectRetrievalPolicy,
  setProjectRetrievalPolicyInputSchema,
} from "../search/project-retrieval-policy";

const projectIdInput = z.object({ projectId: z.string().min(1) }).strict();
const sourceKindSchema = corpusOriginKindSchema.exclude(["conversation"]);
const projectFields = {
  title: z.string().trim().min(1).max(160),
  description: z.string().max(8_000).default(""),
  yearId: z.string().min(1).nullable().default(null),
  subjectId: z.string().min(1).nullable().default(null),
  instructionsMarkdown: z
    .string()
    .max(64 * 1024)
    .nullable()
    .default(null),
  contextPolicyVersion: z.number().int().min(1).default(1),
  contextPolicyJson: z.record(z.string(), z.unknown()).nullable().default(null),
  emoji: z.string().max(32).nullable().default(null),
  color: z.string().max(64).nullable().default(null),
};

function date(value: unknown) {
  return value === null ? null : new Date(Number(value) * 1_000);
}

function projectProjection(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    userId: String(row.userId),
    title: String(row.title),
    description: String(row.description),
    yearId: row.yearId === null ? null : String(row.yearId),
    subjectId: row.subjectId === null ? null : String(row.subjectId),
    instructionsMarkdown:
      row.instructionsMarkdown === null
        ? null
        : String(row.instructionsMarkdown),
    contextPolicyVersion: Number(row.contextPolicyVersion),
    retrievalMode: String(row.retrievalMode ?? "lexical-only"),
    retrievalFallbackPolicy: String(
      row.retrievalFallbackPolicy ?? "lexical-only",
    ),
    embeddingSpaceId:
      row.embeddingSpaceId === null || row.embeddingSpaceId === undefined
        ? null
        : String(row.embeddingSpaceId),
    rerankSpaceId:
      row.rerankSpaceId === null || row.rerankSpaceId === undefined
        ? null
        : String(row.rerankSpaceId),
    starredAt: date(row.starredAt),
    deletedAt: date(row.deletedAt),
    emoji: row.emoji === null ? null : String(row.emoji),
    color: row.color === null ? null : String(row.color),
    revision: Number(row.revision),
    createdAt: new Date(Number(row.createdAt) * 1_000),
    updatedAt: new Date(Number(row.updatedAt) * 1_000),
    contextPolicyJson:
      typeof row.contextPolicyJson === "string"
        ? JSON.parse(row.contextPolicyJson)
        : row.contextPolicyJson,
  };
}

async function requireProject(userId: string, projectId: string) {
  const result = await db.$client.execute({
    sql: `SELECT * FROM study_projects WHERE id = ? AND userId = ? LIMIT 1`,
    args: [projectId, userId],
  });
  const row = result.rows[0];
  if (!row) notFound("Study project");
  return row;
}

async function listItems(userId: string, projectId: string) {
  const result = await db.$client.execute({
    sql: `
      SELECT items.*, sources.id AS sourceId, sources.status AS indexStatus,
        sources.coverage, sources.currentVersionId
      FROM study_project_items AS items
      JOIN study_projects AS projects
        ON projects.id = items.projectId AND projects.userId = ?
      LEFT JOIN content_sources AS sources
        ON sources.userId = projects.userId
        AND sources.originKind = items.kind
        AND sources.originId = items.referenceId
      WHERE items.projectId = ?
      ORDER BY items.position, items.id
    `,
    args: [userId, projectId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.projectId),
    kind: String(row.kind),
    referenceId: String(row.referenceId),
    position: Number(row.position),
    contextMode: String(row.contextMode),
    label: row.label === null ? null : String(row.label),
    addedAt: date(row.addedAt),
    sourceId: row.sourceId === null ? null : String(row.sourceId),
    indexStatus: row.indexStatus === null ? null : String(row.indexStatus),
    coverage: row.coverage === null ? null : String(row.coverage),
    currentVersionId:
      row.currentVersionId === null ? null : String(row.currentVersionId),
    sourceVersionId:
      row.sourceVersionId === null ? null : String(row.sourceVersionId),
    conversationBranchId:
      row.conversationBranchId === null
        ? null
        : String(row.conversationBranchId),
    conversationHeadMessageId:
      row.conversationHeadMessageId === null
        ? null
        : String(row.conversationHeadMessageId),
    trackingMode: String(row.trackingMode),
    selectorReviewRequired: Boolean(row.selectorReviewRequired),
    missing: row.sourceId === null,
  }));
}

type ProjectItem = Awaited<ReturnType<typeof listItems>>[number];

function selectedVersion(item: ProjectItem) {
  return item.trackingMode === "pinned"
    ? item.sourceVersionId
    : item.currentVersionId;
}

export function summarizeProjectSources(items: readonly ProjectItem[]) {
  const indexed = (item: ProjectItem) =>
    !item.missing &&
    !item.selectorReviewRequired &&
    item.indexStatus === "ready" &&
    selectedVersion(item) !== null;
  const recentContextItemIds = items
    .filter((item) => item.contextMode !== "exclude")
    .toSorted(
      (left, right) =>
        (right.addedAt?.getTime() ?? 0) - (left.addedAt?.getTime() ?? 0),
    )
    .slice(0, 4)
    .map((item) => item.id);
  return {
    total: items.length,
    indexed: items.filter(indexed).length,
    included: items.filter((item) => item.contextMode === "include").length,
    onDemand: items.filter((item) => item.contextMode === "on-demand").length,
    excluded: items.filter((item) => item.contextMode === "exclude").length,
    contextEligible: items.filter((item) => item.contextMode !== "exclude")
      .length,
    contextSearchable: items.filter(
      (item) => item.contextMode !== "exclude" && indexed(item),
    ).length,
    automaticEligible: items.filter((item) => item.contextMode === "include")
      .length,
    automaticSearchable: items.filter(
      (item) => item.contextMode === "include" && indexed(item),
    ).length,
    recentContextItemIds,
  };
}

async function assertScope(
  userId: string,
  yearId: string | null,
  subjectId: string | null,
) {
  if (yearId) {
    const year = await db.$client.execute({
      sql: `SELECT 1 FROM years WHERE id = ? AND userId = ? LIMIT 1`,
      args: [yearId, userId],
    });
    if (year.rows.length === 0) badRequest("The selected year is not owned");
  }
  if (subjectId) {
    const subject = await db.$client.execute({
      sql: `SELECT yearId FROM subjects WHERE id = ? AND userId = ? LIMIT 1`,
      args: [subjectId, userId],
    });
    if (
      subject.rows.length === 0 ||
      (yearId && String(subject.rows[0]?.yearId) !== yearId)
    ) {
      badRequest("The selected subject is not compatible with this project");
    }
  }
}

async function enqueueSourceIndex(identity: {
  ownerId: string;
  originKind: z.infer<typeof sourceKindSchema>;
  originId: string;
  projectItemId?: string;
}) {
  const { projectItemId, ...sourceIdentity } = identity;
  const source = await coreCorpusIndexService.store.getSource(sourceIdentity);
  return enqueueJob({
    kind: CORPUS_INDEX_SOURCE_JOB_KIND,
    payload: identity,
    userId: identity.ownerId,
    idempotencyKey: `${source?.id ?? identity.originKind}:${identity.originId}:${projectItemId ?? "head"}`,
    newAttemptAfterTerminal: true,
    maxAttempts: 3,
  });
}

export const projectsRouter = {
  create: protectedProcedure
    .input(z.object(projectFields).strict())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await assertScope(userId, input.yearId, input.subjectId);
      const id = newId("proj");
      const now = Math.floor(Date.now() / 1_000);
      await db.$client.execute({
        sql: `
          INSERT INTO study_projects (
            id, userId, title, description, yearId, subjectId,
            instructionsMarkdown, contextPolicyVersion, contextPolicyJson,
            emoji, color, revision, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `,
        args: [
          id,
          userId,
          input.title,
          input.description,
          input.yearId,
          input.subjectId,
          input.instructionsMarkdown,
          input.contextPolicyVersion,
          input.contextPolicyJson === null
            ? null
            : JSON.stringify(input.contextPolicyJson),
          input.emoji,
          input.color,
          now,
          now,
        ],
      });
      return projectProjection(await requireProject(userId, id));
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          include: z.enum(["live", "trashed", "all"]).default("live"),
          yearId: z.string().min(1).optional(),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const args: InValue[] = [context.session.user.id];
      const filters = ["userId = ?"];
      if (input.include === "live") filters.push("deletedAt IS NULL");
      if (input.include === "trashed") filters.push("deletedAt IS NOT NULL");
      if (input.yearId) {
        filters.push("yearId = ?");
        args.push(input.yearId);
      }
      const result = await db.$client.execute({
        sql: `SELECT * FROM study_projects WHERE ${filters.join(" AND ")} ORDER BY starredAt IS NULL, starredAt DESC, updatedAt DESC, id`,
        args,
      });
      return result.rows.map(projectProjection);
    }),

  get: protectedProcedure
    .input(projectIdInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const project = await requireProject(userId, input.projectId);
      const items = await listItems(userId, input.projectId);
      return {
        project: projectProjection(project),
        items,
        sourceSummary: summarizeProjectSources(items),
      };
    }),

  retrievalPolicy: protectedProcedure
    .input(projectIdInput)
    .handler(({ context, input }) =>
      readOwnedProjectRetrievalPolicy(context.session.user.id, input.projectId),
    ),

  setRetrievalPolicy: protectedProcedure
    .input(setProjectRetrievalPolicyInputSchema)
    .handler(({ context, input }) =>
      setOwnedProjectRetrievalPolicy(context.session.user.id, input),
    ),

  update: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          revision: z.number().int().min(1),
          title: projectFields.title.optional(),
          description: projectFields.description.optional(),
          yearId: projectFields.yearId.optional(),
          subjectId: projectFields.subjectId.optional(),
          instructionsMarkdown: projectFields.instructionsMarkdown.optional(),
          contextPolicyVersion: projectFields.contextPolicyVersion.optional(),
          contextPolicyJson: projectFields.contextPolicyJson.optional(),
          emoji: projectFields.emoji.optional(),
          color: projectFields.color.optional(),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireProject(userId, input.projectId);
      const yearId =
        input.yearId === undefined
          ? existing.yearId === null
            ? null
            : String(existing.yearId)
          : input.yearId;
      const subjectId =
        input.subjectId === undefined
          ? existing.subjectId === null
            ? null
            : String(existing.subjectId)
          : input.subjectId;
      await assertScope(userId, yearId, subjectId);
      const assignments: string[] = [];
      const args: InValue[] = [];
      const assign = (column: string, value: InValue) => {
        assignments.push(`${column} = ?`);
        args.push(value);
      };
      if (input.title !== undefined) assign("title", input.title);
      if (input.description !== undefined)
        assign("description", input.description);
      if (input.yearId !== undefined) assign("yearId", input.yearId);
      if (input.subjectId !== undefined) assign("subjectId", input.subjectId);
      if (input.instructionsMarkdown !== undefined)
        assign("instructionsMarkdown", input.instructionsMarkdown);
      if (input.contextPolicyVersion !== undefined)
        assign("contextPolicyVersion", input.contextPolicyVersion);
      if (input.contextPolicyJson !== undefined)
        assign(
          "contextPolicyJson",
          input.contextPolicyJson === null
            ? null
            : JSON.stringify(input.contextPolicyJson),
        );
      if (input.emoji !== undefined) assign("emoji", input.emoji);
      if (input.color !== undefined) assign("color", input.color);
      assignments.push("revision = revision + 1", "updatedAt = ?");
      args.push(
        Math.floor(Date.now() / 1_000),
        input.projectId,
        userId,
        input.revision,
      );
      const updated = await db.$client.execute({
        sql: `UPDATE study_projects SET ${assignments.join(", ")} WHERE id = ? AND userId = ? AND revision = ?`,
        args,
      });
      if (Number(updated.rowsAffected) !== 1) {
        conflict("This study project changed elsewhere — reload it");
      }
      return projectProjection(await requireProject(userId, input.projectId));
    }),

  star: protectedProcedure
    .input(
      z.object({ projectId: z.string().min(1), starred: z.boolean() }).strict(),
    )
    .handler(async ({ context, input }) => {
      await requireProject(context.session.user.id, input.projectId);
      await db.$client.execute({
        sql: `UPDATE study_projects SET starredAt = ?, updatedAt = ? WHERE id = ? AND userId = ?`,
        args: [
          input.starred ? Math.floor(Date.now() / 1_000) : null,
          Math.floor(Date.now() / 1_000),
          input.projectId,
          context.session.user.id,
        ],
      });
      return projectProjection(
        await requireProject(context.session.user.id, input.projectId),
      );
    }),

  trash: protectedProcedure
    .input(projectIdInput)
    .handler(async ({ context, input }) => {
      await requireProject(context.session.user.id, input.projectId);
      await db.$client.execute({
        sql: `UPDATE study_projects SET deletedAt = ?, updatedAt = ?, revision = revision + 1 WHERE id = ? AND userId = ?`,
        args: [
          Math.floor(Date.now() / 1_000),
          Math.floor(Date.now() / 1_000),
          input.projectId,
          context.session.user.id,
        ],
      });
      return { ok: true as const };
    }),

  restore: protectedProcedure
    .input(projectIdInput)
    .handler(async ({ context, input }) => {
      await requireProject(context.session.user.id, input.projectId);
      await db.$client.execute({
        sql: `UPDATE study_projects SET deletedAt = NULL, updatedAt = ?, revision = revision + 1 WHERE id = ? AND userId = ?`,
        args: [
          Math.floor(Date.now() / 1_000),
          input.projectId,
          context.session.user.id,
        ],
      });
      return { ok: true as const };
    }),

  addItem: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          kind: sourceKindSchema,
          referenceId: z.string().min(1),
          contextMode: z
            .enum(["include", "on-demand", "exclude"])
            .default("include"),
          label: z.string().max(160).nullable().default(null),
          position: z.number().int().min(0).optional(),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const project = await requireProject(userId, input.projectId);
      if (project.deletedAt !== null)
        badRequest("Restore the project before adding sources");
      const identity = {
        ownerId: userId,
        originKind: input.kind,
        originId: input.referenceId,
      };
      const source = await coreCorpusIndexService.ensureRegistered(identity);
      if (
        project.yearId !== null &&
        source.yearId !== null &&
        String(project.yearId) !== source.yearId
      ) {
        badRequest("This source belongs to another academic year");
      }
      const itemId = newId("pitem");
      const now = Math.floor(Date.now() / 1_000);
      const transaction = await db.$client.transaction("write");
      try {
        const position =
          input.position ??
          Number(
            (
              await transaction.execute({
                sql: `SELECT count(*) AS count FROM study_project_items WHERE projectId = ?`,
                args: [input.projectId],
              })
            ).rows[0]?.count ?? 0,
          );
        await transaction.execute({
          sql: `INSERT INTO study_project_items (
            id, projectId, kind, referenceId, sourceVersionId, trackingMode,
            selectorReviewRequired, position, contextMode, label, addedAt
          ) VALUES (?, ?, ?, ?, ?, 'follow-head', 0, ?, ?, ?, ?)`,
          args: [
            itemId,
            input.projectId,
            input.kind,
            input.referenceId,
            source.currentVersionId,
            position,
            input.contextMode,
            input.label,
            now,
          ],
        });
        const bumped = await transaction.execute({
          sql: `UPDATE study_projects SET revision = revision + 1,
              updatedAt = ?
            WHERE id = ? AND userId = ? AND revision = ?
              AND deletedAt IS NULL`,
          args: [now, input.projectId, userId, Number(project.revision)],
        });
        if (Number(bumped.rowsAffected) !== 1) {
          throw new Error("project-revision-conflict");
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        if (String(error).includes("UNIQUE constraint failed")) {
          conflict("This source is already in the project");
        }
        if (String(error).includes("project-revision-conflict")) {
          conflict("This study project changed elsewhere — reload it");
        }
        throw error;
      }
      const job = await enqueueSourceIndex(identity);
      const item = (await listItems(userId, input.projectId)).find(
        (entry) => entry.id === itemId,
      );
      return { item, indexJobId: job.id };
    }),

  removeItem: protectedProcedure
    .input(
      z
        .object({ projectId: z.string().min(1), itemId: z.string().min(1) })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const project = await requireProject(userId, input.projectId);
      const transaction = await db.$client.transaction("write");
      try {
        await transaction.execute({
          sql: `DELETE FROM content_version_references
            WHERE userId = ? AND ownerKind = 'project-item' AND ownerId = ?`,
          args: [userId, input.itemId],
        });
        const deleted = await transaction.execute({
          sql: `DELETE FROM study_project_items
            WHERE id = ? AND projectId = ? AND EXISTS (
              SELECT 1 FROM study_projects WHERE id = ? AND userId = ?
            )`,
          args: [input.itemId, input.projectId, input.projectId, userId],
        });
        if (Number(deleted.rowsAffected) !== 1) {
          throw new Error("project-item-not-found");
        }
        const bumped = await transaction.execute({
          sql: `UPDATE study_projects SET revision = revision + 1,
              updatedAt = ?
            WHERE id = ? AND userId = ? AND revision = ?`,
          args: [
            Math.floor(Date.now() / 1_000),
            input.projectId,
            userId,
            Number(project.revision),
          ],
        });
        if (Number(bumped.rowsAffected) !== 1) {
          throw new Error("project-revision-conflict");
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        if (String(error).includes("project-item-not-found")) {
          notFound("Project item");
        }
        if (String(error).includes("project-revision-conflict")) {
          conflict("This study project changed elsewhere — reload it");
        }
        throw error;
      }
      return { ok: true as const };
    }),

  reorderItems: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          revision: z.number().int().min(1),
          itemIds: z.array(z.string().min(1)).max(10_000),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const requestedItemIds = new Set(input.itemIds);
      if (requestedItemIds.size !== input.itemIds.length) {
        badRequest("Project item ids must be unique");
      }
      const project = await requireProject(userId, input.projectId);
      if (Number(project.revision) !== input.revision) {
        conflict("This study project changed elsewhere — reload it");
      }
      const current = await listItems(userId, input.projectId);
      if (
        current.length !== input.itemIds.length ||
        current.some((item) => !requestedItemIds.has(String(item.id)))
      ) {
        badRequest("Reordering must include every current project item once");
      }
      const transaction = await db.$client.transaction("write");
      try {
        for (let position = 0; position < input.itemIds.length; position += 1) {
          await transaction.execute({
            sql: `UPDATE study_project_items SET position = ? WHERE id = ? AND projectId = ?`,
            args: [position, input.itemIds[position]!, input.projectId],
          });
        }
        const updated = await transaction.execute({
          sql: `UPDATE study_projects SET revision = revision + 1, updatedAt = ? WHERE id = ? AND userId = ? AND revision = ?`,
          args: [
            Math.floor(Date.now() / 1_000),
            input.projectId,
            userId,
            input.revision,
          ],
        });
        if (Number(updated.rowsAffected) !== 1) {
          throw new Error("project-revision-conflict");
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        if (String(error).includes("project-revision-conflict")) {
          conflict("This study project changed elsewhere — reload it");
        }
        throw error;
      }
      return { ok: true as const };
    }),

  setItemContextMode: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          itemId: z.string().min(1),
          contextMode: z.enum(["include", "on-demand", "exclude"]),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const project = await requireProject(userId, input.projectId);
      const revision = Number(project.revision) + 1;
      const transaction = await db.$client.transaction("write");
      try {
        const changed = await transaction.execute({
          sql: `UPDATE study_project_items SET contextMode = ?
            WHERE id = ? AND projectId = ? AND EXISTS (
              SELECT 1 FROM study_projects
              WHERE id = ? AND userId = ? AND deletedAt IS NULL
            )`,
          args: [
            input.contextMode,
            input.itemId,
            input.projectId,
            input.projectId,
            userId,
          ],
        });
        if (Number(changed.rowsAffected) !== 1) {
          throw new Error("project-item-not-found");
        }
        const bumped = await transaction.execute({
          sql: `UPDATE study_projects SET revision = ?, updatedAt = ?
            WHERE id = ? AND userId = ? AND revision = ?
              AND deletedAt IS NULL`,
          args: [
            revision,
            Math.floor(Date.now() / 1_000),
            input.projectId,
            userId,
            Number(project.revision),
          ],
        });
        if (Number(bumped.rowsAffected) !== 1) {
          throw new Error("project-revision-conflict");
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        if (String(error).includes("project-revision-conflict")) {
          conflict("This study project changed elsewhere — reload it");
        }
        if (String(error).includes("project-item-not-found")) {
          notFound("Project item");
        }
        throw error;
      }
      return {
        item: (await listItems(userId, input.projectId)).find(
          (entry) => entry.id === input.itemId,
        ),
        revision,
      };
    }),

  setItemTracking: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          itemId: z.string().min(1),
          trackingMode: z.enum(["pinned", "follow-head"]),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const project = await requireProject(userId, input.projectId);
      const result = await db.$client.execute({
        sql: `SELECT items.kind, items.referenceId, sources.currentVersionId
          FROM study_project_items AS items
          JOIN study_projects AS projects ON projects.id = items.projectId
          LEFT JOIN content_sources AS sources
            ON sources.userId = projects.userId
            AND sources.originKind = items.kind
            AND sources.originId = items.referenceId
          WHERE items.id = ? AND items.projectId = ? AND projects.userId = ?
          LIMIT 1`,
        args: [input.itemId, input.projectId, userId],
      });
      const row = result.rows[0];
      if (!row) notFound("Project item");
      if (String(row.kind) === "conversation") {
        badRequest(
          "Conversation references are immutable branch snapshots; review them from the conversation",
        );
      }
      if (row.currentVersionId === null) {
        badRequest("Index this source before changing its version tracking");
      }
      const transaction = await db.$client.transaction("write");
      try {
        const changed = await transaction.execute({
          sql: `UPDATE study_project_items SET trackingMode = ?,
              sourceVersionId = ?, selectorReviewRequired = 0
            WHERE id = ? AND projectId = ? AND EXISTS (
              SELECT 1 FROM study_projects
              WHERE id = ? AND userId = ? AND deletedAt IS NULL
            )`,
          args: [
            input.trackingMode,
            row.currentVersionId,
            input.itemId,
            input.projectId,
            input.projectId,
            userId,
          ],
        });
        if (Number(changed.rowsAffected) !== 1) {
          throw new Error("project-source-changed");
        }
        const bumped = await transaction.execute({
          sql: `UPDATE study_projects SET revision = revision + 1,
              updatedAt = ?
            WHERE id = ? AND userId = ? AND revision = ?
              AND deletedAt IS NULL`,
          args: [
            Math.floor(Date.now() / 1_000),
            input.projectId,
            userId,
            Number(project.revision),
          ],
        });
        if (Number(bumped.rowsAffected) !== 1) {
          throw new Error("project-revision-conflict");
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        if (String(error).includes("project-revision-conflict")) {
          conflict("This study project changed elsewhere — reload it");
        }
        if (String(error).includes("project-source-changed")) {
          conflict("This project source changed elsewhere — reload it");
        }
        throw error;
      }
      const kind = sourceKindSchema.parse(row.kind);
      const job = await enqueueSourceIndex({
        ownerId: userId,
        originKind: kind,
        originId: String(row.referenceId),
        ...(input.trackingMode === "pinned"
          ? { projectItemId: input.itemId }
          : {}),
      });
      return {
        item: (await listItems(userId, input.projectId)).find(
          (entry) => entry.id === input.itemId,
        ),
        indexJobId: job.id,
      };
    }),

  search: protectedProcedure
    .input(
      z
        .object({
          query: z.string().trim().min(1).max(2_000),
          mode: lexicalSearchModeSchema.default("terms"),
          projectIds: z.array(z.string().min(1)).max(100).default([]),
          yearIds: z.array(z.string().min(1)).max(100).default([]),
          subjectIds: z.array(z.string().min(1)).max(100).default([]),
          originKinds: z.array(sourceKindSchema).max(16).default([]),
          limit: z.number().int().min(1).max(50).default(10),
          cursor: z.string().max(512).nullable().default(null),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const search = await hybridCorpusSearch({
        ownerId: userId,
        ...input,
      });
      const results = search.candidates;
      const searchId = newId("search");
      const evidence = [];
      for (const candidate of results) {
        const reference = await coreCorpusIndexService.store.createReference({
          ownerId: userId,
          ownerKind: "assistant-citation",
          ownerIdWithinKind: searchId,
          sourceVersionId: candidate.versionId,
          chunkId: candidate.chunkId,
          locator: candidate.locator,
          quotedContentHash: candidate.contentHash,
        });
        evidence.push({ ...candidate, citationId: reference.id });
      }
      let offset = 0;
      if (input.cursor) {
        try {
          const parsed = JSON.parse(
            Buffer.from(input.cursor, "base64url").toString("utf8"),
          );
          offset = Number(parsed.offset) || 0;
        } catch {
          offset = 0;
        }
      }
      return {
        searchId,
        evidence,
        nextCursor:
          results.length === input.limit
            ? lexicalCursor(offset + results.length)
            : null,
        lexicalOnly: !search.vectorUsed,
        retrievalMode: search.retrievalMode,
        vectorImplementation: search.vectorImplementation,
        rerankUsed: search.rerankUsed,
        rerankImplementation: search.rerankImplementation,
        fallbackReason: search.fallbackReason,
        operationId: search.operationId,
        stages: search.stages,
      };
    }),

  readCitation: protectedProcedure
    .input(z.object({ citationId: z.string().min(1) }).strict())
    .handler(({ context, input }) =>
      new CoreCitationResolver().readChunk({
        ownerId: context.session.user.id,
        referenceId: input.citationId,
      }),
    ),

  resolveChunk: protectedProcedure
    .input(z.object({ chunkId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const result = await db.$client.execute({
        sql: `
          SELECT chunks.id, chunks.versionId, chunks.ordinal, chunks.text,
            chunks.normalizedText, chunks.contentHash, chunks.locatorJson,
            chunks.headingPathJson, chunks.evidenceKind,
            sources.id AS sourceId, sources.userId, sources.placement,
            sources.placementRef
          FROM content_chunks AS chunks
          JOIN content_versions AS versions ON versions.id = chunks.versionId
          JOIN content_sources AS sources ON sources.id = versions.sourceId
          WHERE chunks.id = ? AND sources.userId = ? LIMIT 1
        `,
        args: [input.chunkId, context.session.user.id],
      });
      const row = result.rows[0];
      if (!row) notFound("Corpus chunk");
      const body = (
        await new RoutedCorpusContentReader(db.$client).hydrate([
          row as unknown as AuthorizedCorpusChunkRow,
        ])
      ).get(String(row.id));
      if (!body) notFound("Corpus chunk body");
      return {
        id: String(row.id),
        versionId: String(row.versionId),
        ordinal: Number(row.ordinal),
        text: body.text,
        contentHash: String(row.contentHash),
        evidenceKind: row.evidenceKind,
        sourceId: String(row.sourceId),
        locator: sourceLocatorV1Schema.parse(
          typeof row.locatorJson === "string"
            ? JSON.parse(row.locatorJson)
            : row.locatorJson,
        ),
      };
    }),

  indexStatus: protectedProcedure
    .input(
      z
        .object({ kind: sourceKindSchema, referenceId: z.string().min(1) })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const identity = {
        ownerId: context.session.user.id,
        originKind: input.kind,
        originId: input.referenceId,
      };
      const source =
        (await coreCorpusIndexService.store.getSource(identity)) ??
        (await coreCorpusIndexService.ensureRegistered(identity));
      return {
        source,
        lexical: await new SqliteFts5LexicalSearchBackend().capabilities(),
      };
    }),

  retryIndex: protectedProcedure
    .input(
      z
        .object({ kind: sourceKindSchema, referenceId: z.string().min(1) })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const identity = {
        ownerId: context.session.user.id,
        originKind: input.kind,
        originId: input.referenceId,
      };
      await coreCorpusIndexService.ensureRegistered(identity);
      const job = await enqueueSourceIndex(identity);
      return { jobId: job.id };
    }),

  embeddingPrivacy: protectedProcedure.handler(async ({ context }) => {
    const configuration = corpusEmbeddingConfiguration();
    let runtime = null;
    try {
      runtime = await createOwnedCorpusVectorRuntime(context.session.user.id);
    } catch {
      // A malformed or unreachable optional provider must never disable lexical search.
    }
    const descriptor = runtime?.embedding.descriptor() ?? null;
    const activeGeneration = descriptor
      ? await db.$client.execute({
          sql: `SELECT id FROM corpus_embedding_generations
            WHERE userId = ? AND spaceId = ? AND state = 'active' LIMIT 1`,
          args: [context.session.user.id, descriptor.id],
        })
      : null;
    const generationId = activeGeneration?.rows[0]?.id
      ? String(activeGeneration.rows[0].id)
      : null;
    const vector =
      runtime && generationId
        ? await runtime.vector
            .forGeneration(context.session.user.id, generationId)
            .capabilities()
        : {
            available: false,
            implementation: runtime
              ? "vector-generation-unavailable"
              : "not-configured",
            dimensions: [],
          };
    return {
      mode: vector.available ? ("hybrid" as const) : ("lexical-only" as const),
      lexicalAvailable: (
        await new SqliteFts5LexicalSearchBackend().capabilities()
      ).available,
      vectorConfigured: configuration.complete,
      vectorActive: vector.available,
      vectorImplementation: vector.implementation,
      configurationState: configuration.reason,
      sendsSourceContentToThirdParties:
        configuration.sendsSourceContentToThirdParties,
      configuredProvider: configuration.provider,
    };
  }),
};
