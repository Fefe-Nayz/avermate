import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  customAverages,
  dashboardCards,
  goals,
  grades,
  periods,
  subjects,
  years,
} from "../db/schema";
import { notFound } from "./orpc";

/**
 * Ownership checks.
 *
 * Every row in this schema belongs to exactly one user, so authorisation is
 * always the same question. Answering it in one place means a new router can
 * never forget the `userId` clause.
 */

export async function requireYear(userId: string, yearId: string) {
  const [row] = await db
    .select()
    .from(years)
    .where(and(eq(years.id, yearId), eq(years.userId, userId)))
    .limit(1);
  if (!row) notFound("Year");
  return row;
}

export async function requireSubject(userId: string, subjectId: string) {
  const [row] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.id, subjectId), eq(subjects.userId, userId)))
    .limit(1);
  if (!row) notFound("Subject");
  return row;
}

export async function requireGrade(userId: string, gradeId: string) {
  const [row] = await db
    .select()
    .from(grades)
    .where(and(eq(grades.id, gradeId), eq(grades.userId, userId)))
    .limit(1);
  if (!row) notFound("Grade");
  return row;
}

export async function requirePeriod(userId: string, periodId: string) {
  const [row] = await db
    .select()
    .from(periods)
    .where(and(eq(periods.id, periodId), eq(periods.userId, userId)))
    .limit(1);
  if (!row) notFound("Period");
  return row;
}

export async function requireCustomAverage(userId: string, averageId: string) {
  const [row] = await db
    .select()
    .from(customAverages)
    .where(
      and(eq(customAverages.id, averageId), eq(customAverages.userId, userId)),
    )
    .limit(1);
  if (!row) notFound("Average");
  return row;
}

export async function requireGoal(userId: string, goalId: string) {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
    .limit(1);
  if (!row) notFound("Goal");
  return row;
}

export async function requireDashboardCard(userId: string, cardId: string) {
  const [row] = await db
    .select()
    .from(dashboardCards)
    .where(
      and(eq(dashboardCards.id, cardId), eq(dashboardCards.userId, userId)),
    )
    .limit(1);
  if (!row) notFound("Dashboard card");
  return row;
}
