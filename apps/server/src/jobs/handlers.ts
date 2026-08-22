import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "../db";
import { mcpOperations } from "../db/schema";
import { enqueueJob, registerJobHandler } from "../lib/jobs";
import { purgeExpiredAutomaticFeedbackRows } from "../routers/admin-feedback";
import { OCR_JOB_KIND, runOcrDocumentJob } from "./ocr";
import {
  CLEANUP_UNOWNED_FILE_JOB_KIND,
  INGEST_LINK_JOB_KIND,
  runCleanupUnownedFileJob,
  runIngestLinkJob,
} from "./ingest-link";
import {
  EXPORT_DOCUMENT_PPTX_JOB_KIND,
  runExportDocumentPptxJob,
} from "./export-document-pptx";
import {
  EXPORT_DOCUMENT_ARTIFACT_JOB_KIND,
  runExportDocumentArtifactJob,
} from "./export-document-artifact";
import {
  TRANSCRIBE_FINALIZE_JOB_KIND,
  TRANSCRIBE_SEGMENT_JOB_KIND,
  runFinalizeTranscriptionJob,
  runTranscribeSegmentJob,
} from "./transcription";
import {
  TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND,
  runTranscribeMaterialMediaJob,
} from "./transcribe-material-media";
import {
  enqueueStorageReaperJob,
  REAP_UNOWNED_FILES_JOB_KIND,
  runScheduledStorageReaperJob,
} from "./storage-reaper";
import { SYNC_JOB_KIND, runSyncJob } from "../sync/run";
import {
  enqueuePendingMaterialPreviews,
  MATERIAL_PREVIEW_JOB_KIND,
  runMaterialPreviewJob,
} from "./material-preview";
import {
  BUILD_DOCUMENT_LATEX_JOB_KIND,
  runBuildDocumentLatexJob,
} from "./build-document-latex";
import {
  enqueueMaterialTrashMaintenanceJob,
  PURGE_MATERIAL_TRASH_JOB_KIND,
  runMaterialTrashMaintenanceJob,
} from "./material-trash-maintenance";
import {
  enqueueOneDriveSubscriptionReconciliation,
  ONEDRIVE_SUBSCRIPTION_RECONCILE_JOB_KIND,
  ONEDRIVE_SUBSCRIPTION_RENEW_JOB_KIND,
  ONEDRIVE_SYNC_JOB_KIND,
  runOneDriveSubscriptionReconciliationJob,
  runOneDriveSubscriptionRenewalJob,
  runOneDriveSyncJob,
} from "./onedrive-sync";
import {
  enqueueGoogleDriveChannelReconciliation,
  GOOGLE_DRIVE_CHANNEL_RECONCILE_JOB_KIND,
  GOOGLE_DRIVE_CHANNEL_RENEW_JOB_KIND,
  GOOGLE_DRIVE_SYNC_JOB_KIND,
  runGoogleDriveChannelReconciliationJob,
  runGoogleDriveChannelRenewalJob,
  runGoogleDriveSyncJob,
} from "./googledrive-sync";
import {
  CORPUS_EMBED_CHUNKS_JOB_KIND,
  CORPUS_EVALUATE_JOB_KIND,
  CORPUS_INDEX_SOURCE_JOB_KIND,
  CORPUS_PRODUCE_DERIVATIVES_JOB_KIND,
  CORPUS_REBUILD_FTS_JOB_KIND,
  CORPUS_REEMBED_SPACE_JOB_KIND,
  CORPUS_REMOVE_VERSION_JOB_KIND,
  CORPUS_REPAIR_JOB_KIND,
  CORPUS_VERIFY_JOB_KIND,
  runCorpusEmbeddingUnavailableJob,
  runCorpusEvaluationJob,
  runCorpusIndexSourceJob,
  runCorpusRebuildFtsJob,
  runCorpusRemoveVersionJob,
  runCorpusRepairJob,
  runCorpusVerifyJob,
} from "./corpus";
import { runCorpusDerivativeProductionJob } from "./corpus-derivatives";
import { managedUsage } from "../managed/services";
import { runConfiguredSandboxWorkerJob } from "../sandbox/worker-services";
import {
  ARTIFACT_WORKFLOW_STAGE_JOB_KIND,
  runArtifactWorkflowStageJob,
} from "../ingestion/artifact-workflow-dispatcher";
import {
  GRADE_COPY_ANALYSIS_JOB_KIND,
  runGradeCopyAnalysisJob,
} from "../learning/copy-analysis";
import {
  PLACEMENT_MIGRATION_JOB_KIND,
  runPlacementMigrationJob,
} from "./placement-migration";

export const MAINTENANCE_JOB_KINDS = [
  "maintenance.reapMcpOperations",
  "maintenance.purgeExpiredAutomaticFeedback",
  PURGE_MATERIAL_TRASH_JOB_KIND,
  "maintenance.enqueueMaterialPreviews",
  "maintenance.reconcileManagedUsage",
  "maintenance.reconcileAssistantRuns",
] as const;

const DAY_MS = 86_400_000;
let registered = false;

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function enqueueMaintenanceKind(
  kind: (typeof MAINTENANCE_JOB_KINDS)[number],
  runAt: Date,
) {
  return enqueueJob({
    kind,
    payload: { scheduledFor: utcDateKey(runAt) },
    userId: null,
    idempotencyKey: utcDateKey(runAt),
    runAt,
    maxAttempts: 3,
  });
}

async function scheduleNext(
  kind: (typeof MAINTENANCE_JOB_KINDS)[number],
  now = new Date(),
) {
  return enqueueMaintenanceKind(kind, new Date(now.getTime() + DAY_MS));
}

export async function reapExpiredMcpOperations(now = new Date()) {
  const completedCutoff = new Date(now.getTime() - 30 * DAY_MS);
  const pendingCutoff = new Date(now.getTime() - 7 * DAY_MS);
  const deleted = await db
    .delete(mcpOperations)
    .where(
      or(
        and(
          eq(mcpOperations.status, "completed"),
          or(
            lt(mcpOperations.completedAt, completedCutoff),
            and(
              isNull(mcpOperations.completedAt),
              lt(mcpOperations.createdAt, completedCutoff),
            ),
          ),
        ),
        and(
          eq(mcpOperations.status, "pending"),
          lt(mcpOperations.createdAt, pendingCutoff),
        ),
      ),
    )
    .returning({ id: mcpOperations.id });
  return { deleted: deleted.length };
}

export function registerAllJobHandlers() {
  if (registered) return;
  registered = true;

  registerJobHandler(MAINTENANCE_JOB_KINDS[0], async () => {
    const now = new Date();
    await scheduleNext(MAINTENANCE_JOB_KINDS[0], now);
    return reapExpiredMcpOperations(now);
  });

  registerJobHandler(MAINTENANCE_JOB_KINDS[1], async () => {
    const now = new Date();
    await scheduleNext(MAINTENANCE_JOB_KINDS[1], now);
    const result = await purgeExpiredAutomaticFeedbackRows(90, now);
    return { deleted: result.deletedCount };
  });

  registerJobHandler(PURGE_MATERIAL_TRASH_JOB_KIND, ({ payload }) =>
    runMaterialTrashMaintenanceJob(payload),
  );

  registerJobHandler(MAINTENANCE_JOB_KINDS[3], async () => {
    const now = new Date();
    await scheduleNext(MAINTENANCE_JOB_KINDS[3], now);
    return enqueuePendingMaterialPreviews();
  });

  registerJobHandler(MAINTENANCE_JOB_KINDS[4], async () => {
    const now = new Date();
    await scheduleNext(MAINTENANCE_JOB_KINDS[4], now);
    const settled = await managedUsage().reconcileExpired(1_000);
    return { settledReservationIds: settled };
  });

  registerJobHandler(MAINTENANCE_JOB_KINDS[5], async () => {
    const now = new Date();
    await scheduleNext(MAINTENANCE_JOB_KINDS[5], now);
    const { assistantRunService } = await import("../assistant/services");
    return assistantRunService.recoverInterrupted(undefined, 1_000);
  });

  registerJobHandler("sandbox.execute", ({ payload, signal, jobId }) =>
    runConfiguredSandboxWorkerJob(payload, { signal, jobId }),
  );

  registerJobHandler(PLACEMENT_MIGRATION_JOB_KIND, ({ payload, signal }) =>
    runPlacementMigrationJob(payload, { signal }),
  );

  registerJobHandler(
    ARTIFACT_WORKFLOW_STAGE_JOB_KIND,
    ({ payload, signal, jobId, attempts, maxAttempts }) =>
      runArtifactWorkflowStageJob(payload, {
        signal,
        jobId,
        attempts,
        maxAttempts,
      }),
  );

  registerJobHandler(
    OCR_JOB_KIND,
    ({ payload, signal, jobId, attempts, identity }) =>
      runOcrDocumentJob(payload, {
        signal,
        operationId: jobId,
        attempt: attempts,
        job: identity,
      }),
  );

  registerJobHandler(
    GRADE_COPY_ANALYSIS_JOB_KIND,
    ({ payload, signal, jobId, attempts, maxAttempts }) =>
      runGradeCopyAnalysisJob(payload, {
        jobId,
        attempts,
        maxAttempts,
        signal,
        operationId: jobId,
      }),
  );

  registerJobHandler(INGEST_LINK_JOB_KIND, ({ payload, signal, attempts }) =>
    runIngestLinkJob(payload, { signal, attempt: attempts }),
  );

  registerJobHandler(CLEANUP_UNOWNED_FILE_JOB_KIND, ({ payload }) =>
    runCleanupUnownedFileJob(payload),
  );

  registerJobHandler(EXPORT_DOCUMENT_PPTX_JOB_KIND, ({ payload, signal }) =>
    runExportDocumentPptxJob(payload, { signal }),
  );

  registerJobHandler(
    EXPORT_DOCUMENT_ARTIFACT_JOB_KIND,
    ({ payload, signal, attempts, jobId }) =>
      runExportDocumentArtifactJob(payload, {
        signal,
        attempt: attempts,
        operationId: jobId,
      }),
  );

  registerJobHandler(
    TRANSCRIBE_SEGMENT_JOB_KIND,
    ({ payload, signal, jobId, attempts, identity }) =>
      runTranscribeSegmentJob(payload, {
        signal,
        operationId: jobId,
        attempt: attempts,
        job: identity,
      }),
  );

  registerJobHandler(TRANSCRIBE_FINALIZE_JOB_KIND, ({ payload }) =>
    runFinalizeTranscriptionJob(payload),
  );

  registerJobHandler(
    TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND,
    ({ payload, signal, jobId, attempts, identity }) =>
      runTranscribeMaterialMediaJob(payload, {
        signal,
        operationId: jobId,
        attempt: attempts,
        job: identity,
      }),
  );

  registerJobHandler(REAP_UNOWNED_FILES_JOB_KIND, ({ payload }) =>
    runScheduledStorageReaperJob(payload),
  );

  registerJobHandler(SYNC_JOB_KIND, ({ payload, signal }) =>
    runSyncJob(payload, { signal }),
  );

  registerJobHandler(
    MATERIAL_PREVIEW_JOB_KIND,
    ({ payload, signal, attempts, maxAttempts, jobId }) =>
      runMaterialPreviewJob(payload, {
        signal,
        attempt: attempts,
        maxAttempts,
        operationId: jobId,
      }),
  );

  registerJobHandler(
    BUILD_DOCUMENT_LATEX_JOB_KIND,
    ({ payload, signal, attempts, maxAttempts }) =>
      runBuildDocumentLatexJob(payload, {
        signal,
        attempt: attempts,
        maxAttempts,
      }),
  );

  registerJobHandler(ONEDRIVE_SYNC_JOB_KIND, ({ payload, signal, jobId }) =>
    runOneDriveSyncJob(payload, { signal, jobId }),
  );

  registerJobHandler(
    ONEDRIVE_SUBSCRIPTION_RENEW_JOB_KIND,
    ({ payload, signal }) =>
      runOneDriveSubscriptionRenewalJob(payload, { signal }),
  );

  registerJobHandler(
    ONEDRIVE_SUBSCRIPTION_RECONCILE_JOB_KIND,
    ({ payload, signal }) =>
      runOneDriveSubscriptionReconciliationJob(payload, { signal }),
  );

  registerJobHandler(GOOGLE_DRIVE_SYNC_JOB_KIND, ({ payload, signal, jobId }) =>
    runGoogleDriveSyncJob(payload, { signal, jobId }),
  );

  registerJobHandler(
    GOOGLE_DRIVE_CHANNEL_RENEW_JOB_KIND,
    ({ payload, signal }) =>
      runGoogleDriveChannelRenewalJob(payload, { signal }),
  );

  registerJobHandler(
    GOOGLE_DRIVE_CHANNEL_RECONCILE_JOB_KIND,
    ({ payload, signal }) =>
      runGoogleDriveChannelReconciliationJob(payload, { signal }),
  );

  registerJobHandler(CORPUS_INDEX_SOURCE_JOB_KIND, ({ payload, signal }) =>
    runCorpusIndexSourceJob(payload, { signal }),
  );
  registerJobHandler(
    CORPUS_PRODUCE_DERIVATIVES_JOB_KIND,
    ({ payload, signal, jobId }) =>
      runCorpusDerivativeProductionJob(payload, {
        signal,
        operationId: jobId,
      }),
  );
  registerJobHandler(CORPUS_REMOVE_VERSION_JOB_KIND, ({ payload }) =>
    runCorpusRemoveVersionJob(payload),
  );
  registerJobHandler(CORPUS_REBUILD_FTS_JOB_KIND, ({ payload, signal }) =>
    runCorpusRebuildFtsJob(payload, { signal }),
  );
  registerJobHandler(CORPUS_VERIFY_JOB_KIND, ({ payload }) =>
    runCorpusVerifyJob(payload),
  );
  registerJobHandler(CORPUS_REPAIR_JOB_KIND, ({ payload, signal }) =>
    runCorpusRepairJob(payload, { signal }),
  );
  registerJobHandler(CORPUS_EMBED_CHUNKS_JOB_KIND, ({ payload, signal }) =>
    runCorpusEmbeddingUnavailableJob(payload, { signal }),
  );
  registerJobHandler(CORPUS_REEMBED_SPACE_JOB_KIND, ({ payload, signal }) =>
    runCorpusEmbeddingUnavailableJob(payload, { signal }),
  );
  registerJobHandler(CORPUS_EVALUATE_JOB_KIND, ({ payload, signal }) =>
    runCorpusEvaluationJob(payload, { signal }),
  );
}

/** Idempotently schedules daily maintenance and the current storage-reaper bucket. */
export async function scheduleDailyMaintenanceJobs(now = new Date()) {
  return Promise.all([
    ...MAINTENANCE_JOB_KINDS.filter(
      (kind) => kind !== PURGE_MATERIAL_TRASH_JOB_KIND,
    ).map((kind) => enqueueMaintenanceKind(kind, now)),
    enqueueMaterialTrashMaintenanceJob(now),
    enqueueStorageReaperJob(now),
    enqueueOneDriveSubscriptionReconciliation(now),
    enqueueGoogleDriveChannelReconciliation(now),
  ]);
}
