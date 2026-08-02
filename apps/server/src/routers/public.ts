import { sql } from "drizzle-orm";
import { db } from "../db";
import { grades, subjects, users } from "../db/schema";
import { publicProcedure } from "../lib/orpc";

/** Counters for the landing page. Aggregates only — no row ever leaves. */
export const publicRouter = {
  stats: publicProcedure.handler(async () => {
    const [row] = await db
      .select({
        users: sql<number>`(select count(*) from ${users})`,
        subjects: sql<number>`(select count(*) from ${subjects})`,
        grades: sql<number>`(select count(*) from ${grades})`,
      })
      .from(sql`(select 1)`);

    return {
      users: row?.users ?? 0,
      subjects: row?.subjects ?? 0,
      grades: row?.grades ?? 0,
    };
  }),

  health: publicProcedure.handler(() => ({
    ok: true,
    at: new Date().toISOString(),
  })),
};
