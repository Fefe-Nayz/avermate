import { db } from "@/db";
import { grades, subjects, periods } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

async function getMarkById(markId: string) {
  const mark = await db.query.grades.findFirst({
    where: (marks, { eq }) => eq(marks.id, markId),
  });
  return mark;
}

async function getMarkByIdWithSubject(markId: string) {
  const mark = await db.query.grades.findFirst({
    where: (marks, { eq }) => eq(marks.id, markId),
    with: {
      subject: true,
    },
  });
  return mark;
}

/**
 * Get a grade by ID
 */
const getGradeSchema = z.object({
  gradeId: z.string().min(1).max(64),
});

app.get("/:gradeId", zValidator("param", getGradeSchema), async (c) => {
  const session = c.get("session");
  if (!session) throw new HTTPException(401);

  // If email isnt verified
  if (!session.user.emailVerified) {
    return c.json(
      { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
      403
    );
  }

  const { gradeId } = c.req.valid("param");

  const grade = await getMarkByIdWithSubject(gradeId);

  if (!grade) throw new HTTPException(404);
  if (grade.userId !== session.user.id) throw new HTTPException(403);

  return c.json({ grade });
});

/**
 * Update a grade by ID
 */
const updateGradeBodySchema = z.object({
  name: z.string().min(1).max(64),
  outOf: z
    .number()
    .min(0)
    .max(1000 * 10)
    .transform((f) => Math.round(f * 100))
    .optional(),
  value: z
    .number()
    .min(0)
    .max(1000 * 10)
    .transform((f) => Math.round(f * 100))
    .optional(),
  coefficient: z
    .number()
    .min(0)
    .max(1000 * 10)
    .transform((f) => Math.round(f * 100))
    .optional(),
  passedAt: z.coerce.date().max(new Date()).optional(),
  subjectId: z.string().min(1).max(64).optional(),
  periodId: z.string().min(1).max(64).optional().nullable(),
});

const updateGradeParamSchema = z.object({
  gradeId: z.string().min(1).max(64),
});

app.patch(
  "/:gradeId",
  zValidator("param", updateGradeParamSchema),
  zValidator("json", updateGradeBodySchema),
  async (c) => {
    const session = c.get("session");

    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
      return c.json(
        {
          code: "EMAIL_NOT_VERIFIED",
          message: "Email verification is required",
        },
        403
      );
    }

    const { gradeId } = c.req.valid("param");
    const data = c.req.valid("json");

    const grade = await getMarkById(gradeId);

    if (!grade) throw new HTTPException(404);
    if (grade.userId !== session.user.id) throw new HTTPException(403);

    // Check if the subject exists and belongs to the user
    if (data.subjectId) {
      const subject = await db.query.subjects.findFirst({
        where: eq(subjects.id, data.subjectId),
      });

      if (!subject) throw new HTTPException(404);
      if (subject.userId !== session.user.id) throw new HTTPException(403);
      if (subject.yearId !== grade.yearId) return c.json({ code: "SUBJECT_NOT_IN_YEAR_ERROR" }, 400);
    }

    // Check if the period exists and belongs to the user
    if (data.periodId) {
      const period = await db.query.periods.findFirst({
        where: eq(periods.id, data.periodId),
      });

      if (!period) throw new HTTPException(404);
      if (period.userId !== session.user.id) throw new HTTPException(403);
      if (period.yearId !== grade.yearId) return c.json({ code: "PERIOD_NOT_IN_YEAR_ERROR" }, 400);
    }

    const updatedGrade = await db
      .update(grades)
      .set(data)
      .where(eq(grades.id, grade.id))
      .returning()
      .get();

    return c.json({ grade: updatedGrade });
  }
);

/**
 * Delete a grade by ID
 */
const deleteGradeSchema = z.object({
  gradeId: z.string().min(1).max(64),
});

app.delete("/:gradeId", zValidator("param", deleteGradeSchema), async (c) => {
  const session = c.get("session");

  if (!session) throw new HTTPException(401);

  // If email isnt verified
  if (!session.user.emailVerified) {
    return c.json(
      { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
      403
    );
  }

  const { gradeId } = c.req.valid("param");

  const grade = await getMarkById(gradeId);

  if (!grade) throw new HTTPException(404);
  if (grade.userId !== session.user.id) throw new HTTPException(403);

  const deletedGrade = await db
    .delete(grades)
    .where(eq(grades.id, grade.id))
    .returning()
    .get();

  return c.json({ grade: deletedGrade });
});

export default app;
