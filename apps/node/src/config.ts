import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import {
  LOCAL_OCR_MODEL_ID,
  LOCAL_TRANSCRIPTION_MODEL_ID,
  modelDescriptorSchema,
  sandboxEgressPolicySchema,
  sandboxProfileIdSchema,
} from "@avermate/agent-contracts";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { canonicalDigest } from "./canonical-json";

export const nodeProfileSchema = z.enum([
  "dev-zero",
  "node-lite",
  "node-storage",
  "node-byok",
  "node-local-ai",
  "node-creator",
  "node-local-gpu",
  "node-observable",
  "full-self-host",
]);
export type NodeProfile = z.infer<typeof nodeProfileSchema>;

const loopbackHostSchema = z
  .string()
  .refine(
    (host) =>
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      (isIP(host) !== 0 && host.startsWith("127.")),
    "the initial configurator is loopback-only",
  );

export const nodeSecretReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value.startsWith("secret:") ||
      value.startsWith("file:") ||
      !/^[a-z][a-z0-9+.-]*:/iu.test(value),
    "expected a Node secret-store, file URL or filesystem reference",
  );

const endpointSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    !url.hash
  );
}, "expected an HTTP(S) endpoint without credentials or a fragment");

const mcpEndpointSchema = endpointSchema.refine((value) => {
  const url = new URL(value);
  return !url.search && url.pathname.length > 0;
}, "expected an exact MCP endpoint without query parameters");

const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "expected an immutable sha256 digest");

const immutableRevisionSchema = z
  .string()
  .min(7)
  .max(256)
  .refine(
    (value) =>
      !/(?:^|[/:@._-])(latest|main|master|nightly|edge)(?:$|[/:@._-])/iu.test(
        value,
      ),
    "expected an immutable provider or model revision",
  );

const modelConfigSchema = z.strictObject({
  enabled: z.boolean(),
  gateway: z.enum(["disabled", "direct", "litellm"]).default("disabled"),
  endpoint: endpointSchema.optional(),
  providerSecretRefs: z.array(nodeSecretReferenceSchema).max(32),
  adminSecretRef: nodeSecretReferenceSchema.optional(),
  catalogue: z.array(modelDescriptorSchema).max(256).default([]),
  modelRevisions: z
    .record(z.string().min(1).max(256), immutableRevisionSchema)
    .default({}),
  virtualKeyTtlSeconds: z.number().int().min(60).max(86_400).default(900),
  ownerBudgetMinor: z.number().int().nonnegative().default(0),
  ownerRequestsPerMinute: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .default(60),
  ownerTokensPerMinute: z
    .number()
    .int()
    .positive()
    .max(1_000_000_000)
    .default(120_000),
  fallbackChains: z
    .array(
      z.strictObject({
        modelId: z.string().min(1).max(256),
        fallbackModelIds: z.array(z.string().min(1).max(256)).min(1).max(8),
      }),
    )
    .max(64)
    .default([]),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .default("EUR"),
});

export const LOCAL_OCR_MODEL_PROVIDER = "tesseract+poppler" as const;
export const LOCAL_TRANSCRIPTION_MODEL_PROVIDER = "whisper.cpp" as const;

type LocalDocumentAiModelKind = "ocr" | "transcription";
type ModelConfig = z.infer<typeof modelConfigSchema>;

/**
 * A sandbox image alone is not evidence that its immutable language/model
 * assets are present. Keep worker advertisement fenced to the exact signed
 * catalogue entry and revision consumed by the worker manifest.
 */
export function localDocumentAiModelAttestation(
  models: ModelConfig,
  kind: LocalDocumentAiModelKind,
) {
  const expected =
    kind === "ocr"
      ? {
          id: LOCAL_OCR_MODEL_ID,
          provider: LOCAL_OCR_MODEL_PROVIDER,
          modality: "image" as const,
        }
      : {
          id: LOCAL_TRANSCRIPTION_MODEL_ID,
          provider: LOCAL_TRANSCRIPTION_MODEL_PROVIDER,
          modality: "audio" as const,
        };
  const matches = models.catalogue.filter((model) => model.id === expected.id);
  const model = matches.length === 1 ? matches[0] : undefined;
  const revision = models.modelRevisions[expected.id];
  if (
    !models.enabled ||
    !model ||
    model.provider !== expected.provider ||
    model.modalities.length !== 1 ||
    model.modalities[0] !== expected.modality ||
    model.contextWindow !== "unknown" ||
    Object.values(model.capabilities).some(Boolean) ||
    !revision
  ) {
    return null;
  }
  return { model, revision };
}

const sandboxImageSchema = z.strictObject({
  profileId: sandboxProfileIdSchema,
  image: z.string().min(1).max(512),
  digest: digestSchema,
  architecture: z.enum(["amd64", "arm64"]),
  egress: sandboxEgressPolicySchema.default({ mode: "none" }),
});

const specialistWorkerSchema = z.strictObject({
  enabled: z.boolean().default(false),
  image: z.string().min(1).max(512).optional(),
  digest: digestSchema.optional(),
  license: z.string().min(1).max(128).optional(),
  maximumInputBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 ** 3)
    .default(64 * 1024 ** 2),
  maximumOutputBytes: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 ** 3)
    .default(128 * 1024 ** 2),
  maximumCommands: z.number().int().positive().max(1_000).default(50),
  commandCatalogue: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/u),
        argv: z.array(z.string().min(1).max(1_024)).min(1).max(64),
      }),
    )
    .max(100)
    .default([]),
  network: z.enum(["denied", "allowlist"]).default("denied"),
  allowedHosts: z.array(z.string().min(1).max(253)).max(100).default([]),
});

const disabledSpecialistWorker = {
  enabled: false,
  maximumInputBytes: 64 * 1024 ** 2,
  maximumOutputBytes: 128 * 1024 ** 2,
  maximumCommands: 50,
  commandCatalogue: [],
  network: "denied" as const,
  allowedHosts: [],
};

export const nodeConfigSchema = z
  .strictObject({
    version: z.literal(1),
    profile: nodeProfileSchema,
    bind: z.strictObject({
      host: loopbackHostSchema,
      port: z.number().int().min(1_024).max(65_535),
    }),
    dataDir: z.string().min(1).max(4_096),
    storage: z.strictObject({
      driver: z.enum(["filesystem", "s3"]),
      filesystemRoot: z.string().min(1).max(4_096).optional(),
      s3SecretRef: nodeSecretReferenceSchema.optional(),
      maxObjectBytes: z.number().int().positive(),
      quotaBytes: z.number().int().positive(),
    }),
    relay: z.strictObject({
      transport: z.enum(["tls", "local-compose"]).default("tls"),
      coreUrl: z.url().optional(),
      credentialSecretRef: nodeSecretReferenceSchema.optional(),
      capabilityCredentialSecretRef: nodeSecretReferenceSchema.optional(),
      coreGrantKeyId: z.string().min(1).max(256).optional(),
      coreGrantPublicKey: z.string().min(32).max(512).optional(),
    }),
    conversations: z
      .strictObject({
        enabled: z.boolean().default(true),
        maximumBytes: z
          .number()
          .int()
          .positive()
          .max(1024 ** 4)
          .default(2 * 1024 ** 3),
      })
      .default({ enabled: true, maximumBytes: 2 * 1024 ** 3 }),
    retrieval: z
      .strictObject({
        enabled: z.boolean().default(true),
        lexical: z.boolean().default(true),
        maximumIndexedBytes: z
          .number()
          .int()
          .positive()
          .max(1024 ** 4)
          .default(10 * 1024 ** 3),
        embeddingEndpoint: endpointSchema.optional(),
        embeddingProvider: z
          .enum(["openai-compatible", "tei", "gemini"])
          .optional(),
        embeddingSecretRef: nodeSecretReferenceSchema.optional(),
        embeddingModel: z.string().min(1).max(256).optional(),
        embeddingRevision: immutableRevisionSchema.optional(),
        embeddingDimensions: z
          .array(z.number().int().positive().max(65_536))
          .max(16)
          .default([]),
        rerankEndpoint: endpointSchema.optional(),
        rerankProvider: z.enum(["tei", "qwen3"]).optional(),
        rerankSecretRef: nodeSecretReferenceSchema.optional(),
        rerankModel: z.string().min(1).max(256).optional(),
        rerankRevision: immutableRevisionSchema.optional(),
        rerankImageDigest: digestSchema.optional(),
        rerankRuntimeRevision: immutableRevisionSchema.optional(),
      })
      .default({
        enabled: true,
        lexical: true,
        maximumIndexedBytes: 10 * 1024 ** 3,
        embeddingDimensions: [],
      }),
    models: modelConfigSchema,
    mcp: z
      .strictObject({
        enabled: z.boolean().default(false),
        allowedEndpoints: z.array(mcpEndpointSchema).max(100).default([]),
        maxCatalogueTools: z.number().int().positive().max(500).default(500),
        maxRequestBytes: z
          .number()
          .int()
          .positive()
          .max(256 * 1024)
          .default(16 * 1024),
        maxResponseBytes: z
          .number()
          .int()
          .positive()
          .max(4 * 1024 * 1024)
          .default(1024 * 1024),
        connectTimeoutMs: z
          .number()
          .int()
          .min(100)
          .max(60_000)
          .default(15_000),
        operationTimeoutMs: z
          .number()
          .int()
          .min(100)
          .max(5 * 60_000)
          .default(30_000),
      })
      .default({
        enabled: false,
        allowedEndpoints: [],
        maxCatalogueTools: 500,
        maxRequestBytes: 16 * 1024,
        maxResponseBytes: 1024 * 1024,
        connectTimeoutMs: 15_000,
        operationTimeoutMs: 30_000,
      }),
    sandbox: z.strictObject({
      enabled: z.boolean(),
      provider: z.enum(["disabled", "opensandbox", "microsandbox"]),
      endpoint: endpointSchema.optional(),
      evidenceEndpoint: endpointSchema.optional(),
      providerSecretRef: nodeSecretReferenceSchema.optional(),
      evidenceSecretRef: nodeSecretReferenceSchema.optional(),
      hostPolicyDigest: digestSchema.optional(),
      maxEvidenceAgeSeconds: z
        .number()
        .int()
        .min(10)
        .max(24 * 60 * 60)
        .default(300),
      isolation: z
        .enum(["none", "runc", "gvisor", "kata", "microvm"])
        .default("none"),
      runtimeCheckpoints: z.boolean().default(false),
      runtimeRegion: immutableRevisionSchema.optional(),
      runtimeArchitecture: z.enum(["amd64", "arm64"]).optional(),
      runtimeKind: immutableRevisionSchema.optional(),
      runtimeVersion: immutableRevisionSchema.optional(),
      runtimeCheckpointMaxTtlSeconds: z
        .number()
        .int()
        .min(60)
        .max(30 * 24 * 60 * 60)
        .optional(),
      images: z.array(sandboxImageSchema).max(64).default([]),
    }),
    jobs: z
      .strictObject({
        enabled: z.boolean().default(true),
        maximumConcurrent: z.number().int().positive().max(10_000).default(2),
        leaseTtlSeconds: z.number().int().min(5).max(300).default(30),
      })
      .default({ enabled: true, maximumConcurrent: 2, leaseTtlSeconds: 30 }),
    workers: z
      .strictObject({
        opencode: specialistWorkerSchema.default(disabledSpecialistWorker),
        openhands: specialistWorkerSchema.default(disabledSpecialistWorker),
      })
      .default({
        opencode: disabledSpecialistWorker,
        openhands: disabledSpecialistWorker,
      }),
    lifecycle: z
      .strictObject({
        backupDir: z.string().min(1).max(4_096).default("backups"),
        releaseVersion: z.string().min(1).max(128).default("development"),
        previousReleaseVersion: z.string().min(1).max(128).optional(),
        offline: z.boolean().default(false),
        releaseManifestPath: z.string().min(1).max(4_096).optional(),
        releaseSigningPublicKeyPath: z.string().min(1).max(4_096).optional(),
      })
      .default({
        backupDir: "backups",
        releaseVersion: "development",
        offline: false,
      }),
    telemetry: z.strictObject({
      enabled: z.boolean(),
      endpoint: z.url().startsWith("https://").optional(),
    }),
  })
  .superRefine((config, context) => {
    if (config.relay.transport === "local-compose") {
      if (config.profile !== "full-self-host" || !config.lifecycle.offline) {
        context.addIssue({
          code: "custom",
          path: ["relay", "transport"],
          message:
            "local-compose relay is restricted to the offline full-self-host profile",
        });
      }
      if (
        config.relay.coreUrl &&
        config.relay.coreUrl !== "http://api:5000"
      ) {
        context.addIssue({
          code: "custom",
          path: ["relay", "coreUrl"],
          message: "local-compose relay must target exactly http://api:5000",
        });
      }
    } else if (
      config.relay.coreUrl &&
      !config.relay.coreUrl.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["relay", "coreUrl"],
        message: "TLS relay requires an HTTPS Core URL",
      });
    }
    if (
      config.storage.driver === "filesystem" &&
      !config.storage.filesystemRoot
    ) {
      context.addIssue({
        code: "custom",
        path: ["storage", "filesystemRoot"],
        message: "filesystem storage requires filesystemRoot",
      });
    }
    if (config.storage.driver === "s3" && !config.storage.s3SecretRef) {
      context.addIssue({
        code: "custom",
        path: ["storage", "s3SecretRef"],
        message: "S3 storage requires an external secret reference",
      });
    }
    if (
      config.profile === "dev-zero" &&
      config.storage.driver !== "filesystem"
    ) {
      context.addIssue({
        code: "custom",
        path: ["storage", "driver"],
        message: "dev-zero intentionally uses filesystem storage",
      });
    }
    if (!config.sandbox.enabled && config.sandbox.provider !== "disabled") {
      context.addIssue({
        code: "custom",
        path: ["sandbox", "provider"],
        message: "a disabled sandbox must use the disabled provider",
      });
    }
    if (config.sandbox.enabled && config.sandbox.provider === "disabled") {
      context.addIssue({
        code: "custom",
        path: ["sandbox", "provider"],
        message: "an enabled sandbox requires a provider",
      });
    }
    if (
      config.sandbox.enabled &&
      config.sandbox.provider !== "disabled" &&
      (config.sandbox.runtimeCheckpoints ||
        config.sandbox.images.length > 0 ||
        config.workers.opencode.enabled ||
        config.workers.openhands.enabled) &&
      (!config.sandbox.endpoint ||
        !config.sandbox.evidenceEndpoint ||
        !config.sandbox.hostPolicyDigest)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sandbox"],
        message:
          "enabled remote sandboxes require runtime, external evidence and host-policy endpoints",
      });
    }
    const runtimeCheckpointConfigured = Boolean(
      config.sandbox.runtimeRegion &&
        config.sandbox.runtimeArchitecture &&
        config.sandbox.runtimeKind &&
        config.sandbox.runtimeVersion &&
        config.sandbox.runtimeCheckpointMaxTtlSeconds,
    );
    if (config.sandbox.runtimeCheckpoints !== runtimeCheckpointConfigured) {
      context.addIssue({
        code: "custom",
        path: ["sandbox", "runtimeCheckpoints"],
        message:
          "runtime checkpoints require exact region, architecture, runtime kind/version and TTL metadata",
      });
    }
    const sandboxProfileIds = new Set<string>();
    for (const [index, image] of config.sandbox.images.entries()) {
      if (sandboxProfileIds.has(image.profileId)) {
        context.addIssue({
          code: "custom",
          path: ["sandbox", "images", index, "profileId"],
          message: "sandbox profiles must have one exact image configuration",
        });
      }
      sandboxProfileIds.add(image.profileId);
      if (!image.image.endsWith(`@${image.digest}`)) {
        context.addIssue({
          code: "custom",
          path: ["sandbox", "images", index, "image"],
          message: "sandbox images must be pinned to their declared sha256 digest",
        });
      }
      if (
        image.egress.mode === "allowlist" &&
        image.egress.destinations.some(
          (destination) =>
            destination.protocol !== "https" || destination.port !== 443,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["sandbox", "images", index, "egress"],
          message: "sandbox egress accepts reviewed HTTPS:443 destinations only",
        });
      }
    }
    for (const kind of ["ocr", "transcription"] as const) {
      const profileId = kind === "ocr" ? "ocr" : "speech-to-text";
      if (
        sandboxProfileIds.has(profileId) &&
        !localDocumentAiModelAttestation(config.models, kind)
      ) {
        context.addIssue({
          code: "custom",
          path: ["models", "catalogue"],
          message: `${profileId} requires its exact offline model/provider/modality and immutable revision`,
        });
      }
    }
    if (
      Boolean(config.relay.coreUrl) !==
      Boolean(config.relay.credentialSecretRef)
    ) {
      context.addIssue({
        code: "custom",
        path: ["relay"],
        message:
          "relay coreUrl and credentialSecretRef must be configured together",
      });
    }
    if (
      Boolean(config.relay.coreUrl) !== Boolean(config.relay.coreGrantKeyId) ||
      Boolean(config.relay.coreUrl) !== Boolean(config.relay.coreGrantPublicKey)
    ) {
      context.addIssue({
        code: "custom",
        path: ["relay", "coreGrantPublicKey"],
        message:
          "a configured relay requires the delivered Core grant verification key",
      });
    }
    if (
      config.relay.capabilityCredentialSecretRef &&
      !config.relay.credentialSecretRef
    ) {
      context.addIssue({
        code: "custom",
        path: ["relay", "capabilityCredentialSecretRef"],
        message: "a capability credential requires a configured relay",
      });
    }
    if (config.models.enabled && config.models.gateway === "disabled") {
      context.addIssue({
        code: "custom",
        path: ["models", "gateway"],
        message: "enabled models require direct or LiteLLM gateway mode",
      });
    }
    if (!config.models.enabled && config.models.gateway !== "disabled") {
      context.addIssue({
        code: "custom",
        path: ["models", "gateway"],
        message: "disabled models must use the disabled gateway",
      });
    }
    if (config.models.enabled && !config.models.endpoint) {
      context.addIssue({
        code: "custom",
        path: ["models", "endpoint"],
        message: "enabled models require an explicit endpoint",
      });
    }
    if (config.models.enabled && config.models.catalogue.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["models", "catalogue"],
        message: "enabled models require an exact model catalogue",
      });
    }
    if (config.models.enabled) {
      const modelIds = new Set(
        config.models.catalogue.map((model) => model.id),
      );
      for (const modelId of modelIds) {
        if (!config.models.modelRevisions[modelId]) {
          context.addIssue({
            code: "custom",
            path: ["models", "modelRevisions", modelId],
            message: "every advertised model requires an immutable revision",
          });
        }
      }
      for (const modelId of Object.keys(config.models.modelRevisions)) {
        if (!modelIds.has(modelId)) {
          context.addIssue({
            code: "custom",
            path: ["models", "modelRevisions", modelId],
            message: "a revision cannot advertise an absent catalogue entry",
          });
        }
      }
    }
    if (config.models.gateway === "litellm" && !config.models.adminSecretRef) {
      context.addIssue({
        code: "custom",
        path: ["models", "adminSecretRef"],
        message: "LiteLLM requires an admin credential reference",
      });
    }
    if (config.models.gateway === "litellm") {
      const modelIds = new Set(
        config.models.catalogue.map((model) => model.id),
      );
      const sources = new Set<string>();
      const graph = new Map<string, readonly string[]>();
      for (const [index, chain] of config.models.fallbackChains.entries()) {
        if (
          sources.has(chain.modelId) ||
          !modelIds.has(chain.modelId) ||
          new Set(chain.fallbackModelIds).size !==
            chain.fallbackModelIds.length ||
          chain.fallbackModelIds.some(
            (modelId) => modelId === chain.modelId || !modelIds.has(modelId),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["models", "fallbackChains", index],
            message:
              "LiteLLM fallback chains must be unique, explicit catalogue-only routes",
          });
        }
        sources.add(chain.modelId);
        graph.set(chain.modelId, chain.fallbackModelIds);
      }
      const visit = (
        modelId: string,
        visiting: Set<string>,
        visited: Set<string>,
      ): boolean => {
        if (visiting.has(modelId)) return false;
        if (visited.has(modelId)) return true;
        visiting.add(modelId);
        for (const fallback of graph.get(modelId) ?? []) {
          if (!visit(fallback, visiting, visited)) return false;
        }
        visiting.delete(modelId);
        visited.add(modelId);
        return true;
      };
      const visited = new Set<string>();
      if (
        [...graph.keys()].some((modelId) => !visit(modelId, new Set(), visited))
      ) {
        context.addIssue({
          code: "custom",
          path: ["models", "fallbackChains"],
          message: "LiteLLM fallback chains cannot contain cycles",
        });
      }
    }
    if (
      config.models.gateway === "litellm" &&
      (config.models.ownerBudgetMinor < 1 || config.models.currency !== "USD")
    ) {
      context.addIssue({
        code: "custom",
        path: ["models", "ownerBudgetMinor"],
        message:
          "LiteLLM proxy budgets are USD-denominated and require a positive per-owner ceiling",
      });
    }
    if (!config.mcp.enabled && config.mcp.allowedEndpoints.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["mcp", "allowedEndpoints"],
        message: "disabled MCP transport cannot advertise approved endpoints",
      });
    }
    const approvedMcpEndpoints = new Set<string>();
    for (const [index, endpoint] of config.mcp.allowedEndpoints.entries()) {
      const normalized = new URL(endpoint);
      normalized.pathname = normalized.pathname.replace(/\/{2,}/gu, "/");
      const key = normalized.href;
      if (approvedMcpEndpoints.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["mcp", "allowedEndpoints", index],
          message: "MCP endpoints must be unique after normalization",
        });
      }
      approvedMcpEndpoints.add(key);
    }
    if (config.retrieval.enabled && !config.retrieval.lexical) {
      context.addIssue({
        code: "custom",
        path: ["retrieval", "lexical"],
        message: "enabled retrieval requires the mandatory lexical backend",
      });
    }
    const embeddingConfigured = Boolean(config.retrieval.embeddingEndpoint);
    if (
      embeddingConfigured !== Boolean(config.retrieval.embeddingProvider) ||
      embeddingConfigured !== Boolean(config.retrieval.embeddingModel) ||
      embeddingConfigured !== Boolean(config.retrieval.embeddingRevision) ||
      embeddingConfigured !== config.retrieval.embeddingDimensions.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["retrieval", "embeddingEndpoint"],
        message:
          "embedding provider, endpoint, exact model/revision and dimensions must be configured together",
      });
    }
    const rerankConfigured = Boolean(config.retrieval.rerankEndpoint);
    if (
      rerankConfigured !== Boolean(config.retrieval.rerankProvider) ||
      rerankConfigured !== Boolean(config.retrieval.rerankModel) ||
      rerankConfigured !== Boolean(config.retrieval.rerankRevision) ||
      rerankConfigured !== Boolean(config.retrieval.rerankImageDigest) ||
      rerankConfigured !== Boolean(config.retrieval.rerankRuntimeRevision)
    ) {
      context.addIssue({
        code: "custom",
        path: ["retrieval", "rerankEndpoint"],
        message:
          "rerank endpoint, provider, exact model/revision, runtime revision and image digest must be configured together",
      });
    }
    for (const [workerId, worker] of Object.entries(config.workers)) {
      if (
        worker.enabled &&
        (!worker.image ||
          !worker.digest ||
          !worker.license ||
          worker.commandCatalogue.length === 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["workers", workerId],
          message:
            "enabled specialist workers require a reviewed image, digest, license and command catalogue",
        });
      }
      if (worker.network === "denied" && worker.allowedHosts.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["workers", workerId, "allowedHosts"],
          message: "network-denied workers cannot declare allowed hosts",
        });
      }
      if (worker.enabled) {
        const image = config.sandbox.images.find(
          (candidate) => candidate.profileId === workerId,
        );
        if (
          !config.sandbox.enabled ||
          config.sandbox.provider === "disabled" ||
          !config.sandbox.hostPolicyDigest ||
          !image ||
          image.image !== worker.image ||
          image.digest !== worker.digest
        ) {
          context.addIssue({
            code: "custom",
            path: ["workers", workerId],
            message:
              "enabled specialist workers require a matching sandbox image and host-policy attestation",
          });
        }
        if (
          worker.commandCatalogue.some(
            (command) =>
              !command.argv[0]?.startsWith("/") ||
              !command.argv.some((argument) =>
                argument.includes("/workspace/input/request.json"),
              ),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["workers", workerId, "commandCatalogue"],
            message:
              "specialist commands must use absolute executables and consume the immutable request manifest",
          });
        }
      }
    }
    if (
      config.lifecycle.offline &&
      (!config.lifecycle.releaseManifestPath ||
        !config.lifecycle.releaseSigningPublicKeyPath)
    ) {
      context.addIssue({
        code: "custom",
        path: ["lifecycle"],
        message:
          "offline mode requires a release manifest and signing public key",
      });
    }
  });
export type NodeConfig = z.infer<typeof nodeConfigSchema>;

export function defaultDevZeroConfig(baseDir = ".data/node"): NodeConfig {
  return nodeConfigSchema.parse({
    version: 1,
    profile: "dev-zero",
    bind: { host: "127.0.0.1", port: 5_188 },
    dataDir: baseDir,
    storage: {
      driver: "filesystem",
      filesystemRoot: `${baseDir}/objects`,
      maxObjectBytes: 512 * 1024 * 1024,
      quotaBytes: 20 * 1024 * 1024 * 1024,
    },
    relay: { transport: "tls" },
    conversations: { enabled: true, maximumBytes: 2 * 1024 ** 3 },
    retrieval: {
      enabled: true,
      lexical: true,
      maximumIndexedBytes: 10 * 1024 ** 3,
      embeddingDimensions: [],
    },
    models: {
      enabled: false,
      gateway: "disabled",
      providerSecretRefs: [],
      catalogue: [],
    },
    mcp: {
      enabled: false,
      allowedEndpoints: [],
    },
    sandbox: {
      enabled: false,
      provider: "disabled",
      isolation: "none",
      runtimeCheckpoints: false,
      images: [],
    },
    jobs: { enabled: true, maximumConcurrent: 2, leaseTtlSeconds: 30 },
    workers: { opencode: { enabled: false }, openhands: { enabled: false } },
    lifecycle: {
      backupDir: `${baseDir}/backups`,
      releaseVersion: "development",
      offline: false,
    },
    telemetry: { enabled: false },
  });
}

function configured(reference?: string) {
  return reference ? "configured" : undefined;
}

/** Browser/log-safe configuration view. Secret references are never disclosed. */
export function publicConfig(input: NodeConfig) {
  return {
    version: input.version,
    profile: input.profile,
    bind: input.bind,
    dataDir: input.dataDir,
    storage: {
      driver: input.storage.driver,
      ...(input.storage.filesystemRoot
        ? { filesystemRoot: input.storage.filesystemRoot }
        : {}),
      ...(input.storage.s3SecretRef ? { s3SecretRef: "configured" } : {}),
      maxObjectBytes: input.storage.maxObjectBytes,
      quotaBytes: input.storage.quotaBytes,
    },
    relay: {
      transport: input.relay.transport,
      ...(input.relay.coreUrl ? { coreUrl: input.relay.coreUrl } : {}),
      ...(input.relay.credentialSecretRef
        ? { credentialSecretRef: "configured" }
        : {}),
      ...(input.relay.capabilityCredentialSecretRef
        ? { capabilityCredentialSecretRef: "configured" }
        : {}),
      ...(input.relay.coreGrantKeyId
        ? { coreGrantKeyId: input.relay.coreGrantKeyId }
        : {}),
      coreGrantPublicKeyConfigured: Boolean(input.relay.coreGrantPublicKey),
    },
    conversations: input.conversations,
    retrieval: {
      ...input.retrieval,
      embeddingSecretRef: configured(input.retrieval.embeddingSecretRef),
      rerankSecretRef: configured(input.retrieval.rerankSecretRef),
    },
    models: {
      ...input.models,
      providerSecretRefs: input.models.providerSecretRefs.map(
        () => "configured",
      ),
      adminSecretRef: configured(input.models.adminSecretRef),
    },
    mcp: input.mcp,
    sandbox: {
      ...input.sandbox,
      providerSecretRef: configured(input.sandbox.providerSecretRef),
      evidenceSecretRef: configured(input.sandbox.evidenceSecretRef),
    },
    jobs: input.jobs,
    workers: input.workers,
    lifecycle: input.lifecycle,
    telemetry: {
      enabled: input.telemetry.enabled,
      ...(input.telemetry.endpoint
        ? { endpoint: input.telemetry.endpoint }
        : {}),
    },
  };
}

/**
 * The signed manifest binds exact secret references without disclosing them.
 * Secret values are intentionally excluded so credential rotation remains
 * independent from the public configuration revision.
 */
export function configRevision(input: NodeConfig) {
  return canonicalDigest(nodeConfigSchema.parse(input));
}

export function serializeNodeConfig(input: NodeConfig) {
  return stringify(nodeConfigSchema.parse(input), { lineWidth: 100 });
}

/** Expand only explicitly public, scalar release pins in checked-in profiles. */
export function expandPublicNodeConfigEnvironment(
  source: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return source.replace(
    /\$\{(AVERMATE_NODE_PUBLIC_[A-Z0-9_]+)\}/gu,
    (_placeholder, name: string) => {
      const value = environment[name]?.trim();
      if (
        !value ||
        value.length > 512 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+\-]*$/u.test(value)
      ) {
        throw new Error(`NODE_PUBLIC_CONFIG_VALUE_REQUIRED:${name}`);
      }
      return value;
    },
  );
}

export async function loadNodeConfig(
  path?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeConfig> {
  const target = path ?? environment.AVERMATE_NODE_CONFIG;
  if (!target) return defaultDevZeroConfig();
  const body = await readFile(resolve(target), "utf8");
  return nodeConfigSchema.parse(
    parse(expandPublicNodeConfigEnvironment(body, environment)),
  );
}
