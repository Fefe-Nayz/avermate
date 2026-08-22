import type {
  ObjectStorageProvider,
  SandboxExecutionProfile,
  SandboxProvider,
} from "@avermate/agent-contracts";
import { OpenSandboxProvider } from "../../server/src/sandbox/opensandbox-provider";
import { OpenSandboxSdkTransport } from "../../server/src/sandbox/opensandbox-sdk-transport";
import type { NodeConfig } from "./config";
import { NodePortableWorkspaceSnapshotStore } from "./portable-workspace-store";
import { NodeSecretStore } from "./secret-store";
import { configuredArtifactSandboxProfiles } from "./artifact-workers";
import { createSpecialistSandboxProfile } from "./specialist-workers";

function enabledSpecialistProfiles(config: NodeConfig) {
  return (["opencode", "openhands"] as const)
    .filter((worker) => config.workers[worker].enabled)
    .map((worker) =>
      createSpecialistSandboxProfile(worker, config.workers[worker]),
    );
}

export function configuredNodeSandboxProfiles(config: NodeConfig) {
  return [
    ...configuredArtifactSandboxProfiles(config),
    ...enabledSpecialistProfiles(config),
  ];
}

function isolation(config: NodeConfig) {
  switch (config.sandbox.isolation) {
    case "runc":
      return {
        kind: "runc-trusted-dev" as const,
        trustedDevelopment: true as const,
        multiTenant: false as const,
      };
    case "gvisor":
      return {
        kind: "gvisor-personal" as const,
        multiTenant: false as const,
      };
    case "kata":
      return {
        kind: "kata-multitenant" as const,
        multiTenant: true as const,
      };
    default:
      throw new Error("NODE_OPENSANDBOX_ISOLATION_UNSUPPORTED");
  }
}

function rootEndpoint(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("NODE_OPENSANDBOX_ENDPOINT_INVALID");
  }
  return url;
}

async function optionalSecret(
  secrets: NodeSecretStore,
  reference?: string,
) {
  return reference ? secrets.read(reference) : undefined;
}

/** Build the real production adapter; absent evidence keeps profiles unavailable. */
export async function createConfiguredNodeSandboxProvider(input: {
  config: NodeConfig;
  storage: ObjectStorageProvider;
  secrets: NodeSecretStore;
}): Promise<SandboxProvider | null> {
  const { config } = input;
  if (!config.sandbox.enabled || config.sandbox.provider === "disabled") {
    return null;
  }
  const required =
    config.sandbox.runtimeCheckpoints ||
    configuredArtifactSandboxProfiles(config).length > 0 ||
    config.workers.opencode.enabled ||
    config.workers.openhands.enabled;
  if (config.sandbox.provider !== "opensandbox") {
    if (required) throw new Error("NODE_SANDBOX_PROVIDER_NOT_IMPLEMENTED");
    return null;
  }
  if (
    !config.sandbox.endpoint ||
    !config.sandbox.evidenceEndpoint ||
    !config.sandbox.hostPolicyDigest
  ) {
    if (required) throw new Error("NODE_OPENSANDBOX_CONFIGURATION_INCOMPLETE");
    return null;
  }
  const profiles: readonly SandboxExecutionProfile[] =
    configuredNodeSandboxProfiles(config);
  if (profiles.length === 0) return null;
  const endpoint = rootEndpoint(config.sandbox.endpoint);
  const imageUris = Object.fromEntries(
    profiles.map((profile) => {
      const configured = config.sandbox.images.find(
        (image) => image.profileId === profile.id,
      );
      if (!configured) throw new Error("NODE_SANDBOX_IMAGE_MISSING");
      return [profile.id, configured.image];
    }),
  );
  const runtimeCheckpoint = config.sandbox.runtimeCheckpoints
    ? {
        region: config.sandbox.runtimeRegion!,
        architecture: config.sandbox.runtimeArchitecture!,
        runtimeKind: config.sandbox.runtimeKind!,
        runtimeVersion: config.sandbox.runtimeVersion!,
        maximumTtlSeconds:
          config.sandbox.runtimeCheckpointMaxTtlSeconds!,
      }
    : undefined;
  const transport = new OpenSandboxSdkTransport({
    connection: {
      domain: endpoint.host,
      protocol: endpoint.protocol === "https:" ? "https" : "http",
      apiKey: await optionalSecret(
        input.secrets,
        config.sandbox.providerSecretRef,
      ),
      requestTimeoutSeconds: 30,
      useServerProxy: false,
    },
    evidenceUrl: config.sandbox.evidenceEndpoint,
    evidenceToken: await optionalSecret(
      input.secrets,
      config.sandbox.evidenceSecretRef,
    ),
    imageUris,
    profiles,
    workspaceSnapshots: new NodePortableWorkspaceSnapshotStore(input.storage),
    ...(runtimeCheckpoint ? { runtimeCheckpoint } : {}),
  });
  return new OpenSandboxProvider({
    isolation: isolation(config),
    hostPolicyDigest: config.sandbox.hostPolicyDigest,
    maxEvidenceAgeMs: config.sandbox.maxEvidenceAgeSeconds * 1_000,
    profiles,
    transport,
  });
}
