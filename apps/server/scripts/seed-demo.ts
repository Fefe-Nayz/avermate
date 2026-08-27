/**
 * Seeds the showcase accounts and a synthetic cohort for the admin panel.
 *
 *   bun scripts/seed-demo.ts            showcase + cohort + empty account
 *   bun scripts/seed-demo.ts --blank    only the empty one
 *   bun scripts/seed-demo.ts --full     only the complete one
 *   bun scripts/seed-demo.ts --cohort   only the synthetic cohort
 *   bun scripts/seed-demo.ts --cohort --users 80 --seed 1234
 *   bun scripts/seed-demo.ts --full --email me@example.com --name "…"
 *
 * Destructive demo seeding only runs against local file or in-memory databases
 * and is always rejected in production. Synthetic users are confined to
 * `@seed.avermate.example`.
 *
 * They exist for opposite reasons. The empty account is the only way to see
 * onboarding twice, because it runs once per account and there is no undo. The
 * complete one exists because an empty dashboard tells you nothing about
 * whether the dashboard works — and because a screen that only ever meets tidy
 * data breaks the first time it meets a real year.
 *
 * So "complete" here means *every shape the app can be asked to draw*, not
 * "a lot of grades": two years so the switcher has somewhere to go, a
 * cumulative period, a three-level subject tree, a subject with nothing in it,
 * composite grades, notes, custom averages, a goal in each of the states the
 * planner can report, and cards covering every display.
 */
import { eq, like, sql } from "drizzle-orm";
import {
  createLocalAccountIssuer,
  createOAuthAccountIssuer,
} from "@better-auth/core/db";
import { db } from "../src/db";
import {
  accounts,
  customAverageEntries,
  customAverages,
  dashboardCardReferences,
  dashboardCards,
  academicAssignments,
  calendarEvents,
  goals,
  gradeComponents,
  gradeTypes,
  grades,
  materialDocuments,
  materialFolders,
  planningTasks,
  studyDocuments,
  agentApprovals,
  agentActionSequences,
  agentActions,
  assistantBranches,
  assistantMessages,
  assistantThreads,
  learningConceptSets,
  learningConcepts,
  learningMasteryCurrent,
  learningMasteryProjections,
  learningObjectives,
  studyProjectItems,
  studyProjects,
  timetableSeries,
  periods,
  friendships,
  groupMemberships,
  socialGroups,
  socialProfiles,
  sessions,
  subjects,
  users,
  years,
} from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { newId } from "../src/lib/id";
import { coreCorpusIndexService } from "../src/search/index-service";
import { canonicalPair } from "../src/lib/social-policy";
import {
  cardSemanticsFromDefinition,
  defaultCards,
  widgetDefinitionFromCard,
  WIDGET_DEFINITION_VERSION,
  type CardSemantics,
} from "@avermate/core";
import { widgetReferenceRows } from "../src/lib/card-storage";
import {
  buildDemoCohort,
  type DemoProfile,
  type DemoUser,
} from "./seed-demo-data";
import { demoActionDigests } from "./demo-action-fixtures";

interface DemoCard {
  row: typeof dashboardCards.$inferInsert;
  references: Array<typeof dashboardCardReferences.$inferInsert>;
}

function demoAccountIssuer(provider: DemoProfile["provider"]): string {
  if (provider === "credential") return createLocalAccountIssuer(provider);
  if (provider === "google") return "https://accounts.google.com";
  // Synthetic Microsoft accounts never authenticate against Entra. A real
  // account must use the verified tenant issuer returned by Microsoft.
  return createOAuthAccountIssuer(provider);
}

/**
 * One seeded card.
 *
 * A card *is* its definition. The `metric` / `targetKind` / `display` columns
 * beside it are a projection of it and nothing reads them — so writing only those
 * columns, which is what this script used to do, now produces a row the app
 * cannot read at all. Every card on the demo dashboard would have said so.
 *
 * The derived reference rows come along too. They are what the delete triggers
 * read: seeded without them, deleting a demo subject would leave a card pointing
 * at nothing, which is a bug the complete account exists to expose rather than to
 * hide.
 */
function demoCard(input: {
  semantics: CardSemantics;
  span: number;
  sortOrder: number;
  yearId: string;
  userId: string;
  surface?: string;
  title?: string | null;
  accent?: string | null;
  hidden?: boolean;
  /** Deterministic where the caller needs one — the cohort names its rows. */
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}): DemoCard {
  const definitionJson = widgetDefinitionFromCard(input.semantics);
  const id = input.id ?? newId("card");
  return {
    row: {
      id,
      surface: input.surface ?? "overview",
      ...cardSemanticsFromDefinition(definitionJson),
      span: input.span,
      title: input.title ?? null,
      accent: input.accent ?? null,
      sortOrder: input.sortOrder,
      hidden: input.hidden ?? false,
      definitionVersion: WIDGET_DEFINITION_VERSION,
      definitionJson,
      yearId: input.yearId,
      userId: input.userId,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    },
    references: widgetReferenceRows(id, definitionJson),
  };
}

/** The default dashboard, as rows for one year. */
function demoDefaultCards(
  yearId: string,
  userId: string,
  options: { id?: (index: number) => string; at?: Date } = {},
): DemoCard[] {
  return defaultCards().map((card, index) =>
    demoCard({
      id: options.id?.(index),
      semantics: {
        metric: card.metric,
        targetKind: card.target.kind,
        targetId: card.target.referenceId,
        goalId: null,
        display: card.display,
      },
      span: card.span,
      title: card.title,
      accent: card.accent,
      sortOrder: card.sortOrder,
      hidden: card.hidden,
      yearId,
      userId,
      createdAt: options.at,
      updatedAt: options.at,
    }),
  );
}

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const ONLY_BLANK = process.argv.includes("--blank");
const ONLY_FULL = process.argv.includes("--full");
const ONLY_COHORT = process.argv.includes("--cohort");
const SHOW_HELP = process.argv.includes("--help");
const PASSWORD = argument("--password") ?? "demo-account-2026";
const SOCIAL_DEMO_ENABLED =
  process.env.SOCIAL_DEMO_SEED_ENABLED === "true" &&
  process.env.NODE_ENV !== "production";

const selectedModes = [ONLY_BLANK, ONLY_FULL, ONLY_COHORT].filter(Boolean);
if (selectedModes.length > 1) {
  throw new Error("Use only one of --blank, --full, or --cohort.");
}

function integerArgument(flag: string): number | undefined {
  const raw = argument(flag);
  if (raw === undefined) {
    if (process.argv.includes(flag)) {
      throw new Error(`${flag} requires a value.`);
    }
    return undefined;
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${flag} must be a whole number.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${flag} must be a safe integer.`);
  }
  return value;
}

const COHORT_SIZE = integerArgument("--users") ?? 48;
const COHORT_SEED = integerArgument("--seed");

function assertSeedAllowed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo seeding is disabled when NODE_ENV=production.");
  }
  const databaseUrl = (
    process.env.DATABASE_URL ?? "file:./dev.db"
  ).toLowerCase();
  const localDatabase =
    databaseUrl === ":memory:" || databaseUrl.startsWith("file:");
  if (!localDatabase) {
    throw new Error(
      "Demo seeding is restricted to :memory: and file: databases.",
    );
  }
}

/** Wipe and recreate, so re-running always lands on the same starting point. */
async function account(email: string, name: string) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    /*
     * Take the RESTRICT edges down by hand, in order, before the cascade.
     *
     * `material_documents.fileId -> files.id` is ON DELETE RESTRICT, and so
     * are the assistant's message/branch/run self-references. Deleting the
     * user cascades into both sides of each pair, and SQLite reaches the
     * parent while a child still points at it: "FOREIGN KEY constraint
     * failed", which is why re-seeding stopped working once conversations and
     * synced material landed. The restriction itself is right — a document
     * must not outlive its file — so the fix belongs here, not in the schema.
     */
    const threads = sql`select id from assistant_threads where "userId" = ${existing.id}`;
    /*
     * Leaves first, because the rows may not be edited.
     *
     * A message points at its parent with ON DELETE RESTRICT, so the set
     * cannot be deleted in one statement, and `assistant_messages are
     * immutable` forbids untying the link with an UPDATE first. Deleting the
     * rows nothing points at, repeatedly, walks the tree from its tips.
     */
    await db.run(
      sql`delete from assistant_runs where "threadId" in (${threads})`,
    );
    for (let pass = 0; pass < 64; pass += 1) {
      const removed = await db.run(
        sql`delete from assistant_conversation_checkpoints
            where "threadId" in (${threads})
              and id not in (
                select "parentCheckpointId" from assistant_conversation_checkpoints
                where "parentCheckpointId" is not null
              )`,
      );
      if (removed.rowsAffected === 0) break;
    }
    await db.run(
      sql`delete from assistant_branches where "threadId" in (${threads})`,
    );
    for (let pass = 0; pass < 256; pass += 1) {
      const removed = await db.run(
        sql`delete from assistant_messages
            where "threadId" in (${threads})
              and id not in (
                select "parentMessageId" from assistant_messages
                where "parentMessageId" is not null
              )`,
      );
      if (removed.rowsAffected === 0) break;
    }
    await db
      .delete(materialDocuments)
      .where(eq(materialDocuments.userId, existing.id));
    await db.delete(users).where(eq(users.id, existing.id));
  }

  await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) throw new Error(`The account ${email} was not created`);

  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, user.id));

  return user;
}

interface Node {
  id: string;
  name: string;
  shortName: string | null;
  parentId: string | null;
  coefficient: number;
  kind: "subject" | "category";
  isMain: boolean;
}

/** subject, name, value, out of, fraction through the year, coefficient */
type Entry = [string, string, number, number, number, number?];

function spread(from: Date, to: Date) {
  return (fraction: number) =>
    new Date(from.getTime() + (to.getTime() - from.getTime()) * fraction);
}

// ------------------------------------------------------------ the full year

async function seedFull(email: string, name: string) {
  const user = await account(email, name);

  // Mid-year on purpose: a finished year makes every goal read as locked in or
  // out of reach, which demonstrates none of the planning.
  const now = new Date();
  const startsAt = new Date(now);
  startsAt.setMonth(startsAt.getMonth() - 8);
  const endsAt = new Date(now);
  endsAt.setMonth(endsAt.getMonth() + 3);

  const [year] = await db
    .insert(years)
    .values({
      name: `${startsAt.getFullYear()}–${endsAt.getFullYear()}`,
      startsAt,
      endsAt,
      scale: 20,
      defaultOutOf: 20,
      passingRatio: 0.5,
      decimals: 2,
      sortOrder: 0,
      userId: user.id,
    })
    .returning();
  if (!year) throw new Error("The demo year was not created");

  // A finished year behind it, so the year switcher has somewhere to go.
  const pastStart = new Date(startsAt);
  pastStart.setFullYear(pastStart.getFullYear() - 1);
  const pastEnd = new Date(endsAt);
  pastEnd.setFullYear(pastEnd.getFullYear() - 1);

  const [past] = await db
    .insert(years)
    .values({
      name: `${pastStart.getFullYear()}–${pastEnd.getFullYear()}`,
      startsAt: pastStart,
      endsAt: pastEnd,
      scale: 20,
      defaultOutOf: 20,
      passingRatio: 0.5,
      decimals: 2,
      sortOrder: 1,
      userId: user.id,
    })
    .returning();
  if (!past) throw new Error("The previous year was not created");

  const at = spread(startsAt, endsAt);
  const atPast = spread(pastStart, pastEnd);

  const periodRows = await db
    .insert(periods)
    .values([
      {
        name: "Trimestre 1",
        startAt: at(0),
        endAt: at(1 / 3),
        isCumulative: false,
        sortOrder: 0,
        yearId: year.id,
        userId: user.id,
      },
      {
        name: "Trimestre 2",
        startAt: at(1 / 3),
        endAt: at(2 / 3),
        isCumulative: false,
        sortOrder: 1,
        yearId: year.id,
        userId: user.id,
      },
      {
        name: "Trimestre 3",
        startAt: at(2 / 3),
        endAt: at(1),
        isCumulative: false,
        sortOrder: 2,
        yearId: year.id,
        userId: user.id,
      },
    ])
    .returning();

  // The previous year uses cumulative semesters, so both period behaviours
  // exist inside one account.
  await db.insert(periods).values([
    {
      name: "Semestre 1",
      startAt: atPast(0),
      endAt: atPast(0.5),
      isCumulative: false,
      sortOrder: 0,
      yearId: past.id,
      userId: user.id,
    },
    {
      name: "Semestre 2",
      startAt: atPast(0.5),
      endAt: atPast(1),
      isCumulative: true,
      sortOrder: 1,
      yearId: past.id,
      userId: user.id,
    },
  ]);

  const science = newId("sub");
  const maths = newId("sub");
  const physics = newId("sub");
  const biology = newId("sub");
  const humanities = newId("sub");
  const french = newId("sub");
  const frenchWritten = newId("sub");
  const frenchOral = newId("sub");
  const history = newId("sub");
  const english = newId("sub");
  const spanish = newId("sub");
  const sport = newId("sub");
  const music = newId("sub");

  const tree: Node[] = [
    {
      id: science,
      name: "Sciences",
      shortName: "Sci.",
      parentId: null,
      coefficient: 1,
      kind: "category",
      isMain: false,
    },
    {
      id: maths,
      name: "Mathématiques",
      shortName: "Maths",
      parentId: science,
      coefficient: 7,
      kind: "subject",
      isMain: true,
    },
    {
      id: physics,
      name: "Physique-Chimie",
      shortName: "PC",
      parentId: science,
      coefficient: 5,
      kind: "subject",
      isMain: true,
    },
    {
      id: biology,
      name: "SVT",
      shortName: null,
      parentId: science,
      coefficient: 3,
      kind: "subject",
      isMain: false,
    },

    {
      id: humanities,
      name: "Humanités",
      shortName: "Hum.",
      parentId: null,
      coefficient: 1,
      kind: "category",
      isMain: false,
    },
    // Three levels deep: a subject whose own children are weighed inside it.
    {
      id: french,
      name: "Français",
      shortName: "Fr.",
      parentId: humanities,
      coefficient: 4,
      kind: "subject",
      isMain: true,
    },
    {
      id: frenchWritten,
      name: "Français — Écrit",
      shortName: "Fr. écrit",
      parentId: french,
      coefficient: 3,
      kind: "subject",
      isMain: false,
    },
    {
      id: frenchOral,
      name: "Français — Oral",
      shortName: "Fr. oral",
      parentId: french,
      coefficient: 1,
      kind: "subject",
      isMain: false,
    },
    {
      id: history,
      name: "Histoire-Géographie",
      shortName: "HG",
      parentId: humanities,
      coefficient: 3,
      kind: "subject",
      isMain: false,
    },

    {
      id: english,
      name: "Anglais",
      shortName: "Ang.",
      parentId: null,
      coefficient: 3,
      kind: "subject",
      isMain: true,
    },
    {
      id: spanish,
      name: "Espagnol",
      shortName: "Esp.",
      parentId: null,
      coefficient: 2,
      kind: "subject",
      isMain: false,
    },
    {
      id: sport,
      name: "Sport",
      shortName: "EPS",
      parentId: null,
      coefficient: 1,
      kind: "subject",
      isMain: false,
    },
    // Deliberately empty: the "no grade yet" states have to be reachable.
    {
      id: music,
      name: "Musique",
      shortName: null,
      parentId: null,
      coefficient: 1,
      kind: "subject",
      isMain: false,
    },
  ];

  await db.insert(subjects).values(
    tree.map((node, index) => ({
      ...node,
      sortOrder: index,
      yearId: year.id,
      userId: user.id,
    })),
  );

  // The previous year gets a flat, simpler tree — most people's setup changes
  // between years, and the app has to survive that.
  const pastMaths = newId("sub");
  const pastFrench = newId("sub");
  const pastEnglish = newId("sub");

  await db.insert(subjects).values([
    {
      id: pastMaths,
      name: "Mathématiques",
      shortName: "Maths",
      parentId: null,
      coefficient: 5,
      kind: "subject" as const,
      isMain: true,
      sortOrder: 0,
      yearId: past.id,
      userId: user.id,
    },
    {
      id: pastFrench,
      name: "Français",
      shortName: "Fr.",
      parentId: null,
      coefficient: 4,
      kind: "subject" as const,
      isMain: true,
      sortOrder: 1,
      yearId: past.id,
      userId: user.id,
    },
    {
      id: pastEnglish,
      name: "Anglais",
      shortName: "Ang.",
      parentId: null,
      coefficient: 3,
      kind: "subject" as const,
      isMain: false,
      sortOrder: 2,
      yearId: past.id,
      userId: user.id,
    },
  ]);

  const plan: Entry[] = [
    // Maths climbs, with one bad day — enough for a trend and a broken streak.
    [maths, "DS 1 — Suites", 12, 20, 0.05],
    [maths, "Interrogation", 9, 20, 0.11],
    [maths, "DS 2 — Dérivation", 14.5, 20, 0.18],
    [maths, "DS 3 — Intégrales", 15.5, 20, 0.33],
    [maths, "Bac blanc", 16, 20, 0.5, 2],
    [maths, "DS 4 — Probabilités", 13, 20, 0.66],
    [maths, "DM — Géométrie", 17, 20, 0.74],

    [physics, "TP Optique", 16, 20, 0.08],
    [physics, "DS 1 — Mécanique", 11, 20, 0.19],
    [physics, "DS 2 — Chimie", 13.5, 20, 0.36],
    [physics, "Bac blanc", 12, 20, 0.51, 2],
    [physics, "TP Électricité", 14, 20, 0.7],

    [biology, "DS 1 — Génétique", 15, 20, 0.14],
    [biology, "TP Microscopie", 18, 20, 0.4],
    [biology, "DS 2 — Écologie", 13, 20, 0.63],

    [frenchWritten, "Dissertation", 11, 20, 0.12],
    [frenchWritten, "Commentaire", 13, 20, 0.3],
    [frenchOral, "Oral blanc", 15, 20, 0.57],

    [history, "Composition", 12, 20, 0.16],
    [history, "Croquis", 14, 20, 0.44],
    [history, "Étude de documents", 11.5, 20, 0.68],

    [english, "Compréhension", 17, 20, 0.1],
    [english, "Expression écrite", 15, 20, 0.27],
    [english, "Oral", 18, 20, 0.48],
    [english, "Essai", 16, 20, 0.72],

    [spanish, "Compréhension", 13, 20, 0.15],
    [spanish, "Oral", 11, 20, 0.42],

    [sport, "Demi-fond", 17, 20, 0.2],
    [sport, "Badminton", 19, 20, 0.61],
  ];

  const notes: Record<string, string> = {
    Interrogation: "Pas révisé, la question 3 m'a coûté cher.",
    "DS 1 — Mécanique": "Erreurs d'étourderie sur les vecteurs.",
    Dissertation: "Plan bancal, à retravailler avant le bac.",
  };

  const periodFor = (passedAt: Date) =>
    periodRows.find(
      (candidate) =>
        passedAt >= candidate.startAt && passedAt <= candidate.endAt,
    )?.id ?? null;

  const gradeRows = await db
    .insert(grades)
    .values(
      plan.map(
        ([subjectId, gradeName, value, outOf, fraction, coefficient]) => {
          const passedAt = at(fraction);
          return {
            name: gradeName,
            value,
            outOf,
            coefficient: coefficient ?? 1,
            note: notes[gradeName] ?? null,
            isComposite: false,
            passedAt,
            subjectId,
            periodId: periodFor(passedAt),
            yearId: year.id,
            userId: user.id,
          };
        },
      ),
    )
    .returning();

  // Two composite grades, because a grade built from parts stores a derived
  // value that every reader has to agree with.
  const composites: Array<{
    subjectId: string;
    name: string;
    fraction: number;
    parts: Array<[string, number, number, number]>;
  }> = [
    {
      subjectId: frenchWritten,
      name: "Bac blanc écrit",
      fraction: 0.54,
      parts: [
        ["Dissertation", 12, 20, 2],
        ["Commentaire", 15, 20, 1],
      ],
    },
    {
      subjectId: physics,
      name: "Épreuve pratique",
      fraction: 0.78,
      parts: [
        ["Manipulation", 17, 20, 3],
        ["Compte-rendu", 13, 20, 1],
      ],
    },
  ];

  for (const composite of composites) {
    const total = composite.parts.reduce(
      (sum, [, , , weight]) => sum + weight,
      0,
    );
    const weighted = composite.parts.reduce(
      (sum, [, value, outOf, weight]) => sum + (value / outOf) * weight,
      0,
    );
    const passedAt = at(composite.fraction);

    const [created] = await db
      .insert(grades)
      .values({
        name: composite.name,
        value: (weighted / total) * 20,
        outOf: 20,
        coefficient: 2,
        note: null,
        isComposite: true,
        passedAt,
        subjectId: composite.subjectId,
        periodId: periodFor(passedAt),
        yearId: year.id,
        userId: user.id,
      })
      .returning();
    if (!created) continue;

    await db.insert(gradeComponents).values(
      composite.parts.map(([partName, value, outOf, weight], index) => ({
        gradeId: created.id,
        name: partName,
        value,
        outOf,
        coefficient: weight,
        sortOrder: index,
        userId: user.id,
      })),
    );
  }

  await db.insert(grades).values(
    (
      [
        [pastMaths, "DS 1", 13, 20, 0.2],
        [pastMaths, "DS 2", 15, 20, 0.55],
        [pastMaths, "Bac blanc", 14, 20, 0.85],
        [pastFrench, "Dissertation", 12, 20, 0.3],
        [pastFrench, "Oral", 16, 20, 0.75],
        [pastEnglish, "Compréhension", 15, 20, 0.35],
        [pastEnglish, "Oral", 17, 20, 0.8],
      ] as Entry[]
    ).map(([subjectId, gradeName, value, outOf, fraction]) => ({
      name: gradeName,
      value,
      outOf,
      coefficient: 1,
      isComposite: false,
      passedAt: atPast(fraction),
      subjectId,
      periodId: null,
      yearId: past.id,
      userId: user.id,
    })),
  );

  // --------------------------------------------------------- custom averages

  const [written] = await db
    .insert(customAverages)
    .values({
      name: "Moyenne des écrits",
      isMain: true,
      sortOrder: 0,
      yearId: year.id,
      userId: user.id,
    })
    .returning();

  const [scientific] = await db
    .insert(customAverages)
    .values({
      name: "Moyenne scientifique",
      isMain: false,
      sortOrder: 1,
      yearId: year.id,
      userId: user.id,
    })
    .returning();

  if (written) {
    await db.insert(customAverageEntries).values([
      {
        averageId: written.id,
        subjectId: maths,
        coefficient: 1,
        includeChildren: false,
      },
      {
        averageId: written.id,
        subjectId: physics,
        coefficient: 1,
        includeChildren: false,
      },
      {
        averageId: written.id,
        subjectId: frenchWritten,
        coefficient: 1,
        includeChildren: false,
      },
    ]);
  }

  if (scientific) {
    await db.insert(customAverageEntries).values([
      // Weighted differently from the real tree, which is the point of these.
      {
        averageId: scientific.id,
        subjectId: maths,
        coefficient: 4,
        includeChildren: false,
      },
      {
        averageId: scientific.id,
        subjectId: physics,
        coefficient: 3,
        includeChildren: false,
      },
      {
        averageId: scientific.id,
        subjectId: biology,
        coefficient: 2,
        includeChildren: false,
      },
    ]);
  }

  // ------------------------------------------------------------------- goals

  // One goal per state the planner can report, so every branch of the advice
  // and every colour of the status pill is reachable without editing data.
  const goalRows = await db
    .insert(goals)
    .values([
      {
        // Above the ceiling the remaining assessments can reach: unreachable.
        name: "Mention très bien",
        kind: "general",
        referenceId: null,
        targetRatio: 0.8,
        periodId: null,
        dueAt: endsAt,
        achievedAt: null,
        isPinned: true,
        sortOrder: 0,
        yearId: year.id,
        userId: user.id,
      },
      {
        // Reachable, but the trend does not get there on its own: at risk.
        name: "15 en maths",
        kind: "subject",
        referenceId: maths,
        targetRatio: 0.75,
        periodId: null,
        dueAt: null,
        achievedAt: null,
        isPinned: true,
        sortOrder: 1,
        yearId: year.id,
        userId: user.id,
      },
      {
        // Already cleared: achieved.
        name: "Mention bien",
        kind: "general",
        referenceId: null,
        targetRatio: 0.7,
        periodId: null,
        dueAt: null,
        achievedAt: null,
        isPinned: false,
        sortOrder: 2,
        yearId: year.id,
        userId: user.id,
      },
      {
        // Just above where SVT sits, just below where it is heading. This is
        // the narrow band that makes the planner say "on track", and it only
        // exists because the projection clears the target — nothing else does.
        name: "15,5 en SVT",
        kind: "subject",
        referenceId: biology,
        targetRatio: 0.775,
        periodId: null,
        dueAt: null,
        achievedAt: null,
        isPinned: false,
        sortOrder: 3,
        yearId: year.id,
        userId: user.id,
      },
      {
        // A custom average, scoped to the term currently running.
        name: "14 aux écrits ce trimestre",
        kind: "custom",
        referenceId: written?.id ?? null,
        targetRatio: 0.7,
        periodId: periodRows[2]?.id ?? null,
        dueAt: null,
        achievedAt: null,
        isPinned: false,
        sortOrder: 4,
        yearId: year.id,
        userId: user.id,
      },
      {
        // Points at the subject with no grades: the "no data yet" state.
        name: "12 en musique",
        kind: "subject",
        referenceId: music,
        targetRatio: 0.6,
        periodId: null,
        dueAt: null,
        achievedAt: null,
        isPinned: false,
        sortOrder: 5,
        yearId: year.id,
        userId: user.id,
      },
      {
        // A finished term, so nothing left can take it away: secured. Also
        // closed by hand, so the reopen path has something to act on.
        name: "Finir le premier trimestre au-dessus de 12",
        kind: "general",
        referenceId: null,
        targetRatio: 0.6,
        periodId: periodRows[0]?.id ?? null,
        dueAt: null,
        achievedAt: new Date(),
        isPinned: false,
        sortOrder: 6,
        yearId: year.id,
        userId: user.id,
      },
    ])
    .returning();

  // ------------------------------------------------------------------- cards

  const cards = [
    ...demoDefaultCards(year.id, user.id),
    // Beyond the defaults: one card per shape the renderer can produce, so a
    // change to any branch of it is visible on the first screen you open.
    demoCard({
      semantics: {
        metric: "goalProgress",
        targetKind: "general",
        targetId: null,
        goalId: goalRows[0]?.id ?? null,
        display: "gauge",
      },
      span: 2,
      sortOrder: 20,
      yearId: year.id,
      userId: user.id,
    }),
    demoCard({
      semantics: {
        metric: "average",
        targetKind: "custom",
        targetId: scientific?.id ?? null,
        goalId: null,
        display: "sparkline",
      },
      span: 2,
      title: "Sciences, à ma sauce",
      sortOrder: 21,
      yearId: year.id,
      userId: user.id,
    }),
    demoCard({
      semantics: {
        metric: "average",
        targetKind: "subject",
        targetId: maths,
        goalId: null,
        display: "value",
      },
      span: 1,
      sortOrder: 22,
      yearId: year.id,
      userId: user.id,
    }),
    demoCard({
      semantics: {
        metric: "distribution",
        targetKind: "general",
        targetId: null,
        goalId: null,
        display: "chart",
      },
      span: 2,
      sortOrder: 23,
      yearId: year.id,
      userId: user.id,
    }),
    demoCard({
      semantics: {
        metric: "subjectRanking",
        targetKind: "general",
        targetId: null,
        goalId: null,
        display: "list",
      },
      span: 2,
      sortOrder: 24,
      yearId: year.id,
      userId: user.id,
    }),
    demoCard({
      semantics: {
        metric: "passStreak",
        targetKind: "general",
        targetId: null,
        goalId: null,
        display: "value",
      },
      span: 1,
      sortOrder: 25,
      yearId: year.id,
      userId: user.id,
    }),
    demoCard({
      semantics: {
        metric: "lastGrade",
        targetKind: "general",
        targetId: null,
        goalId: null,
        display: "value",
      },
      span: 2,
      sortOrder: 26,
      yearId: year.id,
      userId: user.id,
    }),
    demoCard({
      // Hidden, so the "show this card again" path has something to restore.
      semantics: {
        metric: "median",
        targetKind: "general",
        targetId: null,
        goalId: null,
        display: "value",
      },
      span: 1,
      sortOrder: 27,
      hidden: true,
      yearId: year.id,
      userId: user.id,
    }),
    // Cards are per year, so the previous one needs its own.
    ...demoDefaultCards(past.id, user.id),
  ];

  await db.insert(dashboardCards).values(cards.map((card) => card.row));
  const cardReferences = cards.flatMap((card) => card.references);
  if (cardReferences.length > 0) {
    await db.insert(dashboardCardReferences).values(cardReferences);
  }

  await seedStudyLife({
    userId: user.id,
    yearId: year.id,
    startsAt,
    endsAt,
    now,
    subjects: { maths, physics, french, english },
    averageId: written?.id ?? null,
    gradeIds: gradeRows.map((row) => row.id),
  });

  console.info(`Complete account: ${email} / ${PASSWORD}`);
  console.info(
    `  2 years · ${tree.length} subjects · ${gradeRows.length + composites.length} grades · ${goalRows.length} goals`,
  );
  return { user, year };
}

/**
 * Everything the year holds besides its marks.
 *
 * The demo account existed to show averages, and every screen built since — the kinds of
 * assessment, the bonus points, the timetable, the homework, the personal board, the
 * materials — opened on an empty state. A product demonstrates badly from an empty
 * state: the layouts that matter are the ones with something in them.
 *
 * Dates are relative to the year being seeded, so the timetable is always running and
 * the homework is always due soon, whenever the script happens to be run.
 */
async function seedStudyLife(input: {
  userId: string;
  yearId: string;
  startsAt: Date;
  endsAt: Date;
  now: Date;
  subjects: { maths: string; physics: string; french: string; english: string };
  averageId: string | null;
  gradeIds: string[];
}): Promise<void> {
  const { userId, yearId, now, subjects: subject } = input;
  const day = (offset: number, hour = 9) => {
    const at = new Date(now);
    at.setDate(at.getDate() + offset);
    at.setHours(hour, 0, 0, 0);
    return at;
  };
  const isoDay = (date: Date) => date.toISOString().slice(0, 10);

  // ------------------------------------------------------ kinds of assessment
  const written = newId("gtype");
  const oral = newId("gtype");
  const practical = newId("gtype");
  await db.insert(gradeTypes).values([
    {
      id: written,
      name: "DS",
      titlePrefix: "DS ",
      coefficient: 2,
      outOf: 20,
      accent: "primary",
      sortOrder: 0,
      yearId,
      userId,
    },
    {
      id: oral,
      name: "Colle",
      titlePrefix: "Colle ",
      coefficient: 1,
      outOf: 20,
      accent: "amber",
      sortOrder: 1,
      yearId,
      userId,
    },
    {
      id: practical,
      name: "TP note",
      titlePrefix: "TP ",
      coefficient: 1,
      outOf: 20,
      accent: "teal",
      sortOrder: 2,
      yearId,
      userId,
    },
  ]);

  // Spread over the marks that already exist, so a card grouped by kind has three
  // populated buckets and one of untyped results rather than a single bar.
  const kinds = [written, oral, practical, null];
  for (const [index, gradeId] of input.gradeIds.entries()) {
    const typeId = kinds[index % kinds.length];
    if (!typeId) continue;
    await db.update(grades).set({ typeId }).where(eq(grades.id, gradeId));
  }

  // ---------------------------------------------------------------- bonus points
  // A subject carrying an option's points, and a small bonus on the year itself:
  // both readings the feature exists for, at a size that is visible without
  // looking like a bug.
  await db
    .update(subjects)
    .set({ bonus: 0.5 })
    .where(eq(subjects.id, subject.english));
  await db
    .update(years)
    .set({ generalBonus: 0.25, mainAverageId: input.averageId })
    .where(eq(years.id, yearId));

  // ------------------------------------------------------------------ timetable
  const seriesWindow = {
    startsOn: isoDay(input.startsAt),
    endsOn: isoDay(input.endsAt),
  };
  await db.insert(timetableSeries).values([
    {
      title: "Mathematiques",
      ...seriesWindow,
      startMinutes: 8 * 60,
      durationMinutes: 120,
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      recurrenceWeekdays: [1, 4],
      location: "Salle B12",
      subjectId: subject.maths,
      yearId,
      userId,
    },
    {
      title: "Physique-Chimie - TP",
      ...seriesWindow,
      startMinutes: 14 * 60,
      durationMinutes: 120,
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      recurrenceWeekdays: [2],
      location: "Labo 3",
      subjectId: subject.physics,
      yearId,
      userId,
    },
    {
      title: "Anglais",
      ...seriesWindow,
      startMinutes: 10 * 60,
      durationMinutes: 60,
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      recurrenceWeekdays: [3, 5],
      location: "Salle A04",
      subjectId: subject.english,
      yearId,
      userId,
    },
  ]);

  // ------------------------------------------------------------------- homework
  await db.insert(academicAssignments).values([
    {
      title: "Exercices 4 a 8 - suites recurrentes",
      instructions: "Rediger la recurrence en entier pour le 8.",
      assignedAt: day(-2, 8),
      dueAt: day(1, 8),
      subjectId: subject.maths,
      yearId,
      userId,
    },
    {
      title: "Compte rendu de TP - dosage",
      instructions: "Incertitudes attendues, une page maximum.",
      assignedAt: day(-5, 14),
      dueAt: day(3, 14),
      localNote: "Reprendre le tableau de la seance precedente.",
      subjectId: subject.physics,
      yearId,
      userId,
    },
    {
      title: "Lire le chapitre 6",
      assignedAt: day(-1, 10),
      dueAt: day(5, 10),
      subjectId: subject.english,
      yearId,
      userId,
    },
    {
      title: "Commentaire compose - introduction",
      assignedAt: day(-9, 9),
      dueAt: day(-2, 9),
      completedAt: day(-3, 20),
      subjectId: subject.french,
      yearId,
      userId,
    },
  ]);

  // -------------------------------------------------------------- personal board
  // Three columns' worth: a board is only a board when every column holds a card.
  await db.insert(planningTasks).values([
    {
      title: "Refaire les annales de 2024",
      status: "todo",
      dueAt: day(6, 18),
      subjectId: subject.maths,
      sortOrder: 0,
      yearId,
      userId,
    },
    {
      title: "Fiches de vocabulaire - unite 6",
      status: "todo",
      dueAt: day(4, 18),
      subjectId: subject.english,
      sortOrder: 1,
      yearId,
      userId,
    },
    {
      title: "Relire le cours sur les dosages",
      status: "doing",
      scheduledAt: day(0, 17),
      subjectId: subject.physics,
      sortOrder: 2,
      yearId,
      userId,
    },
    {
      title: "Preparer les questions pour la colle",
      status: "doing",
      dueAt: day(2, 8),
      subjectId: subject.maths,
      sortOrder: 3,
      yearId,
      userId,
    },
    {
      title: "Rendre le devoir de francais",
      status: "done",
      completedAt: day(-3, 20),
      subjectId: subject.french,
      sortOrder: 4,
      yearId,
      userId,
    },
  ]);

  // -------------------------------------------------------------------- calendar
  await db.insert(calendarEvents).values([
    {
      eventKind: "event",
      title: "Conseil de classe",
      startsAt: day(4, 17),
      endsAt: day(4, 19),
      location: "Salle des professeurs",
      yearId,
      userId,
    },
    {
      eventKind: "holiday",
      title: "Vacances",
      startsAt: day(12, 0),
      endsAt: day(26, 23),
      allDay: true,
      yearId,
      userId,
    },
    {
      eventKind: "block",
      title: "Revisions - plage bloquee",
      startsAt: day(1, 18),
      endsAt: day(1, 20),
      yearId,
      userId,
    },
  ]);

  // ------------------------------------------------------------------- materials
  const chapter = newId("mfold");
  const labs = newId("mfold");
  const corrections = newId("mfold");
  await db.insert(materialFolders).values([
    {
      id: chapter,
      name: "Chapitre 6 - Suites",
      parentId: null,
      subjectId: subject.maths,
      sortOrder: 0,
      yearId,
      userId,
    },
    {
      id: corrections,
      name: "Corriges",
      parentId: chapter,
      subjectId: subject.maths,
      sortOrder: 0,
      yearId,
      userId,
    },
    {
      id: labs,
      name: "Travaux pratiques",
      parentId: null,
      subjectId: subject.physics,
      sortOrder: 1,
      yearId,
      userId,
    },
  ]);

  const filmedCourse = newId("mdoc");
  await db.insert(materialDocuments).values([
    {
      id: filmedCourse,
      title: "Cours filme - suites adjacentes",
      folderId: chapter,
      sourceType: "link",
      sourceUrl: "https://www.youtube.com/watch?v=demo-suites",
      yearId,
      userId,
    },
    {
      title: "Notes prises en TD",
      folderId: chapter,
      sourceType: "text",
      textContent:
        "Convergence : montrer que la suite est croissante et majoree.",
      yearId,
      userId,
    },
    {
      title: "Corrige du DS 3",
      folderId: corrections,
      sourceType: "text",
      textContent: "Question 2 : l inegalite se demontre par recurrence.",
      yearId,
      userId,
    },
    {
      title: "Protocole de dosage",
      folderId: labs,
      sourceType: "text",
      textContent: "Burette, becher, indicateur colore. Relever le volume.",
      yearId,
      userId,
    },
    {
      title: "Article - la loi de Beer-Lambert",
      folderId: labs,
      sourceType: "link",
      sourceUrl: "https://fr.wikipedia.org/wiki/Loi_de_Beer-Lambert",
      yearId,
      userId,
    },
    {
      title: "Annales non classees",
      folderId: null,
      sourceType: "text",
      textContent: "A ranger : sujets 2022 a 2024.",
      yearId,
      userId,
    },
  ]);

  const recurrenceSheet = newId("sdoc");
  await db.insert(studyDocuments).values([
    {
      id: recurrenceSheet,
      kind: "fiche",
      title: "Fiche - raisonnement par recurrence",
      bodyMarkdown:
        "# Recurrence\n\n## Initialisation\nVerifier le premier rang.\n\n## Heredite\nSupposer vrai au rang n, montrer au rang n + 1.\n",
      folderId: chapter,
      subjectId: subject.maths,
      yearId,
      userId,
    },
    {
      kind: "fiche",
      title: "Fiche - dosages acido-basiques",
      bodyMarkdown:
        "# Dosages\n\nEquivalence : les reactifs sont dans les proportions stoechiometriques.\n",
      folderId: labs,
      subjectId: subject.physics,
      yearId,
      userId,
    },
    {
      kind: "note",
      title: "A revoir avant les vacances",
      bodyMarkdown: "- Suites\n- Dosages\n- Vocabulaire unite 6\n",
      folderId: null,
      subjectId: null,
      yearId,
      userId,
    },
  ]);

  // ------------------------------------------------------- study projects
  // Plan 028's corpus: a bounded set of sources the assistant answers from.
  // Without one, /projects opens on an empty state and nothing downstream —
  // retrieval, citations, the assistant's context — can be tried at all.
  const suitesProject = newId("proj");
  await db.insert(studyProjects).values({
    id: suitesProject,
    title: "Suites et recurrence",
    description:
      "Tout ce qui sert pour le controle de mardi : le cours filme, la fiche et les corriges.",
    yearId,
    subjectId: subject.maths,
    userId,
  });
  // A project may only point at something the corpus registry knows: a
  // trigger enforces it ("project item source is not owned or
  // year-compatible"), which is plan 028's rule that an answer must be able to
  // cite an owned, indexed source rather than a bare row id.
  const projectSources = [
    {
      ownerId: userId,
      originKind: "material" as const,
      originId: filmedCourse,
    },
    {
      ownerId: userId,
      originKind: "study-document" as const,
      originId: recurrenceSheet,
    },
  ];
  for (const identity of projectSources) {
    await coreCorpusIndexService.ensureRegistered(identity);
  }
  await db.insert(studyProjectItems).values([
    {
      projectId: suitesProject,
      kind: "material",
      referenceId: filmedCourse,
      position: 0,
      label: "Cours filme - suites adjacentes",
    },
    {
      projectId: suitesProject,
      kind: "study-document",
      referenceId: recurrenceSheet,
      position: 1,
      label: "Fiche - raisonnement par recurrence",
    },
  ]);
  // A source marked ready without an immutable version made Projects claim
  // that it was searchable while Studio correctly reported zero usable
  // inputs. Index through the production service so the demo exercises the
  // same current-version pointer, FTS publication and project references as a
  // real import.
  for (const identity of projectSources) {
    await coreCorpusIndexService.indexSource(identity);
  }

  // ---------------------------------------------------- assistant thread
  // One finished exchange, attached to the project above, so /assistant opens
  // on a conversation instead of an empty state and the rail, the branch
  // model and the message rendering all have something real to draw.
  const thread = newId("thr");
  const branch = newId("br");
  const askId = newId("msg");
  const answerId = newId("msg");
  // The thread names its branch and the branch names its thread, and a
  // trigger checks both ways ("assistant active branch must belong to
  // thread"), so neither can be written already pointing at the other.
  await db.insert(assistantThreads).values({
    id: thread,
    userId,
    title: "Reviser les suites avant mardi",
    projectId: suitesProject,
  });
  await db.insert(assistantBranches).values({
    id: branch,
    threadId: thread,
    name: "principale",
  });
  await db.insert(assistantMessages).values([
    {
      id: askId,
      threadId: thread,
      parentMessageId: null,
      role: "user",
      authorship: "user",
      status: "complete",
      partsJson: [
        {
          type: "text",
          id: newId("part"),
          markdown:
            "Je bloque sur la recurrence. Tu peux me remettre les etapes a partir de ma fiche ?",
        },
      ],
      createdAt: day(-2, 18),
    },
    {
      id: answerId,
      threadId: thread,
      parentMessageId: askId,
      role: "assistant",
      authorship: "model",
      status: "complete",
      partsJson: [
        {
          type: "text",
          id: newId("part"),
          markdown:
            "Ta fiche donne deux etapes. 1) Initialisation : verifier la propriete au premier rang. 2) Heredite : la supposer vraie au rang n, la montrer au rang n + 1. Ce qui manque souvent, c'est de dire ou l'hypothese sert dans le calcul du rang suivant.",
        },
      ],
      createdAt: day(-2, 19),
    },
  ]);
  await db
    .update(assistantBranches)
    .set({ headMessageId: answerId })
    .where(eq(assistantBranches.id, branch));
  await db
    .update(assistantThreads)
    .set({ activeBranchId: branch })
    .where(eq(assistantThreads.id, thread));

  // -------------------------------------------------------- learning loop
  // Plan 037's evidence model, small but complete: concepts, the objectives
  // under them, and one mastery projection with the interval it is honest
  // about. Without it /learning opens on an empty state and the part the plan
  // calls Avermate's differentiation cannot be looked at at all.
  const conceptSet = newId("lcset");
  const recurrenceConcept = newId("lconc");
  const limitsConcept = newId("lconc");
  const initialisation = newId("lobj");
  const heredity = newId("lobj");
  const comparison = newId("lobj");
  await db.insert(learningConceptSets).values({
    id: conceptSet,
    title: "Analyse - premiere partie",
    namespace: "local",
    yearId,
    subjectId: subject.maths,
    userId,
  });
  await db.insert(learningConcepts).values([
    {
      id: recurrenceConcept,
      setId: conceptSet,
      stableKey: "recurrence",
      canonicalLabel: "Raisonnement par recurrence",
      description: "Montrer une propriete pour tout entier a partir d'un rang.",
      sortOrder: 0,
      yearId,
      subjectId: subject.maths,
      userId,
    },
    {
      id: limitsConcept,
      setId: conceptSet,
      stableKey: "limites-suites",
      canonicalLabel: "Limites de suites",
      description: "Comportement d'une suite quand n devient grand.",
      sortOrder: 1,
      yearId,
      subjectId: subject.maths,
      userId,
    },
  ]);
  await db.insert(learningObjectives).values([
    {
      id: initialisation,
      conceptId: recurrenceConcept,
      statement: "Verifier l'initialisation au bon rang.",
      expectedLevel: 3,
      yearId,
      subjectId: subject.maths,
      userId,
    },
    {
      id: heredity,
      conceptId: recurrenceConcept,
      statement:
        "Utiliser l'hypothese de recurrence dans le passage au rang suivant.",
      expectedLevel: 4,
      yearId,
      subjectId: subject.maths,
      userId,
    },
    {
      id: comparison,
      conceptId: limitsConcept,
      statement: "Appliquer un theoreme de comparaison pour conclure.",
      expectedLevel: 3,
      yearId,
      subjectId: subject.maths,
      userId,
    },
  ]);

  // One objective solid, one still uncertain: the interval is the point, so a
  // demo that only ever showed a confident estimate would misrepresent it.
  const projections = [
    {
      objectiveId: initialisation,
      estimate: 0.82,
      low: 0.71,
      high: 0.9,
      alpha: 9,
      beta: 2,
      count: 11,
    },
    {
      objectiveId: heredity,
      estimate: 0.46,
      low: 0.24,
      high: 0.69,
      alpha: 3,
      beta: 4,
      count: 4,
    },
  ];
  for (const [index, projection] of projections.entries()) {
    const projectionId = newId("lproj");
    await db.insert(learningMasteryProjections).values({
      id: projectionId,
      objectiveId: projection.objectiveId,
      generation: 1,
      algorithmRevision: "beta-binomial-v1",
      evidenceCursor: `seed-${index}`,
      asOf: day(-1, 20),
      estimate: projection.estimate,
      low: projection.low,
      high: projection.high,
      alpha: projection.alpha,
      beta: projection.beta,
      evidenceCount: projection.count,
      freshnessDays: 1,
      // The schema will not store a projection without one: plan 037 is an
      // evidence model, so an estimate that cannot say what it rests on is
      // not a thing this table is willing to hold.
      explanationJson: {
        version: 1,
        prior: { alpha: 1, beta: 1 },
        asOf: day(-1, 20).toISOString(),
        contributions: [
          {
            evidenceId: `seed-evidence-${index}`,
            included: true,
            normalizedOutcome: projection.estimate,
            reliability: 0.8,
            recencyWeight: 1,
            difficulty: null,
            alphaContribution: projection.alpha - 1,
            betaContribution: projection.beta - 1,
          },
        ],
      },
      digest: `seed-digest-${index}`,
      userId,
    });
    await db.insert(learningMasteryCurrent).values({
      objectiveId: projection.objectiveId,
      projectionId,
      generation: 1,
      evidenceCursor: `seed-${index}`,
      userId,
    });
  }

  // -------------------------------------------------------- action ledger
  // Plan 030: what the assistant changed, and what can still be undone. One
  // finished write and one still waiting on the reader, so /assistant/actions
  // shows both the record and the approval it is there to ask for.
  // The ledger numbers from 1 — `agent_actions_sequence_check` is `> 0`.
  const taskActionId = newId("aact");
  const gradeActionId = newId("aact");
  await db.insert(agentActionSequences).values({ userId, nextSequence: 3 });
  await db.insert(agentActions).values([
    {
      id: taskActionId,
      userId,
      actorKind: "embedded-agent",
      threadId: thread,
      branchId: branch,
      toolId: "planning.tasks.create",
      toolVersion: 1,
      effect: "create",
      risk: "low",
      argumentsHash: demoActionDigests.task.argumentsHash,
      idempotencyKey: "seed-action-task",
      actionSequence: 1,
      redactedInputJson: {
        title: "Refaire les exercices 12 a 18",
        dueAt: isoDay(day(1)),
      },
      previewJson: { creates: 1, updates: 0, deletes: 0 },
      previewHash: demoActionDigests.task.previewHash,
      status: "completed",
      resultSummaryJson: { created: "Refaire les exercices 12 a 18" },
      startedAt: day(-2, 19),
      completedAt: day(-2, 19),
    },
    {
      id: gradeActionId,
      userId,
      actorKind: "embedded-agent",
      threadId: thread,
      branchId: branch,
      toolId: "grades.update",
      toolVersion: 1,
      effect: "update",
      // Higher risk on purpose: this is the case the approval flow exists for,
      // and a demo where everything is low risk never shows it.
      risk: "high",
      argumentsHash: demoActionDigests.grade.argumentsHash,
      idempotencyKey: "seed-action-grade",
      actionSequence: 2,
      redactedInputJson: {
        subject: "Mathematiques",
        note: "corriger 12 -> 12.5",
      },
      previewJson: { creates: 0, updates: 1, deletes: 0 },
      previewHash: demoActionDigests.grade.previewHash,
      status: "awaiting-approval",
    },
  ]);
  await db.insert(agentApprovals).values({
    actionId: gradeActionId,
    userId,
    argumentsHash: demoActionDigests.grade.argumentsHash,
    previewHash: demoActionDigests.grade.previewHash,
    expiresAt: day(7, 19),
    createdAt: now,
  });
}

async function seedSocialDemo(primary: Awaited<ReturnType<typeof seedFull>>) {
  const peer = await account("social-peer@avermate.fr", "Alex Demo");
  const now = new Date();
  const peerStartsAt = new Date(primary.year.startsAt);
  const peerEndsAt = new Date(primary.year.endsAt);
  const [peerYear] = await db
    .insert(years)
    .values({
      name: primary.year.name,
      startsAt: peerStartsAt,
      endsAt: peerEndsAt,
      scale: 20,
      defaultOutOf: 20,
      passingRatio: 0.5,
      decimals: 2,
      userId: peer.id,
    })
    .returning();
  if (!peerYear) throw new Error("The social demo peer year was not created");
  const [peerSubject] = await db
    .insert(subjects)
    .values({
      name: "Matière de démonstration",
      yearId: peerYear.id,
      userId: peer.id,
    })
    .returning();
  if (!peerSubject)
    throw new Error("The social demo peer subject was not created");
  await db.insert(grades).values({
    name: "Résultat de démonstration",
    value: 14,
    outOf: 20,
    coefficient: 1,
    passedAt: new Date(
      peerStartsAt.getTime() +
        (peerEndsAt.getTime() - peerStartsAt.getTime()) / 2,
    ),
    subjectId: peerSubject.id,
    yearId: peerYear.id,
    userId: peer.id,
  });

  for (const [user, handle, sharedYear] of [
    [primary.user, "camille-demo", primary.year],
    [peer, "alex-demo", peerYear],
  ] as const) {
    await db.insert(socialProfiles).values({
      userId: user.id,
      handle,
      sharedYearId: sharedYear.id,
      shareGeneralAverage: true,
      shareSubjectsMode: "all",
    });
  }
  const [low, high] = canonicalPair(primary.user.id, peer.id);
  await db.insert(friendships).values({ userLowId: low, userHighId: high });

  const [group] = await db
    .insert(socialGroups)
    .values({
      ownerUserId: primary.user.id,
      name: "Groupe de démonstration",
      description: "Comparez vos moyennes générales.",
    })
    .returning();
  if (!group) throw new Error("The social demo group was not created");
  for (const [user, role] of [
    [primary.user, "owner"],
    [peer, "member"],
  ] as const) {
    await db.insert(groupMemberships).values({
      groupId: group.id,
      userId: user.id,
      role,
      shareAverage: true,
    });
  }
  console.info("Social demo: friendship + group with shared averages");
}

// ---------------------------------------------------------------- the blank

async function seedBlank(email: string, name: string) {
  await account(email, name);
  console.info(`Empty account:    ${email} / ${PASSWORD}`);
  console.info("  Signing in lands straight on onboarding.");
}

// -------------------------------------------------------------- the cohort

const COHORT_EMAIL_DOMAIN = "@seed.avermate.example";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function dateAtLeast(value: Date, minimum: Date): Date {
  return new Date(Math.max(value.getTime(), minimum.getTime()));
}

function activityDates(
  profile: DemoProfile,
  count: number,
  now: Date,
  last30Only = false,
): Date[] {
  if (count <= 0) return [];
  const endsAt = profile.activity.lastActiveAt;
  const lowerBound = dateAtLeast(
    new Date(now.getTime() - 29 * DAY_MS),
    profile.activity.createdAt,
  );
  if (last30Only && endsAt.getTime() < lowerBound.getTime()) return [];
  const startsAt = last30Only
    ? lowerBound
    : new Date(Math.min(endsAt.getTime(), lowerBound.getTime()));
  const duration = endsAt.getTime() - startsAt.getTime();
  return Array.from(
    { length: count },
    (_, index) =>
      new Date(startsAt.getTime() + (duration * (index + 1)) / count),
  );
}

function gradeActivityById(demo: DemoUser, now: Date): Map<string, Date> {
  const allGrades = demo.years
    .flatMap((year) => year.grades)
    .filter(
      (grade) =>
        grade.passedAt.getTime() <=
        demo.profile.activity.lastActiveAt.getTime(),
    )
    .sort((left, right) => left.passedAt.getTime() - right.passedAt.getTime());
  const requestedCount = Math.min(
    demo.profile.activity.gradeEvents30,
    allGrades.length,
  );
  const dates = activityDates(demo.profile, requestedCount, now, true);
  const recentGrades = dates.length === 0 ? [] : allGrades.slice(-dates.length);
  return new Map(
    recentGrades.map(
      (grade, index) =>
        [grade.id, dateAtLeast(dates[index]!, grade.passedAt)] as const,
    ),
  );
}

async function insertBatches<T>(
  rows: readonly T[],
  insert: (batch: T[]) => unknown,
  size = 40,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += size) {
    await insert(rows.slice(offset, offset + size));
  }
}

function sessionRowsFor(
  profile: DemoProfile,
  profileIndex: number,
  now: Date,
): Array<typeof sessions.$inferInsert> {
  const count = Math.max(
    1,
    Math.min(3, Math.ceil(profile.activity.activeDays30 / 10)),
  );
  const dates = activityDates(profile, count, now);
  const agents = [
    "Avermate demo · Chrome desktop",
    "Avermate demo · Expo mobile",
    "Avermate demo · Safari tablet",
  ];

  return dates.map((updatedAt, index) => {
    const createdAt = dateAtLeast(
      new Date(
        updatedAt.getTime() -
          Math.max(1, Math.floor(profile.activity.activeDays30 / count)) *
            DAY_MS,
      ),
      profile.activity.createdAt,
    );
    return {
      id: `${profile.id}_session_${index + 1}`,
      token: newId("seed_ses", 32),
      createdAt,
      updatedAt,
      expiresAt: new Date(
        updatedAt.getTime() + (profile.banned ? HOUR_MS : 30 * DAY_MS),
      ),
      ipAddress: `192.0.2.${((profileIndex * 3 + index) % 250) + 1}`,
      userAgent: agents[index]!,
      userId: profile.id,
    };
  });
}

async function seedCohort(size: number, seed: number | undefined) {
  assertSeedAllowed();

  const now = new Date();
  const cohort = buildDemoCohort({ size, seed, now });
  if (
    cohort.some(({ profile }) => !profile.email.endsWith(COHORT_EMAIL_DOMAIN))
  ) {
    throw new Error("The synthetic cohort escaped its reserved email domain.");
  }

  const credentialPassword = await Bun.password.hash(PASSWORD, "argon2id");
  const userRows: Array<typeof users.$inferInsert> = [];
  const accountRows: Array<typeof accounts.$inferInsert> = [];
  const sessionRows: Array<typeof sessions.$inferInsert> = [];
  const yearRows: Array<typeof years.$inferInsert> = [];
  const periodRows: Array<typeof periods.$inferInsert> = [];
  const subjectRows: Array<typeof subjects.$inferInsert> = [];
  const gradeRows: Array<typeof grades.$inferInsert> = [];
  const componentRows: Array<typeof gradeComponents.$inferInsert> = [];
  const averageRows: Array<typeof customAverages.$inferInsert> = [];
  const averageEntryRows: Array<typeof customAverageEntries.$inferInsert> = [];
  const goalRows: Array<typeof goals.$inferInsert> = [];
  const cardRows: Array<typeof dashboardCards.$inferInsert> = [];
  const cardReferenceRows: Array<typeof dashboardCardReferences.$inferInsert> =
    [];

  for (const [profileIndex, demo] of cohort.entries()) {
    const { profile } = demo;
    const providerId = profile.provider;
    const profileUpdatedAt = dateAtLeast(
      profile.activity.lastActiveAt,
      profile.activity.createdAt,
    );
    const recentGradeActivity = gradeActivityById(demo, now);
    userRows.push({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      emailVerified: profile.emailVerified,
      role: profile.role,
      banned: profile.banned,
      banReason: profile.banReason,
      createdAt: profile.activity.createdAt,
      updatedAt: profileUpdatedAt,
    });
    accountRows.push({
      id: `${profile.id}_account_${providerId}`,
      accountId:
        providerId === "credential"
          ? profile.id
          : `${providerId}:${profile.id}`,
      providerId,
      issuer: demoAccountIssuer(providerId),
      userId: profile.id,
      password: providerId === "credential" ? credentialPassword : null,
      createdAt: profile.activity.createdAt,
      updatedAt: profileUpdatedAt,
    });
    sessionRows.push(...sessionRowsFor(profile, profileIndex, now));

    for (const year of demo.years) {
      const createdAt = dateAtLeast(year.startsAt, profile.activity.createdAt);
      const updatedAt = dateAtLeast(profile.activity.lastActiveAt, createdAt);
      yearRows.push({
        id: year.id,
        name: `${year.name} · ${year.track}`,
        startsAt: year.startsAt,
        endsAt: year.endsAt,
        scale: year.scale,
        defaultOutOf: year.defaultOutOf,
        passingRatio: year.passingRatio,
        decimals: year.decimals,
        sortOrder: year.sortOrder,
        userId: profile.id,
        createdAt,
        updatedAt,
      });
      periodRows.push(
        ...year.periods.map((period) => ({
          ...period,
          yearId: year.id,
          userId: profile.id,
          createdAt,
          updatedAt,
        })),
      );
      subjectRows.push(
        ...year.subjects.map((subject) => ({
          ...subject,
          yearId: year.id,
          userId: profile.id,
          createdAt,
          updatedAt,
        })),
      );

      for (const grade of year.grades) {
        const recordedAt = dateAtLeast(
          dateAtLeast(
            recentGradeActivity.get(grade.id) ?? grade.passedAt,
            grade.passedAt,
          ),
          profile.activity.createdAt,
        );
        gradeRows.push({
          id: grade.id,
          name: grade.name,
          value: grade.value,
          outOf: grade.outOf,
          coefficient: grade.coefficient,
          isComposite: grade.isComposite,
          note: grade.note,
          passedAt: grade.passedAt,
          subjectId: grade.subjectId,
          periodId: grade.periodId,
          yearId: year.id,
          userId: profile.id,
          createdAt: recordedAt,
          updatedAt: recordedAt,
        });
        componentRows.push(
          ...grade.components.map((component) => ({
            ...component,
            gradeId: grade.id,
            userId: profile.id,
            createdAt: recordedAt,
            updatedAt: recordedAt,
          })),
        );
      }

      for (const average of year.customAverages) {
        averageRows.push({
          id: average.id,
          name: average.name,
          isMain: average.isMain,
          sortOrder: average.sortOrder,
          yearId: year.id,
          userId: profile.id,
          createdAt,
          updatedAt,
        });
        averageEntryRows.push(
          ...average.entries.map((entry, index) => ({
            id: `${average.id}_entry_${index + 1}`,
            averageId: average.id,
            subjectId: entry.subjectId,
            coefficient: entry.coefficient,
            includeChildren: entry.includeChildren,
          })),
        );
      }

      goalRows.push(
        ...year.goals.map((goal) => ({
          ...goal,
          yearId: year.id,
          userId: profile.id,
          createdAt,
          updatedAt,
        })),
      );

      const defaultCardRows = demoDefaultCards(year.id, profile.id, {
        id: (index) => `${year.id}_card_${index + 1}`,
        at: createdAt,
      });
      const featuredAverage = year.customAverages[1] ?? year.customAverages[0];
      const featuredGoal = year.goals[0];
      const yearCards = [...defaultCardRows];
      if (featuredAverage) {
        yearCards.push(
          demoCard({
            id: `${year.id}_card_custom_average`,
            semantics: {
              metric: "average",
              targetKind: "custom",
              targetId: featuredAverage.id,
              goalId: null,
              display: "sparkline",
            },
            span: 2,
            title: featuredAverage.name,
            sortOrder: defaultCardRows.length + 1,
            yearId: year.id,
            userId: profile.id,
            createdAt,
            updatedAt,
          }),
        );
      }
      if (featuredGoal) {
        yearCards.push(
          demoCard({
            id: `${year.id}_card_goal`,
            semantics: {
              metric: "goalProgress",
              targetKind: featuredGoal.kind,
              targetId: featuredGoal.referenceId,
              goalId: featuredGoal.id,
              display: "gauge",
            },
            span: 2,
            title: featuredGoal.name,
            sortOrder: defaultCardRows.length + 2,
            yearId: year.id,
            userId: profile.id,
            createdAt,
            updatedAt,
          }),
        );
      }
      cardRows.push(...yearCards.map((card) => card.row));
      cardReferenceRows.push(...yearCards.flatMap((card) => card.references));
    }
  }

  await db.transaction(async (tx) => {
    // This is the only destructive cohort operation: showcase, local and real
    // accounts use another domain and can never match this suffix.
    await tx.delete(users).where(like(users.email, `%${COHORT_EMAIL_DOMAIN}`));
    await insertBatches(userRows, (batch) => tx.insert(users).values(batch));
    await insertBatches(accountRows, (batch) =>
      tx.insert(accounts).values(batch),
    );
    await insertBatches(sessionRows, (batch) =>
      tx.insert(sessions).values(batch),
    );
    await insertBatches(yearRows, (batch) => tx.insert(years).values(batch));
    await insertBatches(periodRows, (batch) =>
      tx.insert(periods).values(batch),
    );
    await insertBatches(subjectRows, (batch) =>
      tx.insert(subjects).values(batch),
    );
    await insertBatches(gradeRows, (batch) => tx.insert(grades).values(batch));
    await insertBatches(componentRows, (batch) =>
      tx.insert(gradeComponents).values(batch),
    );
    await insertBatches(averageRows, (batch) =>
      tx.insert(customAverages).values(batch),
    );
    await insertBatches(averageEntryRows, (batch) =>
      tx.insert(customAverageEntries).values(batch),
    );
    await insertBatches(goalRows, (batch) => tx.insert(goals).values(batch));
    await insertBatches(cardRows, (batch) =>
      tx.insert(dashboardCards).values(batch),
    );
    await insertBatches(cardReferenceRows, (batch) =>
      tx.insert(dashboardCardReferences).values(batch),
    );
  });

  console.info(
    `Synthetic cohort: ${cohort.length} users · ${yearRows.length} years · ${subjectRows.length} subjects · ${gradeRows.length} grades`,
  );
  console.info(
    `  Reserved accounts: *${COHORT_EMAIL_DOMAIN} / ${PASSWORD} (credentials only)`,
  );
}

async function main() {
  if (SHOW_HELP) {
    console.info(`Usage: bun scripts/seed-demo.ts [mode] [options]

Modes (mutually exclusive):
  --full                 Seed only the showcase account
  --blank                Seed only the onboarding account
  --cohort               Seed only synthetic admin-panel data
  no mode                Seed showcase, cohort, then onboarding account

Cohort options:
  --users N              Synthetic users (default 48, maximum 500)
  --seed N               Reproducible safe-integer random seed

Account options:
  --email VALUE          Override --full or --blank email
  --name VALUE           Override --full or --blank display name
  --password VALUE       Demo credential password

All demo modes are blocked in production and only run against :memory: or
file: databases.`);
    return;
  }

  assertSeedAllowed();
  const everything = selectedModes.length === 0;
  const includeCohort = everything || ONLY_COHORT;

  if (
    (ONLY_BLANK || ONLY_FULL) &&
    (argument("--users") !== undefined || argument("--seed") !== undefined)
  ) {
    throw new Error("--users and --seed can only be used with the cohort.");
  }
  if (everything || ONLY_FULL) {
    const full = await seedFull(
      argument("--email") ?? "demo@avermate.fr",
      argument("--name") ?? "Camille Demo",
    );
    if (SOCIAL_DEMO_ENABLED) await seedSocialDemo(full);
  }

  if (includeCohort) {
    await seedCohort(COHORT_SIZE, COHORT_SEED);
  }

  if (everything || ONLY_BLANK) {
    await seedBlank(
      (ONLY_BLANK ? argument("--email") : undefined) ?? "new@avermate.fr",
      (ONLY_BLANK ? argument("--name") : undefined) ?? "Nouvel Élève",
    );
  }
}

await main();
process.exit(0);
