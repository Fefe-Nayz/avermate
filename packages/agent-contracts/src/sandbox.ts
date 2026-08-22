import { z } from "zod";

export const SANDBOX_BASELINE_VERSION = 1 as const;
export const SANDBOX_BASELINE_CHECK_IDS = [
  "non-root-unprivileged",
  "readonly-rootfs",
  "capabilities-dropped",
  "no-new-privileges",
  "host-namespaces-isolated",
  "host-mounts-sockets-devices-denied",
  "proc-sys-masked",
  "bounded-tmpfs",
  "seccomp-lsm-enforced",
  "cgroup-limits-enforced",
  "network-default-deny",
  "environment-sanitized",
] as const;

export const sandboxBaselineCheckIdSchema = z.enum(SANDBOX_BASELINE_CHECK_IDS);
export type SandboxBaselineCheckId = z.infer<
  typeof sandboxBaselineCheckIdSchema
>;

export const sandboxProviderIdSchema = z.enum([
  "disabled",
  "mock",
  "opensandbox",
  "e2b",
  "microsandbox",
]);
export type SandboxProviderId = z.infer<typeof sandboxProviderIdSchema>;

export const sandboxIsolationClassSchema = z.enum([
  "disabled",
  "mock",
  "runc-trusted-dev",
  "gvisor-personal",
  "kata-multitenant",
  "e2b-managed",
  "microsandbox-experimental",
]);
export type SandboxIsolationClass = z.infer<typeof sandboxIsolationClassSchema>;

export const sandboxProfileIdSchema = z.enum([
  "latex",
  "python-data",
  "browser",
  "slides",
  "media",
  "video-audio",
  "ocr",
  "speech-to-text",
  "manim",
  "image-builder",
  "opencode",
  "openhands",
]);
export const SANDBOX_PROFILE_IDS = sandboxProfileIdSchema.options;
export type SandboxProfileId = z.infer<typeof sandboxProfileIdSchema>;

const sha256DigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "expected a lowercase sha256 digest");
const boundedIdSchema = z.string().min(1).max(256);

export const sandboxResourceLimitsSchema = z.strictObject({
  cpuMillis: z.number().int().min(100).max(64_000),
  memoryBytes: z
    .number()
    .int()
    .min(16 * 1024 * 1024)
    .max(64 * 1024 ** 3),
  swapBytes: z
    .number()
    .int()
    .min(0)
    .max(64 * 1024 ** 3),
  pids: z.number().int().min(1).max(4_096),
  wallTimeMs: z
    .number()
    .int()
    .min(100)
    .max(24 * 60 * 60_000),
  cancellationGraceMs: z.number().int().min(0).max(60_000),
  outputBytes: z
    .number()
    .int()
    .min(0)
    .max(2 * 1024 ** 3),
  stdoutBytes: z
    .number()
    .int()
    .min(0)
    .max(64 * 1024 ** 2),
  stderrBytes: z
    .number()
    .int()
    .min(0)
    .max(64 * 1024 ** 2),
  eventBytes: z
    .number()
    .int()
    .min(0)
    .max(64 * 1024 ** 2),
  workspaceBytes: z
    .number()
    .int()
    .min(1)
    .max(50 * 1024 ** 3),
  fileCount: z.number().int().min(1).max(1_000_000),
  tmpfsBytes: z
    .number()
    .int()
    .min(1)
    .max(8 * 1024 ** 3),
  tmpfsInodes: z.number().int().min(1).max(1_000_000),
  openFiles: z.number().int().min(8).max(65_536),
  networkBytes: z
    .number()
    .int()
    .min(0)
    .max(2 * 1024 ** 3),
  networkRequests: z.number().int().min(0).max(100_000),
  gpuCount: z.literal(0),
});
export type SandboxResourceLimits = z.infer<typeof sandboxResourceLimitsSchema>;

export const sandboxEgressDestinationSchema = z.strictObject({
  protocol: z.enum(["https", "wss"]),
  hostname: z.string().min(1).max(253).toLowerCase(),
  port: z.number().int().min(1).max(65_535),
  pathPrefix: z.string().startsWith("/").max(2_048).default("/"),
});
export type SandboxEgressDestination = z.infer<
  typeof sandboxEgressDestinationSchema
>;

export const sandboxEgressPolicySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("none") }),
  z.strictObject({
    mode: z.literal("allowlist"),
    destinations: z.array(sandboxEgressDestinationSchema).min(1).max(64),
    maxRequests: z.number().int().min(1).max(100_000),
    maxResponseBytes: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 ** 3),
  }),
]);
export type SandboxEgressPolicy = z.infer<typeof sandboxEgressPolicySchema>;

export const sandboxSecretGrantSchema = z.strictObject({
  grantId: boundedIdSchema,
  audience: boundedIdSchema,
  allowedMethods: z.array(z.enum(["GET", "HEAD", "POST", "PUT"])).min(1),
  expiresAt: z.string().datetime({ offset: true }),
  requestQuota: z.number().int().min(1).max(10_000),
});
export type SandboxSecretGrant = z.infer<typeof sandboxSecretGrantSchema>;

export const sandboxImageTemplateRefSchema = z.strictObject({
  imageDigest: sha256DigestSchema,
  profileVersion: z.string().min(1).max(128),
});
export type SandboxImageTemplateRef = z.infer<
  typeof sandboxImageTemplateRefSchema
>;

export const sandboxWorkspaceSnapshotRefSchema = z.strictObject({
  provider: sandboxProviderIdSchema,
  digest: sha256DigestSchema,
  format: z.string().min(1).max(128),
});
export type SandboxWorkspaceSnapshotRef = z.infer<
  typeof sandboxWorkspaceSnapshotRefSchema
>;

export const sandboxProviderRuntimeCheckpointRefSchema = z.strictObject({
  provider: sandboxProviderIdSchema,
  opaqueRef: boundedIdSchema,
  portable: z.literal(false),
});
export type SandboxProviderRuntimeCheckpointRef = z.infer<
  typeof sandboxProviderRuntimeCheckpointRefSchema
>;

export const sandboxRuntimeCheckpointCompatibilityV1Schema = z.strictObject({
  provider: sandboxProviderIdSchema,
  region: z.string().min(1).max(128),
  architecture: z.enum(["amd64", "arm64"]),
  runtimeKind: z.string().min(1).max(128),
  runtimeVersion: z.string().min(1).max(128),
  imageDigest: sha256DigestSchema,
  profileId: sandboxProfileIdSchema,
  profileVersion: z.string().min(1).max(128),
});
export type SandboxRuntimeCheckpointCompatibilityV1 = z.infer<
  typeof sandboxRuntimeCheckpointCompatibilityV1Schema
>;

/** Provider-native process/runtime state. It is deliberately non-portable. */
export const sandboxRuntimeCheckpointRefV1Schema = z
  .strictObject({
    version: z.literal(1),
    checkpoint: sandboxProviderRuntimeCheckpointRefSchema,
    compatibility: sandboxRuntimeCheckpointCompatibilityV1Schema,
    sourceWorkspaceSnapshot: sandboxWorkspaceSnapshotRefSchema,
    /** Stable caller key; providers use it to bind/replay capture requests. */
    captureIdempotencyKey: boundedIdSchema.optional(),
    captureState: z.enum(["captured", "adopted"]),
    adoptedObjectRefs: z.array(z.string().min(1).max(1_024)).max(256),
    capturedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .superRefine((checkpoint, context) => {
    if (
      checkpoint.checkpoint.provider !== checkpoint.compatibility.provider ||
      checkpoint.sourceWorkspaceSnapshot.provider !==
        checkpoint.compatibility.provider
    ) {
      context.addIssue({
        code: "custom",
        path: ["compatibility", "provider"],
        message:
          "runtime checkpoint, compatibility and source workspace providers must match",
      });
    }
    if (Date.parse(checkpoint.expiresAt) <= Date.parse(checkpoint.capturedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "runtime checkpoints must expire after capture",
      });
    }
    if (
      checkpoint.captureState === "captured" &&
      checkpoint.adoptedObjectRefs.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["adoptedObjectRefs"],
        message: "unadopted runtime checkpoints cannot own adopted objects",
      });
    }
  });
export type SandboxRuntimeCheckpointRefV1 = z.infer<
  typeof sandboxRuntimeCheckpointRefV1Schema
>;

export const sandboxRuntimeCheckpointCapabilitiesSchema = z.discriminatedUnion(
  "available",
  [
    z.strictObject({
      available: z.literal(false),
      reason: z.enum([
        "provider-unsupported",
        "profile-unsupported",
        "preflight-unavailable",
      ]),
    }),
    z.strictObject({
      available: z.literal(true),
      provider: sandboxProviderIdSchema,
      regions: z.array(z.string().min(1).max(128)).min(1).max(64),
      architectures: z
        .array(z.enum(["amd64", "arm64"]))
        .min(1)
        .max(4),
      runtimeKind: z.string().min(1).max(128),
      runtimeVersion: z.string().min(1).max(128),
      maximumTtlSeconds: z
        .number()
        .int()
        .positive()
        .max(30 * 24 * 60 * 60),
    }),
  ],
);
export type SandboxRuntimeCheckpointCapabilities = z.infer<
  typeof sandboxRuntimeCheckpointCapabilitiesSchema
>;

export const sandboxWorkloadPolicySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("latex"),
    engine: z.literal("tectonic"),
    shellEscape: z.literal(false),
    networkDuringRun: z.literal(false),
    maxPages: z.number().int().min(1).max(1_000),
  }),
  z.strictObject({
    kind: z.literal("python-data"),
    packageManager: z.literal(false),
    networkDuringRun: z.literal(false),
    gpu: z.literal(false),
  }),
  z.strictObject({
    kind: z.literal("browser"),
    freshContext: z.literal(true),
    serviceWorkers: z.literal(false),
    downloads: z.literal(false),
    permissions: z.tuple([]),
    maxDomBytes: z.number().int().min(1),
    maxScreenshotBytes: z.number().int().min(1),
  }),
  z.strictObject({
    kind: z.literal("slides"),
    macros: z.literal(false),
    externalResources: z.literal(false),
    maxSlides: z.number().int().min(1).max(1_000),
  }),
  z.strictObject({
    kind: z.literal("media"),
    networkDuringRun: z.boolean(),
    allowedInputCodecs: z.array(z.string().min(1).max(64)).min(1).max(32),
    allowedOutputCodecs: z.array(z.string().min(1).max(64)).min(1).max(32),
    maxDurationSeconds: z
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 60),
    maxWidth: z.number().int().min(1).max(16_384),
    maxHeight: z.number().int().min(1).max(16_384),
    maxStreams: z.number().int().min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("video-audio"),
    networkDuringRun: z.boolean(),
    provider: z.literal("youtube"),
    outputCodec: z.literal("mp3-mono-16khz"),
    segmentSecondsMin: z.literal(60),
    segmentSecondsMax: z.literal(20 * 60),
    maximumSegmentBytes: z.literal(32 * 1024 * 1024),
    maxDurationSeconds: z.literal(4 * 60 * 60),
  }),
  z.strictObject({
    kind: z.literal("ocr"),
    networkDuringRun: z.literal(false),
    engines: z.tuple([z.literal("tesseract"), z.literal("poppler")]),
    maxPages: z.number().int().min(1).max(1_000),
    maxPixelsPerPage: z.number().int().min(1).max(100_000_000),
    maxTotalPixels: z.number().int().min(1).max(5_000_000_000),
  }),
  z.strictObject({
    kind: z.literal("speech-to-text"),
    networkDuringRun: z.literal(false),
    engine: z.literal("whisper.cpp"),
    timestampSegments: z.literal(true),
    maxDurationSeconds: z.number().int().min(1).max(8 * 60 * 60),
    maxInputBytes: z.number().int().min(1).max(512 * 1024 * 1024),
  }),
  z.strictObject({
    kind: z.literal("manim"),
    networkDuringRun: z.literal(false),
    limitedSceneApi: z.literal(true),
    videoOnly: z.literal(true),
  }),
  z.strictObject({
    kind: z.literal("image-builder"),
    rootless: z.literal(true),
    privileged: z.literal(false),
    hostRuntimeSocket: z.literal(false),
    tenantScopedMutableCache: z.literal(true),
    requireSbom: z.literal(true),
    requireProvenance: z.literal(true),
    requireSignature: z.literal(true),
  }),
  z.strictObject({
    kind: z.enum(["opencode", "openhands"]),
    reviewedCommandCatalogue: z.literal(true),
    arbitraryHostCommands: z.literal(false),
    canonicalHistoryImported: z.literal(false),
  }),
]);
export type SandboxWorkloadPolicy = z.infer<typeof sandboxWorkloadPolicySchema>;

export const sandboxExecutionProfileSchema = z
  .strictObject({
    id: sandboxProfileIdSchema,
    version: z.string().min(1).max(128),
    enabled: z.boolean(),
    requiredBaselineVersion: z.literal(SANDBOX_BASELINE_VERSION),
    image: sandboxImageTemplateRefSchema,
    entrypoints: z.array(z.string().startsWith("/").max(512)).min(1).max(32),
    resources: sandboxResourceLimitsSchema,
    egress: sandboxEgressPolicySchema,
    workspaceRoot: z.literal("/workspace"),
    readOnlyRootfs: z.literal(true),
    allowHostMounts: z.literal(false),
    allowDevices: z.literal(false),
    readOnlyInputPaths: z
      .array(z.string().startsWith("/workspace/input").max(512))
      .min(1),
    writablePaths: z
      .array(z.string().startsWith("/workspace/").max(512))
      .max(16),
    outputGlobs: z.array(z.string().min(1).max(512)).max(32),
    allowSecrets: z.boolean().default(false),
    workload: sandboxWorkloadPolicySchema,
  })
  .superRefine((profile, context) => {
    if (profile.id !== profile.workload.kind) {
      context.addIssue({
        code: "custom",
        path: ["workload", "kind"],
        message: "Workload policy must match the profile id.",
      });
    }
    if (
      profile.egress.mode === "none" &&
      (profile.resources.networkBytes !== 0 ||
        profile.resources.networkRequests !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resources", "networkBytes"],
        message: "Network ceilings must be zero when egress is disabled.",
      });
    }
    if (
      profile.egress.mode === "allowlist" &&
      (profile.resources.networkBytes < profile.egress.maxResponseBytes ||
        profile.resources.networkRequests < profile.egress.maxRequests)
    ) {
      context.addIssue({
        code: "custom",
        path: ["resources", "networkBytes"],
        message:
          "Resource ceilings must cover the stricter egress policy ceilings.",
      });
    }
    if (profile.allowSecrets && profile.egress.mode === "none") {
      context.addIssue({
        code: "custom",
        path: ["allowSecrets"],
        message: "Brokered secret grants require an explicit egress allowlist.",
      });
    }
    if (
      "networkDuringRun" in profile.workload &&
      profile.workload.networkDuringRun !== (profile.egress.mode === "allowlist")
    ) {
      context.addIssue({
        code: "custom",
        path: ["workload", "networkDuringRun"],
        message:
          "workload network policy must exactly match the sandbox egress mode",
      });
    }
  });
export type SandboxExecutionProfile = z.infer<
  typeof sandboxExecutionProfileSchema
>;

export const sandboxBaselineCheckResultSchema = z.strictObject({
  status: z.enum(["pass", "fail", "unknown"]),
  observed: z.string().min(1).max(4_096),
});
export type SandboxBaselineCheckResult = z.infer<
  typeof sandboxBaselineCheckResultSchema
>;

const sandboxBaselineChecksSchema = z.strictObject({
  "non-root-unprivileged": sandboxBaselineCheckResultSchema,
  "readonly-rootfs": sandboxBaselineCheckResultSchema,
  "capabilities-dropped": sandboxBaselineCheckResultSchema,
  "no-new-privileges": sandboxBaselineCheckResultSchema,
  "host-namespaces-isolated": sandboxBaselineCheckResultSchema,
  "host-mounts-sockets-devices-denied": sandboxBaselineCheckResultSchema,
  "proc-sys-masked": sandboxBaselineCheckResultSchema,
  "bounded-tmpfs": sandboxBaselineCheckResultSchema,
  "seccomp-lsm-enforced": sandboxBaselineCheckResultSchema,
  "cgroup-limits-enforced": sandboxBaselineCheckResultSchema,
  "network-default-deny": sandboxBaselineCheckResultSchema,
  "environment-sanitized": sandboxBaselineCheckResultSchema,
});

export const sandboxBaselineEvidenceSchema = z.strictObject({
  baselineVersion: z.literal(SANDBOX_BASELINE_VERSION),
  providerId: sandboxProviderIdSchema,
  profileId: sandboxProfileIdSchema,
  profileVersion: z.string().min(1).max(128),
  isolationClass: sandboxIsolationClassSchema,
  runtimeKind: z.string().min(1).max(128),
  runtimeVersion: z.string().min(1).max(128),
  probeVersion: z.string().min(1).max(128),
  imageDigest: sha256DigestSchema,
  hostPolicyDigest: sha256DigestSchema,
  evidenceNonce: boundedIdSchema,
  checkedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  checks: sandboxBaselineChecksSchema,
});
export type SandboxBaselineEvidence = z.infer<
  typeof sandboxBaselineEvidenceSchema
>;

export const sandboxUnavailableReasonSchema = z.enum([
  "PROVIDER_DISABLED",
  "PROFILE_DISABLED",
  "EVIDENCE_MISSING",
  "EVIDENCE_STALE",
  "EVIDENCE_FAILED",
  "CONFIGURATION_INVALID",
  "ISOLATION_NOT_ALLOWED",
  "TRANSPORT_UNAVAILABLE",
  "RESOURCE_POLICY_INVALID",
  "EGRESS_POLICY_INVALID",
  "SECRET_POLICY_INVALID",
  "SNAPSHOT_INCOMPATIBLE",
]);
export type SandboxUnavailableReason = z.infer<
  typeof sandboxUnavailableReasonSchema
>;

export const sandboxPreflightResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    evidence: sandboxBaselineEvidenceSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: sandboxUnavailableReasonSchema,
    message: z.string().min(1).max(4_096),
  }),
]);
export type SandboxPreflightResult = z.infer<
  typeof sandboxPreflightResultSchema
>;

export const sandboxCapabilitiesSchema = z.strictObject({
  providerId: sandboxProviderIdSchema,
  available: z.boolean(),
  profiles: z.array(
    z.strictObject({
      id: sandboxProfileIdSchema,
      version: z.string().min(1).max(128),
      isolationClass: sandboxIsolationClassSchema,
      evidence: sandboxBaselineEvidenceSchema,
    }),
  ),
});
export type SandboxCapabilities = z.infer<typeof sandboxCapabilitiesSchema>;

export const sandboxHandleSchema = z.strictObject({
  providerId: sandboxProviderIdSchema,
  sandboxId: boundedIdSchema,
  ownerId: boundedIdSchema,
  threadId: boundedIdSchema,
  branchId: boundedIdSchema,
  profileId: sandboxProfileIdSchema,
  profileVersion: z.string().min(1).max(128),
  image: sandboxImageTemplateRefSchema,
  evidenceNonce: boundedIdSchema,
  expiresAt: z.string().datetime({ offset: true }),
});
export type SandboxHandle = z.infer<typeof sandboxHandleSchema>;

export const sandboxFileManifestEntrySchema = z.strictObject({
  relativePath: z.string().min(1).max(1_024),
  digest: sha256DigestSchema,
  byteSize: z
    .number()
    .int()
    .min(0)
    .max(50 * 1024 ** 3),
  mimeType: z.string().min(1).max(256),
  kind: z.enum([
    "pdf",
    "png",
    "jpeg",
    "json",
    "text",
    "csv",
    "pptx",
    "mp3",
    "wav",
    "mp4",
    "webp",
    "vtt",
    "binary",
  ]),
  nodeType: z.enum(["file", "symlink", "device"]),
});
export type SandboxFileManifestEntry = z.infer<
  typeof sandboxFileManifestEntrySchema
>;

export type SandboxInputFile = {
  relativePath: string;
  bytes: Uint8Array;
  digest: string;
  mimeType: string;
};

export type SandboxExecutionEvent =
  | { type: "started"; at: string }
  | { type: "stdout"; chunk: string; truncated: boolean }
  | { type: "stderr"; chunk: string; truncated: boolean }
  | { type: "progress"; current: number; total: number; message?: string }
  | {
      type: "exited";
      at: string;
      exitCode: number;
      signal: string | null;
      outputBytes: number;
    };

export interface SandboxPreflightInput {
  profile: SandboxExecutionProfile;
  expectedHostPolicyDigest: string;
  maxEvidenceAgeMs: number;
  now?: Date;
}

export interface SandboxCreateInput extends SandboxPreflightInput {
  /** Required by managed placement for durable reservation idempotency. */
  operationId?: string;
  ownerId: string;
  threadId: string;
  branchId: string;
  expiresAt: Date;
  workspaceSnapshotRef?: SandboxWorkspaceSnapshotRef;
}

export interface SandboxExecuteInput {
  handle: SandboxHandle;
  executable: string;
  argv: readonly string[];
  cwd?: string;
  environment?: Readonly<Record<string, string>>;
  secretGrants?: readonly SandboxSecretGrant[];
  resources?: Partial<SandboxResourceLimits>;
  signal?: AbortSignal;
}

export interface SandboxProvider {
  readonly id: SandboxProviderId;
  capabilities(): Promise<SandboxCapabilities>;
  preflight(input: SandboxPreflightInput): Promise<SandboxPreflightResult>;
  create(input: SandboxCreateInput): Promise<SandboxHandle>;
  execute(input: SandboxExecuteInput): AsyncIterable<SandboxExecutionEvent>;
  putFiles(
    handle: SandboxHandle,
    files: readonly SandboxInputFile[],
  ): Promise<void>;
  getFiles(
    handle: SandboxHandle,
    paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]>;
  readFile(
    handle: SandboxHandle,
    relativePath: string,
  ): AsyncIterable<Uint8Array>;
  snapshotWorkspace(
    handle: SandboxHandle,
  ): Promise<SandboxWorkspaceSnapshotRef>;
  forkWorkspace(
    input: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef },
  ): Promise<SandboxHandle>;
  stop(handle: SandboxHandle): Promise<void>;
  destroy(handle: SandboxHandle): Promise<void>;
  runtimeCheckpointCapabilities?(): Promise<SandboxRuntimeCheckpointCapabilities>;
  captureRuntimeCheckpoint?(input: {
    handle: SandboxHandle;
    sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<SandboxRuntimeCheckpointRefV1>;
  restoreRuntimeCheckpoint?(input: {
    create: SandboxCreateInput;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }): Promise<SandboxHandle>;
  deleteRuntimeCheckpoint?(
    checkpoint: SandboxRuntimeCheckpointRefV1,
  ): Promise<void>;
}

export const sandboxConformanceCellSchema = z.strictObject({
  providerId: sandboxProviderIdSchema,
  profileId: sandboxProfileIdSchema,
  status: z.enum(["pass", "fail", "unavailable"]),
  isolationClass: sandboxIsolationClassSchema.nullable(),
  baselineVersion: z.literal(SANDBOX_BASELINE_VERSION).nullable(),
  runtimeKind: z.string().min(1).max(128).nullable(),
  runtimeVersion: z.string().min(1).max(128).nullable(),
  imageDigest: sha256DigestSchema.nullable(),
  hostPolicyDigest: sha256DigestSchema.nullable(),
  evidenceNonce: boundedIdSchema.nullable(),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  checks: z.array(
    z.strictObject({
      id: z.string().min(1).max(256),
      status: z.enum(["pass", "fail", "unknown", "not-applicable"]),
      detail: z.string().min(1).max(4_096),
    }),
  ),
});
export type SandboxConformanceCell = z.infer<
  typeof sandboxConformanceCellSchema
>;

export const sandboxConformanceReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  providerId: sandboxProviderIdSchema,
  mockEvidence: z.boolean(),
  passed: z.boolean(),
  cells: z.array(sandboxConformanceCellSchema),
});
export type SandboxConformanceReport = z.infer<
  typeof sandboxConformanceReportSchema
>;

export const sandboxImageBuildAttestationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  proposalId: boundedIdSchema,
  sourceImageDigest: sha256DigestSchema,
  resultImageDigest: sha256DigestSchema,
  profileId: sandboxProfileIdSchema,
  profileVersion: z.string().min(1).max(128),
  dependencyLockDigest: sha256DigestSchema,
  builderPolicyDigest: sha256DigestSchema,
  egressPolicyDigest: sha256DigestSchema,
  sbomDigest: sha256DigestSchema,
  provenanceDigest: sha256DigestSchema,
  signature: z.string().min(16).max(16_384),
  signerKeyId: boundedIdSchema,
  tenantCacheScope: boundedIdSchema,
  scanStatus: z.literal("pass"),
  quarantined: z.literal(false),
  builtAt: z.string().datetime({ offset: true }),
  baselineEvidence: sandboxBaselineEvidenceSchema,
});
export type SandboxImageBuildAttestation = z.infer<
  typeof sandboxImageBuildAttestationSchema
>;

export const sandboxDependencyManifestRequestSchema = z
  .strictObject({
    ecosystem: z.enum(["ctan", "pypi", "npm", "system"]),
    packages: z
      .array(
        z.strictObject({
          name: z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u),
          version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/u),
          registry: z.enum(["ctan", "pypi", "npmjs", "debian-snapshot"]),
          installScripts: z.literal(false),
          nativeBuild: z.boolean(),
        }),
      )
      .min(1)
      .max(256),
    requestedBy: boundedIdSchema,
    tenantCacheScope: boundedIdSchema,
  })
  .superRefine((request, context) => {
    const expectedRegistry = {
      ctan: "ctan",
      pypi: "pypi",
      npm: "npmjs",
      system: "debian-snapshot",
    } as const;
    request.packages.forEach((dependency, index) => {
      if (dependency.registry !== expectedRegistry[request.ecosystem]) {
        context.addIssue({
          code: "custom",
          path: ["packages", index, "registry"],
          message: "Dependency registry must match the declared ecosystem.",
        });
      }
    });
  });
export type SandboxDependencyManifestRequest = z.infer<
  typeof sandboxDependencyManifestRequestSchema
>;
