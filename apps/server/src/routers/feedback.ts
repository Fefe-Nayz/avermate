import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { feedback, feedbackComments } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { reserveRateLimit } from "../lib/rate-limit";
import { deleteFile, resolveIncomingFile } from "../lib/storage";

const CONTEXT_KEYS = new Set([
  "appVersion",
  "browser",
  "buildVersion",
  "connectivity",
  "device",
  "locale",
  "os",
  "platform",
  "route",
  "userAgent",
  "viewport",
]);
const SECRET_KEY =
  /(auth|authorization|cookie|credential|password|query|secret|session|token)/i;
const SECRET_VALUE =
  /(bearer\s+[a-z0-9._~-]+|(?:token|password|secret|cookie)=\S+)/i;

const contextSchema = z
  .record(z.string().trim().min(1).max(64), z.string().max(500))
  .superRefine((value, issue) => {
    if (Object.keys(value).length > 20) {
      issue.addIssue({
        code: "custom",
        message: "Feedback context is limited to 20 fields",
      });
    }
  });

function sanitizedRoute(value: string): string {
  const rawPath = value.split(/[?#]/, 1)[0] ?? "/";
  const normalized = rawPath
    .split("/")
    .map((segment) =>
      /^\d+$/.test(segment) ||
      /^[a-z0-9_-]{20,}$/i.test(segment) ||
      segment.includes("@")
        ? ":id"
        : segment,
    )
    .join("/");
  return normalized.slice(0, 200) || "/";
}

export function sanitizeFeedbackContext(input: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(input)
      .filter(
        ([key, value]) =>
          CONTEXT_KEYS.has(key) &&
          !SECRET_KEY.test(key) &&
          !SECRET_VALUE.test(value),
      )
      .map(([key, value]) => [
        key,
        key === "route" ? sanitizedRoute(value) : value.slice(0, 500),
      ]),
  );
}

const feedbackInput = z
  .object({
    kind: z.enum(["bug", "idea", "question", "other"]).default("other"),
    subject: z.string().trim().min(3).max(120),
    message: z.string().trim().min(10).max(4000),
    /** Route, viewport and user agent — whatever makes a bug reproducible. */
    context: contextSchema.default({}),
    image: z.instanceof(File).optional(),
    attachmentFileId: z.string().min(1).optional(),
  })
  .refine((input) => !(input.image && input.attachmentFileId), {
    message: "Provide only one feedback attachment",
  });

const automaticFeedbackInput = z.object({
  source: z.enum(["web", "mobile", "server"]),
  errorDigest: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._:-]{8,128}$/),
  route: z.string().trim().min(1).max(500),
  appVersion: z.string().trim().min(1).max(64),
  context: contextSchema.default({}),
});

function automaticGroupKey(input: z.infer<typeof automaticFeedbackInput>) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        source: input.source,
        errorDigest: input.errorDigest,
        route: sanitizedRoute(input.route),
        appVersion: input.appVersion,
      }),
    )
    .digest("hex");
}

function automaticFingerprint(
  userId: string,
  input: z.infer<typeof automaticFeedbackInput>,
) {
  return createHash("sha256")
    .update(`${userId}\0${automaticGroupKey(input)}`)
    .digest("hex");
}

export const feedbackRouter = {
  submit: protectedProcedure
    .input(feedbackInput)
    .handler(async ({ context, input }) => {
      const user = context.session.user;
      await reserveRateLimit({
        subject: user.id,
        action: "feedback.submit",
        limit: 20,
        windowMs: 86_400_000,
      });
      let attachment: Awaited<ReturnType<typeof resolveIncomingFile>> | null =
        null;

      if (input.image || input.attachmentFileId) {
        const extension =
          input.image?.type === "image/png"
            ? "png"
            : input.image?.type === "image/webp"
              ? "webp"
              : "jpg";
        attachment = await resolveIncomingFile({
          userId: user.id,
          purpose: "feedback-attachment",
          file: input.image,
          fileId: input.attachmentFileId,
          nameHint: `feedback-${user.id}-${Date.now()}.${extension}`,
        });
      }

      let created: typeof feedback.$inferSelect | undefined;
      try {
        [created] = await db
          .insert(feedback)
          .values({
            kind: input.kind,
            subject: input.subject,
            message: input.message,
            attachmentUrl: attachment?.url ?? null,
            context: JSON.stringify(sanitizeFeedbackContext(input.context)),
            source: "form",
            userId: user.id,
          })
          .returning();
      } catch (error) {
        if (attachment)
          await deleteFile(user.id, attachment.id).catch(() => undefined);
        throw error;
      }
      if (!created) {
        if (attachment)
          await deleteFile(user.id, attachment.id).catch(() => undefined);
        badRequest("The feedback could not be saved");
      }

      return created;
    }),

  autoReport: protectedProcedure
    .input(automaticFeedbackInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await reserveRateLimit({
        subject: userId,
        action: "feedback.auto_report",
        limit: 30,
        windowMs: 60 * 60 * 1_000,
      });
      const now = new Date();
      const route = sanitizedRoute(input.route);
      const duplicateGroupKey = automaticGroupKey(input);
      const fingerprint = automaticFingerprint(userId, input);
      const sanitizedContext = sanitizeFeedbackContext({
        ...input.context,
        appVersion: input.appVersion,
        route,
      });
      const [report] = await db
        .insert(feedback)
        .values({
          kind: "bug",
          subject: "Automatic application error",
          message: "The application detected an unexpected error.",
          source: `auto:${input.source}`,
          fingerprint,
          duplicateGroupKey,
          errorDigest: input.errorDigest,
          route,
          context: JSON.stringify(sanitizedContext),
          userId,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: feedback.fingerprint,
          set: {
            duplicateCount: sql`${feedback.duplicateCount} + 1`,
            lastSeenAt: now,
            updatedAt: now,
            revision: sql`${feedback.revision} + 1`,
          },
        })
        .returning({
          id: feedback.id,
          status: feedback.status,
          duplicateCount: feedback.duplicateCount,
          firstSeenAt: feedback.createdAt,
          lastSeenAt: feedback.lastSeenAt,
        });
      if (!report) badRequest("The error report could not be saved");
      return report;
    }),

  mine: protectedProcedure.handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(feedback)
      .where(eq(feedback.userId, context.session.user.id))
      .orderBy(desc(feedback.createdAt))
      .limit(20);
    const ids = rows.map((row) => row.id);
    const responses = ids.length
      ? await db
          .select({
            id: feedbackComments.id,
            feedbackId: feedbackComments.feedbackId,
            body: feedbackComments.body,
            createdAt: feedbackComments.createdAt,
          })
          .from(feedbackComments)
          .where(
            and(
              inArray(feedbackComments.feedbackId, ids),
              eq(feedbackComments.internal, false),
            ),
          )
          .orderBy(feedbackComments.createdAt)
      : [];
    return rows.map((row) => ({
      ...row,
      responses: responses.filter((response) => response.feedbackId === row.id),
    }));
  }),
};
