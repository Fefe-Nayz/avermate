import { db } from "@/db";
import { type Session, type User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { customAverages, subjects } from "@/db/schema";
import { inArray } from "drizzle-orm";


const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

async function getCustomAverageById(averageId: string) {
  const average = await db.query.customAverages.findFirst({
    where: and(
      eq(customAverages.id, averageId)
    ),
  });

  return average;
}

/**
 * Retrieve a Specific Custom Average by ID
 */

const updateCustomAverageSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  subjects: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        customCoefficient: z
          .number()
          .min(1)
          .max(1000)
          .optional()
          .nullable(),
        includeChildren: z.boolean().optional().default(true),
      })
    )
    .optional(),
  isMainAverage: z.boolean().optional(),
});

const averageIdParamSchema = z.object({
  averageId: z.string().min(1).max(64),
});


app.get(
  "/:averageId",
  zValidator("param", averageIdParamSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
      return c.json(
        { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
        403
      );
    }

    const { averageId } = c.req.valid("param");
    const average = await getCustomAverageById(averageId);

    if (!average) throw new HTTPException(404);
    if (average.userId !== session.user.id) throw new HTTPException(403);

    return c.json({ customAverage: { ...average, subjects: JSON.parse(average.subjects) } });
  }
);

/**
      ),
    });

    if (!average) throw new HTTPException(404);

    return c.json({ customAverage: { ...average, subjects: JSON.parse(average.subjects) } });
  }
);

/**
 * Update an Existing Custom Average
 */
app.patch(
  "/:averageId",
  zValidator("param", averageIdParamSchema),
  zValidator("json", updateCustomAverageSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
      return c.json(
        { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
        403
      );
    }

    const { averageId } = c.req.valid("param");

    const average = await getCustomAverageById(averageId);

    if (!average) throw new HTTPException(404);
    if (average.userId !== session.user.id) throw new HTTPException(403);

    const updateData = c.req.valid("json");

    // If subjects are provided, validate that they belong to the user
    if (updateData.subjects) {
      const subjectArray = updateData.subjects;
      const subjectIds = subjectArray.map((s) => s.id);

      const customAverageSubjects = await db.query.subjects.findMany({
        where: inArray(subjects.id, subjectIds)
      });

      if (customAverageSubjects.length != subjectIds.length) {
        return c.json({
          code: "SUBJECT_NOT_FOUND_ERROR"
        }, 404);
      }

      // Validate subject ownership
      for (const customAverageSubject of customAverageSubjects) {
        if (customAverageSubject.userId !== session.user.id) return c.json(
          { code: "SUBJECT_NOT_OWNED_ERROR" },
          403
        );
        if (customAverageSubject.yearId !== average.yearId) return c.json(
          { code: "SUBJECT_NOT_IN_YEAR_ERROR" },
          400
        );
      }

      // Normalize customCoefficient values
      updateData.subjects = subjectArray.map((subject) => ({
        ...subject,
        customCoefficient: subject.customCoefficient ?? null,
      }));
    }

    const updatedAverage = await db
      .update(customAverages)
      .set({
        ...updateData,
        subjects: updateData.subjects ? JSON.stringify(updateData.subjects) : undefined,
      })
      .where(
        and(
          eq(customAverages.id, averageId),
          eq(customAverages.userId, session.user.id)
        )
      )
      .returning()
      .get();

    return c.json({ customAverage: updatedAverage });
  }
);



/**
 * Delete a Custom Average
 */
app.delete(
  "/:averageId",
  zValidator("param", averageIdParamSchema),
  async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
      return c.json(
        { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
        403
      );
    }

    const { averageId } = c.req.valid("param");

    const average = await getCustomAverageById(averageId);

    if (!average) throw new HTTPException(404);
    if (average.userId !== session.user.id) throw new HTTPException(403);

    const deletedAverage = await db
      .delete(customAverages)
      .where(
        and(
          eq(customAverages.id, averageId),
          eq(customAverages.userId, session.user.id)
        )
      )
      .returning()
      .get();

    if (!deletedAverage) throw new HTTPException(404);

    return c.json({ customAverage: deletedAverage });
  }
);

export default app;