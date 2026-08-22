import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  customAverages,
  contentConnections,
  dashboardCards,
  files,
  goals,
  grades,
  jobs,
  lectureRecordings,
  materialDocuments,
  materialFolders,
  materialTags,
  periods,
  plannerItems,
  studyDocuments,
  studyDocumentBuilds,
  subjects,
  syncConnections,
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

export async function requireJob(userId: string, jobId: string) {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  if (!row) notFound("Job");
  return row;
}

export async function requireRecording(userId: string, recordingId: string) {
  const [row] = await db
    .select()
    .from(lectureRecordings)
    .where(
      and(
        eq(lectureRecordings.id, recordingId),
        eq(lectureRecordings.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Lecture recording");
  return row;
}

export async function requireFile(userId: string, fileId: string) {
  const [row] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .limit(1);
  if (!row) notFound("File");
  return row;
}

export async function requireMaterialFolder(userId: string, folderId: string) {
  const [row] = await db
    .select()
    .from(materialFolders)
    .where(
      and(eq(materialFolders.id, folderId), eq(materialFolders.userId, userId)),
    )
    .limit(1);
  if (!row) notFound("Material folder");
  return row;
}

export async function requireMaterialDocument(
  userId: string,
  documentId: string,
) {
  const [row] = await db
    .select()
    .from(materialDocuments)
    .where(
      and(
        eq(materialDocuments.id, documentId),
        eq(materialDocuments.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Material document");
  return row;
}

export async function requirePlannerItem(userId: string, itemId: string) {
  const [row] = await db
    .select()
    .from(plannerItems)
    .where(and(eq(plannerItems.id, itemId), eq(plannerItems.userId, userId)))
    .limit(1);
  if (!row) notFound("Planner item");
  return row;
}

export async function requireStudyDocument(userId: string, documentId: string) {
  const [row] = await db
    .select()
    .from(studyDocuments)
    .where(
      and(eq(studyDocuments.id, documentId), eq(studyDocuments.userId, userId)),
    )
    .limit(1);
  if (!row) notFound("Study document");
  return row;
}

export async function requireSyncConnection(
  userId: string,
  connectionId: string,
) {
  const [row] = await db
    .select()
    .from(syncConnections)
    .where(
      and(
        eq(syncConnections.id, connectionId),
        eq(syncConnections.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Synchronization connection");
  return row;
}

/** Resolve a folder that may safely receive or mutate live content. */
export async function requireLiveMaterialFolder(
  userId: string,
  folderId: string,
) {
  const [row] = await db
    .select()
    .from(materialFolders)
    .where(
      and(
        eq(materialFolders.id, folderId),
        eq(materialFolders.userId, userId),
        isNull(materialFolders.deletedAt),
      ),
    )
    .limit(1);
  if (!row) notFound("Material folder");
  return row;
}

export async function requireContentConnection(
  userId: string,
  connectionId: string,
) {
  const [row] = await db
    .select()
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connectionId),
        eq(contentConnections.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Content connection");
  return row;
}

export async function requireMaterialTag(userId: string, tagId: string) {
  const [row] = await db
    .select()
    .from(materialTags)
    .where(and(eq(materialTags.id, tagId), eq(materialTags.userId, userId)))
    .limit(1);
  if (!row) notFound("Material tag");
  return row;
}

export async function requireStudyDocumentBuild(
  userId: string,
  buildId: string,
) {
  const [row] = await db
    .select()
    .from(studyDocumentBuilds)
    .where(
      and(
        eq(studyDocumentBuilds.id, buildId),
        eq(studyDocumentBuilds.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Study document build");
  return row;
}
