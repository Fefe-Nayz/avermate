import { db } from "@/db";
import { customAverages, grades, periods, subjects, years } from "@/db/schema";
import type { Session, User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { eq, and, gte, lte, desc, sql, asc, inArray } from "drizzle-orm";
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

export async function getYearById(yearId: string) {
    const year = await db.query.years.findFirst({
        where: eq(years.id, yearId),
    });
    return year;
}

async function getAllYearByUserId(userId: string) {
    const years = await db.query.years.findMany({
        where: (years, { eq }) => eq(years.userId, userId),
    });
    return years;
}

const createYearSchema = z.object({
    name: z.string().min(1).max(32),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    defaultOutOf: z.number()
        .min(0)
        .max(1000 * 10)
        .transform((f) => Math.round(f * 100)),
});

app.post("/", zValidator("json", createYearSchema), async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const { name, startDate, endDate, defaultOutOf } = c.req.valid("json");

    const year = await db.insert(years).values({
        name,
        startDate,
        endDate,
        defaultOutOf,
        userId: session.user.id,
    }).returning().get();

    return c.json({ year }, 201);
});

app.get("/", async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const years = await getAllYearByUserId(session.user.id);

    return c.json({ years });
});

/**
 * Grades
 */
/**
 * Create a new grade
 */
const createGradeSchema = z.object({
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
    passedAt: z.coerce.date().refine((date) => date <= new Date(), {
        message: "Date cannot be in the future",
    }).optional().default(new Date()),
    subjectId: z.string().min(1).max(64),
    periodId: z.string().min(1).max(64).nullable(),
});

app.post("/:yearId/grades", zValidator("json", createGradeSchema), async (c) => {
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

    const { yearId } = c.req.param();
    const { name, outOf, value, coefficient, passedAt, subjectId, periodId } =
        c.req.valid("json");

    const year = await getYearById(yearId);

    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    const subject = await db.query.subjects.findFirst({
        where: eq(subjects.id, subjectId),
    });

    if (!subject) throw new HTTPException(404);
    if (subject.userId !== session.user.id) throw new HTTPException(403);
    if (subject.yearId !== year.id) return c.json({ code: "SUBJECT_NOT_IN_YEAR_ERROR" }, 400);


    // Check if the period exists and belongs to the user
    if (periodId) {
        const period = await db.query.periods.findFirst({
            where: eq(periods.id, periodId),
        });

        if (!period) throw new HTTPException(404);
        if (period.userId !== session.user.id) throw new HTTPException(403);
        if (period.yearId !== year.id) return c.json({ code: "PERIOD_NOT_IN_YEAR_ERROR" }, 400);
    }

    // TODO: Error Handling
    const grade = await db
        .insert(grades)
        .values({
            name,
            outOf,
            value,
            coefficient,
            passedAt,
            createdAt: new Date(),
            userId: session.user.id,
            subjectId: subject.id,
            periodId,
            yearId,
        })
        .returning()
        .get();

    return c.json({ grade }, 201);
});

/**
 * Get all grades
 */
const getGradesQuerySchema = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().optional(),
});

app.get("/:yearId/grades", zValidator("query", getGradesQuerySchema), async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const { yearId } = c.req.param();
    const { from, to, limit } = c.req.valid("query");

    const year = await getYearById(yearId);

    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    const allGrades = await db.query.grades.findMany({
        where: and(
            eq(grades.userId, session.user.id),
            eq(grades.yearId, yearId),
            from && gte(grades.createdAt, from),
            to && lte(grades.createdAt, to)
        ),
        limit: limit,
        orderBy: desc(grades.passedAt),
        with: {
            subject: {
                columns: {
                    id: true,
                    name: true,
                },
            },
        },
    });

    //   allGrades = allGrades.sort(
    //     (a, b) => b.passedAt.getTime() - a.passedAt.getTime()
    //   );

    return c.json({ grades: allGrades });
});

/**
 * Subjects
 */
/**
 * Create a new subject
 */
const createSubjectSchema = z.object({
    name: z.string().min(1).max(64),
    coefficient: z
        .number()
        .min(1)
        .max(1000)
        .transform((f) => Math.round(f * 100)),
    parentId: z.string().min(1).max(64).optional().nullable(),
    depth: z.number().int().min(0).max(1000).optional(),
    isMainSubject: z.boolean().optional(),
    isDisplaySubject: z.boolean().optional(),
});

app.post("/:yearId/subjects", zValidator("json", createSubjectSchema), async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const yearId = c.req.param("yearId");
    const { name, coefficient, parentId, isMainSubject, isDisplaySubject } =
        c.req.valid("json");

    const year = await getYearById(yearId);
    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    let depth = 0;

    if (parentId) {
        const parentSubject = await db.query.subjects.findFirst({
            where: eq(subjects.id, parentId),
        });

        if (!parentSubject) throw new HTTPException(404);
        if (parentSubject.userId !== session.user.id) throw new HTTPException(403);
        if (parentSubject.yearId !== year.id) return c.json({ code: "PARENT_SUBJECT_NOT_IN_YEAR_ERROR" }, 400);

        depth = parentSubject.depth + 1;
    }

    // TODO: Error Handling
    const subject = await db
        .insert(subjects)
        .values({
            name,
            coefficient,
            parentId,
            depth,
            isMainSubject: isMainSubject,
            isDisplaySubject: isDisplaySubject,
            createdAt: new Date(),
            userId: session.user.id,
            yearId,
        })
        .returning()
        .get();

    return c.json({ subject }, 201);
});

/**
 * Get all subjects
 */
app.get("/:yearId/subjects", async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const yearId = c.req.param("yearId");

    const year = await getYearById(yearId);
    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    const allSubjects = await db.query.subjects.findMany({
        where: eq(subjects.yearId, year.id),
        with: {
            grades: true,
        },
        orderBy: sql`COALESCE(${subjects.parentId}, ${subjects.id}), ${subjects.parentId} IS NULL DESC, ${subjects.name} ASC`,
    });

    return c.json({ subjects: allSubjects });
});

app.get("/:yearId/subjects/organized-by-periods", async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    const { yearId } = c.req.param();
    const year = await getYearById(yearId);
    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    // If email isn't verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    // 1) Fetch periods for the user
    const userPeriods = await db.query.periods.findMany({
        where: eq(periods.yearId, year.id),
        orderBy: asc(periods.startAt),
    });

    // 2) Fetch subjects with grades
    const subjectsWithGrades = await db.query.subjects.findMany({
        where: eq(subjects.yearId, year.id),
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
        orderBy: asc(subjects.name),
    });

    // 3) Sort periods by start date
    const sortedPeriods = [...userPeriods].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );

    // 4) Build the data structure: for each period, if isCumulative = true,
    //    include the grades from all *previous* periods plus the current one.
    const periodsWithSubjects = sortedPeriods.map((period, index) => {
        // Gather relevant period IDs
        const relevantPeriodIds = period.isCumulative
            ? sortedPeriods.slice(0, index + 1).map((p) => p.id)
            : [period.id];

        // Now, for each subject, we include only the grades whose `periodId` is in relevantPeriodIds
        const subjectsInPeriod = subjectsWithGrades.map((subject) => {
            const relevantGrades = subject.grades.filter((grade) =>
                relevantPeriodIds.includes(grade.periodId ?? "")
            );

            return {
                ...subject,
                grades: relevantGrades,
            };
        });

        return {
            period,
            subjects: subjectsInPeriod,
        };
    });

    // -- The following is the "full-year" logic you already have. --
    // Calculate startAt and endAt for the "full-year" period:
    const fullYearStartAt =
        sortedPeriods.length > 0
            ? new Date(sortedPeriods[0].startAt)
            : new Date(new Date().getFullYear(), 8, 1);

    const fullYearEndAt =
        sortedPeriods.length > 0
            ? new Date(sortedPeriods[sortedPeriods.length - 1].endAt)
            : new Date(new Date().getFullYear() + 1, 5, 30);

    // Hardcoded full-year period
    const fullYearPeriod = {
        id: "full-year",
        name: "Full Year",
        startAt: fullYearStartAt,
        endAt: fullYearEndAt,
        createdAt: new Date(),
        userId: session.user.id,
        isCumulative: false, // or true, depending on your logic
        yearId: year.id,
    };

    // All subjects with all grades
    const allSubjectsWithAllGrades = subjectsWithGrades.map((subject) => ({
        ...subject,
        grades: subject.grades,
    }));

    // Add the full-year period to the array
    periodsWithSubjects.push({
        period: fullYearPeriod,
        subjects: allSubjectsWithAllGrades,
    });

    // 5) Return the final result
    return c.json({ periods: periodsWithSubjects });
});

/**
 * Periods
 */
/**
 * Create a new period
 */

const createPeriodSchema = z.object({
    name: z.string().min(1).max(64),
    startAt: z.coerce.date().optional().default(new Date()),
    endAt: z.coerce.date().optional().default(new Date()),
    // NEW FIELD
    isCumulative: z.boolean().default(false),
});

app.post("/:yearId/periods", zValidator("json", createPeriodSchema), async (c) => {
    const session = c.get("session");

    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const { yearId } = c.req.param();
    const { name, startAt, endAt, isCumulative } = c.req.valid("json");

    if (startAt > endAt) {
        throw new HTTPException(400);
    }

    const year = await getYearById(yearId);

    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    const period = await db
        .insert(periods)
        .values({
            name,
            startAt: new Date(startAt.getTime()),
            endAt: new Date(endAt.getTime()),
            userId: session.user.id,
            createdAt: new Date(),
            isCumulative,
            yearId,
        })
        .returning()
        .get();

    return c.json(period);
});

/**
 * Get all periods
 */
app.get("/:yearId/periods", async (c) => {
    const session = c.get("session");

    if (!session) throw new HTTPException(401);

    // If email isnt verified
    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const { yearId } = c.req.param();
    const year = await getYearById(yearId);

    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    const allPeriods = await db.query.periods.findMany({
        where: eq(periods.yearId, year.id),
        orderBy: asc(periods.startAt),
    });

    return c.json({
        periods: allPeriods,
    });
});

/**
 * Averages
 */
/**
 * Create a New Custom Average
 */
const createCustomAverageSchema = z.object({
    name: z.string().min(1).max(64),
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
        .min(1),
    isMainAverage: z.boolean().optional().default(false),
});

app.post("/:yearId/averages", zValidator("json", createCustomAverageSchema), async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const { yearId } = c.req.param();
    const year = await getYearById(yearId);
    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    // Extract and rename subjects to avoid naming conflicts
    const { name, subjects: subjectArray, isMainAverage } = c.req.valid("json");
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
        if (customAverageSubject.yearId !== year.id) return c.json(
            { code: "SUBJECT_NOT_IN_YEAR_ERROR" },
            400
        );
    }

    // Insert new average
    const newAverage = await db
        .insert(customAverages)
        .values({
            name,
            subjects: JSON.stringify(subjectArray),
            userId: session.user.id,
            isMainAverage: isMainAverage || false,
            createdAt: new Date(),
            yearId,
        })
        .returning()
        .get();

    return c.json({ customAverage: newAverage }, 201);
});

/**
 * Retrieve All Custom Averages for the Authenticated User
 */
app.get("/:yearId/averages", async (c) => {
    const session = c.get("session");
    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
        return c.json(
            { code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" },
            403
        );
    }

    const { yearId } = c.req.param();
    const year = await getYearById(yearId);
    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    const averages = await db.query.customAverages.findMany({
        where: eq(customAverages.yearId, year.id),
        orderBy: desc(customAverages.createdAt),
    });

    const parsedAverages = averages.map((avg) => ({
        ...avg,
        subjects: JSON.parse(avg.subjects),
    }));

    return c.json({ customAverages: parsedAverages });
});

export default app;