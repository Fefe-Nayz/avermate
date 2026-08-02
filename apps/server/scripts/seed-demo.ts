/**
 * Seeds a demo account.
 *
 *   bun scripts/seed-demo.ts            a plausible year of results
 *   bun scripts/seed-demo.ts --blank    a fresh account, no year
 *   bun scripts/seed-demo.ts --email me@example.com --name "…"
 *
 * The populated account exists because an empty dashboard tells you nothing
 * about whether the dashboard works. The blank one exists for the opposite
 * reason: onboarding only runs once per account, so seeing it again means
 * starting over from nothing.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  customAverageEntries,
  customAverages,
  dashboardCards,
  goals,
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

const BLANK = process.argv.includes("--blank");
const EMAIL = argument("--email") ?? (BLANK ? "new@avermate.fr" : "demo@avermate.fr");
const PASSWORD = argument("--password") ?? "demo-account-2026";
const NAME = argument("--name") ?? (BLANK ? "Nouvel Élève" : "Camille Demo");

async function main() {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, EMAIL))
    .limit(1);

  if (existing) {
    await db.delete(users).where(eq(users.id, existing.id));
    console.info("Removed the previous demo account.");
  }

  await auth.api.signUpEmail({
    body: { name: NAME, email: EMAIL, password: PASSWORD },
  });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, EMAIL))
    .limit(1);
  if (!user) throw new Error("The demo account was not created");

  await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, user.id));

  // A verified account with no year is exactly the state onboarding is for:
  // the year gate sends it straight there on first sign-in.
  if (BLANK) {
    console.info(`Blank account ready: ${EMAIL} / ${PASSWORD}`);
    console.info("Signing in lands on /onboarding.");
    return;
  }

  // Relative to today so the demo is always mid-year: a finished year makes
  // every goal read as locked in or out of reach, which shows nothing.
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
      userId: user.id,
    })
    .returning();
  if (!year) throw new Error("The demo year was not created");

  const at = (fraction: number) =>
    new Date(
      startsAt.getTime() + (endsAt.getTime() - startsAt.getTime()) * fraction,
    );

  const periodRows = await db
    .insert(periods)
    .values([
      { name: "Trimestre 1", startAt: at(0), endAt: at(1 / 3), sortOrder: 0, yearId: year.id, userId: user.id },
      { name: "Trimestre 2", startAt: at(1 / 3), endAt: at(2 / 3), sortOrder: 1, yearId: year.id, userId: user.id },
      { name: "Trimestre 3", startAt: at(2 / 3), endAt: at(1), sortOrder: 2, yearId: year.id, userId: user.id },
    ])
    .returning();

  interface Node {
    id: string;
    name: string;
    parentId: string | null;
    coefficient: number;
    kind: "subject" | "category";
    isMain: boolean;
  }

  const science = newId("sub");
  const maths = newId("sub");
  const physics = newId("sub");
  const humanities = newId("sub");
  const french = newId("sub");
  const frenchWritten = newId("sub");
  const frenchOral = newId("sub");
  const english = newId("sub");
  const sport = newId("sub");

  const tree: Node[] = [
    { id: science, name: "Sciences", parentId: null, coefficient: 1, kind: "category", isMain: false },
    { id: maths, name: "Mathématiques", parentId: science, coefficient: 7, kind: "subject", isMain: true },
    { id: physics, name: "Physique-Chimie", parentId: science, coefficient: 5, kind: "subject", isMain: true },
    { id: humanities, name: "Humanités", parentId: null, coefficient: 1, kind: "category", isMain: false },
    { id: french, name: "Français", parentId: humanities, coefficient: 4, kind: "subject", isMain: true },
    { id: frenchWritten, name: "Français — Écrit", parentId: french, coefficient: 3, kind: "subject", isMain: false },
    { id: frenchOral, name: "Français — Oral", parentId: french, coefficient: 1, kind: "subject", isMain: false },
    { id: english, name: "Anglais", parentId: humanities, coefficient: 3, kind: "subject", isMain: true },
    { id: sport, name: "Sport", parentId: null, coefficient: 1, kind: "subject", isMain: false },
  ];

  await db.insert(subjects).values(
    tree.map((node, index) => ({
      ...node,
      shortName: null,
      sortOrder: index,
      yearId: year.id,
      userId: user.id,
    })),
  );

  const plan: Array<[string, string, number, number, number]> = [
    // subject, name, value, out of, fraction through the year
    [maths, "DS 1 — Suites", 12, 20, 0.06],
    [maths, "DS 2 — Dérivation", 14.5, 20, 0.16],
    [maths, "Interrogation", 9, 20, 0.22],
    [maths, "DS 3 — Intégrales", 15.5, 20, 0.34],
    [maths, "Bac blanc", 16, 20, 0.52],
    [maths, "DS 4 — Probabilités", 13, 20, 0.68],
    [physics, "TP Optique", 16, 20, 0.09],
    [physics, "DS 1 — Mécanique", 11, 20, 0.19],
    [physics, "DS 2 — Chimie", 13.5, 20, 0.37],
    [physics, "Bac blanc", 12, 20, 0.53],
    [frenchWritten, "Dissertation", 11, 20, 0.12],
    [frenchWritten, "Commentaire", 13, 20, 0.31],
    [frenchWritten, "Bac blanc écrit", 14, 20, 0.55],
    [frenchOral, "Oral blanc", 15, 20, 0.58],
    [english, "Compréhension", 17, 20, 0.11],
    [english, "Expression écrite", 15, 20, 0.28],
    [english, "Oral", 18, 20, 0.49],
    [sport, "Demi-fond", 17, 20, 0.21],
    [sport, "Badminton", 19, 20, 0.62],
  ];

  await db.insert(grades).values(
    plan.map(([subjectId, name, value, outOf, fraction]) => {
      const passedAt = at(fraction);
      const period = periodRows.find(
        (candidate) =>
          passedAt >= candidate.startAt && passedAt <= candidate.endAt,
      );
      return {
        name,
        value,
        outOf,
        coefficient: name.startsWith("Bac blanc") ? 2 : 1,
        passedAt,
        subjectId,
        periodId: period?.id ?? null,
        yearId: year.id,
        userId: user.id,
      };
    }),
  );

  const [written] = await db
    .insert(customAverages)
    .values({
      name: "Moyenne des écrits",
      isMain: false,
      sortOrder: 0,
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

  await db.insert(goals).values([
    {
      name: "Mention bien",
      kind: "general",
      referenceId: null,
      targetRatio: 0.7,
      periodId: null,
      dueAt: endsAt,
      isPinned: true,
      sortOrder: 0,
      yearId: year.id,
      userId: user.id,
    },
    {
      name: "15 en maths",
      kind: "subject",
      referenceId: maths,
      targetRatio: 0.75,
      periodId: null,
      dueAt: null,
      isPinned: true,
      sortOrder: 1,
      yearId: year.id,
      userId: user.id,
    },
  ]);

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
      yearId: year.id,
      userId: user.id,
    })),
  );

  console.info(`Demo account ready: ${EMAIL} / ${PASSWORD}`);
}

await main();
process.exit(0);
