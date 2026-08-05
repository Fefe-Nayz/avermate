/**
 * Seeds the two demo accounts.
 *
 *   bun scripts/seed-demo.ts            both
 *   bun scripts/seed-demo.ts --blank    only the empty one
 *   bun scripts/seed-demo.ts --full     only the complete one
 *   bun scripts/seed-demo.ts --full --email me@example.com --name "…"
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
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  customAverageEntries,
  customAverages,
  dashboardCards,
  goals,
  gradeComponents,
  grades,
  periods,
  subjects,
  users,
  years,
} from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { newId } from "../src/lib/id";
import { defaultCards } from "@avermate/core";

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const ONLY_BLANK = process.argv.includes("--blank");
const ONLY_FULL = process.argv.includes("--full");
const PASSWORD = argument("--password") ?? "demo-account-2026";

/** Wipe and recreate, so re-running always lands on the same starting point. */
async function account(email: string, name: string) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) await db.delete(users).where(eq(users.id, existing.id));

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
      { name: "Trimestre 1", startAt: at(0), endAt: at(1 / 3), isCumulative: false, sortOrder: 0, yearId: year.id, userId: user.id },
      { name: "Trimestre 2", startAt: at(1 / 3), endAt: at(2 / 3), isCumulative: false, sortOrder: 1, yearId: year.id, userId: user.id },
      { name: "Trimestre 3", startAt: at(2 / 3), endAt: at(1), isCumulative: false, sortOrder: 2, yearId: year.id, userId: user.id },
    ])
    .returning();

  // The previous year uses cumulative semesters, so both period behaviours
  // exist inside one account.
  await db.insert(periods).values([
    { name: "Semestre 1", startAt: atPast(0), endAt: atPast(0.5), isCumulative: false, sortOrder: 0, yearId: past.id, userId: user.id },
    { name: "Semestre 2", startAt: atPast(0.5), endAt: atPast(1), isCumulative: true, sortOrder: 1, yearId: past.id, userId: user.id },
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
    { id: science, name: "Sciences", shortName: "Sci.", parentId: null, coefficient: 1, kind: "category", isMain: false },
    { id: maths, name: "Mathématiques", shortName: "Maths", parentId: science, coefficient: 7, kind: "subject", isMain: true },
    { id: physics, name: "Physique-Chimie", shortName: "PC", parentId: science, coefficient: 5, kind: "subject", isMain: true },
    { id: biology, name: "SVT", shortName: null, parentId: science, coefficient: 3, kind: "subject", isMain: false },

    { id: humanities, name: "Humanités", shortName: "Hum.", parentId: null, coefficient: 1, kind: "category", isMain: false },
    // Three levels deep: a subject whose own children are weighed inside it.
    { id: french, name: "Français", shortName: "Fr.", parentId: humanities, coefficient: 4, kind: "subject", isMain: true },
    { id: frenchWritten, name: "Français — Écrit", shortName: "Fr. écrit", parentId: french, coefficient: 3, kind: "subject", isMain: false },
    { id: frenchOral, name: "Français — Oral", shortName: "Fr. oral", parentId: french, coefficient: 1, kind: "subject", isMain: false },
    { id: history, name: "Histoire-Géographie", shortName: "HG", parentId: humanities, coefficient: 3, kind: "subject", isMain: false },

    { id: english, name: "Anglais", shortName: "Ang.", parentId: null, coefficient: 3, kind: "subject", isMain: true },
    { id: spanish, name: "Espagnol", shortName: "Esp.", parentId: null, coefficient: 2, kind: "subject", isMain: false },
    { id: sport, name: "Sport", shortName: "EPS", parentId: null, coefficient: 1, kind: "subject", isMain: false },
    // Deliberately empty: the "no grade yet" states have to be reachable.
    { id: music, name: "Musique", shortName: null, parentId: null, coefficient: 1, kind: "subject", isMain: false },
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
    { id: pastMaths, name: "Mathématiques", shortName: "Maths", parentId: null, coefficient: 5, kind: "subject" as const, isMain: true, sortOrder: 0, yearId: past.id, userId: user.id },
    { id: pastFrench, name: "Français", shortName: "Fr.", parentId: null, coefficient: 4, kind: "subject" as const, isMain: true, sortOrder: 1, yearId: past.id, userId: user.id },
    { id: pastEnglish, name: "Anglais", shortName: "Ang.", parentId: null, coefficient: 3, kind: "subject" as const, isMain: false, sortOrder: 2, yearId: past.id, userId: user.id },
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
      plan.map(([subjectId, gradeName, value, outOf, fraction, coefficient]) => {
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
      }),
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
    const total = composite.parts.reduce((sum, [, , , weight]) => sum + weight, 0);
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
      { averageId: written.id, subjectId: maths, coefficient: 1, includeChildren: false },
      { averageId: written.id, subjectId: physics, coefficient: 1, includeChildren: false },
      { averageId: written.id, subjectId: frenchWritten, coefficient: 1, includeChildren: false },
    ]);
  }

  if (scientific) {
    await db.insert(customAverageEntries).values([
      // Weighted differently from the real tree, which is the point of these.
      { averageId: scientific.id, subjectId: maths, coefficient: 4, includeChildren: false },
      { averageId: scientific.id, subjectId: physics, coefficient: 3, includeChildren: false },
      { averageId: scientific.id, subjectId: biology, coefficient: 2, includeChildren: false },
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

  await db.insert(dashboardCards).values([
    ...defaultCards().map((card) => ({
      surface: "overview",
      metric: card.metric,
      targetKind: card.target.kind,
      targetId: card.target.referenceId,
      goalId: null,
      display: card.display,
      span: card.span,
      title: card.title,
      accent: card.accent,
      sortOrder: card.sortOrder,
      hidden: card.hidden,
      yearId: year.id,
      userId: user.id,
    })),
    // Beyond the defaults: one card per shape the renderer can produce, so a
    // change to any branch of it is visible on the first screen you open.
    {
      surface: "overview",
      metric: "goalProgress",
      targetKind: "general",
      targetId: null,
      goalId: goalRows[0]?.id ?? null,
      display: "gauge",
      span: 2,
      title: null,
      accent: null,
      sortOrder: 20,
      hidden: false,
      yearId: year.id,
      userId: user.id,
    },
    {
      surface: "overview",
      metric: "average",
      targetKind: "custom",
      targetId: scientific?.id ?? null,
      goalId: null,
      display: "sparkline",
      span: 2,
      title: "Sciences, à ma sauce",
      accent: null,
      sortOrder: 21,
      hidden: false,
      yearId: year.id,
      userId: user.id,
    },
    {
      surface: "overview",
      metric: "average",
      targetKind: "subject",
      targetId: maths,
      goalId: null,
      display: "value",
      span: 1,
      title: null,
      accent: null,
      sortOrder: 22,
      hidden: false,
      yearId: year.id,
      userId: user.id,
    },
    {
      surface: "overview",
      metric: "distribution",
      targetKind: "general",
      targetId: null,
      goalId: null,
      display: "chart",
      span: 2,
      title: null,
      accent: null,
      sortOrder: 23,
      hidden: false,
      yearId: year.id,
      userId: user.id,
    },
    {
      surface: "overview",
      metric: "subjectRanking",
      targetKind: "general",
      targetId: null,
      goalId: null,
      display: "list",
      span: 2,
      title: null,
      accent: null,
      sortOrder: 24,
      hidden: false,
      yearId: year.id,
      userId: user.id,
    },
    {
      surface: "overview",
      metric: "passStreak",
      targetKind: "general",
      targetId: null,
      goalId: null,
      display: "value",
      span: 1,
      title: null,
      accent: null,
      sortOrder: 25,
      hidden: false,
      yearId: year.id,
      userId: user.id,
    },
    {
      surface: "overview",
      metric: "lastGrade",
      targetKind: "general",
      targetId: null,
      goalId: null,
      display: "value",
      span: 2,
      title: null,
      accent: null,
      sortOrder: 26,
      hidden: false,
      yearId: year.id,
      userId: user.id,
    },
    {
      // Hidden, so the "show this card again" path has something to restore.
      surface: "overview",
      metric: "median",
      targetKind: "general",
      targetId: null,
      goalId: null,
      display: "value",
      span: 1,
      title: null,
      accent: null,
      sortOrder: 27,
      hidden: true,
      yearId: year.id,
      userId: user.id,
    },
  ]);

  // Cards are per year, so the previous one needs its own.
  await db.insert(dashboardCards).values(
    defaultCards().map((card) => ({
      surface: "overview",
      metric: card.metric,
      targetKind: card.target.kind,
      targetId: card.target.referenceId,
      goalId: null,
      display: card.display,
      span: card.span,
      title: card.title,
      accent: card.accent,
      sortOrder: card.sortOrder,
      hidden: card.hidden,
      yearId: past.id,
      userId: user.id,
    })),
  );

  console.info(`Complete account: ${email} / ${PASSWORD}`);
  console.info(
    `  2 years · ${tree.length} subjects · ${gradeRows.length + composites.length} grades · ${goalRows.length} goals`,
  );
}

// ---------------------------------------------------------------- the blank

async function seedBlank(email: string, name: string) {
  await account(email, name);
  console.info(`Empty account:    ${email} / ${PASSWORD}`);
  console.info("  Signing in lands straight on onboarding.");
}

async function main() {
  const both = !ONLY_BLANK && !ONLY_FULL;

  if (both || ONLY_FULL) {
    await seedFull(
      argument("--email") ?? "demo@avermate.fr",
      argument("--name") ?? "Camille Demo",
    );
  }

  if (both || ONLY_BLANK) {
    await seedBlank(
      (ONLY_BLANK ? argument("--email") : undefined) ?? "new@avermate.fr",
      (ONLY_BLANK ? argument("--name") : undefined) ?? "Nouvel Élève",
    );
  }
}

await main();
process.exit(0);
