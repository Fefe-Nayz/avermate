import type {
  SandboxProvider,
  SandboxProviderId,
} from "@avermate/agent-contracts";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultDevZeroConfig,
  loadNodeConfig,
  serializeNodeConfig,
  type NodeConfig,
} from "./config";
import { ConfiguratorSecurity, secureResponse } from "./configurator-security";
import { LocalConfigurator } from "./configurator";
import { FilesystemObjectStorageProvider } from "./filesystem-storage";
import { loadOrCreateNodeIdentity } from "./identity";
import { GrantReplayLedger, PairingManager, buildManifest } from "./protocol";
import {
  BunWebSocketControlConnector,
  OutboundNodeControlChannel,
  controlChannelUrl,
} from "./control-channel";
import { NodeJobLedger } from "./job-ledger";
import { loadS3NodeCredentials, S3ObjectStorageProvider } from "./s3-storage";
import { FilesystemConversationStore } from "./conversation-store";
import { FilesystemLexicalSearchBackend } from "./lexical-store";
import {
  LiteLLMNodeGateway,
  OpenAICompatibleNodeGateway,
} from "./model-gateway";
import { NodeSecretStore } from "./secret-store";
import { BoundedNodeProviderFetcher } from "./provider-fetch";
import { LocalNodeProviderTransport } from "./provider-transport";
import { LocalNodeMcpTransport } from "./mcp-transport";
import { NodeCapabilityOperationDispatcher } from "./capability-dispatcher";
import { NodeOperationResultLedger } from "./operation-ledger";
import {
  NodeJobDispatcher,
  NodeJobHandlerRegistry,
  type NodeJobHandler,
} from "./job-dispatcher";
import { configRevision } from "./config";
import { sha256Digest } from "./canonical-json";
import {
  configuredArtifactSandboxProfiles,
  createHealthyArtifactHandlers,
  type ArtifactSandboxJobHandler,
} from "./artifact-workers";
import {
  createSpecialistSandboxProfile,
  objectStorageManifestReader,
  ProviderSpecialistSandboxRunner,
  SpecialistWorkerJobHandler,
} from "./specialist-workers";
import { createConfiguredNodeSandboxProvider } from "./opensandbox-runtime";
import {
  ARTIFACT_REAPER_INTERVAL_MS,
  NodeArtifactRetentionReaper,
} from "./artifact-retention";
import { NodeCapabilitySecretCustody } from "./capabilities/secret-store";
import {
  NodeCapabilityRegistry,
  type NodeCapabilityAdapter,
} from "./capabilities/registry";
import {
  bridgeLegacyNodeCapabilityOfferings,
  configuredNodeCapabilitySidecarOffering,
  inferenceManifestFeature,
  nodeCapabilityProtocolV1Enabled,
} from "./capabilities/manifest";
import {
  LegacyModelCapabilityAdapter,
  LegacyRetrievalCapabilityAdapter,
} from "./capabilities/legacy-bridge";
import { LegacyArtifactWorkerCapabilityAdapter } from "./capabilities/worker-adapter";
import { NodeCapabilityExecutor } from "./capabilities/executor";
import { NodeCapabilityV1Dispatcher } from "./capabilities/dispatcher";
import { NodeCapabilityHttpSidecarAdapter } from "./capabilities/sidecar-client";
import { NodeSidecarArtifactIo } from "./capabilities/sidecar-artifacts";

async function readSecretReference(reference: string) {
  if (
    /^[a-z][a-z0-9+.-]*:/iu.test(reference) &&
    !reference.startsWith("file:")
  ) {
    throw new Error("NODE_SECRET_REFERENCE_SCHEME_UNSUPPORTED");
  }
  const path = reference.startsWith("file:")
    ? fileURLToPath(reference)
    : resolve(reference);
  const metadata = await stat(path);
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new Error("NODE_SECRET_FILE_PERMISSIONS_TOO_OPEN");
  }
  const value = (await readFile(path, "utf8")).trim();
  if (value.length < 32 || value.length > 8_192) {
    throw new Error("NODE_CHANNEL_CREDENTIAL_INVALID");
  }
  return value;
}

async function initializeMutableConfig(path: string, config: NodeConfig) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serializeNodeConfig(config), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function resolveDaemonConfig(input: {
  config?: NodeConfig;
  configPath?: string;
  configTemplatePath?: string;
}) {
  if (input.config) {
    return {
      config: input.config,
      configPath:
        input.configPath ?? resolve(input.config.dataDir, "avermate-node.yaml"),
    };
  }
  const configuredPath =
    input.configPath ?? process.env.AVERMATE_NODE_CONFIG?.trim();
  if (!configuredPath) {
    const config = defaultDevZeroConfig();
    return {
      config,
      configPath: resolve(config.dataDir, "avermate-node.yaml"),
    };
  }
  const configPath = resolve(configuredPath);
  try {
    return { config: await loadNodeConfig(configPath), configPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const templatePath =
    input.configTemplatePath ??
    process.env.AVERMATE_NODE_CONFIG_TEMPLATE?.trim();
  const config = templatePath
    ? await loadNodeConfig(templatePath)
    : defaultDevZeroConfig(dirname(configPath));
  await initializeMutableConfig(configPath, config);
  return { config, configPath };
}

export async function createNodeDaemon(
  input: {
    config?: NodeConfig;
    configPath?: string;
    /** Immutable first-boot profile copied once to the mutable config path. */
    configTemplatePath?: string;
    /**
     * Optional container-namespace listener. Docker must publish it on host
     * loopback only; the canonical configurator listener remains loopback.
     */
    containerBridgePort?: number;
    bootstrapPath?: string;
    configuratorFetch?: typeof fetch;
    sandboxes?: (
      ownerId: string,
      providerId: SandboxProviderId,
    ) => SandboxProvider | null;
    /**
     * Production provider already configured with the profiles returned by
     * createSpecialistSandboxProfile. No mock provider is accepted.
     */
    specialistProvider?: SandboxProvider;
    jobHandlers?: readonly NodeJobHandler[];
    /**
     * Optional node-local capability adapters (for example HTTP sidecars).
     * They are only registered when NODE_CAPABILITY_PROTOCOL_V1=true.
     */
    capabilityAdapters?: readonly NodeCapabilityAdapter[];
  } = {},
) {
  const resolvedConfig = await resolveDaemonConfig(input);
  const config = resolvedConfig.config;
  const dataDir = resolve(config.dataDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const identity = await loadOrCreateNodeIdentity(
    resolve(dataDir, "secrets", "identity.json"),
  );
  const storage =
    config.storage.driver === "filesystem" && config.storage.filesystemRoot
      ? new FilesystemObjectStorageProvider({
          root: config.storage.filesystemRoot,
          maxObjectBytes: config.storage.maxObjectBytes,
          quotaBytes: config.storage.quotaBytes,
        })
      : new S3ObjectStorageProvider({
          credentials: await loadS3NodeCredentials(
            config.storage.s3SecretRef ?? "",
          ),
          journalPath: resolve(dataDir, "storage", "s3-journal.json"),
          maxObjectBytes: config.storage.maxObjectBytes,
          quotaBytes: config.storage.quotaBytes,
        });
  await storage.initialize();
  const jobLedger = new NodeJobLedger(resolve(dataDir, "jobs", "ledger.json"));
  const artifactRetentionReaper = new NodeArtifactRetentionReaper({
    ledger: jobLedger,
    storage,
  });
  const secretStore = new NodeSecretStore(resolve(dataDir, "secrets"));
  const conversationStore = config.conversations.enabled
    ? new FilesystemConversationStore({
        path: resolve(dataDir, "conversations", "events.json"),
        maximumBytes: config.conversations.maximumBytes,
      })
    : null;
  await conversationStore?.initialize();
  const lexicalStores = new Map<string, FilesystemLexicalSearchBackend>();
  const lexicalStore = (ownerId: string) => {
    if (!config.retrieval.enabled || !config.retrieval.lexical) return null;
    const ownerKey = sha256Digest(ownerId).slice("sha256:".length);
    const existing = lexicalStores.get(ownerKey);
    if (existing) return existing;
    const created = new FilesystemLexicalSearchBackend({
      path: resolve(dataDir, "retrieval", `${ownerKey}.json`),
      ownerId,
      maximumBytes: config.retrieval.maximumIndexedBytes,
    });
    lexicalStores.set(ownerKey, created);
    return created;
  };
  const modelGateway = config.models.enabled
    ? config.models.gateway === "litellm"
      ? new LiteLLMNodeGateway({
          baseUrl: config.models.endpoint!,
          models: config.models.catalogue,
          adminKey: () => secretStore.read(config.models.adminSecretRef!),
          virtualKeyTtlSeconds: config.models.virtualKeyTtlSeconds,
          ownerBudgetMinor: config.models.ownerBudgetMinor,
          ownerRequestsPerMinute: config.models.ownerRequestsPerMinute,
          ownerTokensPerMinute: config.models.ownerTokensPerMinute,
          fallbackChains: config.models.fallbackChains,
        })
      : new OpenAICompatibleNodeGateway({
          baseUrl: config.models.endpoint!,
          models: config.models.catalogue,
          credential: async () =>
            config.models.providerSecretRefs[0]
              ? secretStore.read(config.models.providerSecretRefs[0])
              : null,
        })
    : null;
  const providerRoutes = [
    ...(config.retrieval.embeddingEndpoint
      ? [
          {
            purpose: "embedding" as const,
            baseUrl: config.retrieval.embeddingEndpoint,
            ...(config.retrieval.embeddingSecretRef
              ? { secretRef: config.retrieval.embeddingSecretRef }
              : {}),
          },
        ]
      : []),
    ...(config.retrieval.rerankEndpoint
      ? [
          {
            purpose: "rerank" as const,
            baseUrl: config.retrieval.rerankEndpoint,
            ...(config.retrieval.rerankSecretRef
              ? { secretRef: config.retrieval.rerankSecretRef }
              : {}),
          },
        ]
      : []),
  ];
  const providerFetcher =
    config.retrieval.enabled && providerRoutes.length > 0
      ? new BoundedNodeProviderFetcher({
          routes: providerRoutes,
          secrets: secretStore,
        })
      : null;
  const mcpTransport = config.mcp.enabled
    ? new LocalNodeMcpTransport({
        allowedEndpoints: config.mcp.allowedEndpoints,
        maxCatalogueTools: config.mcp.maxCatalogueTools,
        maxRequestBytes: config.mcp.maxRequestBytes,
        maxResponseBytes: config.mcp.maxResponseBytes,
        connectTimeoutMs: config.mcp.connectTimeoutMs,
        operationTimeoutMs: config.mcp.operationTimeoutMs,
      })
    : null;
  const specialistProvider =
    input.specialistProvider ??
    (await createConfiguredNodeSandboxProvider({
      config,
      storage,
      secrets: secretStore,
    }));
  const sandboxResolver =
    input.sandboxes ??
    (specialistProvider
      ? (_ownerId: string, providerId: SandboxProviderId) =>
          specialistProvider.id === providerId ? specialistProvider : null
      : undefined);
  const providerTransport = new LocalNodeProviderTransport(identity.nodeId, {
    storage,
    ...(config.relay.coreGrantPublicKey && config.relay.coreGrantKeyId
      ? {
          deletion: {
            identity,
            issuerPublicKeyDer: config.relay.coreGrantPublicKey,
            expectedIssuerKeyId: config.relay.coreGrantKeyId,
          },
        }
      : {}),
    conversations: conversationStore ? () => conversationStore : undefined,
    lexical: lexicalStore,
    models: modelGateway ? () => modelGateway : undefined,
    providerHttp: providerFetcher ? () => providerFetcher : undefined,
    mcp: mcpTransport ?? undefined,
    sandboxes: sandboxResolver,
  });
  const operationResults = new NodeOperationResultLedger({
    path: resolve(dataDir, "relay", "operation-results.json"),
    maximumBytes: 64 * 1024 * 1024,
  });
  await operationResults.initialize();
  await operationResults.recoverInterrupted();
  const operationGrantReplay = new GrantReplayLedger(
    resolve(dataDir, "relay", "operation-grants.json"),
  );
  const capabilityV1Results = new NodeOperationResultLedger({
    path: resolve(dataDir, "relay", "capability-v1-results.json"),
    maximumBytes: 64 * 1024 * 1024,
  });
  const capabilityV1GrantReplay = new GrantReplayLedger(
    resolve(dataDir, "relay", "capability-v1-grants.json"),
  );
  const jobGrantReplay = new GrantReplayLedger(
    resolve(dataDir, "relay", "job-grants.json"),
  );
  const jobHandlers = new NodeJobHandlerRegistry();
  for (const handler of input.jobHandlers ?? []) jobHandlers.register(handler);
  const artifactHandlers: ArtifactSandboxJobHandler[] = [];
  const specialistHandlers: SpecialistWorkerJobHandler[] = [];
  const specialistWorkerHealth = new Map<
    "opencode" | "openhands",
    { healthy: boolean; safeErrorCode: string | null }
  >();
  if (
    specialistProvider &&
    specialistProvider.id === config.sandbox.provider &&
    config.sandbox.hostPolicyDigest
  ) {
    const profiles = configuredArtifactSandboxProfiles(config);
    const healthy = await createHealthyArtifactHandlers({
      config,
      provider: specialistProvider,
      profiles,
      storage,
    });
    for (const handler of healthy) {
      jobHandlers.register(handler);
      artifactHandlers.push(handler);
    }
  }
  if (
    specialistProvider &&
    specialistProvider.id === config.sandbox.provider &&
    config.sandbox.hostPolicyDigest
  ) {
    const profiles = Object.fromEntries(
      (["opencode", "openhands"] as const)
        .filter((worker) => config.workers[worker].enabled)
        .map((worker) => [
          worker,
          createSpecialistSandboxProfile(worker, config.workers[worker]),
        ]),
    );
    const runner = new ProviderSpecialistSandboxRunner({
      provider: specialistProvider,
      profiles,
      hostPolicyDigest: config.sandbox.hostPolicyDigest,
      maxEvidenceAgeMs: config.sandbox.maxEvidenceAgeSeconds * 1_000,
      storage,
    });
    for (const worker of ["opencode", "openhands"] as const) {
      if (!config.workers[worker].enabled) continue;
      const handler = new SpecialistWorkerJobHandler({
        worker,
        config: config.workers[worker],
        readManifest: objectStorageManifestReader(storage),
        runner,
      });
      if (await handler.healthy()) {
        jobHandlers.register(handler);
        specialistHandlers.push(handler);
        specialistWorkerHealth.set(worker, {
          healthy: true,
          safeErrorCode: null,
        });
      } else {
        specialistWorkerHealth.set(worker, {
          healthy: false,
          safeErrorCode: "SPECIALIST_PREFLIGHT_FAILED",
        });
      }
    }
  } else {
    for (const worker of ["opencode", "openhands"] as const) {
      if (!config.workers[worker].enabled) continue;
      specialistWorkerHealth.set(worker, {
        healthy: false,
        safeErrorCode: "SPECIALIST_PROVIDER_NOT_INJECTED",
      });
    }
  }
  const advertisedJobKinds = async () => {
    const unhealthy = new Set<string>();
    for (const handler of artifactHandlers) {
      if (!(await handler.healthy())) {
        unhealthy.add(`${handler.kind}@${handler.capabilityVersion}`);
      }
    }
    for (const handler of specialistHandlers) {
      if (!(await handler.healthy())) {
        unhealthy.add(`${handler.kind}@${handler.capabilityVersion}`);
        specialistWorkerHealth.set(
          handler.kind.endsWith("opencode") ? "opencode" : "openhands",
          {
            healthy: false,
            safeErrorCode: "SPECIALIST_PREFLIGHT_FAILED",
          },
        );
      }
    }
    return jobHandlers.advertisedKinds().filter((kind) => !unhealthy.has(kind));
  };
  const initialAdvertisedJobKinds = await advertisedJobKinds();
  const capabilityProtocolV1 = nodeCapabilityProtocolV1Enabled();
  const capabilitySecretCustody = new NodeCapabilitySecretCustody(secretStore);
  const capabilityRegistry = new NodeCapabilityRegistry({
    nodeId: identity.nodeId,
    configRevision: () => configRevision(config),
    secrets: capabilitySecretCustody,
  });
  if (capabilityProtocolV1) {
    const healthyWorkerProfiles = new Map(
      artifactHandlers.map((handler) => [
        `${handler.kind}@${handler.capabilityVersion}`,
        handler.executionProfile(),
      ]),
    );
    const bridges = bridgeLegacyNodeCapabilityOfferings({
      nodeId: identity.nodeId,
      configRevision: configRevision(config),
      config,
      healthyWorkerProfiles,
    });
    for (const bridge of bridges) {
      switch (bridge.source.kind) {
        case "model":
          if (modelGateway) {
            capabilityRegistry.register(
              new LegacyModelCapabilityAdapter({
                offering: bridge.offering,
                gateway: modelGateway,
                modelId: bridge.source.modelId,
              }),
            );
          }
          break;
        case "embedding":
          if (providerFetcher && config.retrieval.embeddingEndpoint) {
            capabilityRegistry.register(
              new LegacyRetrievalCapabilityAdapter({
                offering: bridge.offering,
                fetcher: providerFetcher,
                endpoint: config.retrieval.embeddingEndpoint,
              }),
            );
          }
          break;
        case "rerank":
          if (providerFetcher && config.retrieval.rerankEndpoint) {
            capabilityRegistry.register(
              new LegacyRetrievalCapabilityAdapter({
                offering: bridge.offering,
                fetcher: providerFetcher,
                endpoint: config.retrieval.rerankEndpoint,
              }),
            );
          }
          break;
        case "worker": {
          const workerKind = bridge.source.workerKind;
          const handler = artifactHandlers.find(
            (candidate) => candidate.kind === workerKind,
          );
          if (handler) {
            capabilityRegistry.register(
              new LegacyArtifactWorkerCapabilityAdapter({
                offering: bridge.offering,
                handler,
                nodeId: identity.nodeId,
              }),
            );
          }
          break;
        }
      }
    }
    for (const sidecar of config.capabilities.sidecars) {
      if (!sidecar.enabled) continue;
      const sidecarOffering = configuredNodeCapabilitySidecarOffering({
        nodeId: identity.nodeId,
        configRevision: configRevision(config),
        sidecar,
      });
      const credentialSlot = sidecar.secretRef ? "provider" : undefined;
      if (sidecar.secretRef) {
        capabilitySecretCustody.bind({
          offeringId: sidecarOffering.descriptor.id,
          slot: credentialSlot!,
          reference: sidecar.secretRef,
          version: sidecar.descriptor.connectionRevision,
        });
      }
      capabilityRegistry.register(
        new NodeCapabilityHttpSidecarAdapter({
          offering: sidecarOffering,
          invocationModes: sidecar.invocationModes,
          baseUrl: sidecar.baseUrl,
          artifacts: new NodeSidecarArtifactIo(storage),
          ...(credentialSlot ? { credentialSlot } : {}),
          healthTimeoutMs: sidecar.health.timeoutMs,
          healthCredential: (slot) =>
            capabilitySecretCustody.credential(
              sidecarOffering.descriptor.id,
              slot,
            ),
        }),
      );
    }
    for (const adapter of input.capabilityAdapters ?? []) {
      capabilityRegistry.register(adapter);
    }
  }
  const port = config.bind.port;
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  const security = new ConfiguratorSecurity({
    bootstrapPath:
      input.bootstrapPath ??
      resolve(dataDir, "secrets", "setup-bootstrap.secret"),
    hosts,
  });
  await security.initialize();
  const pairing = new PairingManager(identity);
  const manifest = async () => {
    const storageCapabilities = await storage.capabilities();
    const currentJobKinds = await advertisedJobKinds();
    const currentKindSet = new Set(currentJobKinds);
    const currentExecutionProfiles = artifactHandlers
      .map((handler) => handler.executionProfile())
      .filter((profile) => currentKindSet.has(profile.kind))
      .sort((left, right) => left.kind.localeCompare(right.kind));
    const sandboxCapabilities = specialistProvider
      ? await specialistProvider.capabilities().catch(() => ({
          providerId: specialistProvider.id,
          available: false,
          profiles: [],
        }))
      : null;
    const runtimeCheckpointCapabilities =
      sandboxCapabilities?.available &&
      specialistProvider?.runtimeCheckpointCapabilities
        ? await specialistProvider
            .runtimeCheckpointCapabilities()
            .catch(() => ({
              available: false as const,
              reason: "preflight-unavailable" as const,
            }))
        : null;
    const retrievalProviders = [
      ...(config.retrieval.embeddingEndpoint
        ? [
            {
              purpose: "embedding" as const,
              provider: config.retrieval.embeddingProvider!,
              model: config.retrieval.embeddingModel!,
              modelRevision: config.retrieval.embeddingRevision!,
              dimensions: config.retrieval.embeddingDimensions[0]!,
            },
          ]
        : []),
      ...(config.retrieval.rerankEndpoint
        ? [
            {
              purpose: "rerank" as const,
              provider: config.retrieval.rerankProvider!,
              model: config.retrieval.rerankModel!,
              modelRevision: config.retrieval.rerankRevision!,
              imageDigest: config.retrieval.rerankImageDigest!,
              runtimeRevision: config.retrieval.rerankRuntimeRevision!,
            },
          ]
        : []),
    ];
    if (capabilityProtocolV1) {
      await Promise.all(
        capabilityRegistry
          .listOfferings()
          .map((offering) =>
            capabilityRegistry.probe(offering.descriptor.id),
          ),
      );
    }
    const inference = capabilityProtocolV1
      ? inferenceManifestFeature({
          registry: capabilityRegistry,
          maxConcurrent: Math.max(1, config.jobs.maximumConcurrent * 2),
        })
      : null;
    return buildManifest({
      identity,
      config,
      features: {
        storage: {
          version: 1,
          maxObjectBytes: config.storage.maxObjectBytes,
          multipart: storageCapabilities.multipart,
          directTransfer: false,
          encryptionModes: ["transport-tls"],
        },
        ...(conversationStore
          ? {
              conversations: {
                version: 1 as const,
                search: false,
                maxBytes: config.conversations.maximumBytes,
              },
            }
          : {}),
        ...(config.retrieval.enabled && config.retrieval.lexical
          ? {
              retrieval: {
                version: 1 as const,
                lexical: true as const,
                // A configured embedding route is a provider capability, not a
                // queryable local vector index. Keep the v1 field present but
                // empty until the Node owns a real vector runtime and preflight.
                vectorSpaces: [],
                providers: retrievalProviders,
              },
            }
          : {}),
        ...(modelGateway
          ? {
              models: {
                version: 1 as const,
                models: config.models.catalogue,
                revisions: config.models.modelRevisions,
              },
            }
          : {}),
        ...(inference ? { inference } : {}),
        ...(config.jobs.enabled && currentJobKinds.length > 0
          ? {
              jobs: {
                version: 1 as const,
                kinds: currentJobKinds,
                maxConcurrent: config.jobs.maximumConcurrent,
                ...(currentExecutionProfiles.length > 0
                  ? { executionProfiles: currentExecutionProfiles }
                  : {}),
              },
            }
          : {}),
        ...(config.sandbox.enabled && sandboxCapabilities?.available
          ? {
              sandbox: {
                version: 1 as const,
                isolation: config.sandbox.isolation,
                workspaceSnapshots: true,
                runtimeCheckpoints:
                  config.sandbox.runtimeCheckpoints &&
                  runtimeCheckpointCapabilities?.available === true,
                browser: false,
                gpu: config.profile === "node-local-gpu",
              },
            }
          : {}),
        ...(mcpTransport
          ? {
              mcp: {
                version: 1 as const,
                transports: ["streamable-http" as const],
                maxCatalogueTools: config.mcp.maxCatalogueTools,
                maxRequestBytes: config.mcp.maxRequestBytes,
                maxResponseBytes: config.mcp.maxResponseBytes,
              },
            }
          : {}),
      },
      storageUsedBytes: await storage.usageBytes(),
    });
  };
  const configurator = new LocalConfigurator({
    security,
    pairing,
    config,
    configPath: resolvedConfig.configPath,
    manifest,
    secrets: secretStore,
    fetch: input.configuratorFetch,
  });
  let controlChannel: OutboundNodeControlChannel | null = null;
  const capabilityDispatcher =
    config.relay.coreGrantPublicKey && config.relay.coreGrantKeyId
      ? new NodeCapabilityOperationDispatcher({
          nodeId: identity.nodeId,
          corePublicKeyDer: config.relay.coreGrantPublicKey,
          coreKeyId: config.relay.coreGrantKeyId,
          configRevision: () => configRevision(config),
          transport: providerTransport,
          grantReplay: operationGrantReplay,
          results: operationResults,
          maximumConcurrent: Math.max(1, config.jobs.maximumConcurrent * 2),
          publish: async (frame) => {
            if (!controlChannel) throw new Error("NODE_CHANNEL_OFFLINE");
            await controlChannel.send(frame);
          },
        })
      : null;
  await capabilityDispatcher?.initialize();
  const capabilityV1Executor =
    capabilityProtocolV1 &&
    config.relay.coreGrantPublicKey &&
    config.relay.coreGrantKeyId &&
    capabilityRegistry.listOfferings().length > 0
      ? new NodeCapabilityExecutor({
          nodeId: identity.nodeId,
          configRevision: () => configRevision(config),
          issuerPublicKeyDer: config.relay.coreGrantPublicKey,
          issuerKeyId: config.relay.coreGrantKeyId,
          registry: capabilityRegistry,
          verifyArtifact: async (artifact) => {
            const metadata = await storage.stat({ ref: artifact.object });
            if (
              !metadata ||
              metadata.digest !== artifact.digest ||
              metadata.byteSize !== artifact.byteSize ||
              metadata.mimeType !== artifact.mimeType
            ) {
              throw new Error("NODE_CAPABILITY_ARTIFACT_MISMATCH");
            }
          },
        })
      : null;
  const capabilityV1Dispatcher = capabilityV1Executor
    ? new NodeCapabilityV1Dispatcher({
        nodeId: identity.nodeId,
        configRevision: () => configRevision(config),
        issuerPublicKeyDer: config.relay.coreGrantPublicKey!,
        issuerKeyId: config.relay.coreGrantKeyId!,
        registry: capabilityRegistry,
        executor: capabilityV1Executor,
        grantReplay: capabilityV1GrantReplay,
        results: capabilityV1Results,
        maximumConcurrent: Math.max(1, config.jobs.maximumConcurrent * 2),
        publish: async (frame) => {
          if (!controlChannel) throw new Error("NODE_CHANNEL_OFFLINE");
          await controlChannel.send(frame);
        },
      })
    : null;
  await capabilityV1Dispatcher?.initialize();
  const jobDispatcher =
    config.jobs.enabled &&
    initialAdvertisedJobKinds.length > 0 &&
    config.relay.coreGrantPublicKey
      ? new NodeJobDispatcher({
          nodeId: identity.nodeId,
          corePublicKeyDer: config.relay.coreGrantPublicKey,
          expectedPolicyRef: () => configRevision(config),
          ledger: jobLedger,
          grantReplay: jobGrantReplay,
          registry: jobHandlers,
          maximumConcurrent: config.jobs.maximumConcurrent,
          leaseTtlMs: config.jobs.leaseTtlSeconds * 1_000,
          publish: async (event) => {
            const connectionEpoch = controlChannel?.connectionEpoch;
            if (!controlChannel || connectionEpoch == null) {
              throw new Error("NODE_CHANNEL_OFFLINE");
            }
            await controlChannel.send({
              type: "job-event",
              frameId: `frame_${crypto.randomUUID()}`,
              nodeId: identity.nodeId,
              connectionEpoch,
              event,
            });
          },
        })
      : null;
  await jobDispatcher?.recover();
  if (config.relay.coreUrl && config.relay.credentialSecretRef) {
    controlChannel = new OutboundNodeControlChannel({
      connector: new BunWebSocketControlConnector(),
      url: controlChannelUrl(config.relay.coreUrl, config.relay.transport),
      credential: await secretStore.read(config.relay.credentialSecretRef),
      manifest,
      handlers: {
        onReady: async (frame) => {
          await jobDispatcher?.replayPending();
          const health = (await manifest()).features;
          await controlChannel!.send({
            type: "health",
            frameId: `frame_${crypto.randomUUID()}`,
            nodeId: identity.nodeId,
            health: Object.keys(health).map((feature) => {
              const aggregate = capabilityRegistry.health.aggregate();
              const state =
                feature !== "inference" || aggregate === "healthy"
                  ? ("healthy" as const)
                  : aggregate === "unknown"
                    ? ("configured" as const)
                    : aggregate;
              return {
                capability:
                feature === "schoolConnectors"
                  ? "school-connectors"
                  : (feature as
                      | "storage"
                      | "conversations"
                      | "retrieval"
                      | "models"
                      | "jobs"
                      | "sandbox"
                      | "renderers"
                      | "mcp"
                      | "inference"),
                state,
                lastSuccessAt: new Date().toISOString(),
                lastErrorAt: null,
                safeErrorCode: null,
                queued: 0,
                active:
                  feature === "jobs"
                    ? (jobDispatcher?.activeCount ?? 0)
                    : feature === "inference"
                      ? (capabilityV1Dispatcher?.activeCount ?? 0)
                      : 0,
              };
            }),
          });
        },
        onJobOffer: async (frame) => {
          if (!jobDispatcher) {
            throw new Error("NODE_JOB_EXECUTOR_NOT_ADVERTISED");
          }
          await jobDispatcher.accept(frame.job);
        },
        onJobCancel: async (frame) => {
          if (!jobDispatcher) throw new Error("NODE_JOB_NOT_ADVERTISED");
          await jobDispatcher.cancel(frame.jobId);
        },
        onJobAck: async (frame) => {
          if (!jobDispatcher) throw new Error("NODE_JOB_NOT_ADVERTISED");
          await jobDispatcher.acknowledge(frame.jobId, frame.sequence);
        },
        onOperationRequest: async (frame) => {
          if (frame.operation.startsWith("capability.")) {
            if (!capabilityV1Dispatcher) {
              throw new Error("NODE_CAPABILITY_PROTOCOL_V1_NOT_CONFIGURED");
            }
            await capabilityV1Dispatcher.accept(frame);
            return;
          }
          if (!capabilityDispatcher) {
            throw new Error("NODE_CAPABILITY_DISPATCHER_NOT_CONFIGURED");
          }
          await capabilityDispatcher.accept(frame);
        },
        onOperationCancel: async (frame) => {
          const cancelled = await capabilityV1Dispatcher?.cancel(
            frame.operationId,
          );
          if (!cancelled) await capabilityDispatcher?.cancel(frame.operationId);
        },
      },
    });
  }

  return {
    config,
    identity,
    storage,
    jobLedger,
    artifactRetentionReaper,
    conversationStore,
    lexicalStores,
    modelGateway,
    providerFetcher,
    providerTransport,
    capabilityDispatcher,
    capabilityRegistry,
    capabilitySecretCustody,
    capabilityV1Executor,
    capabilityV1Dispatcher,
    jobDispatcher,
    specialistWorkerHealth,
    controlChannel,
    security,
    manifest,
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        try {
          security.assertBaseRequest(request);
        } catch (error) {
          return secureResponse(
            JSON.stringify({
              error:
                error instanceof Error ? error.message : "REQUEST_REJECTED",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const currentManifest = await manifest();
        return secureResponse(
          JSON.stringify({
            status: "ok",
            protocol: "avermate-node/2",
            nodeId: identity.nodeId,
            profile: config.profile,
            setupOpen: security.setupOpen,
            manifest: currentManifest,
            capabilityLimitations: {
              jobs: currentManifest.features.jobs
                ? null
                : "no-reviewed-job-handlers",
              conversations: currentManifest.features.conversations
                ? null
                : "disabled",
              retrieval: currentManifest.features.retrieval
                ? null
                : "not-configured",
              models: currentManifest.features.models
                ? null
                : "not-configured",
              inference: currentManifest.features.inference
                ? null
                : capabilityProtocolV1
                  ? "no-generic-offerings"
                  : "feature-flag-disabled",
              sandbox:
                currentManifest.features.sandbox
                  ? null
                  : config.sandbox.enabled
                    ? "provider-not-injected"
                    : "disabled",
            },
            capabilityOfferingHealth: capabilityRegistry.health.list(),
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return configurator.fetch(request);
    },
  };
}

export async function startNodeDaemon(
  input: Parameters<typeof createNodeDaemon>[0] = {},
) {
  const daemon = await createNodeDaemon(input);
  await daemon.artifactRetentionReaper.reap().catch(() => undefined);
  const relayAbort = new AbortController();
  const relayTask = daemon.controlChannel?.run(relayAbort.signal);
  const server = Bun.serve({
    hostname: daemon.config.bind.host,
    port: daemon.config.bind.port,
    fetch: daemon.fetch,
    maxRequestBodySize: 64 * 1024,
  });
  const configuredBridge =
    input.containerBridgePort ??
    (process.env.AVERMATE_NODE_CONTAINER_BRIDGE_PORT
      ? Number(process.env.AVERMATE_NODE_CONTAINER_BRIDGE_PORT)
      : null);
  if (
    configuredBridge !== null &&
    (!Number.isSafeInteger(configuredBridge) ||
      configuredBridge < 1_024 ||
      configuredBridge > 65_535 ||
      configuredBridge === daemon.config.bind.port)
  ) {
    relayAbort.abort();
    server.stop(true);
    await relayTask?.catch(() => undefined);
    throw new Error("NODE_CONTAINER_BRIDGE_PORT_INVALID");
  }
  let containerBridge: ReturnType<typeof Bun.serve> | null = null;
  if (configuredBridge !== null) {
    try {
      containerBridge = Bun.serve({
        hostname: "0.0.0.0",
        port: configuredBridge,
        fetch: daemon.fetch,
        maxRequestBodySize: 64 * 1024,
      });
    } catch (error) {
      relayAbort.abort();
      server.stop(true);
      await relayTask?.catch(() => undefined);
      throw error;
    }
  }
  const artifactReaperTimer = setInterval(() => {
    void daemon.artifactRetentionReaper.reap().catch(() => undefined);
  }, ARTIFACT_REAPER_INTERVAL_MS);
  return {
    daemon,
    server,
    containerBridge,
    relayTask,
    async stop() {
      clearInterval(artifactReaperTimer);
      relayAbort.abort();
      containerBridge?.stop(true);
      server.stop(true);
      await relayTask?.catch(() => undefined);
    },
  };
}
