import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { createRouterClient } from "@orpc/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

let api: Api;
let adminApi: Api;
let managedApi: Api;
let database: typeof import("../db").db;
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  await database.$client.executeMultiple(migration);
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
    expect(unchanged.startsAt).toEqual(
      new Date("2038-09-01T00:00:00.000Z"),
    );
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
        metric: "average",
        targetKind: "subject",
        targetId: "subject-b",
      }),
    ).rejects.toThrow("Card subject must belong to the same year");
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
      metric: "average",
    });
    const cardB = await api.cards.create({
      yearId: "year-b",
      metric: "average",
    });
    await expect(
      api.cards.reorder({ cardIds: [cardA?.id ?? "", cardB?.id ?? ""] }),
    ).rejects.toThrow("Every reordered card must share a year and surface");

    await api.cards.reorder({ cardIds: [cardA?.id ?? ""] });
    const cards = await api.cards.list({ yearId: "year-a" });
    expect(new Set(cards.map((card) => card.sortOrder)).size).toBe(
      cards.length,
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

  test("rolls back year creation and dashboard reset when card seeding fails", async () => {
    const existingCard = await api.cards.create({
      yearId: "year-a",
      metric: "average",
      surface: "overview",
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
    expect(
      detail.sharing!.subjects.map((subject) => subject.name),
    ).toContain("Subject A");

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

    // Groups: one link, one switch, real values, no minimum head-count.
    const group = await api.social.groups.create({
      name: "Integration group",
      description: "",
    });
    const invitation = await api.social.groups.invitations.create({
      groupId: group.id,
    });
    const preview = await managedApi.social.groups.invitations.preview({
      token: invitation.token,
    });
    expect(preview.group.name).toBe("Integration group");
    const joined = await managedApi.social.groups.invitations.accept({
      token: invitation.token,
    });
    expect(joined.joined).toBe(true);

    const detailForMember = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(detailForMember.members).toHaveLength(2);
    const owner = detailForMember.members.find(
      (member) => member.role === "owner",
    );
    expect(owner?.average).toBeCloseTo(expectedAverage, 9);
    // The joiner has no academic year, so they appear without a figure.
    const joiner = detailForMember.members.find(
      (member) => member.role === "member",
    );
    expect(joiner?.average).toBeNull();
    expect(detailForMember.groupAverage).toBeCloseTo(expectedAverage, 9);

    // The owner configures what the room compares and what it displays.
    await api.social.groups.update({
      groupId: group.id,
      kind: "class",
      comparedSubjectName: "Subject A",
    });
    const configured = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(configured.kind).toBe("class");
    expect(configured.comparedSubjectName).toBe("Subject A");
    const configuredOwner = configured.members.find(
      (member) => member.role === "owner",
    );
    // Every grade in the fixture year sits under Subject A, so the scoped
    // figure exists; and every grade predates the 30-day window, so the
    // trend is a computed "flat", not a missing value.
    expect(configuredOwner?.average).not.toBeNull();
    expect(configuredOwner?.trend).toBe("flat");
    expect(configuredOwner?.gradeCount).toBeGreaterThan(0);
    // A scope nobody's subjects match yields no figure rather than an error.
    await api.social.groups.update({
      groupId: group.id,
      comparedSubjectName: "Astrophysics",
    });
    const unmatched = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(
      unmatched.members.every((member) => member.average === null),
    ).toBe(true);
    await api.social.groups.update({
      groupId: group.id,
      comparedSubjectName: null,
    });

    // The optional common configuration: the owner offers year-a, the other
    // member adopts it and gets a structural copy — no grades, no link back.
    await api.social.groups.update({
      groupId: group.id,
      sharedSetupYearId: "year-a",
    });
    const withSetup = await managedApi.social.groups.get({
      groupId: group.id,
    });
    // Earlier suites grow year-a, so the summary is checked for shape and
    // the copy for parity with it rather than against absolute counts.
    expect(withSetup.sharedSetup?.yearName).toBe("Year A");
    expect(withSetup.sharedSetup?.subjectCount).toBeGreaterThanOrEqual(1);
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
      withSetup.sharedSetup?.subjectCount ?? 0,
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
    // Tidy up so later fixtures never meet the adopted copy.
    await database
      .delete(schema.years)
      .where(eq(schema.years.id, adopted.yearId));
    await api.social.groups.update({
      groupId: group.id,
      sharedSetupYearId: null,
    });

    // The one lock a member has: their own switch.
    await api.social.groups.setSharing({
      groupId: group.id,
      shareAverage: false,
    });
    const afterLock = await managedApi.social.groups.get({
      groupId: group.id,
    });
    expect(
      afterLock.members.find((member) => member.role === "owner")?.average,
    ).toBeNull();
    expect(afterLock.groupAverage).toBeNull();

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
    expect(frozen.members.every((member) => member.average === null)).toBe(
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
      metric: "average",
      targetKind: "subject",
      targetId: mathematics?.id,
    });
    const averageCard = await api.cards.create({
      yearId: year.id,
      metric: "average",
      targetKind: "custom",
      targetId: scienceAverage?.id,
    });
    const physicsCard = await api.cards.create({
      yearId: year.id,
      metric: "average",
      targetKind: "subject",
      targetId: physics?.id,
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
    expect(await api.cards.list({ yearId: year.id, surface: "overview" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mathematicsCard?.id }),
        expect.objectContaining({ id: averageCard?.id }),
        expect.objectContaining({ id: physicsCard?.id }),
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
          children: root.children.filter((subject) => subject.key !== "physics"),
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
    expect(goalsAfterRemoval.some((goal) => goal.id === mathematicsGoal?.id)).toBe(
      true,
    );
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
