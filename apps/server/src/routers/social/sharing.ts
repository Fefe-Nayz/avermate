import { ORPCError } from "@orpc/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  socialProfiles,
  socialSharedSubjects,
  subjects,
} from "../../db/schema";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import {
  ensureProfile,
  handleSchema,
  resolveSharedYear,
  sharedAcademics,
} from "./shared";

/**
 * The owner's side of sharing: the handle they can be found by, the year
 * whose figures travel, and the two locks — general average, and which
 * subject averages. `preview` is the exact object a friend receives, so the
 * settings screen can show "this is what they see" without a second model.
 */
export const socialSharingRouter = {
  get: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const profile = await ensureProfile(userId);
    const [year, sharedRows, preview] = await Promise.all([
      resolveSharedYear(userId, profile.sharedYearId),
      db
        .select({ subjectId: socialSharedSubjects.subjectId })
        .from(socialSharedSubjects)
        .where(eq(socialSharedSubjects.userId, userId)),
      sharedAcademics(userId),
    ]);
    return {
      handle: profile.handle,
      shareGeneralAverage: profile.shareGeneralAverage,
      // Its own lock: a current average says where you are, its history says when you had
      // a bad fortnight. Off until somebody says otherwise.
      shareHistory: profile.shareHistory,
      shareSubjectsMode: profile.shareSubjectsMode,
      /** The stored choice; null means "follow my current year". */
      sharedYearId: profile.sharedYearId,
      /** What that resolves to today. */
      resolvedYear: year ? { id: year.id, name: year.name } : null,
      sharedSubjectIds: sharedRows.map((row) => row.subjectId),
      preview,
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        handle: handleSchema.nullable().optional(),
        sharedYearId: z.string().min(1).nullable().optional(),
        shareGeneralAverage: z.boolean().optional(),
        shareHistory: z.boolean().optional(),
        shareSubjectsMode: z.enum(["all", "selected", "none"]).optional(),
        sharedSubjectIds: z.array(z.string().min(1)).max(500).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await ensureProfile(userId);

      if (input.handle !== undefined && input.handle !== null) {
        const [taken] = await db
          .select({ userId: socialProfiles.userId })
          .from(socialProfiles)
          .where(
            and(
              eq(socialProfiles.handle, input.handle),
              ne(socialProfiles.userId, userId),
            ),
          )
          .limit(1);
        if (taken) {
          throw new ORPCError("CONFLICT", {
            message: "That handle is already taken",
          });
        }
      }

      if (input.sharedYearId) {
        const year = await resolveSharedYear(userId, input.sharedYearId);
        if (!year || year.id !== input.sharedYearId) {
          badRequest("That year is not yours");
        }
      }

      if (input.sharedSubjectIds !== undefined) {
        if (input.sharedSubjectIds.length > 0) {
          const owned = await db
            .select({ id: subjects.id })
            .from(subjects)
            .where(
              and(
                eq(subjects.userId, userId),
                inArray(subjects.id, input.sharedSubjectIds),
              ),
            );
          if (owned.length !== new Set(input.sharedSubjectIds).size) {
            badRequest("A selected subject is not yours");
          }
        }
        await db
          .delete(socialSharedSubjects)
          .where(eq(socialSharedSubjects.userId, userId));
        if (input.sharedSubjectIds.length > 0) {
          await db.insert(socialSharedSubjects).values(
            [...new Set(input.sharedSubjectIds)].map((subjectId) => ({
              userId,
              subjectId,
            })),
          );
        }
      }

      await db
        .update(socialProfiles)
        .set({
          ...(input.handle !== undefined ? { handle: input.handle } : {}),
          ...(input.sharedYearId !== undefined
            ? { sharedYearId: input.sharedYearId }
            : {}),
          ...(input.shareHistory !== undefined
            ? { shareHistory: input.shareHistory }
            : {}),
          ...(input.shareGeneralAverage !== undefined
            ? { shareGeneralAverage: input.shareGeneralAverage }
            : {}),
          ...(input.shareSubjectsMode !== undefined
            ? { shareSubjectsMode: input.shareSubjectsMode }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(socialProfiles.userId, userId));
      return { updated: true };
    }),
};
