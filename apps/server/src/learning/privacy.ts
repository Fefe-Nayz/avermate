import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import {
  jobRuntimeMetadata,
  jobs,
  learningConceptOperations,
  learningConcepts,
  learningConceptSets,
  learningCopyAnalyses,
  learningCopyAnalysisReviews,
  learningErrorObservations,
  learningEvidence,
  learningEvidenceDecisions,
  learningMasteryCurrent,
  learningMasteryProjections,
  learningObjectivePrerequisites,
  learningObjectives,
  learningPlanItems,
  learningPreferences,
  learningQuizAttemptItems,
  learningQuizAttemptModes,
  learningQuizQuestionVersions,
} from "../db/schema";
import { canonicalJson, sha256 } from "../search/values";

const exportTables = {
  preferences: learningPreferences,
  conceptSets: learningConceptSets,
  concepts: learningConcepts,
  objectives: learningObjectives,
  objectivePrerequisites: learningObjectivePrerequisites,
  conceptOperations: learningConceptOperations,
  copyAnalyses: learningCopyAnalyses,
  copyAnalysisReviews: learningCopyAnalysisReviews,
  evidence: learningEvidence,
  evidenceDecisions: learningEvidenceDecisions,
  errorObservations: learningErrorObservations,
  masteryProjections: learningMasteryProjections,
  masteryCurrent: learningMasteryCurrent,
  planItems: learningPlanItems,
  quizQuestionVersions: learningQuizQuestionVersions,
  quizAttemptModes: learningQuizAttemptModes,
  quizAttemptItems: learningQuizAttemptItems,
} as const;

export type LearningDerivativeScope = "copy-analysis" | "all-computed";

/**
 * Relationship-complete learning export. Source bytes stay in the normal file
 * export; this archive retains their owned IDs, versions and exact locators.
 */
export async function exportLearningData(userId: string) {
  const entries = await Promise.all(
    Object.entries(exportTables).map(async ([name, table]) => [
      name,
      await db.select().from(table).where(eq(table.userId, userId)),
    ]),
  );
  const data = Object.fromEntries(entries) as Record<string, unknown[]>;
  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    ownership: "user-owned" as const,
    sourceFiles: {
      included: false,
      reason:
        "Original file bytes are exported by the account/file export. Learning rows retain their source IDs and locators.",
    },
    data,
  };
}

export function learningExportMarkdown(
  exported: Awaited<ReturnType<typeof exportLearningData>>,
) {
  const lines = [
    "# Avermate learning data export",
    "",
    `- Exported at: ${exported.exportedAt}`,
    `- Format version: ${exported.version}`,
    "- Ownership: user-owned",
    "- Original file bytes: exported separately by the account/file export",
    "",
  ];
  for (const [name, rows] of Object.entries(exported.data)) {
    lines.push(`## ${name}`, "", `Rows: ${rows.length}`, "");
    const json = JSON.stringify(rows, null, 2);
    lines.push(...json.split("\n").map((line) => `    ${line}`), "");
  }
  return lines.join("\n");
}

async function requestJobCancellation(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  jobIds: string[],
) {
  if (!jobIds.length) return { queued: 0, running: 0 };
  const now = new Date();
  const queued = await transaction
    .update(jobs)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.id, jobIds),
        eq(jobs.status, "queued"),
      ),
    )
    .returning({ id: jobs.id });
  const running = await transaction
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.id, jobIds),
        eq(jobs.status, "running"),
      ),
    );
  for (const job of running) {
    await transaction
      .insert(jobRuntimeMetadata)
      .values({
        jobId: job.id,
        stage: "running",
        cancellation: "requested",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jobRuntimeMetadata.jobId,
        set: { cancellation: "requested", updatedAt: now },
      });
  }
  return { queued: queued.length, running: running.length };
}

/** Delete model/OCR derivatives while preserving original grade attachments. */
export async function deleteLearningDerivatives(
  userId: string,
  scope: LearningDerivativeScope,
) {
  return db.transaction(async (transaction) => {
    const analyses = await transaction
      .select({
        id: learningCopyAnalyses.id,
        jobId: learningCopyAnalyses.jobId,
      })
      .from(learningCopyAnalyses)
      .where(eq(learningCopyAnalyses.userId, userId));
    const evidence = await transaction
      .select({
        id: learningEvidence.id,
        objectiveId: learningEvidence.objectiveId,
      })
      .from(learningEvidence)
      .where(
        and(
          eq(learningEvidence.userId, userId),
          scope === "all-computed"
            ? or(
                eq(learningEvidence.sourceKind, "grade-copy-analysis"),
                eq(learningEvidence.producerKind, "model"),
                eq(learningEvidence.producerKind, "deterministic-parser"),
              )
            : eq(learningEvidence.sourceKind, "grade-copy-analysis"),
        ),
      );
    const objectiveIds = [...new Set(evidence.map((row) => row.objectiveId))];
    const cancellation = await requestJobCancellation(
      transaction,
      userId,
      analyses.flatMap((row) => (row.jobId ? [row.jobId] : [])),
    );

    const planItems =
      scope === "all-computed"
        ? await transaction
            .delete(learningPlanItems)
            .where(eq(learningPlanItems.userId, userId))
            .returning({ id: learningPlanItems.id })
        : objectiveIds.length
          ? await transaction
              .delete(learningPlanItems)
              .where(
                and(
                  eq(learningPlanItems.userId, userId),
                  inArray(learningPlanItems.objectiveId, objectiveIds),
                ),
              )
              .returning({ id: learningPlanItems.id })
          : [];
    const current =
      scope === "all-computed"
        ? await transaction
            .delete(learningMasteryCurrent)
            .where(eq(learningMasteryCurrent.userId, userId))
            .returning({ id: learningMasteryCurrent.objectiveId })
        : objectiveIds.length
          ? await transaction
              .delete(learningMasteryCurrent)
              .where(
                and(
                  eq(learningMasteryCurrent.userId, userId),
                  inArray(learningMasteryCurrent.objectiveId, objectiveIds),
                ),
              )
              .returning({ id: learningMasteryCurrent.objectiveId })
          : [];
    const projections =
      scope === "all-computed"
        ? await transaction
            .delete(learningMasteryProjections)
            .where(eq(learningMasteryProjections.userId, userId))
            .returning({ id: learningMasteryProjections.id })
        : objectiveIds.length
          ? await transaction
              .delete(learningMasteryProjections)
              .where(
                and(
                  eq(learningMasteryProjections.userId, userId),
                  inArray(learningMasteryProjections.objectiveId, objectiveIds),
                ),
              )
              .returning({ id: learningMasteryProjections.id })
          : [];
    const deletedEvidence = evidence.length
      ? await transaction
          .delete(learningEvidence)
          .where(
            and(
              eq(learningEvidence.userId, userId),
              inArray(
                learningEvidence.id,
                evidence.map((row) => row.id),
              ),
            ),
          )
          .returning({ id: learningEvidence.id })
      : [];
    const deletedAnalyses = await transaction
      .delete(learningCopyAnalyses)
      .where(eq(learningCopyAnalyses.userId, userId))
      .returning({ id: learningCopyAnalyses.id });

    const counts = {
      copyAnalyses: deletedAnalyses.length,
      evidence: deletedEvidence.length,
      masteryCurrent: current.length,
      masteryProjections: projections.length,
      planItems: planItems.length,
      jobsCancelled: cancellation.queued,
      jobsCancellationRequested: cancellation.running,
    };
    return {
      scope,
      originalFilesDeleted: 0 as const,
      counts,
      receipt: sha256(canonicalJson({ scope, counts })),
    };
  });
}

/** Permanently remove the complete Learning domain, never the account/grades/files. */
export async function deleteAllLearningData(userId: string) {
  return db.transaction(async (transaction) => {
    const analyses = await transaction
      .select({ jobId: learningCopyAnalyses.jobId })
      .from(learningCopyAnalyses)
      .where(eq(learningCopyAnalyses.userId, userId));
    const cancellation = await requestJobCancellation(
      transaction,
      userId,
      analyses.flatMap((row) => (row.jobId ? [row.jobId] : [])),
    );
    const order = [
      ["quizAttemptItems", learningQuizAttemptItems],
      ["quizAttemptModes", learningQuizAttemptModes],
      ["quizQuestionVersions", learningQuizQuestionVersions],
      ["planItems", learningPlanItems],
      ["masteryCurrent", learningMasteryCurrent],
      ["masteryProjections", learningMasteryProjections],
      ["errorObservations", learningErrorObservations],
      ["evidenceDecisions", learningEvidenceDecisions],
      ["evidence", learningEvidence],
      ["copyAnalysisReviews", learningCopyAnalysisReviews],
      ["copyAnalyses", learningCopyAnalyses],
      ["objectivePrerequisites", learningObjectivePrerequisites],
      ["objectives", learningObjectives],
      ["conceptOperations", learningConceptOperations],
      ["concepts", learningConcepts],
      ["conceptSets", learningConceptSets],
      ["preferences", learningPreferences],
    ] as const;
    const counts: Record<string, number> = {};
    for (const [name, table] of order) {
      const deleted = await transaction
        .delete(table)
        .where(eq(table.userId, userId))
        .returning({ userId: table.userId });
      counts[name] = deleted.length;
    }
    counts.jobsCancelled = cancellation.queued;
    counts.jobsCancellationRequested = cancellation.running;
    return {
      originalFilesDeleted: 0 as const,
      gradesDeleted: 0 as const,
      planningTasksDeleted: 0 as const,
      counts,
      receipt: sha256(canonicalJson(counts)),
    };
  });
}
