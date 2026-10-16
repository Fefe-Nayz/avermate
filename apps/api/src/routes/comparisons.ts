import type { db } from "@/db";
import { customAverages, periods, subjects, yearComparisons, years } from "@/db/schema";
import type { Session, User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

const idSchema = z.string().min(1).max(64);
const pairSchema = z.object({
  yearId: idSchema,
  referenceYearId: idSchema,
}).refine(({ yearId, referenceYearId }) => yearId !== referenceYearId, {
  message: "Choose two different years",
});

const mappingSchema = z.record(idSchema, idSchema.nullable())
  .refine((map) => Object.keys(map).length <= 2000, {
    message: "Too many mappings",
  })
  .refine((map) => {
    const references = Object.values(map).filter((id) => id !== null);
    return new Set(references).size === references.length;
  }, { message: "Each reference can be mapped only once" });

const updateSchema = z.object({
  subjectMap: mappingSchema,
  periodMap: mappingSchema,
  // Older clients must not erase a mapping they do not know about.
  customAverageMap: mappingSchema.optional(),
}).strict();

type Mapping = Record<string, string | null>;

function isValidMapping(map: Mapping, sourceIds: Set<string>, referenceIds: Set<string>) {
  return Object.entries(map).every(([sourceId, referenceId]) =>
    sourceIds.has(sourceId) && (referenceId === null || referenceIds.has(referenceId))
  );
}

// Academic items can be removed after configuration. Keep explicit exclusions,
// discard removed sources and clear references that no longer exist.
function readMapping(serialized: string, sourceIds: Set<string>, referenceIds: Set<string>): Mapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return {};
  }
  const result = mappingSchema.safeParse(parsed);
  if (!result.success) return {};
  return Object.fromEntries(Object.entries(result.data)
    .filter(([sourceId]) => sourceIds.has(sourceId))
    .map(([sourceId, referenceId]) => [
      sourceId,
      referenceId !== null && referenceIds.has(referenceId) ? referenceId : null,
    ]));
}

export function createComparisonsRoutes(database: typeof db) {
  const app = new Hono<{
    Variables: {
      session: { user: User; session: Session } | null;
    };
  }>();

  app.use("*", async (c, next) => {
    const session = c.get("session");
    if (!session) return c.json({ code: "UNAUTHORIZED" }, 401);
    if (!session.user.emailVerified) {
      return c.json({ code: "EMAIL_NOT_VERIFIED", message: "Email verification is required" }, 403);
    }
    await next();
  });

  async function getOwnedPair(userId: string, yearId: string, referenceYearId: string) {
    const ownedYears = await database.select({ id: years.id }).from(years).where(and(
      eq(years.userId, userId),
      inArray(years.id, [yearId, referenceYearId]),
    ));
    return ownedYears.length === 2;
  }

  async function getMappingIds(userId: string, yearId: string, referenceYearId: string) {
    const [pairSubjects, pairPeriods, pairCustomAverages] = await Promise.all([
      database.select({ id: subjects.id, yearId: subjects.yearId }).from(subjects).where(and(
        eq(subjects.userId, userId), inArray(subjects.yearId, [yearId, referenceYearId]),
      )),
      database.select({ id: periods.id, yearId: periods.yearId }).from(periods).where(and(
        eq(periods.userId, userId), inArray(periods.yearId, [yearId, referenceYearId]),
      )),
      database.select({ id: customAverages.id, yearId: customAverages.yearId }).from(customAverages).where(and(
        eq(customAverages.userId, userId), inArray(customAverages.yearId, [yearId, referenceYearId]),
      )),
    ]);
    return {
      sourceSubjects: new Set(pairSubjects.filter((s) => s.yearId === yearId).map((s) => s.id)),
      referenceSubjects: new Set(pairSubjects.filter((s) => s.yearId === referenceYearId).map((s) => s.id)),
      sourcePeriods: new Set(pairPeriods.filter((p) => p.yearId === yearId).map((p) => p.id)),
      referencePeriods: new Set(pairPeriods.filter((p) => p.yearId === referenceYearId).map((p) => p.id)),
      sourceCustomAverages: new Set(pairCustomAverages.filter((a) => a.yearId === yearId).map((a) => a.id)),
      referenceCustomAverages: new Set(pairCustomAverages.filter((a) => a.yearId === referenceYearId).map((a) => a.id)),
    };
  }

  app.get("/:yearId/:referenceYearId", zValidator("param", pairSchema), async (c) => {
    const userId = c.get("session")!.user.id;
    const { yearId, referenceYearId } = c.req.valid("param");
    if (!await getOwnedPair(userId, yearId, referenceYearId)) {
      return c.json({ code: "YEAR_NOT_FOUND" }, 404);
    }
    const row = await database.query.yearComparisons.findFirst({
      where: and(eq(yearComparisons.userId, userId), eq(yearComparisons.yearId, yearId),
        eq(yearComparisons.referenceYearId, referenceYearId)),
    });
    if (!row) return c.json({ comparison: null });

    const ids = await getMappingIds(userId, yearId, referenceYearId);
    return c.json({ comparison: {
      yearId,
      referenceYearId,
      subjectMap: readMapping(row.subjectMap, ids.sourceSubjects, ids.referenceSubjects),
      periodMap: readMapping(row.periodMap, ids.sourcePeriods, ids.referencePeriods),
      customAverageMap: readMapping(row.customAverageMap, ids.sourceCustomAverages, ids.referenceCustomAverages),
      updatedAt: row.updatedAt.toISOString(),
    } });
  });

  app.put("/:yearId/:referenceYearId", zValidator("param", pairSchema),
    zValidator("json", updateSchema), async (c) => {
      const userId = c.get("session")!.user.id;
      const { yearId, referenceYearId } = c.req.valid("param");
      const { subjectMap, periodMap, customAverageMap } = c.req.valid("json");
      if (!await getOwnedPair(userId, yearId, referenceYearId)) {
        return c.json({ code: "YEAR_NOT_FOUND" }, 404);
      }
      const ids = await getMappingIds(userId, yearId, referenceYearId);
      if (!isValidMapping(subjectMap, ids.sourceSubjects, ids.referenceSubjects)) {
        return c.json({ code: "INVALID_SUBJECT_MAPPING" }, 400);
      }
      if (!isValidMapping(periodMap, ids.sourcePeriods, ids.referencePeriods)) {
        return c.json({ code: "INVALID_PERIOD_MAPPING" }, 400);
      }
      if (customAverageMap !== undefined && !isValidMapping(customAverageMap, ids.sourceCustomAverages, ids.referenceCustomAverages)) {
        return c.json({ code: "INVALID_CUSTOM_AVERAGE_MAPPING" }, 400);
      }
      const values = {
        subjectMap: JSON.stringify(subjectMap),
        periodMap: JSON.stringify(periodMap),
        // Omit from the upsert update too: preserving this at SQL level avoids
        // overwriting a concurrent custom-average edit made by a newer client.
        ...(customAverageMap !== undefined ? { customAverageMap: JSON.stringify(customAverageMap) } : {}),
        updatedAt: new Date(),
      };
      const row = await database.insert(yearComparisons).values({
        userId, yearId, referenceYearId, ...values,
      }).onConflictDoUpdate({
        target: [yearComparisons.userId, yearComparisons.yearId, yearComparisons.referenceYearId],
        set: values,
      }).returning().get();
      return c.json({ comparison: {
        yearId, referenceYearId, subjectMap, periodMap,
        customAverageMap: readMapping(row.customAverageMap, ids.sourceCustomAverages, ids.referenceCustomAverages),
        updatedAt: row.updatedAt.toISOString(),
      } });
    });

  return app;
}
