import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import {
  cardSemanticsFromDefinition,
  createWidgetDefinition,
  widgetDefinitionFromCard,
  WIDGET_DEFINITION_VERSION,
  type CardMetric,
  type CardSemantics,
} from "@avermate/core";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A plain metric card, as a create payload.
 *
 * These used to be written in the API's other accepted shape — `metric`,
 * `targetKind`, `display` as loose fields — which stored no definition at all.
 * There is one shape now, so the fixture builds it: same intent, one
 * representation.
 */
const metricCard = (
  metric: CardMetric,
  over: Partial<Omit<CardSemantics, "metric">> & {
    surface?: "overview" | "insights" | "subject" | "grade";
  } = {},
) => {
  const { surface, ...semantics } = over;
  return {
    ...(surface ? { surface } : {}),
    definitionVersion: WIDGET_DEFINITION_VERSION,
    definitionJson: widgetDefinitionFromCard({
      metric,
      targetKind: "general",
      targetId: null,
      goalId: null,
      display: "value",
      ...semantics,
    }),
  };
};

const databaseUrl = "file::memory:";

process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_FEEDBACK = "true";
process.env.DISABLE_UPLOADS = "true";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

/**
 * The cards built on a custom average, found through their reference rows.
 *
 * The `target_id` column this used to query is gone: it held a card's *primary*
 * target, while a definition can name several averages and every one of them is a
 * reference row. Asking the same way the router asks keeps the test honest about
 * what the router will find.
 */
async function cardsForAverage(averageId: string) {
  const references = await database
    .select({ cardId: schema.dashboardCardReferences.cardId })
    .from(schema.dashboardCardReferences)
    .where(
      and(
        eq(schema.dashboardCardReferences.kind, "custom-average"),
        eq(schema.dashboardCardReferences.referenceId, averageId),
      ),
    );
  if (references.length === 0) return [];
  return database
    .select()
    .from(schema.dashboardCards)
    .where(
      inArray(
        schema.dashboardCards.id,
        references.map((reference) => reference.cardId),
      ),
    );
}

let api: Api;
let adminApi: Api;
let managedApi: Api;
let database: typeof import("../db").db;
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  // Every router test file shares the one in-memory database behind the db
  // module, so whichever bootstrap runs first migrates for all of them.
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  const { appRouter } = await import("./index");

  const now = new Date("2026-08-01T00:00:00.000Z");
  await database.insert(schema.users).values({
    id: "user-a",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    role: "user",
    banned: false,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(schema.users).values([
    {
      id: "admin-a",
      name: "Admin User",
      email: "admin@example.com",
      emailVerified: true,
      role: "admin",
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "managed-user",
      name: "Managed User",
      email: "managed@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.insert(schema.years).values([
    {
      id: "year-a",
      name: "Year A",
      startsAt: new Date("2025-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-01T00:00:00.000Z"),
      userId: "user-a",
    },
    {
      id: "year-b",
      name: "Year B",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-07-01T00:00:00.000Z"),
      userId: "user-a",
    },
  ]);
  await database.insert(schema.periods).values([
    {
      id: "period-a",
      name: "A",
      startAt: new Date("2025-09-01T00:00:00.000Z"),
      endAt: new Date("2026-07-01T00:00:00.000Z"),
      yearId: "year-a",
      userId: "user-a",
    },
    {
      id: "period-b",
      name: "B",
      startAt: new Date("2026-09-01T00:00:00.000Z"),
      endAt: new Date("2027-07-01T00:00:00.000Z"),
      yearId: "year-b",
      userId: "user-a",
    },
  ]);
  await database.insert(schema.subjects).values([
    {
      id: "subject-a",
      name: "Subject A",
      yearId: "year-a",
      userId: "user-a",
    },
    {
      id: "subject-b",
      name: "Subject B",
      yearId: "year-b",
      userId: "user-a",
    },
  ]);

  api = createRouterClient(appRouter, {
    context: {
      headers: new Headers(),
      session: {
        user: {
          id: "user-a",
          name: "Test User",
          email: "test@example.com",
          emailVerified: true,
          image: null,
          role: "user",
          banned: false,
          banReason: null,
          banExpires: null,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: "session-a",
          token: "token-a",
          userId: "user-a",
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: null,
          impersonatedBy: null,
        },
      },
    } as never,
  });
  adminApi = createRouterClient(appRouter, {
    context: {
      headers: new Headers(),
      session: {
        user: {
          id: "admin-a",
          name: "Admin User",
          email: "admin@example.com",
          emailVerified: true,
          image: null,
          role: "admin",
          banned: false,
          banReason: null,
          banExpires: null,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: "admin-session",
          token: "admin-token",
          userId: "admin-a",
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: null,
          impersonatedBy: null,
        },
      },
    } as never,
  });
  managedApi = createRouterClient(appRouter, {
    context: {
      headers: new Headers(),
      session: {
        user: {
          id: "managed-user",
          name: "Managed User",
          email: "managed@example.com",
          emailVerified: true,
          image: null,
          role: "user",
          banned: false,
          banReason: null,
          banExpires: null,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: "managed-session",
          token: "managed-token",
          userId: "managed-user",
          expiresAt: new Date("2027-01-01T00:00:00.000Z"),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: null,
          impersonatedBy: null,
        },
      },
    } as never,
  });
});

afterAll(async () => {
  database.$client.close();
});

describe("router year invariants", () => {
  test("always keeps an active year while archived years remain", async () => {
    await api.years.archive({ yearId: "year-a", archived: true });

    await expect(
      api.years.archive({ yearId: "year-b", archived: true }),
    ).rejects.toThrow("The last active year cannot be archived");
    await expect(api.years.delete({ yearId: "year-b" })).rejects.toThrow(
      "The last active year cannot be deleted while archived years remain",
    );

    await api.years.archive({ yearId: "year-a", archived: false });
    const listed = await api.years.list();
    expect(listed.filter((year) => !year.archivedAt)).toHaveLength(2);
  });

  test("reports an ownership-scoped year configuration resume status", async () => {
    const status = await api.years.configurationStatus({ yearId: "year-a" });
    expect(status).toMatchObject({
      year: { id: "year-a", userId: "user-a" },
      counts: { subjects: 1, periods: 1, customAverages: 0 },
      preset: { state: "none", presetId: null },
      recommendedStep: "complete",
    });
    expect(typeof status.canReplacePreset).toBe("boolean");

    await expect(
      managedApi.years.configurationStatus({ yearId: "year-a" }),
    ).rejects.toThrow("Year not found");
  });

  test("keeps every period inside its year while allowing ordered overlapping views", async () => {
    const year = await api.years.create({
      name: "Period invariant year",
      startsAt: new Date("2038-09-01T00:00:00.000Z"),
      endsAt: new Date("2039-07-01T00:00:00.000Z"),
    });
    expect(year).toBeDefined();
    const first = await api.periods.create({
      yearId: year?.id ?? "",
      name: "Main term",
      startAt: new Date("2038-09-01T00:00:00.000Z"),
      endAt: new Date("2039-02-01T00:00:00.000Z"),
      isCumulative: false,
    });
    const overlapping = await api.periods.create({
      yearId: year?.id ?? "",
      name: "Exam window",
      startAt: new Date("2038-12-01T00:00:00.000Z"),
      endAt: new Date("2038-12-20T00:00:00.000Z"),
      isCumulative: false,
    });
    expect(overlapping).toBeDefined();

    const subject = await api.subjects.create({
      yearId: year?.id ?? "",
      name: "Period resolution subject",
    });
    const grade = await api.grades.create({
      name: "Overlapping date",
      value: 15,
      outOf: 20,
      passedAt: new Date("2038-12-10T00:00:00.000Z"),
      subjectId: subject?.id ?? "",
    });
    expect(grade?.periodId).toBe(first?.id);

    await expect(
      api.periods.create({
        yearId: year?.id ?? "",
        name: "Outside",
        startAt: new Date("2038-08-01T00:00:00.000Z"),
        endAt: new Date("2038-09-15T00:00:00.000Z"),
        isCumulative: false,
      }),
    ).rejects.toThrow("must stay within the academic year");
    await expect(
      api.periods.update({
        periodId: overlapping?.id ?? "",
        endAt: new Date("2039-08-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("must stay within the academic year");
    await expect(
      api.years.update({
        yearId: year?.id ?? "",
        startsAt: new Date("2038-10-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("must stay within the academic year");

    const unchanged = await api.years.get({ yearId: year?.id ?? "" });
    expect(unchanged.startsAt).toEqual(new Date("2038-09-01T00:00:00.000Z"));
  });

  test("rejects cross-year grade, hierarchy, average, goal and card references", async () => {
    await expect(
      api.grades.create({
        name: "Cross-year",
        value: 12,
        outOf: 20,
        passedAt: new Date("2026-01-01T00:00:00.000Z"),
        subjectId: "subject-a",
        periodId: "period-b",
      }),
    ).rejects.toThrow("Period must belong to the same year");

    await expect(
      api.subjects.create({
        name: "Cross-year child",
        yearId: "year-a",
        parentId: "subject-b",
      }),
    ).rejects.toThrow("Parent subject must belong to the same year");

    await expect(
      api.averages.create({
        name: "Cross-year average",
        yearId: "year-a",
        entries: [{ subjectId: "subject-b" }],
      }),
    ).rejects.toThrow("Average subject must belong to the same year");

    await expect(
      api.goals.create({
        name: "Cross-year goal",
        yearId: "year-a",
        kind: "subject",
        referenceId: "subject-b",
        targetRatio: 0.75,
      }),
    ).rejects.toThrow("Goal subject must belong to the same year");

    await expect(
      api.cards.create({
        yearId: "year-a",
        ...metricCard("average", {
          targetKind: "subject",
          targetId: "subject-b",
        }),
      }),
      // Cross-year references used to be caught by a check that existed only on
      // the legacy write path. They are now caught by compiling the definition
      // against what this account owns in *this* year, which is one check for
      // every reference a card can hold rather than one for the three the old
      // columns could name.
    ).rejects.toThrow("Invalid widget definition");
  });

  test("requires an exact destination sibling order while preserving re-parenting", async () => {
    const createSubject = async (name: string, parentId: string | null) => {
      const created = await api.subjects.create({
        yearId: "year-a",
        name,
        parentId,
      });
      if (!created) throw new Error(`Failed to create ${name}`);
      return created;
    };

    const sourceParent = await createSubject("Move source", null);
    const destinationParent = await createSubject("Move destination", null);
    const sourceFirst = await createSubject(
      "Move source first",
      sourceParent.id,
    );
    const sourceSecond = await createSubject(
      "Move source second",
      sourceParent.id,
    );
    const destinationExisting = await createSubject(
      "Move destination existing",
      destinationParent.id,
    );

    await expect(
      api.subjects.move({
        subjectId: sourceFirst.id,
        parentId: sourceParent.id,
        siblingIds: [sourceFirst.id, sourceFirst.id, sourceSecond.id],
      }),
    ).rejects.toThrow("A subject can only appear once");

    await expect(
      api.subjects.move({
        subjectId: sourceFirst.id,
        parentId: sourceParent.id,
        siblingIds: [sourceSecond.id],
      }),
    ).rejects.toThrow("The moved subject must appear in its sibling order");

    await expect(
      api.subjects.move({
        subjectId: sourceFirst.id,
        parentId: sourceParent.id,
        siblingIds: [sourceFirst.id],
      }),
    ).rejects.toThrow(
      "Sibling order must include every destination sibling exactly once",
    );

    await expect(
      api.subjects.move({
        subjectId: sourceFirst.id,
        parentId: sourceParent.id,
        siblingIds: [sourceFirst.id, sourceSecond.id, destinationExisting.id],
      }),
    ).rejects.toThrow("Every reordered subject must share the same parent");

    await expect(
      api.subjects.move({
        subjectId: sourceFirst.id,
        parentId: sourceParent.id,
        siblingIds: [sourceFirst.id, sourceSecond.id, "subject-b"],
      }),
    ).rejects.toThrow("Sibling subject must belong to the same year");

    await expect(
      api.subjects.move({
        subjectId: sourceFirst.id,
        parentId: "subject-b",
        siblingIds: [sourceFirst.id],
      }),
    ).rejects.toThrow("Parent subject must belong to the same year");

    await api.subjects.move({
      subjectId: sourceFirst.id,
      parentId: sourceParent.id,
      siblingIds: [sourceSecond.id, sourceFirst.id],
    });
    const sourceAfterReorder = await database
      .select({
        id: schema.subjects.id,
        parentId: schema.subjects.parentId,
        sortOrder: schema.subjects.sortOrder,
      })
      .from(schema.subjects)
      .where(eq(schema.subjects.parentId, sourceParent.id));
    const sourceById = new Map(
      sourceAfterReorder.map((subject) => [subject.id, subject]),
    );
    expect(sourceById.get(sourceSecond.id)).toMatchObject({
      parentId: sourceParent.id,
      sortOrder: 0,
    });
    expect(sourceById.get(sourceFirst.id)).toMatchObject({
      parentId: sourceParent.id,
      sortOrder: 1,
    });

    await api.subjects.move({
      subjectId: sourceFirst.id,
      parentId: destinationParent.id,
      siblingIds: [destinationExisting.id, sourceFirst.id],
    });
    const destinationAfterMove = await database
      .select({
        id: schema.subjects.id,
        parentId: schema.subjects.parentId,
        sortOrder: schema.subjects.sortOrder,
      })
      .from(schema.subjects)
      .where(eq(schema.subjects.parentId, destinationParent.id));
    const destinationById = new Map(
      destinationAfterMove.map((subject) => [subject.id, subject]),
    );
    expect(destinationById.get(destinationExisting.id)).toMatchObject({
      parentId: destinationParent.id,
      sortOrder: 0,
    });
    expect(destinationById.get(sourceFirst.id)).toMatchObject({
      parentId: destinationParent.id,
      sortOrder: 1,
    });
    expect(
      new Set(destinationAfterMove.map((subject) => subject.sortOrder)).size,
    ).toBe(destinationAfterMove.length);
  });

  test("rejects forged mixed-scope ordering and keeps sort positions unique", async () => {
    await expect(
      api.years.reorder({ yearIds: ["year-a", "year-a"] }),
    ).rejects.toThrow("A year can only appear once");
    await expect(
      api.periods.reorder({ periodIds: ["period-a", "period-b"] }),
    ).rejects.toThrow("Every reordered period must belong to the same year");

    const goalA = await api.goals.create({
      yearId: "year-a",
      name: "Goal A",
      targetRatio: 0.7,
    });
    const goalB = await api.goals.create({
      yearId: "year-b",
      name: "Goal B",
      targetRatio: 0.8,
    });
    await expect(
      api.goals.reorder({ goalIds: [goalA?.id ?? "", goalB?.id ?? ""] }),
    ).rejects.toThrow("Every reordered goal must belong to the same year");

    const cardA = await api.cards.create({
      yearId: "year-a",
      ...metricCard("average"),
    });
    const cardB = await api.cards.create({
      yearId: "year-b",
      ...metricCard("average"),
    });
    await expect(
      api.cards.reorder({
        cardIds: [cardA?.id ?? "", cardB?.id ?? ""],
        expectedCardIds: [cardA?.id ?? "", cardB?.id ?? ""],
      }),
    ).rejects.toThrow("Every reordered card must share a year and surface");

    // A layout is the whole surface or it is nothing. Naming one card of several
    // used to be accepted and the rest appended, which renumbered every card the
    // caller had not mentioned — a hidden card losing the position it was hidden
    // at, and coming back somewhere it had never been once unhidden.
    await api.cards.create({ yearId: "year-a", ...metricCard("gradeCount") });
    const before = await api.cards.list({ yearId: "year-a" });
    expect(before.length).toBeGreaterThan(1);
    await expect(
      api.cards.reorder({
        cardIds: [cardA?.id ?? ""],
        expectedCardIds: [cardA?.id ?? ""],
      }),
    ).rejects.toThrow("A reorder must list every card on the surface");
    expect(
      (await api.cards.list({ yearId: "year-a" })).map((c) => c.id),
    ).toEqual(before.map((c) => c.id));

    // Computed against an arrangement that has since moved on: refused, and the
    // stored order is left exactly as it was. Without this the last write wins
    // unconditionally, and "last" is decided by the network rather than by the
    // person — two devices reordering from the same point, and the loser's refetch
    // shows them their own gesture undone with no explanation.
    await expect(
      api.cards.reorder({
        cardIds: [...before.map((c) => c.id)].reverse(),
        expectedCardIds: [...before.map((c) => c.id)].reverse(),
      }),
    ).rejects.toThrow("This layout was changed somewhere else");
    expect(
      (await api.cards.list({ yearId: "year-a" })).map((c) => c.id),
    ).toEqual(before.map((c) => c.id));

    await api.cards.reorder({
      cardIds: [...before.map((c) => c.id)].reverse(),
      expectedCardIds: before.map((c) => c.id),
    });
    const cards = await api.cards.list({ yearId: "year-a" });
    expect(cards.map((c) => c.id)).toEqual(
      [...before.map((c) => c.id)].reverse(),
    );
    expect(new Set(cards.map((card) => card.sortOrder)).size).toBe(
      cards.length,
    );
  });

  test("keeps the insights layout isolated and restores explicit recommendations", async () => {
    const first = await api.cards.create({
      yearId: "year-a",
      surface: "insights",
      ...metricCard("average", { surface: "insights" }),
    });
    const second = await api.cards.create({
      yearId: "year-a",
      surface: "insights",
      ...metricCard("gradeCount", { surface: "insights" }),
    });

    const insights = await api.cards.list({
      yearId: "year-a",
      surface: "insights",
    });
    expect(insights.map((card) => card.id)).toEqual([first?.id, second?.id]);
    expect(
      (await api.cards.list({ yearId: "year-a", surface: "overview" })).some(
        (card) => card.id === first?.id || card.id === second?.id,
      ),
    ).toBe(false);

    await api.cards.reorder({
      cardIds: [second?.id ?? "", first?.id ?? ""],
      expectedCardIds: [first?.id ?? "", second?.id ?? ""],
    });
    expect(
      (await api.cards.list({ yearId: "year-a", surface: "insights" })).map(
        (card) => card.id,
      ),
    ).toEqual([second?.id, first?.id]);

    const recommended = await api.cards.reset({
      yearId: "year-a",
      surface: "insights",
    });
    expect(recommended).toHaveLength(4);
    expect(
      recommended.map(
        (card) => cardSemanticsFromDefinition(card.definitionJson).metric,
      ),
    ).toEqual(["average", "distribution", "mostImproved", "consistency"]);
    expect(recommended.every((card) => card.definitionVersion === 1)).toBe(
      true,
    );

    for (const card of recommended) {
      await api.cards.delete({ cardId: card.id });
    }
    expect(
      await api.cards.list({ yearId: "year-a", surface: "insights" }),
    ).toEqual([]);
  });

  test("canonicalizes V1 widgets and rejects forged references", async () => {
    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["subject-a", "subject-a"],
      includeDescendants: true,
    };
    definition.query.window = { kind: "period", periodId: "period-a" };
    definition.visualization.mark = "bar";
    definition.visualization.options = {
      kind: "bar",
      orientation: "horizontal",
      stacked: false,
      cornerRadius: 3,
    };

    const created = await api.cards.create({
      yearId: "year-a",
      surface: "insights",
      definitionVersion: 1,
      definitionJson: definition,
      span: 3,
      title: "Owned widget",
    });
    // The semantics are read back *off the definition*, not off columns beside it:
    // the row no longer carries a second copy to compare against.
    expect(cardSemanticsFromDefinition(created!.definitionJson)).toMatchObject({
      metric: "average",
      targetKind: "subject",
      targetId: "subject-a",
      display: "chart",
    });
    expect(created).toMatchObject({
      surface: "insights",
      span: 3,
      title: "Owned widget",
      definitionVersion: 1,
      definitionJson: {
        apiVersion: 1,
        query: {
          scope: { kind: "subjects", subjectIds: ["subject-a"] },
          window: { kind: "period", periodId: "period-a" },
        },
      },
    });
    expect((await api.snapshot.get({ yearId: "year-a" })).cards).toContainEqual(
      expect.objectContaining({
        id: created?.id,
        definitionVersion: 1,
        definitionJson: expect.objectContaining({ apiVersion: 1 }),
      }),
    );

    const foreign = createWidgetDefinition("insights");
    foreign.query.scope = {
      kind: "subjects",
      subjectIds: ["subject-b"],
      includeDescendants: false,
    };
    foreign.query.window = { kind: "period", periodId: "period-b" };
    await expect(
      api.cards.create({
        yearId: "year-a",
        surface: "insights",
        definitionVersion: 1,
        definitionJson: foreign,
      }),
    ).rejects.toThrow("Invalid widget definition");

    await expect(
      api.cards.create({
        yearId: "year-a",
        surface: "insights",
        definitionVersion: 1,
        definitionJson: definition,
        metric: "average",
      } as never),
    ).rejects.toThrow();
  });

  test("stores one representation, and renaming leaves it alone", async () => {
    // A card described by `metric` / `targetKind` / `display` used to be accepted
    // and stored as *only* those columns, with no definition at all. Both clients
    // then had to read two representations, and the one they fell back to was
    // drawn by a different renderer — so the same card could look like two
    // different cards depending on which screen resolved it. There is now one
    // shape in, and the API refuses the other rather than half-supporting it.
    await expect(
      api.cards.create({
        yearId: "year-a",
        metric: "average",
        targetKind: "subject",
        targetId: "subject-a",
        display: "sparkline",
      } as never),
    ).rejects.toThrow();

    const sparkline = await api.cards.create({
      yearId: "year-a",
      ...metricCard("average", {
        targetKind: "subject",
        targetId: "subject-a",
        display: "sparkline",
      }),
    });
    // A sparkline is a filled line with its apparatus stripped, which is what the
    // card renderer reads to draw a reading over scenery rather than a chart.
    expect(sparkline?.definitionJson).toMatchObject({
      visualization: {
        mark: "area",
        axes: {
          x: { visible: false, grid: false },
          y: { visible: false, grid: false },
        },
      },
    });
    // One representation, and this is the case that argued for it. The row used to
    // carry a projection of the definition — `metric`, `targetKind`, `targetId`,
    // `display` — and `display` came back as "chart" for the card above, not
    // "sparkline": the projection knew nothing about axes, so it could not tell a
    // sparkline from a chart. It is gone; the keys are not on the row at all.
    for (const key of ["metric", "targetKind", "targetId", "display"]) {
      expect(sparkline, key).not.toHaveProperty(key);
    }
    expect(sparkline).toMatchObject({ definitionVersion: 1 });
    // Derived on demand it is still lossy in exactly the same way, which is why
    // nothing stores it: the projection is a convenience, never an authority.
    expect(
      cardSemanticsFromDefinition(sparkline!.definitionJson),
    ).toMatchObject({
      metric: "average",
      targetKind: "subject",
      targetId: "subject-a",
      display: "chart",
    });

    const renamed = await api.cards.update({
      cardId: sparkline?.id ?? "",
      title: "Renamed without rewriting semantics",
    });
    expect(renamed).toMatchObject({
      title: "Renamed without rewriting semantics",
      definitionVersion: 1,
    });
    expect(renamed?.definitionJson).toEqual(sparkline?.definitionJson);

    // A semantics patch has to carry the whole definition; there is no
    // field-level back door into it any more.
    await expect(
      api.cards.update({
        cardId: sparkline?.id ?? "",
        display: "chart",
      } as never),
    ).rejects.toThrow();

    const formula = createWidgetDefinition("insights");
    formula.analysis.measure = {
      kind: "formula",
      formula: {
        kind: "binary",
        operation: "multiply",
        left: { kind: "aggregate", operation: "mean", field: "ratio" },
        right: { kind: "literal", value: 100 },
      },
      valueType: "percent",
    };
    const formulaCard = await api.cards.create({
      yearId: "year-a",
      surface: "insights",
      definitionVersion: 1,
      definitionJson: formula,
    });
    expect(formulaCard).toMatchObject({
      surface: "insights",
      definitionVersion: 1,
      definitionJson: {
        analysis: { measure: { kind: "formula", valueType: "percent" } },
      },
    });

    await expect(
      api.cards.update({
        cardId: formulaCard?.id ?? "",
        display: "value",
      } as never),
    ).rejects.toThrow();
    expect(
      await api.cards.list({ yearId: "year-a", surface: "insights" }),
    ).toContainEqual(
      expect.objectContaining({
        id: formulaCard?.id,
        definitionVersion: 1,
        definitionJson: expect.objectContaining({
          analysis: expect.objectContaining({
            measure: expect.objectContaining({ kind: "formula" }),
          }),
        }),
      }),
    );

    await expect(
      api.cards.update({ cardId: formulaCard?.id ?? "", surface: "overview" }),
    ).rejects.toThrow("A card cannot change surface through an update");
    const unchanged = await api.cards.list({
      yearId: "year-a",
      surface: "insights",
    });
    expect(unchanged.some((card) => card.id === formulaCard?.id)).toBe(true);
  });

  /*
   * There was a test here for a card with no definition — `definitionVersion` and
   * `definitionJson` both null, its meaning carried by the `metric` / `target_kind`
   * / `target_id` / `display` columns — checking that a presentation-only update
   * left that meaning intact.
   *
   * The row it described can no longer be written. Those columns are gone and the
   * definition is `NOT NULL`, so "a card whose meaning lives somewhere else" is not
   * a state to defend against; it is a state the schema refuses. Deleting the test
   * is the point of the change, not a gap left by it.
   */

  test("keeps derived widget references current and cascades every reference kind", async () => {
    const yearId = "year-widget-references";
    await database.insert(schema.years).values({
      id: yearId,
      name: "Widget references",
      startsAt: new Date("2027-09-01T00:00:00.000Z"),
      endsAt: new Date("2028-07-01T00:00:00.000Z"),
      userId: "user-a",
    });
    await database.insert(schema.subjects).values(
      ["one", "two", "three"].map((suffix, sortOrder) => ({
        id: `subject-ref-${suffix}`,
        name: `Reference ${suffix}`,
        sortOrder,
        yearId,
        userId: "user-a",
      })),
    );
    await database.insert(schema.periods).values([
      {
        id: "period-ref-one",
        name: "Reference period one",
        startAt: new Date("2027-09-01T00:00:00.000Z"),
        endAt: new Date("2028-01-01T00:00:00.000Z"),
        yearId,
        userId: "user-a",
      },
      {
        id: "period-ref-two",
        name: "Reference period two",
        startAt: new Date("2028-01-02T00:00:00.000Z"),
        endAt: new Date("2028-07-01T00:00:00.000Z"),
        sortOrder: 1,
        yearId,
        userId: "user-a",
      },
    ]);
    await database.insert(schema.customAverages).values({
      id: "average-ref-one",
      name: "Reference average",
      yearId,
      userId: "user-a",
    });
    await database.insert(schema.goals).values({
      id: "goal-ref-one",
      name: "Reference goal",
      targetRatio: 0.75,
      yearId,
      userId: "user-a",
    });

    const multiSubject = createWidgetDefinition("insights");
    multiSubject.query.scope = {
      kind: "subjects",
      subjectIds: ["subject-ref-one", "subject-ref-two"],
      includeDescendants: false,
    };
    multiSubject.query.window = {
      kind: "period",
      periodId: "period-ref-one",
    };
    const multiCard = await api.cards.create({
      yearId,
      surface: "insights",
      definitionVersion: 1,
      definitionJson: multiSubject,
    });
    expect(
      await database
        .select({
          kind: schema.dashboardCardReferences.kind,
          referenceId: schema.dashboardCardReferences.referenceId,
        })
        .from(schema.dashboardCardReferences)
        .where(eq(schema.dashboardCardReferences.cardId, multiCard?.id ?? "")),
    ).toEqual(
      expect.arrayContaining([
        { kind: "subject", referenceId: "subject-ref-one" },
        { kind: "subject", referenceId: "subject-ref-two" },
        { kind: "period", referenceId: "period-ref-one" },
      ]),
    );

    multiSubject.query.scope.subjectIds = [
      "subject-ref-one",
      "subject-ref-three",
    ];
    multiSubject.query.window = { kind: "whole-year" };
    await database.$client.executeMultiple(`
      CREATE TRIGGER reject_test_widget_reference
      BEFORE INSERT ON dashboard_card_references
      WHEN NEW.referenceId = 'subject-ref-three'
      BEGIN
        SELECT RAISE(ABORT, 'forced widget reference failure');
      END;
    `);
    try {
      await expect(
        api.cards.update({
          cardId: multiCard?.id ?? "",
          definitionVersion: 1,
          definitionJson: multiSubject,
        }),
      ).rejects.toThrow("forced widget reference failure");
    } finally {
      await database.$client.executeMultiple(
        "DROP TRIGGER IF EXISTS reject_test_widget_reference;",
      );
    }
    expect(
      (
        await database
          .select({ referenceId: schema.dashboardCardReferences.referenceId })
          .from(schema.dashboardCardReferences)
          .where(eq(schema.dashboardCardReferences.cardId, multiCard?.id ?? ""))
      )
        .map((row) => row.referenceId)
        .sort(),
    ).toEqual(["period-ref-one", "subject-ref-one", "subject-ref-two"]);
    expect(
      (await api.cards.list({ yearId, surface: "insights" })).find(
        (card) => card.id === multiCard?.id,
      )?.definitionJson?.query.window,
    ).toEqual({ kind: "period", periodId: "period-ref-one" });
    await api.cards.update({
      cardId: multiCard?.id ?? "",
      definitionVersion: 1,
      definitionJson: multiSubject,
    });
    expect(
      (
        await database
          .select({ referenceId: schema.dashboardCardReferences.referenceId })
          .from(schema.dashboardCardReferences)
          .where(eq(schema.dashboardCardReferences.cardId, multiCard?.id ?? ""))
      ).map((row) => row.referenceId),
    ).toEqual(["subject-ref-one", "subject-ref-three"]);
    await database
      .delete(schema.subjects)
      .where(eq(schema.subjects.id, "subject-ref-two"));
    expect(
      await api.cards.list({ yearId, surface: "insights" }),
    ).toContainEqual(expect.objectContaining({ id: multiCard?.id }));
    await database
      .delete(schema.subjects)
      .where(eq(schema.subjects.id, "subject-ref-three"));
    expect(
      await api.cards.list({ yearId, surface: "insights" }),
    ).not.toContainEqual(expect.objectContaining({ id: multiCard?.id }));
    expect(
      await database
        .select()
        .from(schema.dashboardCardReferences)
        .where(eq(schema.dashboardCardReferences.cardId, multiCard?.id ?? "")),
    ).toHaveLength(0);

    const periodDefinition = createWidgetDefinition("insights");
    periodDefinition.query.window = {
      kind: "period",
      periodId: "period-ref-two",
    };
    const periodCard = await api.cards.create({
      yearId,
      surface: "insights",
      definitionVersion: 1,
      definitionJson: periodDefinition,
    });
    await database
      .delete(schema.periods)
      .where(eq(schema.periods.id, "period-ref-two"));
    expect(
      await api.cards.list({ yearId, surface: "insights" }),
    ).not.toContainEqual(expect.objectContaining({ id: periodCard?.id }));

    const averageDefinition = createWidgetDefinition("overview");
    averageDefinition.query.scope = {
      kind: "custom-average",
      averageId: "average-ref-one",
    };
    const averageCard = await api.cards.create({
      yearId,
      definitionVersion: 1,
      definitionJson: averageDefinition,
    });
    await database
      .delete(schema.customAverages)
      .where(eq(schema.customAverages.id, "average-ref-one"));
    expect(await api.cards.list({ yearId })).not.toContainEqual(
      expect.objectContaining({ id: averageCard?.id }),
    );

    const goalDefinition = createWidgetDefinition("overview");
    goalDefinition.analysis.measure = {
      kind: "metric",
      metric: "goalProgress",
      goalId: "goal-ref-one",
    };
    goalDefinition.visualization.mark = "gauge";
    goalDefinition.visualization.options = {
      kind: "gauge",
      showValue: true,
      thickness: 10,
    };
    const goalCard = await api.cards.create({
      yearId,
      definitionVersion: 1,
      definitionJson: goalDefinition,
    });
    expect(
      await database
        .select()
        .from(schema.dashboardCardReferences)
        .where(
          and(
            eq(schema.dashboardCardReferences.cardId, goalCard?.id ?? ""),
            eq(schema.dashboardCardReferences.kind, "goal"),
          ),
        ),
    ).toHaveLength(1);
    await database
      .delete(schema.goals)
      .where(eq(schema.goals.id, "goal-ref-one"));
    expect(await api.cards.list({ yearId })).not.toContainEqual(
      expect.objectContaining({ id: goalCard?.id }),
    );
  });

  test("reports affected widgets and prunes V1 multi-subject cards on API deletion", async () => {
    const yearId = "year-subject-widget-delete";
    await database.insert(schema.years).values({
      id: yearId,
      name: "Subject widget deletion",
      startsAt: new Date("2029-09-01T00:00:00.000Z"),
      endsAt: new Date("2030-07-01T00:00:00.000Z"),
      userId: "user-a",
    });
    await database.insert(schema.subjects).values([
      {
        id: "subject-widget-removed",
        name: "Removed subject",
        yearId,
        userId: "user-a",
      },
      {
        id: "subject-widget-retained",
        name: "Retained subject",
        yearId,
        userId: "user-a",
      },
      {
        id: "subject-widget-removed-child",
        name: "Removed child subject",
        parentId: "subject-widget-removed",
        yearId,
        userId: "user-a",
      },
    ]);

    const multiDefinition = createWidgetDefinition("insights");
    multiDefinition.query.scope = {
      kind: "subjects",
      subjectIds: ["subject-widget-removed-child", "subject-widget-retained"],
      includeDescendants: false,
    };
    const multiCard = await api.cards.create({
      yearId,
      surface: "insights",
      definitionVersion: 1,
      definitionJson: multiDefinition,
    });

    const singleDefinition = createWidgetDefinition("overview");
    singleDefinition.query.scope = {
      kind: "subjects",
      subjectIds: ["subject-widget-removed"],
      includeDescendants: false,
    };
    const singleCard = await api.cards.create({
      yearId,
      definitionVersion: 1,
      definitionJson: singleDefinition,
    });
    const subjectCard = await api.cards.create({
      yearId,
      ...metricCard("average", {
        targetKind: "subject",
        targetId: "subject-widget-removed-child",
      }),
    });

    await expect(
      api.subjects.impact({ subjectId: "subject-widget-removed" }),
    ).resolves.toMatchObject({ descendants: 1, grades: 0, widgets: 3 });

    await api.subjects.delete({
      subjectId: "subject-widget-removed",
      promoteChildren: false,
    });

    const retained = (
      await api.cards.list({ yearId, surface: "insights" })
    ).find((card) => card.id === multiCard?.id);
    // The surviving subject, read off the definition — which is where the card's
    // target lives now, and where it always was authoritatively.
    expect(cardSemanticsFromDefinition(retained!.definitionJson)).toMatchObject(
      {
        targetKind: "subject",
        targetId: "subject-widget-retained",
      },
    );
    expect(retained).toMatchObject({
      id: multiCard?.id,
      definitionVersion: 1,
      definitionJson: {
        query: {
          scope: {
            kind: "subjects",
            subjectIds: ["subject-widget-retained"],
          },
        },
      },
    });
    expect(
      await database
        .select({
          kind: schema.dashboardCardReferences.kind,
          referenceId: schema.dashboardCardReferences.referenceId,
        })
        .from(schema.dashboardCardReferences)
        .where(eq(schema.dashboardCardReferences.cardId, multiCard?.id ?? "")),
    ).toEqual([{ kind: "subject", referenceId: "subject-widget-retained" }]);

    const overviewCards = await api.cards.list({ yearId });
    expect(overviewCards).not.toContainEqual(
      expect.objectContaining({ id: singleCard?.id }),
    );
    expect(overviewCards).not.toContainEqual(
      expect.objectContaining({ id: subjectCard?.id }),
    );
  });

  test("loads composite components only for the requested year", async () => {
    await api.grades.create({
      name: "Foreign composite",
      value: 0,
      outOf: 20,
      passedAt: new Date("2026-11-01T00:00:00.000Z"),
      subjectId: "subject-b",
      periodId: "period-b",
      components: [
        {
          name: "Foreign component",
          value: 18,
          outOf: 20,
          coefficient: 1,
        },
      ],
    });

    const snapshot = await api.snapshot.get({ yearId: "year-a" });
    const componentNames = snapshot.subjects.flatMap((subject) =>
      subject.grades.flatMap((grade) =>
        grade.components.map((component) => component.name),
      ),
    );
    expect(componentNames).not.toContain("Foreign component");
  });

  test("replaces periods without severing retained grade associations", async () => {
    await expect(
      api.periods.replaceAll({
        yearId: "year-a",
        periods: [
          {
            periodId: "period-b",
            name: "Foreign period",
            startAt: new Date("2025-09-01T00:00:00.000Z"),
            endAt: new Date("2026-01-01T00:00:00.000Z"),
            isCumulative: false,
          },
        ],
      }),
    ).rejects.toThrow("Every retained period must belong to this year");

    const grade = await api.grades.create({
      name: "Period-preserving grade",
      value: 13,
      outOf: 20,
      passedAt: new Date("2025-11-01T00:00:00.000Z"),
      subjectId: "subject-a",
      periodId: "period-a",
    });

    const replaced = await api.periods.replaceAll({
      yearId: "year-a",
      periods: [
        {
          periodId: "period-a",
          name: "First semester",
          startAt: new Date("2025-09-01T00:00:00.000Z"),
          endAt: new Date("2026-01-31T23:59:59.000Z"),
          isCumulative: false,
        },
        {
          name: "Second semester",
          startAt: new Date("2026-02-01T00:00:00.000Z"),
          endAt: new Date("2026-07-01T00:00:00.000Z"),
          isCumulative: true,
        },
      ],
    });

    expect(replaced[0]).toMatchObject({
      id: "period-a",
      name: "First semester",
      sortOrder: 0,
    });
    expect(replaced[1]).toMatchObject({
      name: "Second semester",
      sortOrder: 1,
    });

    const [storedGrade] = await database
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.id, grade?.id ?? ""));
    expect(storedGrade?.periodId).toBe("period-a");
  });

  test("protects grade-bearing subjects and deletes a complete subtree", async () => {
    await api.grades.create({
      name: "Existing grade",
      value: 14,
      outOf: 20,
      passedAt: new Date("2026-01-01T00:00:00.000Z"),
      subjectId: "subject-a",
      periodId: "period-a",
    });

    await expect(
      api.subjects.update({ subjectId: "subject-a", kind: "category" }),
    ).rejects.toThrow("A subject with grades cannot become a category");

    await database.insert(schema.subjects).values([
      {
        id: "tree-root",
        name: "Root",
        yearId: "year-a",
        userId: "user-a",
      },
      {
        id: "tree-child",
        name: "Child",
        parentId: "tree-root",
        yearId: "year-a",
        userId: "user-a",
      },
      {
        id: "tree-grandchild",
        name: "Grandchild",
        parentId: "tree-child",
        yearId: "year-a",
        userId: "user-a",
      },
    ]);
    await api.grades.create({
      name: "Nested grade",
      value: 16,
      outOf: 20,
      passedAt: new Date("2026-02-01T00:00:00.000Z"),
      subjectId: "tree-grandchild",
      periodId: "period-a",
    });

    const result = await api.subjects.delete({
      subjectId: "tree-root",
      promoteChildren: false,
    });
    expect(result.deleted).toBe(3);

    const remainingSubjects = await database.select().from(schema.subjects);
    const remainingGrades = await database.select().from(schema.grades);
    expect(
      remainingSubjects.some((subject) => subject.id.startsWith("tree-")),
    ).toBe(false);
    expect(remainingGrades.some((grade) => grade.name === "Nested grade")).toBe(
      false,
    );
  });

  test("rolls back composite grades when a component write fails", async () => {
    const original = await api.grades.create({
      name: "Stable composite",
      value: 0,
      outOf: 20,
      passedAt: new Date("2026-03-01T00:00:00.000Z"),
      subjectId: "subject-a",
      periodId: "period-a",
      components: [
        {
          name: "Original part",
          value: 12,
          outOf: 20,
          coefficient: 1,
        },
      ],
    });

    await database.$client.executeMultiple(`
      CREATE TRIGGER reject_test_grade_component
      BEFORE INSERT ON grade_components
      BEGIN
        SELECT RAISE(ABORT, 'forced component failure');
      END;
    `);

    try {
      await expect(
        api.grades.create({
          name: "Atomic composite",
          value: 0,
          outOf: 20,
          passedAt: new Date("2026-03-01T00:00:00.000Z"),
          subjectId: "subject-a",
          periodId: "period-a",
          components: [
            {
              name: "Part A",
              value: 15,
              outOf: 20,
              coefficient: 1,
            },
            {
              name: "Part B",
              value: 10,
              outOf: 20,
              coefficient: 1,
            },
          ],
        }),
      ).rejects.toThrow();
      await expect(
        api.grades.update({
          gradeId: original.id,
          name: "Should roll back",
          components: [
            {
              name: "Replacement part",
              value: 18,
              outOf: 20,
              coefficient: 1,
            },
          ],
        }),
      ).rejects.toThrow();
    } finally {
      await database.$client.executeMultiple(
        "DROP TRIGGER IF EXISTS reject_test_grade_component;",
      );
    }

    const stored = await database
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.name, "Atomic composite"));
    expect(stored).toHaveLength(0);

    const unchanged = await api.grades.get({ gradeId: original.id });
    expect(unchanged).toMatchObject({
      name: "Stable composite",
      value: 12,
      components: [{ name: "Original part", value: 12 }],
    });
  });

  test("rolls back custom averages when an entry write fails", async () => {
    const original = await api.averages.create({
      name: "Stable average",
      yearId: "year-a",
      entries: [
        {
          subjectId: "subject-a",
          coefficient: 2,
          includeChildren: false,
        },
      ],
    });

    await database.$client.executeMultiple(`
      CREATE TRIGGER reject_test_average_entry
      BEFORE INSERT ON custom_average_entries
      BEGIN
        SELECT RAISE(ABORT, 'forced average entry failure');
      END;
    `);

    try {
      await expect(
        api.averages.create({
          name: "Atomic average",
          yearId: "year-a",
          entries: [
            {
              subjectId: "subject-a",
              coefficient: 1,
              includeChildren: true,
            },
          ],
        }),
      ).rejects.toThrow();
      await expect(
        api.averages.update({
          averageId: original.id,
          name: "Should roll back",
          entries: [
            {
              subjectId: "subject-a",
              coefficient: 5,
              includeChildren: true,
            },
          ],
        }),
      ).rejects.toThrow();
    } finally {
      await database.$client.executeMultiple(
        "DROP TRIGGER IF EXISTS reject_test_average_entry;",
      );
    }

    const stored = await database
      .select()
      .from(schema.customAverages)
      .where(eq(schema.customAverages.name, "Atomic average"));
    expect(stored).toHaveLength(0);

    const unchanged = await api.averages.get({ averageId: original.id });
    expect(unchanged).toMatchObject({
      name: "Stable average",
      entries: [
        {
          subjectId: "subject-a",
          coefficient: 2,
          includeChildren: false,
        },
      ],
    });
  });

  test("creates a dedicated custom-average card once and cleans it up with the average", async () => {
    await database.$client.executeMultiple(`
      CREATE TRIGGER reject_test_average_card
      BEFORE INSERT ON dashboard_cards
      WHEN NEW.title = 'Atomic card failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced average card failure');
      END;
    `);
    try {
      await expect(
        api.averages.create({
          name: "Atomic card failure",
          yearId: "year-a",
          addDashboardCard: true,
          entries: [{ subjectId: "subject-a" }],
        }),
      ).rejects.toThrow("forced average card failure");
    } finally {
      await database.$client.executeMultiple(
        "DROP TRIGGER IF EXISTS reject_test_average_card;",
      );
    }
    expect(
      await database
        .select()
        .from(schema.customAverages)
        .where(eq(schema.customAverages.name, "Atomic card failure")),
    ).toHaveLength(0);

    const created = await api.averages.create({
      name: "Dashboard science",
      yearId: "year-a",
      addDashboardCard: true,
      entries: [
        {
          subjectId: "subject-a",
          coefficient: null,
          includeChildren: false,
        },
      ],
    });

    expect(created).toMatchObject({ name: "Dashboard science", isMain: false });
    const createdCards = await cardsForAverage(created?.id ?? "");
    // The row carries the presentation; the definition carries the meaning.
    expect(createdCards).toMatchObject([
      {
        surface: "overview",
        span: 2,
        title: "Dashboard science",
        hidden: false,
        yearId: "year-a",
      },
    ]);
    expect(
      createdCards.map((card) =>
        cardSemanticsFromDefinition(card.definitionJson),
      ),
    ).toMatchObject([
      {
        metric: "average",
        targetKind: "custom",
        targetId: created?.id,
        display: "chart",
      },
    ]);
    expect(
      await database
        .select()
        .from(schema.dashboardCardReferences)
        .where(
          and(
            eq(schema.dashboardCardReferences.kind, "custom-average"),
            eq(schema.dashboardCardReferences.referenceId, created?.id ?? ""),
          ),
        ),
    ).toHaveLength(1);

    // A historical bit in storage must not bring back headline substitution.
    await database
      .update(schema.customAverages)
      .set({ isMain: true })
      .where(eq(schema.customAverages.id, created?.id ?? ""));
    expect(
      await api.averages.get({ averageId: created?.id ?? "" }),
    ).toMatchObject({
      isMain: false,
    });
    expect(await api.averages.list({ yearId: "year-a" })).toContainEqual(
      expect.objectContaining({ id: created?.id, isMain: false }),
    );
    expect(await api.snapshot.get({ yearId: "year-a" })).toMatchObject({
      customAverages: expect.arrayContaining([
        expect.objectContaining({ id: created?.id, isMain: false }),
      ]),
    });

    await api.averages.delete({ averageId: created?.id ?? "" });
    expect(await cardsForAverage(created?.id ?? "")).toHaveLength(0);

    const longName = "A".repeat(64);
    const longNamed = await api.averages.create({
      name: longName,
      yearId: "year-a",
      addDashboardCard: true,
      entries: [{ subjectId: "subject-a" }],
    });
    const [longNamedCard] = await cardsForAverage(longNamed?.id ?? "");
    expect(longNamed?.name).toBe(longName);
    expect(longNamedCard?.title).toBe("A".repeat(48));
    await api.averages.delete({ averageId: longNamed?.id ?? "" });
  });

  test("rolls back year creation and dashboard reset when card seeding fails", async () => {
    const existingCard = await api.cards.create({
      yearId: "year-a",
      surface: "overview",
      ...metricCard("average"),
    });

    await database.$client.executeMultiple(`
      CREATE TRIGGER reject_test_dashboard_card
      BEFORE INSERT ON dashboard_cards
      BEGIN
        SELECT RAISE(ABORT, 'forced dashboard card failure');
      END;
    `);

    try {
      await expect(
        api.years.create({
          name: "Atomic year",
          startsAt: new Date("2027-09-01T00:00:00.000Z"),
          endsAt: new Date("2028-07-01T00:00:00.000Z"),
        }),
      ).rejects.toThrow();
      await expect(
        api.cards.reset({ yearId: "year-a", surface: "overview" }),
      ).rejects.toThrow();
    } finally {
      await database.$client.executeMultiple(
        "DROP TRIGGER IF EXISTS reject_test_dashboard_card;",
      );
    }

    const yearsAfterFailure = await database
      .select()
      .from(schema.years)
      .where(eq(schema.years.name, "Atomic year"));
    expect(yearsAfterFailure).toHaveLength(0);

    const cardsAfterFailure = await api.cards.list({
      yearId: "year-a",
      surface: "overview",
    });
    expect(cardsAfterFailure.some((card) => card.id === existingCard?.id)).toBe(
      true,
    );
  });
});

describe("account-safe reads", () => {
  test("announcement history exposes only current or previously dismissed messages", async () => {
    const now = new Date();
    await database.insert(schema.announcements).values([
      {
        id: "announcement-current",
        title: "Current",
        message: "Visible now",
        active: true,
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 60_000),
        createdByUserId: "user-a",
      },
      {
        id: "announcement-draft",
        title: "Draft",
        message: "Never public",
        active: false,
        createdByUserId: "user-a",
      },
      {
        id: "announcement-future",
        title: "Future",
        message: "Not yet public",
        active: true,
        startsAt: new Date(now.getTime() + 60_000),
        createdByUserId: "user-a",
      },
      {
        id: "announcement-expired",
        title: "Expired",
        message: "Visible because it was dismissed",
        active: true,
        endsAt: new Date(now.getTime() - 60_000),
        createdByUserId: "user-a",
      },
    ]);
    await database.insert(schema.announcementViews).values({
      id: "view-expired",
      announcementId: "announcement-expired",
      userId: "user-a",
    });

    const history = await api.announcements.history();
    expect(history.map((announcement) => announcement.id).sort()).toEqual([
      "announcement-current",
      "announcement-expired",
    ]);
    expect(
      history.find(
        (announcement) => announcement.id === "announcement-current",
      ),
    ).toMatchObject({ currentlyActive: true, dismissed: false });
    expect(
      history.find(
        (announcement) => announcement.id === "announcement-expired",
      ),
    ).toMatchObject({ currentlyActive: false, dismissed: true });
    await expect(
      api.announcements.dismiss({ announcementId: "announcement-draft" }),
    ).rejects.toThrow("Active announcement not found");
  });

  test("preset announcements follow only linked memberships without leaking history", async () => {
    await database
      .insert(schema.presetDefinitions)
      .values([
        {
          id: "announcement-preset-a",
          name: "Announcement preset A",
          createdByUserId: "admin-a",
        },
        {
          id: "announcement-preset-b",
          name: "Announcement preset B",
          createdByUserId: "admin-a",
        },
      ])
      .onConflictDoNothing();
    await database.insert(schema.years).values([
      {
        id: "announcement-year-a",
        name: "Announcement year A",
        startsAt: new Date("2025-09-01T00:00:00.000Z"),
        endsAt: new Date("2026-07-01T00:00:00.000Z"),
        userId: "user-a",
      },
      {
        id: "announcement-year-b",
        name: "Announcement year B",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: "user-a",
      },
    ]);
    await database.insert(schema.yearPresetMemberships).values([
      {
        yearId: "announcement-year-a",
        presetId: "announcement-preset-a",
        appliedVersion: 1,
        mode: "linked",
        userId: "user-a",
      },
      {
        yearId: "announcement-year-b",
        presetId: "announcement-preset-b",
        appliedVersion: 1,
        mode: "linked",
        userId: "user-a",
      },
    ]);
    await database.insert(schema.announcements).values([
      {
        id: "announcement-global-scope",
        title: "Everyone",
        message: "Global remains visible",
        audience: "global",
        createdByUserId: "admin-a",
      },
      {
        id: "announcement-for-preset-a",
        title: "Only A",
        message: "Preset A members",
        audience: "preset",
        createdByUserId: "admin-a",
      },
      {
        id: "announcement-for-preset-b",
        title: "Only B",
        message: "Preset B members",
        audience: "preset",
        createdByUserId: "admin-a",
      },
      {
        id: "announcement-without-target",
        title: "Invalid legacy target",
        message: "Nobody should see this",
        audience: "preset",
        createdByUserId: "admin-a",
      },
    ]);
    await database.insert(schema.announcementPresetTargets).values([
      {
        announcementId: "announcement-for-preset-a",
        presetId: "announcement-preset-a",
      },
      {
        announcementId: "announcement-for-preset-b",
        presetId: "announcement-preset-b",
      },
    ]);

    const visibleForA = await api.announcements.active({
      yearId: "announcement-year-a",
    });
    expect(visibleForA.map((announcement) => announcement.id)).toContain(
      "announcement-global-scope",
    );
    expect(visibleForA.map((announcement) => announcement.id)).toContain(
      "announcement-for-preset-a",
    );
    expect(
      visibleForA.find(
        (announcement) => announcement.id === "announcement-for-preset-a",
      ),
    ).not.toHaveProperty("audience");
    expect(
      visibleForA.find(
        (announcement) => announcement.id === "announcement-for-preset-a",
      ),
    ).not.toHaveProperty("createdByUserId");
    expect(visibleForA.map((announcement) => announcement.id)).not.toContain(
      "announcement-for-preset-b",
    );
    expect(visibleForA.map((announcement) => announcement.id)).not.toContain(
      "announcement-without-target",
    );

    const visibleForAnyYear = await api.announcements.active();
    expect(visibleForAnyYear.map((announcement) => announcement.id)).toContain(
      "announcement-for-preset-a",
    );
    expect(visibleForAnyYear.map((announcement) => announcement.id)).toContain(
      "announcement-for-preset-b",
    );
    await database
      .update(schema.years)
      .set({ archivedAt: new Date() })
      .where(eq(schema.years.id, "announcement-year-b"));
    expect(
      (await api.announcements.active()).map((announcement) => announcement.id),
    ).not.toContain("announcement-for-preset-b");
    await expect(
      api.announcements.dismiss({
        announcementId: "announcement-for-preset-a",
        yearId: "announcement-year-b",
      }),
    ).rejects.toThrow("Active announcement not found");

    await api.announcements.dismiss({
      announcementId: "announcement-for-preset-a",
      yearId: "announcement-year-a",
    });
    expect(
      (
        await api.announcements.history({
          yearId: "announcement-year-a",
        })
      ).map((announcement) => announcement.id),
    ).toContain("announcement-for-preset-a");

    await database
      .update(schema.yearPresetMemberships)
      .set({
        mode: "customized",
        detachedAt: new Date(),
        detachedReason: "configuration_changed",
      })
      .where(eq(schema.yearPresetMemberships.yearId, "announcement-year-a"));
    expect(
      (
        await api.announcements.history({
          yearId: "announcement-year-a",
        })
      ).map((announcement) => announcement.id),
    ).not.toContain("announcement-for-preset-a");

    await database
      .delete(schema.announcements)
      .where(
        inArray(schema.announcements.id, [
          "announcement-global-scope",
          "announcement-for-preset-a",
          "announcement-for-preset-b",
          "announcement-without-target",
        ]),
      );
    await database
      .delete(schema.years)
      .where(
        inArray(schema.years.id, [
          "announcement-year-a",
          "announcement-year-b",
        ]),
      );
    await database
      .delete(schema.presetDefinitions)
      .where(
        inArray(schema.presetDefinitions.id, [
          "announcement-preset-a",
          "announcement-preset-b",
        ]),
      );
  });

  test("admin announcement mutations validate and atomically replace preset targets", async () => {
    await database
      .insert(schema.presetDefinitions)
      .values({
        id: "announcement-preset-b",
        name: "Announcement preset B",
        createdByUserId: "admin-a",
      })
      .onConflictDoNothing();
    const created = await adminApi.admin.createAnnouncement({
      title: "Targeted",
      message: "For preset B",
      audience: "preset",
      presetIds: ["announcement-preset-b"],
      tone: "info",
      active: true,
      startsAt: null,
      endsAt: null,
    });
    expect(created).toMatchObject({
      audience: "preset",
      presetIds: ["announcement-preset-b"],
    });

    const toggled = await adminApi.admin.updateAnnouncement({
      announcementId: created.id,
      active: false,
    });
    expect(toggled).toMatchObject({
      active: false,
      audience: "preset",
      presetIds: ["announcement-preset-b"],
    });

    const updated = await adminApi.admin.updateAnnouncement({
      announcementId: created.id,
      audience: "global",
    });
    expect(updated).toMatchObject({ audience: "global", presetIds: [] });
    const remainingTargets = await database
      .select()
      .from(schema.announcementPresetTargets)
      .where(eq(schema.announcementPresetTargets.announcementId, created.id));
    expect(remainingTargets).toHaveLength(0);

    await expect(
      adminApi.admin.createAnnouncement({
        title: "Missing target",
        message: "Must fail",
        audience: "preset",
        presetIds: [],
        tone: "info",
        active: true,
        startsAt: null,
        endsAt: null,
      }),
    ).rejects.toThrow("needs at least one preset target");
    await expect(
      adminApi.admin.createAnnouncement({
        title: "Unknown target",
        message: "Must fail",
        audience: "preset",
        presetIds: ["missing-preset"],
        tone: "info",
        active: true,
        startsAt: null,
        endsAt: null,
      }),
    ).rejects.toThrow("do not exist");

    await adminApi.admin.deleteAnnouncement({ announcementId: created.id });
    await database
      .delete(schema.presetDefinitions)
      .where(eq(schema.presetDefinitions.id, "announcement-preset-b"));
  });

  test("exports every reconstructible application relation without auth secrets", async () => {
    const exported = await api.preferences.exportData();
    expect(exported).toHaveProperty("periods");
    expect(exported).toHaveProperty("gradeComponents");
    expect(exported).toHaveProperty("customAverageEntries");
    expect(exported).toHaveProperty("dashboardCards");
    expect(exported).toHaveProperty("yearReviewViews");
    expect(exported).toHaveProperty("announcementViews");
    expect(exported).toHaveProperty("createdAnnouncementPresetTargets");
    expect(exported).toHaveProperty("feedback");

    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("token-a");
    expect(serialized).not.toContain('passwordHashes":');
    expect(exported.authentication.excludedForSecurity).toContain(
      "passwordHashes",
    );
  });
});

describe("the simplified social model", () => {
  test("friends see real averages under the owner's locks", async () => {
    // user-a shares year-a explicitly: today falls between the two fixture
    // years, so the automatic fallback would pick the more recent empty one.
    await api.social.sharing.update({
      handle: "test-user",
      sharedYearId: "year-a",
      shareGeneralAverage: true,
      shareSubjectsMode: "all",
    });
    const grade = await api.grades.create({
      name: "Shared with friends",
      value: 15,
      outOf: 20,
      passedAt: new Date("2026-04-01T00:00:00.000Z"),
      subjectId: "subject-a",
      periodId: "period-a",
    });

    // Two intents make a friendship: the request meets an acceptance.
    const sent = await managedApi.social.friends.request({
      handle: "test-user",
    });
    expect(sent.status).toBe("pending");
    const requests = await api.social.friends.requests();
    expect(requests.incoming).toHaveLength(1);
    await api.social.friends.respond({
      requestId: requests.incoming[0]!.id,
      accept: true,
    });

    const friends = await managedApi.social.friends.list();
    expect(friends.friends).toHaveLength(1);
    expect(friends.friends[0]).toMatchObject({
      name: "Test User",
      handle: "test-user",
      sharesSomething: true,
    });

    // The friend reads the exact figure the owner's own preview announces —
    // earlier tests may have left other grades in the year, so the value is
    // asserted against the engine rather than against a constant.
    const mine = await api.social.sharing.get();
    expect(mine.preview?.generalAverage).not.toBeNull();
    const expectedAverage = mine.preview!.generalAverage as number;
    const detail = await managedApi.social.friends.detail({
      friendshipId: friends.friends[0]!.friendshipId,
    });
    expect(detail.sharing).not.toBeNull();
    expect(detail.sharing!.generalAverage).toBeCloseTo(expectedAverage, 9);
    expect(detail.sharing!.year.scale).toBe(20);
    expect(detail.sharing!.subjects.map((subject) => subject.name)).toContain(
      "Subject A",
    );

    // Locking the general average keeps subjects; locking everything hides all.
    await api.social.sharing.update({ shareGeneralAverage: false });
    const partial = await managedApi.social.friends.detail({
      friendshipId: friends.friends[0]!.friendshipId,
    });
    expect(partial.sharing!.generalAverage).toBeNull();
    expect(partial.sharing!.subjects.length).toBeGreaterThan(0);

    await api.social.sharing.update({ shareSubjectsMode: "none" });
    const closed = await managedApi.social.friends.detail({
      friendshipId: friends.friends[0]!.friendshipId,
    });
    expect(closed.sharing).toBeNull();

    // Restore for the group half of the scenario.
    await api.social.sharing.update({
      shareGeneralAverage: true,
      shareSubjectsMode: "all",
    });

    // Preserved legacy groups are inert until the owner configures a class.
    await database.insert(schema.socialGroups).values({
      id: "legacy-class",
      ownerUserId: "user-a",
      name: "Legacy class",
      kind: "friends",
    });
    await database.insert(schema.groupMemberships).values({
      id: "legacy-class-owner",
      groupId: "legacy-class",
      userId: "user-a",
      role: "owner",
      shareAverage: true,
    });
    await database.insert(schema.groupMemberships).values({
      id: "legacy-class-member",
      groupId: "legacy-class",
      userId: "managed-user",
      role: "member",
    });
    const [defaultPrivateMembership] = await database
      .select({ shareAverage: schema.groupMemberships.shareAverage })
      .from(schema.groupMemberships)
      .where(eq(schema.groupMemberships.id, "legacy-class-member"));
    expect(defaultPrivateMembership?.shareAverage).toBe(false);
    expect(
      (await api.social.groups.get({ groupId: "legacy-class" })).setupRequired,
    ).toBe(true);
    await expect(
      api.social.groups.invitations.create({ groupId: "legacy-class" }),
    ).rejects.toThrow("Configure the class");
    await api.social.groups.configureClass({
      groupId: "legacy-class",
      templateYearId: "year-a",
    });
    const configuredLegacy = await api.social.groups.get({
      groupId: "legacy-class",
    });
    expect(configuredLegacy.setupRequired).toBe(false);
    expect(configuredLegacy.viewer.shareAverage).toBe(false);
    await expect(
      api.social.groups.configureClass({
        groupId: "legacy-class",
        templateYearId: "year-b",
      }),
    ).rejects.toThrow("already has an academic template");
    expect(
      (await api.social.groups.get({ groupId: "legacy-class" })).classTemplate
        ?.yearName,
    ).toBe("Year A");
    await api.social.groups.delete({ groupId: "legacy-class" });

    await database
      .update(schema.years)
      .set({ archivedAt: new Date() })
      .where(eq(schema.years.id, "year-a"));
    await expect(
      api.social.groups.create({
        name: "Archived template",
        template: { mode: "year", yearId: "year-a" },
      }),
    ).rejects.toThrow("template year");
    await database
      .update(schema.years)
      .set({ archivedAt: null })
      .where(eq(schema.years.id, "year-a"));

    const customBuilder = await api.social.groups.create({
      name: "Custom builder class",
      template: {
        mode: "builder",
        year: {
          name: "Builder year",
          startsAt: new Date("2039-09-01T00:00:00.000Z"),
          endsAt: new Date("2040-07-01T00:00:00.000Z"),
          scale: 20,
          defaultOutOf: 20,
          passingRatio: 0.5,
          decimals: 2,
        },
        presetId: null,
        configuration: {
          subjects: [
            {
              key: "builder-subject",
              name: "Builder subject",
              kind: "subject",
              isMain: true,
              coefficient: 1,
              children: [],
            },
          ],
          averages: [],
        },
        periods: {
          mode: "custom",
          items: [
            {
              name: "Teaching block",
              startsAt: new Date("2039-09-01T12:00:00.000Z"),
              endsAt: new Date("2040-01-15T00:00:00.000Z"),
              isCumulative: false,
            },
            {
              name: "Final block",
              startsAt: new Date("2040-01-15T00:00:00.000Z"),
              endsAt: new Date("2040-07-01T12:00:00.000Z"),
              isCumulative: true,
            },
          ],
        },
      },
    });
    const customBuilderDetail = await api.social.groups.get({
      groupId: customBuilder.id,
    });
    expect(customBuilderDetail.viewer).toMatchObject({
      yearId: customBuilder.yearId,
      yearStatus: "connected",
      shareAverage: false,
    });
    expect(customBuilderDetail.classTemplate?.source).toBe("custom");
    expect(customBuilderDetail.availableSubjectOptions).toContainEqual({
      key: "builder-subject",
      name: "Builder subject",
    });
    const customPeriods = await database
      .select()
      .from(schema.periods)
      .where(eq(schema.periods.yearId, customBuilder.yearId));
    expect(customPeriods).toHaveLength(2);
    expect(
      customPeriods
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((period) => ({
          name: period.name,
          startsAt: period.startAt.toISOString(),
          endsAt: period.endAt.toISOString(),
          isCumulative: period.isCumulative,
          sortOrder: period.sortOrder,
        })),
    ).toEqual([
      {
        name: "Teaching block",
        startsAt: "2039-09-01T00:00:00.000Z",
        endsAt: "2040-01-15T00:00:00.000Z",
        isCumulative: false,
        sortOrder: 0,
      },
      {
        name: "Final block",
        startsAt: "2040-01-15T00:00:00.000Z",
        endsAt: "2040-07-01T00:00:00.000Z",
        isCumulative: true,
        sortOrder: 1,
      },
    ]);
    await database
      .update(schema.subjects)
      .set({ name: "Edited after class creation" })
      .where(eq(schema.subjects.yearId, customBuilder.yearId));
    const immutableBuilder = await api.social.groups.get({
      groupId: customBuilder.id,
    });
    expect(immutableBuilder.viewer.yearStatus).toBe("incompatible");
    expect(immutableBuilder.availableSubjectOptions).toContainEqual({
      key: "builder-subject",
      name: "Builder subject",
    });
    await api.social.groups.delete({ groupId: customBuilder.id });
    await database
      .delete(schema.years)
      .where(eq(schema.years.id, customBuilder.yearId));

    const invalidPeriodBuilder = {
      year: {
        name: "Invalid period builder year",
        startsAt: new Date("2042-09-01T00:00:00.000Z"),
        endsAt: new Date("2043-07-01T00:00:00.000Z"),
      },
      configuration: {
        subjects: [
          {
            key: "invalid-period-subject",
            name: "Invalid period subject",
            kind: "subject" as const,
            isMain: true,
            coefficient: 1,
            children: [],
          },
        ],
        averages: [],
      },
    };
    await expect(
      api.social.groups.create({
        name: "Out-of-bounds period class",
        template: {
          mode: "builder",
          ...invalidPeriodBuilder,
          periods: {
            mode: "custom",
            items: [
              {
                name: "Too early",
                startsAt: new Date("2042-08-01T00:00:00.000Z"),
                endsAt: new Date("2042-12-01T00:00:00.000Z"),
              },
            ],
          },
        },
      }),
    ).rejects.toThrow("within the academic year");
    await expect(
      api.social.groups.create({
        name: "Overlapping period class",
        template: {
          mode: "builder",
          ...invalidPeriodBuilder,
          periods: {
            mode: "custom",
            items: [
              {
                name: "First",
                startsAt: new Date("2042-09-01T00:00:00.000Z"),
                endsAt: new Date("2043-02-01T00:00:00.000Z"),
              },
              {
                name: "Overlap",
                startsAt: new Date("2043-01-01T00:00:00.000Z"),
                endsAt: new Date("2043-07-01T00:00:00.000Z"),
              },
            ],
          },
        },
      }),
    ).rejects.toThrow("ordered and cannot overlap");
    expect(
      await database
        .select({ id: schema.years.id })
        .from(schema.years)
        .where(eq(schema.years.name, invalidPeriodBuilder.year.name)),
    ).toHaveLength(0);

    const [presetSummary] = await api.presets.list();
    const preset = await api.presets.get({ presetId: presetSummary!.id });
    const presetBuilder = await api.social.groups.create({
      name: "Preset builder class",
      template: {
        mode: "builder",
        year: {
          name: "Preset builder year",
          startsAt: new Date("2040-09-01T00:00:00.000Z"),
          endsAt: new Date("2041-07-01T00:00:00.000Z"),
          scale: 20,
          defaultOutOf: 20,
          passingRatio: 0.5,
          decimals: 2,
        },
        presetId: preset.id,
        configuration: preset.configuration,
        periods: { mode: "template", templateId: "none", names: [] },
      },
    });
    const presetBuilderDetail = await api.social.groups.get({
      groupId: presetBuilder.id,
    });
    expect(presetBuilderDetail.classTemplate?.source).toBe("preset");
    expect(presetBuilderDetail.viewer.yearStatus).toBe("connected");
    await api.social.groups.delete({ groupId: presetBuilder.id });
    await database
      .delete(schema.years)
      .where(eq(schema.years.id, presetBuilder.yearId));

    await database.$client.execute(
      "CREATE TRIGGER fail_class_builder BEFORE INSERT ON subjects WHEN NEW.name = 'Rollback subject' BEGIN SELECT RAISE(ABORT, 'forced class builder failure'); END",
    );
    await expect(
      api.social.groups.create({
        name: "Rolled back builder class",
        template: {
          mode: "builder",
          year: {
            name: "Rolled back builder year",
            startsAt: new Date("2041-09-01T00:00:00.000Z"),
            endsAt: new Date("2042-07-01T00:00:00.000Z"),
            scale: 20,
            defaultOutOf: 20,
            passingRatio: 0.5,
            decimals: 2,
          },
          configuration: {
            subjects: [
              {
                key: "rollback-subject",
                name: "Rollback subject",
                kind: "subject",
                isMain: true,
                coefficient: 1,
                children: [],
              },
            ],
            averages: [],
          },
          presetId: null,
          periods: { mode: "template", templateId: "none", names: [] },
        },
      }),
    ).rejects.toThrow("forced class builder failure");
    await database.$client.execute("DROP TRIGGER fail_class_builder");
    expect(
      await database
        .select({ id: schema.years.id })
        .from(schema.years)
        .where(eq(schema.years.name, "Rolled back builder year")),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: schema.socialGroups.id })
        .from(schema.socialGroups)
        .where(eq(schema.socialGroups.name, "Rolled back builder class")),
    ).toHaveLength(0);

    // Groups: one link, one switch, real values, no minimum head-count.
    const group = await api.social.groups.create({
      name: "Integration group",
      description: "",
      template: { mode: "year", yearId: "year-a" },
    });
    const invitation = await api.social.groups.invitations.create({
      groupId: group.id,
    });
    const preview = await managedApi.social.groups.invitations.preview({
      token: invitation.token,
    });
    expect(preview.group.name).toBe("Integration group");
    expect(preview.group.setupRequired).toBe(false);
    expect(preview.group.classTemplate?.subjectCount).toBeGreaterThan(0);
    const joined = await managedApi.social.groups.invitations.accept({
      token: invitation.token,
      year: { mode: "copy", name: "Managed class year" },
    });
    expect(joined.joined).toBe(true);
    expect(joined.yearId).toBeTruthy();

    await managedApi.social.groups.setSharing({
      groupId: group.id,
      shareAverage: true,
    });
    await database
      .update(schema.years)
      .set({ archivedAt: new Date() })
      .where(eq(schema.years.id, joined.yearId ?? ""));
    const archivedConnection = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(archivedConnection.viewer.yearStatus).toBe("incompatible");
    expect(
      archivedConnection.members.find((member) => member.role === "member")
        ?.figures,
    ).toHaveLength(0);
    await expect(
      managedApi.social.groups.selectYear({
        groupId: group.id,
        yearId: joined.yearId ?? "",
      }),
    ).rejects.toThrow("not compatible");
    await database
      .update(schema.years)
      .set({ archivedAt: null })
      .where(eq(schema.years.id, joined.yearId ?? ""));
    await managedApi.social.groups.selectYear({
      groupId: group.id,
      yearId: joined.yearId ?? "",
    });

    // Links issued by non-owners before invitations became owner-only must
    // not remain valid after a group is configured as a class.
    const legacyMemberToken = "legacy-member-invitation";
    const { hashOpaque } = await import("../lib/social-policy");
    await database.insert(schema.groupInvitations).values({
      id: "legacy-member-invitation",
      groupId: group.id,
      createdByUserId: "managed-user",
      tokenHash: hashOpaque(legacyMemberToken),
      tokenPrefix: legacyMemberToken.slice(0, 8),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    });
    await expect(
      adminApi.social.groups.invitations.preview({ token: legacyMemberToken }),
    ).rejects.toThrow("Invitation");
    await expect(
      adminApi.social.groups.invitations.accept({
        token: legacyMemberToken,
        year: { mode: "copy" },
      }),
    ).rejects.toThrow("Invitation");

    // A fresh group carries one board: the general average.
    const detailForMember = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(detailForMember.members).toHaveLength(2);
    expect(detailForMember.comparisons).toHaveLength(1);
    expect(detailForMember.comparisons[0]?.kind).toBe("general");
    const generalId = detailForMember.comparisons[0]!.id;
    const owner = detailForMember.members.find(
      (member) => member.role === "owner",
    );
    expect(owner?.shareAverage).toBe(false);
    expect(owner?.figures).toHaveLength(0);
    const joiner = detailForMember.members.find(
      (member) => member.role === "member",
    );
    expect(joiner?.figures).toHaveLength(0);
    expect(joiner?.yearStatus).toBe("connected");
    expect(detailForMember.sharingCount).toBe(0);
    expect(detailForMember.availableSubjectOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Subject A" })]),
    );

    // Year selection is personal, not an owner operation, and revokes any
    // previous sharing choice until the member opts in again.
    await managedApi.social.groups.setSharing({
      groupId: group.id,
      shareAverage: true,
    });
    await managedApi.social.groups.selectYear({
      groupId: group.id,
      yearId: joined.yearId ?? "",
    });
    expect(
      (await managedApi.social.groups.get({ groupId: group.id })).viewer
        .shareAverage,
    ).toBe(false);
    await expect(
      managedApi.social.groups.invitations.create({ groupId: group.id }),
    ).rejects.toThrow("owner access required");

    await api.social.groups.setSharing({
      groupId: group.id,
      shareAverage: true,
    });
    const sharing = await api.social.groups.get({ groupId: group.id });
    const ownerGeneral = sharing.members
      .find((member) => member.role === "owner")
      ?.figures.find((figure) => figure.scopeId === generalId);
    expect(ownerGeneral?.average).toBeCloseTo(expectedAverage, 9);
    expect(ownerGeneral?.gradeCount).toBeGreaterThan(0);

    const subjectOption = sharing.availableSubjectOptions.find(
      (subject) => subject.name === "Subject A",
    );
    await api.social.groups.comparisons.add({
      groupId: group.id,
      kind: "subject",
      subjectKey: subjectOption?.key,
    });
    const copiedSubjects = await database
      .select()
      .from(schema.subjects)
      .where(eq(schema.subjects.yearId, joined.yearId ?? ""));
    const copiedPeriods = await database
      .select()
      .from(schema.periods)
      .where(eq(schema.periods.yearId, joined.yearId ?? ""));
    const copiedSubject = copiedSubjects.find(
      (subject) => subject.name === "Subject A",
    );
    await managedApi.grades.create({
      name: "Class copy grade",
      value: 16,
      outOf: 20,
      passedAt: new Date("2026-04-02T00:00:00.000Z"),
      subjectId: copiedSubject?.id ?? "",
      periodId: copiedPeriods[0]?.id ?? null,
    });
    await managedApi.social.groups.setSharing({
      groupId: group.id,
      shareAverage: true,
    });
    await expect(
      api.social.groups.comparisons.add({
        groupId: group.id,
        kind: "subject",
        subjectKey: subjectOption?.key,
      }),
    ).rejects.toThrow();
    await expect(
      api.social.groups.comparisons.add({
        groupId: group.id,
        kind: "median",
      }),
    ).rejects.toThrow("only compare general and subject");
    const configured = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(configured.kind).toBe("class");
    expect(configured.comparisons.map((entry) => entry.kind)).toEqual([
      "general",
      "subject",
    ]);
    const configuredOwner = configured.members.find(
      (member) => member.role === "owner",
    );
    const configuredMember = configured.members.find(
      (member) => member.role === "member",
    );
    expect(configuredOwner?.figures).toHaveLength(2);
    expect(configuredMember?.figures).toHaveLength(2);
    for (const comparison of configured.comparisons) {
      const figure = configuredOwner?.figures.find(
        (entry) => entry.scopeId === comparison.id,
      );
      // Every fixture grade sits under Subject A, so all four boards have a
      // real value for the owner.
      expect(figure?.average).not.toBeNull();
    }
    const subjectComparisonId = configured.comparisons.find(
      (comparison) => comparison.kind === "subject",
    )?.id;
    expect(
      configuredMember?.figures.find(
        (figure) => figure.scopeId === subjectComparisonId,
      )?.average,
    ).toBeCloseTo(0.8, 9);
    // Adoption creates another independent copy and connects it; it never
    // overwrites the previously connected year or copies grades.
    const adopted = await managedApi.social.groups.adoptSetup({
      groupId: group.id,
      name: "Adopted year",
    });
    expect(adopted.yearId).toBeTruthy();
    const adoptedSubjects = await database
      .select()
      .from(schema.subjects)
      .where(eq(schema.subjects.yearId, adopted.yearId));
    expect(adoptedSubjects).toHaveLength(
      configured.classTemplate?.subjectCount ?? 0,
    );
    expect(adoptedSubjects.map((subject) => subject.name)).toContain(
      "Subject A",
    );
    expect(adoptedSubjects[0]?.userId).toBe("managed-user");
    expect(
      await database
        .select()
        .from(schema.grades)
        .where(eq(schema.grades.yearId, adopted.yearId)),
    ).toHaveLength(0);
    const connectedAfterAdopt = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(connectedAfterAdopt.viewer.yearId).toBe(adopted.yearId);
    expect(connectedAfterAdopt.viewer.yearStatus).toBe("connected");
    expect(connectedAfterAdopt.viewer.shareAverage).toBe(false);
    await database
      .delete(schema.years)
      .where(eq(schema.years.id, adopted.yearId));
    const afterLinkedYearDelete = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(afterLinkedYearDelete.viewer.yearId).toBeNull();
    expect(afterLinkedYearDelete.viewer.yearStatus).toBe("not_connected");

    // The one lock a member has: their own switch.
    await api.social.groups.setSharing({
      groupId: group.id,
      shareAverage: false,
    });
    const afterLock = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(
      afterLock.members.find((member) => member.role === "owner")?.figures,
    ).toHaveLength(0);
    expect(afterLock.sharingCount).toBe(0);

    // Administrative hold hides every figure without deleting anything.
    await api.social.groups.setSharing({
      groupId: group.id,
      shareAverage: true,
    });
    await adminApi.admin.setSocialGroupState({
      groupId: group.id,
      state: "frozen",
    });
    const frozen = await managedApi.social.groups.get({ groupId: group.id });
    expect(frozen.state).toBe("frozen");
    expect(frozen.members.every((member) => member.figures.length === 0)).toBe(
      true,
    );
    await adminApi.admin.setSocialGroupState({
      groupId: group.id,
      state: "active",
    });

    const overview = await adminApi.admin.socialOverview();
    expect(overview.friendships).toBeGreaterThanOrEqual(1);
    expect(overview.groups).toBeGreaterThanOrEqual(1);

    // Blocking severs the friendship in both directions.
    await managedApi.social.blocks.create({ userId: "user-a" });
    const afterBlock = await managedApi.social.friends.list();
    expect(afterBlock.friends).toHaveLength(0);
    const blocks = await managedApi.social.blocks.list();
    expect(blocks).toHaveLength(1);
    await managedApi.social.blocks.remove({ blockId: blocks[0]!.id });

    // Leave the world as this test found it.
    await api.social.groups.delete({ groupId: group.id });
    await database.delete(schema.years).where(
      inArray(
        schema.years.id,
        [joined.yearId].filter((yearId): yearId is string => Boolean(yearId)),
      ),
    );
    await api.grades.delete({ gradeId: grade.id });
  });
});

describe("admin account safety and parity", () => {
  test("prevents an administrator from demoting, suspending or deleting themself", async () => {
    await expect(
      adminApi.admin.setRole({ userId: "admin-a", role: "user" }),
    ).rejects.toThrow("cannot demote your own account");
    await expect(
      adminApi.admin.setBanned({
        userId: "admin-a",
        banned: true,
        reason: "self",
        expiresAt: null,
      }),
    ).rejects.toThrow("cannot suspend your own account");
    await expect(
      adminApi.admin.deleteUser({
        userId: "admin-a",
        confirmation: "admin-a",
      }),
    ).rejects.toThrow("cannot delete your own account");
  });

  test("manages role, timed suspension and Mokattam from authoritative procedures", async () => {
    await adminApi.admin.setRole({ userId: "managed-user", role: "admin" });
    const expiry = new Date(Date.now() + 86_400_000);
    const suspended = await adminApi.admin.setBanned({
      userId: "managed-user",
      banned: true,
      reason: "Safety review",
      expiresAt: expiry,
    });
    expect(suspended).toMatchObject({
      banned: true,
      banReason: "Safety review",
    });
    expect(Math.floor((suspended.banExpires?.getTime() ?? 0) / 1000)).toBe(
      Math.floor(expiry.getTime() / 1000),
    );

    await adminApi.admin.grantTheme({
      userId: "managed-user",
      theme: "mokattam",
      available: true,
    });
    const listed = await adminApi.admin.users({
      query: "managed@example.com",
      limit: 20,
      offset: 0,
    });
    expect(listed.users[0]).toMatchObject({
      role: "admin",
      banned: true,
      mokattamThemeAvailable: true,
    });

    await adminApi.admin.setBanned({
      userId: "managed-user",
      banned: false,
      reason: null,
      expiresAt: null,
    });
  });

  test("returns the richer overview and deep user read model", async () => {
    const overview = await adminApi.admin.overview({ days: 30 });
    expect(overview).toHaveProperty("health.adoptionRate");
    expect(overview).toHaveProperty("distribution.roles");
    expect(overview).toHaveProperty("topUsers");
    expect(overview).toHaveProperty("subjectActivity");

    const detail = await adminApi.admin.user({
      userId: "user-a",
      days: 90,
    });
    expect(detail).toHaveProperty("gradeStats.averageOn20");
    expect(detail).toHaveProperty("recentGrades");
    expect(detail).toHaveProperty("sessions");
    expect(detail).toHaveProperty("providers");
  });
});

describe("managed preset lifecycle", () => {
  const baseConfiguration = {
    subjects: [
      {
        key: "science",
        name: "Science",
        kind: "category" as const,
        isMain: true,
        coefficient: 1,
        children: [
          {
            key: "mathematics",
            name: "Mathematics",
            kind: "subject" as const,
            isMain: true,
            coefficient: 4,
            children: [],
          },
          {
            key: "physics",
            name: "Physics",
            kind: "subject" as const,
            isMain: false,
            coefficient: 3,
            children: [],
          },
        ],
      },
    ],
    averages: [
      {
        key: "science-average",
        name: "Science average",
        isMain: true,
        entries: [
          {
            subjectKey: "science",
            coefficient: null,
            includeChildren: true,
          },
        ],
      },
    ],
  };

  test("bootstraps all seven legacy presets without overwriting them", async () => {
    const catalog = await api.presets.list();
    expect(catalog).toHaveLength(7);
    expect(catalog.every((preset) => preset.version === 1)).toBe(true);
    expect(catalog.every((preset) => preset.subjectCount > 0)).toBe(true);
  });

  test("sets up a complete year atomically and retries with the same key", async () => {
    const preset = (await api.presets.list())[0];
    expect(preset).toBeDefined();
    const request = {
      idempotencyKey: "retry-safe-setup-1",
      year: {
        name: "Retry-safe year",
        startsAt: new Date("2028-09-01T00:00:00.000Z"),
        endsAt: new Date("2029-07-01T00:00:00.000Z"),
        scale: 20,
        defaultOutOf: 20,
        passingRatio: 0.5,
        decimals: 2,
      },
      presetId: preset?.id ?? null,
      periodTemplateId: "trimesters" as const,
      periodNames: ["Term 1", "Term 2", "Term 3"],
    };

    await database.$client.execute(
      "CREATE TRIGGER fail_setup_subject BEFORE INSERT ON subjects WHEN NEW.yearId NOT IN ('year-a', 'year-b') BEGIN SELECT RAISE(ABORT, 'forced setup failure'); END",
    );
    await expect(api.presets.setupYear(request)).rejects.toThrow();
    await database.$client.execute("DROP TRIGGER fail_setup_subject");

    expect(
      await api.presets.setupYearStatus({
        idempotencyKey: request.idempotencyKey,
      }),
    ).toBeNull();

    const afterFailure = await database
      .select()
      .from(schema.years)
      .where(eq(schema.years.name, "Retry-safe year"));
    expect(afterFailure).toHaveLength(0);
    const setupRowsAfterFailure = await database
      .select()
      .from(schema.yearSetupRequests)
      .where(
        eq(schema.yearSetupRequests.idempotencyKey, request.idempotencyKey),
      );
    expect(setupRowsAfterFailure).toHaveLength(0);

    const created = await api.presets.setupYear(request);
    const resolved = await api.presets.setupYearStatus({
      idempotencyKey: request.idempotencyKey,
    });
    const retried = await api.presets.setupYear(request);
    expect(resolved?.year).toEqual(created);
    expect(retried.id).toBe(created.id);
    expect(
      await managedApi.presets.setupYearStatus({
        idempotencyKey: request.idempotencyKey,
      }),
    ).toBeNull();

    const [createdSubjects, createdPeriods, createdCards, membership] =
      await Promise.all([
        database
          .select()
          .from(schema.subjects)
          .where(eq(schema.subjects.yearId, created.id)),
        database
          .select()
          .from(schema.periods)
          .where(eq(schema.periods.yearId, created.id)),
        database
          .select()
          .from(schema.dashboardCards)
          .where(eq(schema.dashboardCards.yearId, created.id)),
        database
          .select()
          .from(schema.yearPresetMemberships)
          .where(eq(schema.yearPresetMemberships.yearId, created.id)),
      ]);
    expect(createdSubjects.length).toBeGreaterThan(0);
    expect(
      createdSubjects.every((subject) => Boolean(subject.presetNodeKey)),
    ).toBe(true);
    expect(createdPeriods).toHaveLength(3);
    expect(createdCards.length).toBeGreaterThan(0);
    expect(membership[0]).toMatchObject({ mode: "linked", appliedVersion: 1 });

    await expect(
      api.presets.setupYear({
        ...request,
        year: { ...request.year, name: "Different payload" },
      }),
    ).rejects.toThrow("already used with different options");
  });

  test("keeps stable preset references and blocks replacement before any user data loss", async () => {
    const presetId = "INTEGRATION_REAPPLY_REFERENCES";
    await adminApi.presets.admin.create({
      id: presetId,
      name: "Reference-safe curriculum",
      description: "Reference preservation coverage",
      tags: ["test"],
      featured: false,
      configuration: baseConfiguration,
    });
    const year = await api.presets.setupYear({
      idempotencyKey: "reference-safe-reapply-setup",
      year: {
        name: "Reference-safe year",
        startsAt: new Date("2039-09-01T00:00:00.000Z"),
        endsAt: new Date("2040-07-01T00:00:00.000Z"),
      },
      presetId,
      periodTemplateId: "none",
      periodNames: [],
    });
    const [configuredSubjectsBefore, configuredAveragesBefore] =
      await Promise.all([
        database
          .select()
          .from(schema.subjects)
          .where(eq(schema.subjects.yearId, year.id)),
        database
          .select()
          .from(schema.customAverages)
          .where(eq(schema.customAverages.yearId, year.id)),
      ]);
    const mathematics = configuredSubjectsBefore.find(
      (subject) => subject.presetNodeKey === "mathematics",
    );
    const physics = configuredSubjectsBefore.find(
      (subject) => subject.presetNodeKey === "physics",
    );
    const scienceAverage = configuredAveragesBefore.find(
      (average) => average.presetNodeKey === "science-average",
    );
    expect(mathematics).toBeDefined();
    expect(physics).toBeDefined();
    expect(scienceAverage).toBeDefined();
    expect(mathematics?.isMain).toBe(true);
    expect(scienceAverage?.isMain).toBe(false);

    const mathematicsGoal = await api.goals.create({
      yearId: year.id,
      name: "Mathematics target",
      kind: "subject",
      referenceId: mathematics?.id,
      targetRatio: 0.8,
    });
    const averageGoal = await api.goals.create({
      yearId: year.id,
      name: "Science target",
      kind: "custom",
      referenceId: scienceAverage?.id,
      targetRatio: 0.75,
    });
    const physicsGoal = await api.goals.create({
      yearId: year.id,
      name: "Physics target",
      kind: "subject",
      referenceId: physics?.id,
      targetRatio: 0.7,
    });
    const mathematicsCard = await api.cards.create({
      yearId: year.id,
      ...metricCard("average", {
        targetKind: "subject",
        targetId: mathematics?.id ?? null,
      }),
    });
    const averageCard = await api.cards.create({
      yearId: year.id,
      ...metricCard("average", {
        targetKind: "custom",
        targetId: scienceAverage?.id ?? null,
      }),
    });
    const physicsCard = await api.cards.create({
      yearId: year.id,
      ...metricCard("average", {
        targetKind: "subject",
        targetId: physics?.id ?? null,
      }),
    });
    const multiSubjectDefinition = createWidgetDefinition("overview");
    multiSubjectDefinition.query.scope = {
      kind: "subjects",
      subjectIds: [mathematics?.id ?? "", physics?.id ?? ""],
      includeDescendants: false,
    };
    const multiSubjectCard = await api.cards.create({
      yearId: year.id,
      definitionVersion: 1,
      definitionJson: multiSubjectDefinition,
    });

    await api.presets.reapply({
      yearId: year.id,
      presetId,
      acknowledgeReplacement: true,
    });
    const [configuredSubjectsAfter, configuredAveragesAfter] =
      await Promise.all([
        database
          .select()
          .from(schema.subjects)
          .where(eq(schema.subjects.yearId, year.id)),
        database
          .select()
          .from(schema.customAverages)
          .where(eq(schema.customAverages.yearId, year.id)),
      ]);
    expect(
      configuredSubjectsAfter.find(
        (subject) => subject.presetNodeKey === "mathematics",
      )?.id,
    ).toBe(mathematics?.id);
    expect(
      configuredAveragesAfter.find(
        (average) => average.presetNodeKey === "science-average",
      )?.id,
    ).toBe(scienceAverage?.id);
    expect(await api.goals.list({ yearId: year.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mathematicsGoal?.id }),
        expect.objectContaining({ id: averageGoal?.id }),
        expect.objectContaining({ id: physicsGoal?.id }),
      ]),
    );
    expect(
      await api.cards.list({ yearId: year.id, surface: "overview" }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mathematicsCard?.id }),
        expect.objectContaining({ id: averageCard?.id }),
        expect.objectContaining({ id: physicsCard?.id }),
        expect.objectContaining({ id: multiSubjectCard?.id }),
      ]),
    );
    expect(
      await database
        .select({ referenceId: schema.dashboardCardReferences.referenceId })
        .from(schema.dashboardCardReferences)
        .where(
          eq(schema.dashboardCardReferences.cardId, multiSubjectCard?.id ?? ""),
        ),
    ).toEqual(
      expect.arrayContaining([
        { referenceId: mathematics?.id },
        { referenceId: physics?.id },
      ]),
    );

    await adminApi.presets.admin.publish({
      presetId,
      name: "Reference-safe curriculum",
      description: "Reference preservation coverage",
      tags: ["test"],
      featured: false,
      changeNote: "Remove physics",
      configuration: {
        ...baseConfiguration,
        subjects: baseConfiguration.subjects.map((root) => ({
          ...root,
          children: root.children.filter(
            (subject) => subject.key !== "physics",
          ),
        })),
      },
    });
    const preview = await api.presets.previewApply({
      yearId: year.id,
      presetId,
    });
    expect(preview.canReplace).toBe(false);
    expect(preview.referenceBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: "goal", id: physicsGoal?.id }),
        expect.objectContaining({
          resource: "dashboard_card",
          id: physicsCard?.id,
        }),
        expect.objectContaining({
          resource: "dashboard_card",
          id: multiSubjectCard?.id,
        }),
      ]),
    );
    await expect(
      api.presets.reapply({
        yearId: year.id,
        presetId,
        acknowledgeReplacement: true,
      }),
    ).rejects.toThrow("would invalidate goals or dashboard cards");

    const goalsAfterRemoval = await api.goals.list({ yearId: year.id });
    const cardsAfterRemoval = await api.cards.list({
      yearId: year.id,
      surface: "overview",
    });
    expect(goalsAfterRemoval.some((goal) => goal.id === physicsGoal?.id)).toBe(
      true,
    );
    expect(cardsAfterRemoval.some((card) => card.id === physicsCard?.id)).toBe(
      true,
    );
    expect(
      cardsAfterRemoval.some((card) => card.id === multiSubjectCard?.id),
    ).toBe(true);
    expect(
      goalsAfterRemoval.some((goal) => goal.id === mathematicsGoal?.id),
    ).toBe(true);
    expect(cardsAfterRemoval.some((card) => card.id === averageCard?.id)).toBe(
      true,
    );
    expect(
      (await api.snapshot.get({ yearId: year.id })).subjects.some(
        (subject) => subject.id === physics?.id,
      ),
    ).toBe(true);
  });

  test("versions, synchronizes without changing IDs, then detaches on configuration edits", async () => {
    const presetId = "INTEGRATION_MANAGED_PRESET";
    await adminApi.presets.admin.create({
      id: presetId,
      name: "Integration curriculum",
      description: "Managed in tests",
      tags: ["test"],
      featured: false,
      configuration: baseConfiguration,
    });
    const year = await api.presets.setupYear({
      idempotencyKey: "managed-version-setup",
      year: {
        name: "Managed year",
        startsAt: new Date("2029-09-01T00:00:00.000Z"),
        endsAt: new Date("2030-07-01T00:00:00.000Z"),
      },
      presetId,
      periodTemplateId: "none",
      periodNames: [],
    });
    const [mathBefore] = await database
      .select()
      .from(schema.subjects)
      .where(
        and(
          eq(schema.subjects.yearId, year.id),
          eq(schema.subjects.presetNodeKey, "mathematics"),
        ),
      );
    expect(mathBefore).toBeDefined();
    const grade = await api.grades.create({
      name: "Algebra",
      value: 18,
      outOf: 20,
      passedAt: new Date("2029-10-01T00:00:00.000Z"),
      subjectId: mathBefore?.id ?? "",
    });

    await adminApi.presets.admin.publish({
      presetId,
      name: "Integration curriculum",
      description: "Managed in tests",
      tags: ["test"],
      featured: false,
      changeNote: "Increase mathematics weight",
      configuration: {
        ...baseConfiguration,
        subjects: baseConfiguration.subjects.map((root) => ({
          ...root,
          children: root.children.map((subject) =>
            subject.key === "mathematics"
              ? { ...subject, coefficient: 5 }
              : subject,
          ),
        })),
      },
    });

    const available = await api.presets.status({ yearId: year.id });
    expect(available.state).toBe("update_available");
    expect(available.changes?.subjectsChanged).toBe(1);
    await api.presets.synchronize({ yearId: year.id });

    const [mathAfter] = await database
      .select()
      .from(schema.subjects)
      .where(eq(schema.subjects.id, mathBefore?.id ?? ""));
    const [gradeAfter] = await database
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.id, grade?.id ?? ""));
    expect(mathAfter).toMatchObject({ id: mathBefore?.id, coefficient: 5 });
    expect(gradeAfter?.subjectId).toBe(mathBefore?.id);
    expect((await api.presets.status({ yearId: year.id })).state).toBe(
      "current",
    );

    await api.subjects.update({
      subjectId: mathBefore?.id ?? "",
      name: "My mathematics",
    });
    expect((await api.presets.status({ yearId: year.id })).state).toBe(
      "customized",
    );

    await adminApi.presets.admin.publish({
      presetId,
      name: "Integration curriculum",
      description: "Managed in tests",
      tags: ["test"],
      featured: false,
      changeNote: "Another official change",
      configuration: baseConfiguration,
    });
    await expect(api.presets.synchronize({ yearId: year.id })).rejects.toThrow(
      "not linked",
    );
    const [stillCustom] = await database
      .select()
      .from(schema.subjects)
      .where(eq(schema.subjects.id, mathBefore?.id ?? ""));
    expect(stillCustom?.name).toBe("My mathematics");
  });

  test("keeps curriculum presets linked across independent period mutations", async () => {
    const presetId = "INTEGRATION_PERIOD_MUTATION_PRESET";
    await adminApi.presets.admin.create({
      id: presetId,
      name: "Period mutation curriculum",
      description: "Independent period coverage",
      tags: ["test"],
      featured: false,
      configuration: baseConfiguration,
    });
    const year = await api.presets.setupYear({
      idempotencyKey: "managed-period-mutation-setup",
      year: {
        name: "Managed period year",
        startsAt: new Date("2032-09-01T00:00:00.000Z"),
        endsAt: new Date("2033-07-01T00:00:00.000Z"),
      },
      presetId,
      periodTemplateId: "trimesters",
      periodNames: ["Term 1", "Term 2", "Term 3"],
    });

    const expectCurrent = async () => {
      expect((await api.presets.status({ yearId: year.id })).state).toBe(
        "current",
      );
    };

    const created = await api.periods.create({
      yearId: year.id,
      name: "Revision",
      startAt: new Date("2033-06-01T00:00:00.000Z"),
      endAt: new Date("2033-06-30T00:00:00.000Z"),
      isCumulative: false,
    });
    expect(created).toBeDefined();
    await expectCurrent();

    await api.periods.update({
      periodId: created?.id ?? "",
      name: "Final revision",
    });
    await expectCurrent();

    const beforeReorder = await api.periods.list({ yearId: year.id });
    await api.periods.reorder({
      periodIds: beforeReorder.map((period) => period.id).reverse(),
    });
    await expectCurrent();

    await api.periods.delete({ periodId: created?.id ?? "" });
    await expectCurrent();

    const beforeReplace = await api.periods.list({ yearId: year.id });
    await api.periods.replaceAll({
      yearId: year.id,
      periods: beforeReplace.map((period, index) => ({
        periodId: period.id,
        name: index === 0 ? `${period.name} adjusted` : period.name,
        startAt: period.startAt,
        endAt: period.endAt,
        isCumulative: period.isCumulative,
      })),
    });
    await expectCurrent();

    await api.presets.applyPeriods({
      yearId: year.id,
      templateId: "semesters",
      names: ["Semester 1", "Semester 2"],
    });
    await expectCurrent();

    expect(
      await api.presets.applyPeriods({
        yearId: year.id,
        templateId: "none",
        names: [],
      }),
    ).toEqual([]);
    await expectCurrent();
  });

  test("requires action instead of deleting a subject that carries grades", async () => {
    const presetId = "INTEGRATION_REMOVAL_PRESET";
    await adminApi.presets.admin.create({
      id: presetId,
      name: "Removal curriculum",
      description: "Removal safety",
      tags: [],
      featured: false,
      configuration: baseConfiguration,
    });
    const year = await api.presets.setupYear({
      idempotencyKey: "managed-removal-setup",
      year: {
        name: "Removal-safe year",
        startsAt: new Date("2030-09-01T00:00:00.000Z"),
        endsAt: new Date("2031-07-01T00:00:00.000Z"),
      },
      presetId,
      periodTemplateId: "none",
      periodNames: [],
    });
    const [physics] = await database
      .select()
      .from(schema.subjects)
      .where(
        and(
          eq(schema.subjects.yearId, year.id),
          eq(schema.subjects.presetNodeKey, "physics"),
        ),
      );
    const grade = await api.grades.create({
      name: "Mechanics",
      value: 15,
      outOf: 20,
      passedAt: new Date("2030-10-01T00:00:00.000Z"),
      subjectId: physics?.id ?? "",
    });
    await adminApi.presets.admin.publish({
      presetId,
      name: "Removal curriculum",
      description: "Removal safety",
      tags: [],
      featured: false,
      changeNote: "Remove physics",
      configuration: {
        ...baseConfiguration,
        subjects: baseConfiguration.subjects.map((root) => ({
          ...root,
          children: root.children.filter(
            (subject) => subject.key !== "physics",
          ),
        })),
      },
    });

    const status = await api.presets.status({ yearId: year.id });
    expect(status.state).toBe("action_required");
    expect(status.blockers).toEqual([
      expect.objectContaining({ subjectName: "Physics", gradeCount: 1 }),
    ]);
    await expect(api.presets.synchronize({ yearId: year.id })).rejects.toThrow(
      "already has grades",
    );
    expect(
      await database
        .select()
        .from(schema.grades)
        .where(eq(schema.grades.id, grade?.id ?? "")),
    ).toHaveLength(1);
    expect(
      await database
        .select()
        .from(schema.subjects)
        .where(eq(schema.subjects.id, physics?.id ?? "")),
    ).toHaveLength(1);
  });

  test("conservatively detaches legacy preset years without stable keys", async () => {
    const preset = (await api.presets.list())[0];
    await database.insert(schema.years).values({
      id: "legacy-preset-year",
      name: "Legacy preset year",
      startsAt: new Date("2031-09-01T00:00:00.000Z"),
      endsAt: new Date("2032-07-01T00:00:00.000Z"),
      presetId: preset?.id,
      userId: "user-a",
    });
    await database.insert(schema.subjects).values({
      id: "legacy-preset-subject",
      name: "Legacy subject",
      yearId: "legacy-preset-year",
      userId: "user-a",
    });
    const status = await api.presets.status({ yearId: "legacy-preset-year" });
    expect(status.state).toBe("customized");
    expect(status.membership?.detachedReason).toBe("legacy_configuration");
  });

  test("keeps preset administration authoritative", async () => {
    await expect(api.presets.admin.list()).rejects.toThrow(
      "Administrator access required",
    );
  });
});
