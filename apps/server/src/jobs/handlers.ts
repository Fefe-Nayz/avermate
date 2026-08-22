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

export const MAINTENANCE_JOB_KINDS = [
  "maintenance.reapMcpOperations",
  "maintenance.purgeExpiredAutomaticFeedback",
  PURGE_MATERIAL_TRASH_JOB_KIND,
  "maintenance.enqueueMaterialPreviews",
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

  registerJobHandler(OCR_JOB_KIND, ({ payload, signal }) =>
    runOcrDocumentJob(payload, { signal }),
  );

  registerJobHandler(INGEST_LINK_JOB_KIND, ({ payload, signal }) =>
    runIngestLinkJob(payload, { signal }),
  );

  registerJobHandler(CLEANUP_UNOWNED_FILE_JOB_KIND, ({ payload }) =>
    runCleanupUnownedFileJob(payload),
  );

  registerJobHandler(EXPORT_DOCUMENT_PPTX_JOB_KIND, ({ payload, signal }) =>
    runExportDocumentPptxJob(payload, { signal }),
  );

  registerJobHandler(
    EXPORT_DOCUMENT_ARTIFACT_JOB_KIND,
    ({ payload, signal, attempts }) =>
      runExportDocumentArtifactJob(payload, { signal, attempt: attempts }),
  );

  registerJobHandler(TRANSCRIBE_SEGMENT_JOB_KIND, ({ payload, signal }) =>
    runTranscribeSegmentJob(payload, { signal }),
  );

  registerJobHandler(TRANSCRIBE_FINALIZE_JOB_KIND, ({ payload }) =>
    runFinalizeTranscriptionJob(payload),
  );

  registerJobHandler(
    TRANSCRIBE_MATERIAL_MEDIA_JOB_KIND,
    ({ payload, signal }) => runTranscribeMaterialMediaJob(payload, { signal }),
  );

  registerJobHandler(REAP_UNOWNED_FILES_JOB_KIND, ({ payload }) =>
    runScheduledStorageReaperJob(payload),
  );

  registerJobHandler(SYNC_JOB_KIND, ({ payload, signal }) =>
    runSyncJob(payload, { signal }),
  );

  registerJobHandler(
    MATERIAL_PREVIEW_JOB_KIND,
    ({ payload, signal, attempts, maxAttempts }) =>
      runMaterialPreviewJob(payload, {
        signal,
        attempt: attempts,
        maxAttempts,
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
