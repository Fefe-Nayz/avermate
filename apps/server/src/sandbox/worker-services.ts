import { resolve } from "node:path";
import { coreJobRuntime } from "../jobs/core-job-runtime-store";
import { ObjectStorageManifestStore } from "../ingestion/object-manifest-store";
import {
  storageBackendEnabled,
  storageDriver,
} from "../lib/storage-backend";
import {
  CoreObjectStorageProvider,
  LegacyManagedStorageByteBackend,
} from "../node/core-object-storage-provider";
import { SandboxUnavailableError } from "./errors";
import { SandboxJobAdmission } from "./job-admission";
import { ObjectStorageTrustedArtifactStore } from "./object-storage-artifact-store";
import { createSandboxProviderFromEnvironment } from "./provider-factory";
import { SandboxWorkerExecutor } from "./worker-executor";
import { SandboxWorkerClient } from "./worker-client";

export interface ConfiguredSandboxWorkerRuntime {
  readonly admission: SandboxJobAdmission;
  readonly manifests: ObjectStorageManifestStore;
  readonly executor: SandboxWorkerExecutor;
  readonly client: SandboxWorkerClient;
}

let configuredRuntime: ConfiguredSandboxWorkerRuntime | null = null;

export function configuredSandboxWorkerRuntime(): ConfiguredSandboxWorkerRuntime {
  if (configuredRuntime) return configuredRuntime;
  if (!storageBackendEnabled()) {
    throw new SandboxUnavailableError(
      "TRANSPORT_UNAVAILABLE",
      "Sandbox input/output object storage is disabled",
    );
  }
  const configured = createSandboxProviderFromEnvironment({
    allowMock: process.env.NODE_ENV === "test",
  });
  if (!configured.hostPolicyDigest) {
    throw new SandboxUnavailableError(
      "PROVIDER_DISABLED",
      "No attested sandbox provider is configured",
    );
  }
  const maximumEvidenceAgeMs = evidenceMaximumAge();
  const storage = new CoreObjectStorageProvider({
    id: "core-sandbox-v1",
    backend: new LegacyManagedStorageByteBackend(
      storageDriver(),
      () => "document-artifact",
    ),
    journalPath: resolve(
      process.cwd(),
      process.env.SANDBOX_OBJECT_JOURNAL_PATH?.trim() ||
        ".data/sandbox-object-journal-v1.json",
    ),
    maxObjectBytes: 2 * 1024 ** 3,
  });
  const manifests = new ObjectStorageManifestStore(storage, 8 * 1024 * 1024);
  configuredRuntime = Object.freeze({
    admission: new SandboxJobAdmission(
      configured.provider,
      coreJobRuntime,
      {
        hostPolicyDigest: configured.hostPolicyDigest,
        maxEvidenceAgeMs: maximumEvidenceAgeMs,
      },
    ),
    manifests,
    executor: new SandboxWorkerExecutor({
      provider: configured.provider,
      profiles: configured.profiles,
      hostPolicyDigest: configured.hostPolicyDigest,
      maxEvidenceAgeMs: maximumEvidenceAgeMs,
      manifests,
      artifacts: (jobId) =>
        new ObjectStorageTrustedArtifactStore(storage, jobId),
    }),
    client: new SandboxWorkerClient({
      provider: configured.provider,
      profiles: configured.profiles,
      hostPolicyDigest: configured.hostPolicyDigest,
      maxEvidenceAgeMs: maximumEvidenceAgeMs,
    }),
  });
  return configuredRuntime;
}

export function runConfiguredSandboxWorkerJob(
  payload: unknown,
  context: { jobId: string; signal?: AbortSignal },
) {
  return configuredSandboxWorkerRuntime().executor.execute(payload, context);
}

export function runConfiguredSandboxWorker(
  input: Parameters<SandboxWorkerClient["execute"]>[0],
) {
  return configuredSandboxWorkerRuntime().client.execute(input);
}

/** Unit-test seam; never call it to change production configuration at runtime. */
export function resetConfiguredSandboxWorkerRuntimeForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Sandbox worker runtime reset is test-only");
  }
  configuredRuntime = null;
}

function evidenceMaximumAge() {
  const value = Number(process.env.SANDBOX_EVIDENCE_MAX_AGE_MS);
  return Number.isInteger(value) && value > 0 && value <= 60 * 60_000
    ? value
    : 5 * 60_000;
}
