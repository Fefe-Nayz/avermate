import { db } from "@/db";
import { gradeComponents, grades, subjects, periods } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
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
      components: {
        orderBy: (components, { asc }) => [asc(components.createdAt)],
      },
    },
  });
  return mark;
}

function computeCompositeValue(
  outOf: number,
  components: Array<{ value: number; outOf: number; coefficient: number }>
) {
  let totalWeightedPercentages = 0;
  let totalCoefficients = 0;

  for (const component of components) {
    if (component.outOf <= 0) {
      continue;
    }

    const coefficient = component.coefficient / 100;
    if (coefficient <= 0) {
      continue;
    }

    totalWeightedPercentages += (component.value / component.outOf) * coefficient;
    totalCoefficients += coefficient;
  }

  if (totalCoefficients <= 0) {
    return null;
  }

  return Math.round((totalWeightedPercentages / totalCoefficients) * outOf);
}

async function recalculateCompositeGrade(gradeId: string) {
  const grade = await getMarkById(gradeId);
  if (!grade) {
    throw new HTTPException(404);
  }

  const components = await db.query.gradeComponents.findMany({
    where: eq(gradeComponents.gradeId, grade.id),
    orderBy: asc(gradeComponents.createdAt),
  });

  const nextValue = computeCompositeValue(grade.outOf, components);

  if (nextValue === null) {
    return await db
      .update(grades)
      .set({ isComposite: true })
      .where(eq(grades.id, grade.id))
      .returning()
      .get();
  }

  return await db
    .update(grades)
    .set({
      value: nextValue,
      isComposite: true,
    })
    .where(eq(grades.id, grade.id))
    .returning()
    .get();
}

async function activateCompositeGradeWithOriginalSeed(
  grade: NonNullable<Awaited<ReturnType<typeof getMarkById>>>,
  userId: string
) {
  const components = await db.query.gradeComponents.findMany({
    where: eq(gradeComponents.gradeId, grade.id),
    orderBy: asc(gradeComponents.createdAt),
  });

  if (components.length === 0) {
    const seedCreatedAt =
      grade.createdAt instanceof Date ? grade.createdAt : new Date();

    await db.insert(gradeComponents).values({
      gradeId: grade.id,
      name: grade.name,
      value: grade.value,
      outOf: grade.outOf,
      coefficient: 100,
      createdAt: seedCreatedAt,
      updatedAt: new Date(),
      userId,
      yearId: grade.yearId,
    });
  }

  return await recalculateCompositeGrade(grade.id);
}

async function revertCompositeGradeWhenSingleComponent(gradeId: string) {
  const grade = await getMarkById(gradeId);
  if (!grade) {
    throw new HTTPException(404);
  }

  const components = await db.query.gradeComponents.findMany({
    where: eq(gradeComponents.gradeId, grade.id),
    orderBy: asc(gradeComponents.createdAt),
  });

  if (components.length > 1) {
    return await recalculateCompositeGrade(grade.id);
  }

  const remainingComponent = components[0];

  await db
    .delete(gradeComponents)
    .where(eq(gradeComponents.gradeId, grade.id));

  return await db
    .update(grades)
    .set({
      value: remainingComponent?.value ?? grade.value,
      outOf: remainingComponent?.outOf ?? grade.outOf,
      isComposite: false,
    })
    .where(eq(grades.id, grade.id))
    .returning()
    .get();
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
  passedAt: z.coerce.date().refine((date) => date <= new Date(), {
    message: "Date cannot be in the future",
  }).optional(),
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

    const updatePayload = { ...data };

    if (grade.isComposite) {
      delete updatePayload.value;
      delete updatePayload.outOf;
      delete updatePayload.subjectId;
      delete updatePayload.periodId;
    }

    let updatedGrade = await db
      .update(grades)
      .set(updatePayload)
      .where(eq(grades.id, grade.id))
      .returning()
      .get();

    if (updatedGrade.isComposite) {
      updatedGrade = await recalculateCompositeGrade(updatedGrade.id);
    }

    return c.json({ grade: updatedGrade });
  }
);

const componentBodySchema = z.object({
  name: z.string().min(1).max(64),
  outOf: z
    .number()
    .min(0)
    .max(1000 * 10)
    .transform((f) => Math.round(f * 100)),
  value: z
    .number()
    .min(0)
    .max(1000 * 10)
    .transform((f) => Math.round(f * 100)),
  coefficient: z
    .number()
    .min(0)
    .max(1000 * 10)
    .transform((f) => Math.round(f * 100)),
}).refine((data) => data.value <= data.outOf, {
  message: "Value cannot exceed out of",
  path: ["value"],
});

const gradeComponentParamSchema = z.object({
  gradeId: z.string().min(1).max(64),
});

const gradeComponentUpdateParamSchema = gradeComponentParamSchema.extend({
  componentId: z.string().min(1).max(64),
});

async function ensureOwnedGrade(gradeId: string, userId: string) {
  const grade = await getMarkById(gradeId);

  if (!grade) throw new HTTPException(404);
  if (grade.userId !== userId) throw new HTTPException(403);

  return grade;
}

app.post(
  "/:gradeId/composite",
  zValidator("param", gradeComponentParamSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

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
    const grade = await ensureOwnedGrade(gradeId, session.user.id);

    const updatedGrade = await activateCompositeGradeWithOriginalSeed(
      grade,
      session.user.id
    );
    const components = await db.query.gradeComponents.findMany({
      where: eq(gradeComponents.gradeId, grade.id),
      orderBy: asc(gradeComponents.createdAt),
    });

    return c.json({ grade: updatedGrade, components });
  }
);

app.delete(
  "/:gradeId/composite",
  zValidator("param", gradeComponentParamSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

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
    const grade = await ensureOwnedGrade(gradeId, session.user.id);
    const updatedGrade = await revertCompositeGradeWhenSingleComponent(grade.id);
    const components = await db.query.gradeComponents.findMany({
      where: eq(gradeComponents.gradeId, grade.id),
      orderBy: asc(gradeComponents.createdAt),
    });

    return c.json({ grade: updatedGrade, components });
  }
);

app.post(
  "/:gradeId/components",
  zValidator("param", gradeComponentParamSchema),
  zValidator("json", componentBodySchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

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
    const grade = await ensureOwnedGrade(gradeId, session.user.id);
    const data = c.req.valid("json");
    const now = new Date();

    if (!grade.isComposite) {
      await activateCompositeGradeWithOriginalSeed(grade, session.user.id);
    }

    await db.insert(gradeComponents).values({
      ...data,
      gradeId: grade.id,
      userId: session.user.id,
      yearId: grade.yearId,
      createdAt: now,
      updatedAt: now,
    });

    const updatedGrade = await recalculateCompositeGrade(grade.id);
    const components = await db.query.gradeComponents.findMany({
      where: eq(gradeComponents.gradeId, grade.id),
      orderBy: asc(gradeComponents.createdAt),
    });

    return c.json({ grade: updatedGrade, components }, 201);
  }
);

app.patch(
  "/:gradeId/components/:componentId",
  zValidator("param", gradeComponentUpdateParamSchema),
  zValidator("json", componentBodySchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
      return c.json(
        {
          code: "EMAIL_NOT_VERIFIED",
          message: "Email verification is required",
        },
        403
      );
    }

    const { gradeId, componentId } = c.req.valid("param");
    const grade = await ensureOwnedGrade(gradeId, session.user.id);
    const component = await db.query.gradeComponents.findFirst({
      where: and(
        eq(gradeComponents.id, componentId),
        eq(gradeComponents.gradeId, grade.id)
      ),
    });

    if (!component) throw new HTTPException(404);
    if (component.userId !== session.user.id) throw new HTTPException(403);

    const data = c.req.valid("json");

    await db
      .update(gradeComponents)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(gradeComponents.id, component.id));

    const updatedGrade = await recalculateCompositeGrade(grade.id);
    const components = await db.query.gradeComponents.findMany({
      where: eq(gradeComponents.gradeId, grade.id),
      orderBy: asc(gradeComponents.createdAt),
    });

    return c.json({ grade: updatedGrade, components });
  }
);

app.delete(
  "/:gradeId/components/:componentId",
  zValidator("param", gradeComponentUpdateParamSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
      return c.json(
        {
          code: "EMAIL_NOT_VERIFIED",
          message: "Email verification is required",
        },
        403
      );
    }

    const { gradeId, componentId } = c.req.valid("param");
    const grade = await ensureOwnedGrade(gradeId, session.user.id);
    const component = await db.query.gradeComponents.findFirst({
      where: and(
        eq(gradeComponents.id, componentId),
        eq(gradeComponents.gradeId, grade.id)
      ),
    });

    if (!component) throw new HTTPException(404);
    if (component.userId !== session.user.id) throw new HTTPException(403);

    await db
      .delete(gradeComponents)
      .where(eq(gradeComponents.id, component.id));

    const updatedGrade = await revertCompositeGradeWhenSingleComponent(grade.id);
    const components = await db.query.gradeComponents.findMany({
      where: eq(gradeComponents.gradeId, grade.id),
      orderBy: asc(gradeComponents.createdAt),
    });

    return c.json({ grade: updatedGrade, components });
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
