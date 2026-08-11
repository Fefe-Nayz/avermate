import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, inArray, like, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  feedback,
  feedbackComments,
  feedbackEvents,
  feedbackLabels,
  users,
} from "../db/schema";
import { adminIds } from "../lib/admin";
import { adminProcedure, badRequest, notFound } from "../lib/orpc";

const feedbackStatusSchema = z.enum([
  "open",
  "triaged",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
  "rejected",
]);
const feedbackPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const feedbackKindSchema = z.enum(["bug", "idea", "question", "other"]);
const labelSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u)
  .transform((label) => label.toLocaleLowerCase());

function jsonRecord(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function feedbackDto(row: typeof feedback.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    message: row.message,
    stack: row.stack,
    errorDigest: row.errorDigest,
    route: row.route,
    attachmentUrl: row.attachmentUrl,
    context: jsonRecord(row.context),
    fingerprint: row.fingerprint,
    duplicateGroupKey: row.duplicateGroupKey,
    source: row.source,
    duplicateCount: row.duplicateCount,
    status: row.status,
    priority: row.priority,
    assignedToUserId: row.assignedToUserId,
    lastSeenAt: row.lastSeenAt,
    resolvedAt: row.resolvedAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const triagePatchSchema = z
  .object({
    status: feedbackStatusSchema.optional(),
    priority: feedbackPrioritySchema.optional(),
    assignedToUserId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    {
      message: "At least one triage field must change",
    },
  );

async function assertAdminAssignee(userId: string | null | undefined) {
  if (!userId) return;
  const bootstrap = adminIds();
  const [assignee] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        or(
          eq(users.role, "admin"),
          bootstrap.length > 0 ? inArray(users.id, bootstrap) : undefined,
        ),
      ),
    )
    .limit(1);
  if (!assignee) badRequest("The feedback assignee must be an administrator");
}

function resolvedAtFor(status: z.infer<typeof feedbackStatusSchema>) {
  return status === "resolved" || status === "closed" || status === "rejected"
    ? new Date()
    : null;
}

export const adminFeedbackRouter = {
  feedbackQueue: adminProcedure
    .input(
      z.object({
        statuses: z.array(feedbackStatusSchema).max(7).default([]),
        priorities: z.array(feedbackPrioritySchema).max(4).default([]),
        kinds: z.array(feedbackKindSchema).max(4).default([]),
        source: z
          .enum(["all", "form", "auto:web", "auto:mobile", "auto:server"])
          .default("all"),
        assignee: z.enum(["all", "unassigned", "mine"]).default("all"),
        label: labelSchema.nullable().default(null),
        duplicateGroupKey: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .default(null),
        search: z.string().trim().max(100).default(""),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).max(100_000).default(0),
      }),
    )
    .handler(async ({ context, input }) => {
      const labelMatch = input.label
        ? db
            .select({ feedbackId: feedbackLabels.feedbackId })
            .from(feedbackLabels)
            .where(eq(feedbackLabels.label, input.label))
        : null;
      const filters = and(
        input.statuses.length
          ? inArray(feedback.status, input.statuses)
          : undefined,
        input.priorities.length
          ? inArray(feedback.priority, input.priorities)
          : undefined,
        input.kinds.length ? inArray(feedback.kind, input.kinds) : undefined,
        input.source !== "all" ? eq(feedback.source, input.source) : undefined,
        input.assignee === "unassigned"
          ? sql`${feedback.assignedToUserId} is null`
          : input.assignee === "mine"
            ? eq(feedback.assignedToUserId, context.session.user.id)
            : undefined,
        labelMatch ? inArray(feedback.id, labelMatch) : undefined,
        input.duplicateGroupKey
          ? eq(feedback.duplicateGroupKey, input.duplicateGroupKey)
          : undefined,
        input.search
          ? or(
              like(feedback.subject, `%${input.search}%`),
              like(feedback.message, `%${input.search}%`),
              like(feedback.errorDigest, `%${input.search}%`),
              like(feedback.route, `%${input.search}%`),
            )
          : undefined,
      );
      const [rows, countRows] = await Promise.all([
        db
          .select({
            item: feedback,
            reporterId: users.id,
            reporterName: users.name,
            reporterEmail: users.email,
          })
          .from(feedback)
          .innerJoin(users, eq(users.id, feedback.userId))
          .where(filters)
          .orderBy(
            sql`case ${feedback.priority}
              when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc`,
            desc(feedback.lastSeenAt),
            desc(feedback.createdAt),
          )
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(feedback)
          .where(filters),
      ]);
      const ids = rows.map((row) => row.item.id);
      const labels = ids.length
        ? await db
            .select({
              feedbackId: feedbackLabels.feedbackId,
              label: feedbackLabels.label,
            })
            .from(feedbackLabels)
            .where(inArray(feedbackLabels.feedbackId, ids))
            .orderBy(asc(feedbackLabels.label))
        : [];
      return {
        items: rows.map((row) => ({
          ...feedbackDto(row.item),
          reporter: {
            id: row.reporterId,
            name: row.reporterName,
            email: row.reporterEmail,
          },
          labels: labels
            .filter((label) => label.feedbackId === row.item.id)
            .map((label) => label.label),
        })),
        total: Number(countRows[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  feedbackDetail: adminProcedure
    .input(z.object({ feedbackId: z.string().min(1) }))
    .handler(async ({ input }) => {
      const [row] = await db
        .select({
          item: feedback,
          reporterId: users.id,
          reporterName: users.name,
          reporterEmail: users.email,
        })
        .from(feedback)
        .innerJoin(users, eq(users.id, feedback.userId))
        .where(eq(feedback.id, input.feedbackId))
        .limit(1);
      if (!row) notFound("Feedback");
      const [labels, comments, events] = await Promise.all([
        db
          .select()
          .from(feedbackLabels)
          .where(eq(feedbackLabels.feedbackId, input.feedbackId))
          .orderBy(asc(feedbackLabels.label)),
        db
          .select({
            id: feedbackComments.id,
            body: feedbackComments.body,
            internal: feedbackComments.internal,
            authorName: users.name,
            createdAt: feedbackComments.createdAt,
            updatedAt: feedbackComments.updatedAt,
          })
          .from(feedbackComments)
          .leftJoin(users, eq(users.id, feedbackComments.authorUserId))
          .where(eq(feedbackComments.feedbackId, input.feedbackId))
          .orderBy(asc(feedbackComments.createdAt)),
        db
          .select({
            id: feedbackEvents.id,
            kind: feedbackEvents.kind,
            changedKeys: feedbackEvents.changedKeys,
            metadata: feedbackEvents.metadata,
            actorName: users.name,
            createdAt: feedbackEvents.createdAt,
          })
          .from(feedbackEvents)
          .leftJoin(users, eq(users.id, feedbackEvents.actorUserId))
          .where(eq(feedbackEvents.feedbackId, input.feedbackId))
          .orderBy(asc(feedbackEvents.createdAt)),
      ]);
      return {
        ...feedbackDto(row.item),
        reporter: {
          id: row.reporterId,
          name: row.reporterName,
          email: row.reporterEmail,
        },
        labels: labels.map((label) => ({
          id: label.id,
          label: label.label,
          createdAt: label.createdAt,
        })),
        comments,
        events: events.map((event) => ({
          ...event,
          changedKeys: JSON.parse(event.changedKeys) as string[],
          metadata: jsonRecord(event.metadata),
        })),
        duplicateGroup: row.item.duplicateGroupKey
          ? await db
              .select({
                id: feedback.id,
                duplicateCount: feedback.duplicateCount,
                status: feedback.status,
                lastSeenAt: feedback.lastSeenAt,
              })
              .from(feedback)
              .where(eq(feedback.duplicateGroupKey, row.item.duplicateGroupKey))
              .orderBy(desc(feedback.lastSeenAt))
          : [],
      };
    }),

  feedbackTriageStats: adminProcedure.handler(async () => {
    const [summary, statuses, priorities, sources] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`,
          unresolved: sql<number>`sum(case when ${feedback.status} not in ('resolved','closed','rejected') then 1 else 0 end)`,
          occurrences: sql<number>`sum(${feedback.duplicateCount})`,
          urgent: sql<number>`sum(case when ${feedback.priority} = 'urgent' then 1 else 0 end)`,
          unassigned: sql<number>`sum(case when ${feedback.assignedToUserId} is null then 1 else 0 end)`,
        })
        .from(feedback),
      db
        .select({ key: feedback.status, count: sql<number>`count(*)` })
        .from(feedback)
        .groupBy(feedback.status),
      db
        .select({ key: feedback.priority, count: sql<number>`count(*)` })
        .from(feedback)
        .groupBy(feedback.priority),
      db
        .select({ key: feedback.source, count: sql<number>`count(*)` })
        .from(feedback)
        .groupBy(feedback.source),
    ]);
    return {
      total: Number(summary[0]?.total ?? 0),
      unresolved: Number(summary[0]?.unresolved ?? 0),
      occurrences: Number(summary[0]?.occurrences ?? 0),
      urgent: Number(summary[0]?.urgent ?? 0),
      unassigned: Number(summary[0]?.unassigned ?? 0),
      byStatus: Object.fromEntries(
        statuses.map((row) => [row.key, Number(row.count)]),
      ),
      byPriority: Object.fromEntries(
        priorities.map((row) => [row.key, Number(row.count)]),
      ),
      bySource: Object.fromEntries(
        sources.map((row) => [row.key, Number(row.count)]),
      ),
    };
  }),

  feedbackAssignees: adminProcedure.handler(async () => {
    const bootstrap = adminIds();
    return db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(
        or(
          eq(users.role, "admin"),
          bootstrap.length > 0 ? inArray(users.id, bootstrap) : undefined,
        ),
      )
      .orderBy(asc(users.name));
  }),

  updateFeedbackTriage: adminProcedure
    .input(
      z.object({
        feedbackId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
        patch: triagePatchSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      await assertAdminAssignee(input.patch.assignedToUserId);
      const now = new Date();
      const changedKeys = Object.keys(input.patch).sort();
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(feedback)
          .set({
            ...input.patch,
            ...(input.patch.status
              ? { resolvedAt: resolvedAtFor(input.patch.status) }
              : {}),
            revision: sql`${feedback.revision} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(feedback.id, input.feedbackId),
              eq(feedback.revision, input.expectedRevision),
            ),
          )
          .returning();
        if (!row) {
          throw new ORPCError("CONFLICT", {
            message: "The feedback item changed in another session",
          });
        }
        await tx.insert(feedbackEvents).values({
          feedbackId: input.feedbackId,
          actorUserId: context.session.user.id,
          kind: "triage.updated",
          changedKeys: JSON.stringify(changedKeys),
        });
        return row;
      });
      return feedbackDto(updated);
    }),

  bulkUpdateFeedbackTriage: adminProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              feedbackId: z.string().min(1),
              expectedRevision: z.number().int().min(1),
            }),
          )
          .min(1)
          .max(100),
        patch: triagePatchSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      await assertAdminAssignee(input.patch.assignedToUserId);
      const now = new Date();
      const changedKeys = Object.keys(input.patch).sort();
      await db.transaction(async (tx) => {
        for (const item of input.items) {
          const rows = await tx
            .update(feedback)
            .set({
              ...input.patch,
              ...(input.patch.status
                ? { resolvedAt: resolvedAtFor(input.patch.status) }
                : {}),
              revision: sql`${feedback.revision} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(feedback.id, item.feedbackId),
                eq(feedback.revision, item.expectedRevision),
              ),
            )
            .returning({ id: feedback.id });
          if (rows.length !== 1) {
            throw new ORPCError("CONFLICT", {
              message: "At least one feedback item changed in another session",
            });
          }
          await tx.insert(feedbackEvents).values({
            feedbackId: item.feedbackId,
            actorUserId: context.session.user.id,
            kind: "triage.bulk_updated",
            changedKeys: JSON.stringify(changedKeys),
          });
        }
      });
      return { ok: true, updatedCount: input.items.length };
    }),

  addFeedbackLabel: adminProcedure
    .input(z.object({ feedbackId: z.string().min(1), label: labelSchema }))
    .handler(async ({ context, input }) => {
      const [created] = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(feedbackLabels)
          .values({
            feedbackId: input.feedbackId,
            label: input.label,
            createdByUserId: context.session.user.id,
          })
          .onConflictDoNothing({
            target: [feedbackLabels.feedbackId, feedbackLabels.label],
          })
          .returning({ id: feedbackLabels.id, label: feedbackLabels.label });
        await tx.insert(feedbackEvents).values({
          feedbackId: input.feedbackId,
          actorUserId: context.session.user.id,
          kind: "label.added",
          changedKeys: JSON.stringify(["labels"]),
        });
        return rows;
      });
      return created ?? { id: null, label: input.label };
    }),

  removeFeedbackLabel: adminProcedure
    .input(z.object({ feedbackId: z.string().min(1), label: labelSchema }))
    .handler(async ({ context, input }) => {
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(feedbackLabels)
          .where(
            and(
              eq(feedbackLabels.feedbackId, input.feedbackId),
              eq(feedbackLabels.label, input.label),
            ),
          )
          .returning({ id: feedbackLabels.id });
        if (deleted.length === 0) notFound("Feedback label");
        await tx.insert(feedbackEvents).values({
          feedbackId: input.feedbackId,
          actorUserId: context.session.user.id,
          kind: "label.removed",
          changedKeys: JSON.stringify(["labels"]),
        });
      });
      return { ok: true };
    }),

  addFeedbackComment: adminProcedure
    .input(
      z.object({
        feedbackId: z.string().min(1),
        body: z.string().trim().min(1).max(4_000),
      }),
    )
    .handler(async ({ context, input }) => {
      const created = await db.transaction(async (tx) => {
        const [comment] = await tx
          .insert(feedbackComments)
          .values({
            feedbackId: input.feedbackId,
            authorUserId: context.session.user.id,
            body: input.body,
            internal: true,
          })
          .returning({
            id: feedbackComments.id,
            body: feedbackComments.body,
            internal: feedbackComments.internal,
            createdAt: feedbackComments.createdAt,
          });
        if (!comment) badRequest("The comment could not be saved");
        await tx.insert(feedbackEvents).values({
          feedbackId: input.feedbackId,
          actorUserId: context.session.user.id,
          kind: "comment.added",
          changedKeys: JSON.stringify(["comments"]),
        });
        return comment;
      });
      return created;
    }),

  replyToFeedback: adminProcedure
    .input(
      z.object({
        feedbackId: z.string().min(1),
        body: z.string().trim().min(1).max(4_000),
      }),
    )
    .handler(async ({ context, input }) => {
      const reply = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: feedback.id })
          .from(feedback)
          .where(eq(feedback.id, input.feedbackId))
          .limit(1);
        if (!existing) notFound("Feedback");
        const [created] = await tx
          .insert(feedbackComments)
          .values({
            feedbackId: input.feedbackId,
            authorUserId: context.session.user.id,
            body: input.body,
            internal: false,
          })
          .returning({
            id: feedbackComments.id,
            body: feedbackComments.body,
            createdAt: feedbackComments.createdAt,
          });
        if (!created) badRequest("The reply could not be saved");
        await tx.insert(feedbackEvents).values({
          feedbackId: input.feedbackId,
          actorUserId: context.session.user.id,
          kind: "reply.sent",
          changedKeys: JSON.stringify(["publicReplies"]),
        });
        return created;
      });
      return reply;
    }),

  purgeExpiredAutomaticFeedback: adminProcedure
    .input(
      z.object({
        olderThanDays: z.number().int().min(90).max(365).default(90),
      }),
    )
    .handler(async ({ input }) => {
      const cutoff = new Date(Date.now() - input.olderThanDays * 86_400_000);
      const deleted = await db
        .delete(feedback)
        .where(
          and(like(feedback.source, "auto:%"), lt(feedback.lastSeenAt, cutoff)),
        )
        .returning({ id: feedback.id });
      return { ok: true, deletedCount: deleted.length, cutoff };
    }),
};
