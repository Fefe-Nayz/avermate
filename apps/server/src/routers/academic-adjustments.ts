import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  periodGeneralAdjustments,
  subjectPeriodAdjustments,
  subjects,
} from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requirePeriod, requireYear } from "../lib/ownership";

const pointsSchema = z.number().finite().min(-1_000).max(1_000);

async function readAdjustments(userId: string, yearId: string) {
  const [general, bySubject] = await Promise.all([
    db
      .select({
        periodId: periodGeneralAdjustments.periodId,
        points: periodGeneralAdjustments.points,
      })
      .from(periodGeneralAdjustments)
      .where(
        and(
          eq(periodGeneralAdjustments.userId, userId),
          eq(periodGeneralAdjustments.yearId, yearId),
        ),
      )
      .orderBy(asc(periodGeneralAdjustments.periodId)),
    db
      .select({
        periodId: subjectPeriodAdjustments.periodId,
        subjectId: subjectPeriodAdjustments.subjectId,
        points: subjectPeriodAdjustments.points,
      })
      .from(subjectPeriodAdjustments)
      .where(
        and(
          eq(subjectPeriodAdjustments.userId, userId),
          eq(subjectPeriodAdjustments.yearId, yearId),
        ),
      )
      .orderBy(
        asc(subjectPeriodAdjustments.periodId),
        asc(subjectPeriodAdjustments.subjectId),
      ),
  ]);
  return { general, subjects: bySubject };
}

export const academicAdjustmentsRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      return readAdjustments(userId, input.yearId);
    }),

  /** Replace every adjustment for one period in one atomic write. */
  replacePeriod: protectedProcedure
    .input(
      z.object({
        periodId: z.string().min(1),
        generalPoints: pointsSchema,
        subjects: z
          .array(
            z.object({
              subjectId: z.string().min(1),
              points: pointsSchema,
            }),
          )
          .max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const period = await requirePeriod(userId, input.periodId);
      const requestedIds = input.subjects.map((row) => row.subjectId);
      if (new Set(requestedIds).size !== requestedIds.length) {
        badRequest("A subject can only have one adjustment per period");
      }

      if (requestedIds.length > 0) {
        const owned = await db
          .select({ id: subjects.id, kind: subjects.kind })
          .from(subjects)
          .where(
            and(
              eq(subjects.userId, userId),
              eq(subjects.yearId, period.yearId),
              inArray(subjects.id, requestedIds),
            ),
          );
        if (
          owned.length !== requestedIds.length ||
          owned.some((subject) => subject.kind !== "subject")
        ) {
          badRequest(
            "Every adjustment must target a subject in this period's year",
          );
        }
      }

      const now = new Date();
      const nonZeroSubjects = input.subjects.filter((row) => row.points !== 0);
      const statements = [
        db
          .delete(periodGeneralAdjustments)
          .where(
            and(
              eq(periodGeneralAdjustments.periodId, period.id),
              eq(periodGeneralAdjustments.userId, userId),
            ),
          ),
        db
          .delete(subjectPeriodAdjustments)
          .where(
            and(
              eq(subjectPeriodAdjustments.periodId, period.id),
              eq(subjectPeriodAdjustments.userId, userId),
            ),
          ),
        ...(input.generalPoints === 0
          ? []
          : [
              db.insert(periodGeneralAdjustments).values({
                periodId: period.id,
                points: input.generalPoints,
                yearId: period.yearId,
                userId,
                createdAt: now,
                updatedAt: now,
              }),
            ]),
        ...(nonZeroSubjects.length === 0
          ? []
          : [
              db.insert(subjectPeriodAdjustments).values(
                nonZeroSubjects.map((row) => ({
                  periodId: period.id,
                  subjectId: row.subjectId,
                  points: row.points,
                  yearId: period.yearId,
                  userId,
                  createdAt: now,
                  updatedAt: now,
                })),
              ),
            ]),
      ];

      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return readAdjustments(userId, period.yearId);
    }),
};
