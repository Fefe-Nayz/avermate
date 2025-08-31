import { db } from "@/db";
import { periods, subjects } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, } from "drizzle-orm";
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

async function getSubjectById(subjectId: string) {
  const subject = await db.query.subjects.findFirst({
    where: eq(subjects.id, subjectId),
  });
  return subject;
}

async function getSubjectByIdWithMarks(subjectId: string) {
  const subject = await db.query.subjects.findFirst({
    where: eq(subjects.id, subjectId),
    with: {
      grades: true,
    },
  });
  return subject;
}

async function getSubjectByIdWithParentAndChildrenAndMarks(subjectId: string) {
  const subject = await db.query.subjects.findFirst({
    where: eq(subjects.id, subjectId),
    with: {
      grades: true,
      childrens: true,
      parent: true
    }
  });
  return subject;
}


// Get a specific subject organized by periods
// const getSubjectByPeriodSchema = z.object({
//   subjectId: z.string().min(1).max(64).nullable(),
// });

app.get(
  "/organized-by-periods/:subjectId",
  // zValidator("param", getSubjectByPeriodSchema),
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

    const { subjectId } = c.req.param();

    // useless bc subjectId never null
    // // if subjectId is null or empty, return all subjects
    // if (!subjectId) {
    //   const allSubjects = await db.query.subjects.findMany({
    //     where: eq(subjects.userId, session.user.id),
    //     with: {
    //       grades: true,
    //     },
    //     orderBy: sql`COALESCE(${subjects.parentId}, ${subjects.id}), ${subjects.parentId} IS NULL DESC, ${subjects.name} ASC`,
    //   });

    //   return c.json({ subjects: allSubjects });
    // }

    // Fetch the single subject + its grades
    const subject = await db.query.subjects.findFirst({
      where: and(
        eq(subjects.id, subjectId),
        // eq(subjects.userId, session.user.id)
      ),
      with: {
        grades: {
          columns: {
            id: true,
            name: true,
            value: true,
            outOf: true,
            coefficient: true,
            passedAt: true,
            periodId: true,
          },
        },
      },
    });

    if (!subject) throw new HTTPException(404);
    if (subject.userId !== session.user.id) throw new HTTPException(403);

    // Fetch periods for the user and sort them
    const userPeriods = await db.query.periods.findMany({
      where: eq(periods.userId, session.user.id),
      orderBy: asc(periods.startAt),
    });
    const sortedPeriods = [...userPeriods].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );

    // For each period, if isCumulative, gather all prior period IDs too
    const periodsWithGrades = sortedPeriods.map((p, index) => {
      const relevantPeriodIds = p.isCumulative
        ? sortedPeriods.slice(0, index + 1).map((p2) => p2.id)
        : [p.id];

      // Filter subject's own grades that match relevantPeriodIds
      const gradesInPeriod = subject.grades.filter((grade) =>
        relevantPeriodIds.includes(grade.periodId ?? "")
      );

      return {
        period: p,
        grades: gradesInPeriod,
      };
    });

    return c.json({ subject: { ...subject, periods: periodsWithGrades } });
  }
);


/**
 * Get subject by ID
 */
// const getSubjectSchema = z.object({
//   subjectId: z.string().min(1).max(64),
// });

app.get("/:subjectId", async (c) => {
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

  const { subjectId } = c.req.param();

  const subject = await getSubjectByIdWithParentAndChildrenAndMarks(subjectId);

  if (!subject) throw new HTTPException(404);
  if (subject.userId !== session.user.id) throw new HTTPException(403);

  return c.json({ subject });
});

/**
 * Update subject by ID
 */
const updateSubjectBodySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  coefficient: z
    .number()
    .min(1)
    .max(1000)
    .transform((f) => Math.round(f * 100))
    .optional(),
  parentId: z.string().min(1).max(64).optional().nullable(),
  // TODO: Dont allow user to edit the depth
  depth: z.number().int().min(0).max(1000).optional(),
  isMainSubject: z.boolean().optional(),
  isDisplaySubject: z.boolean().optional(),
});

const updateSubjectParamSchema = z.object({
  subjectId: z.string().min(1).max(64),
});

app.patch(
  "/:subjectId",
  zValidator("param", updateSubjectParamSchema),
  zValidator("json", updateSubjectBodySchema),
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

    const { subjectId } = c.req.valid("param");
    const data = c.req.valid("json");

    // Get the subject to be updated
    const subject = await getSubjectByIdWithMarks(subjectId);

    if (!subject) throw new HTTPException(404);
    if (subject.userId !== session.user.id) throw new HTTPException(403);

    // If subjects has mark it cannot be a category
    if (subject.grades.length > 0 && data.isDisplaySubject) return c.json({ code: "CATEGORY_CANT_HAVE_MARKS_ERROR" }, 400);

    let newDepth = subject.depth;
    let depthDifference = 0;

    // If parentId is being updated
    if (data.parentId !== undefined) {
      const newParentId = data.parentId;

      if (newParentId) {
        // Prevent self-parenting
        if (newParentId === subjectId) {
          throw new HTTPException(400);
        }

        // Get the new parent subject
        const parentSubject = await getSubjectById(newParentId);

        if (!parentSubject) throw new HTTPException(404);
        if (parentSubject.userId !== session.user.id)
          throw new HTTPException(403);
        if (parentSubject.yearId !== subject.yearId)
          return c.json({ code: "PARENT_NOT_IN_YEAR" }, 400);

        // Compute new depth
        newDepth = parentSubject.depth + 1;
      } else {
        // ParentId is null, depth is 0
        newDepth = 0;
      }

      // Compute depth difference
      depthDifference = newDepth - subject.depth;

      data.depth = newDepth;
    }

    // TODO: Use transactions

    // Update the subject
    const updatedSubject = await db
      .update(subjects)
      .set(data)
      .where(
        and(eq(subjects.id, subjectId), eq(subjects.yearId, subject.yearId), eq(subjects.userId, session.user.id))
      )
      .returning()
      .get();

    // If depth has changed, update the depths of the descendants
    if (depthDifference !== 0) {
      // Fetch all descendants of the subject using a simpler query
      const descendants = await db.query.subjects.findMany({
        where: and(
          eq(subjects.userId, session.user.id),
          eq(subjects.yearId, subject.yearId),
          eq(subjects.parentId, subjectId)  // Direct children only
        ),
      });

      // Update the depth of each descendant recursively
      const updateDescendantDepths = async (parentId: string, depthOffset: number) => {
        const children = await db.query.subjects.findMany({
          where: and(
            eq(subjects.userId, session.user.id),
            eq(subjects.yearId, subject.yearId),
            eq(subjects.parentId, parentId)
          ),
        });

        for (const child of children) {
          await db
            .update(subjects)
            .set({ depth: child.depth + depthOffset })
            .where(eq(subjects.id, child.id));

          // Recursively update children
          await updateDescendantDepths(child.id, depthOffset);
        }
      };

      await updateDescendantDepths(subjectId, depthDifference);
    }

    // Dont silently delete user grades
    // // If the subject is now a category (assuming `isMainSubject === true` indicates category)
    // // delete all associated grades.
    // if (data.isDisplaySubject === true) {
    //   await db.delete(grades).where(eq(grades.subjectId, subjectId));
    // }

    return c.json({ subject: updatedSubject });
  }
);
/**
 * Delete subject by ID
 */
const deleteSubjectSchema = z.object({
  subjectId: z.string().min(1).max(64),
});

app.delete(
  "/:subjectId",
  zValidator("param", deleteSubjectSchema),
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

    const { subjectId } = c.req.valid("param");

    const subject = await getSubjectById(subjectId);

    if (!subject) throw new HTTPException(404);
    if (subject.userId !== session.user.id) throw new HTTPException(403);

    const deletedSubject = await db
      .delete(subjects)
      .where(
        and(eq(subjects.id, subjectId), eq(subjects.userId, session.user.id))
      )
      .returning()
      .get();

    return c.json({ subject: deletedSubject });
  }
);

export default app;
