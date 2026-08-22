import { mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadNodeConfig, type NodeConfig } from "./config";
import { ConfiguratorSecurity, secureResponse } from "./configurator-security";
import { LocalConfigurator } from "./configurator";
import { FilesystemObjectStorageProvider } from "./filesystem-storage";
import { loadOrCreateNodeIdentity } from "./identity";
import { PairingManager, buildManifest } from "./protocol";
import {
  BunWebSocketControlConnector,
  OutboundNodeControlChannel,
  controlChannelUrl,
} from "./control-channel";
import { NodeJobLedger } from "./job-ledger";
import { loadS3NodeCredentials, S3ObjectStorageProvider } from "./s3-storage";

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

export async function createNodeDaemon(
  input: {
    config?: NodeConfig;
    configPath?: string;
    bootstrapPath?: string;
  } = {},
) {
  const config = input.config ?? (await loadNodeConfig(input.configPath));
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
  const configurator = new LocalConfigurator({
    security,
    pairing,
    config,
    configPath: input.configPath ?? resolve(dataDir, "avermate-node.yaml"),
  });
  const manifest = async () => {
    const storageCapabilities = await storage.capabilities();
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
      },
      storageUsedBytes: await storage.usageBytes(),
    });
  };
  const controlChannel =
    config.relay.coreUrl && config.relay.credentialSecretRef
      ? new OutboundNodeControlChannel({
          connector: new BunWebSocketControlConnector(),
          url: controlChannelUrl(config.relay.coreUrl),
          credential: await readSecretReference(
            config.relay.credentialSecretRef,
          ),
          manifest,
          handlers: {
            onJobOffer: async () => {
              throw new Error("NODE_JOB_EXECUTOR_NOT_ADVERTISED");
            },
            onJobCancel: async (frame) => {
              await jobLedger.requestCancellation(frame.jobId);
            },
            onJobAck: async (frame) => {
              const record = await jobLedger.get(frame.jobId);
              const finalSequence = record?.events.at(-1)?.sequence;
              if (finalSequence !== frame.sequence) {
                throw new Error("NODE_JOB_ACK_SEQUENCE_MISMATCH");
              }
              await jobLedger.acknowledgeCommit(frame.jobId);
            },
          },
        })
      : null;

  return {
    config,
    identity,
    storage,
    jobLedger,
    controlChannel,
    security,
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
              jobs: "executor-not-implemented",
              conversations: "provider-not-activated",
              retrieval: "lexical-provider-not-activated",
              models: config.models.enabled
                ? "provider-not-activated"
                : "not-configured",
              sandbox: config.sandbox.enabled
                ? "provider-not-activated"
                : "disabled",
            },
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
  const relayAbort = new AbortController();
  const relayTask = daemon.controlChannel?.run(relayAbort.signal);
  const server = Bun.serve({
    hostname: daemon.config.bind.host,
    port: daemon.config.bind.port,
    fetch: daemon.fetch,
    maxRequestBodySize: 64 * 1024,
  });
  return {
    daemon,
    server,
    relayTask,
    async stop() {
      relayAbort.abort();
      server.stop(true);
      await relayTask?.catch(() => undefined);
    },
  };
}
