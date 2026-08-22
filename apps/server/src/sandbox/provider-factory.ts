import type {
  SandboxExecutionProfile,
  SandboxProfileId,
  SandboxProvider,
} from "@avermate/agent-contracts";
import { DisabledSandboxProvider } from "./disabled-provider";
import { E2BSandboxProvider } from "./e2b-provider";
import { SandboxUnavailableError } from "./errors";
import { MicrosandboxProvider } from "./microsandbox-provider";
import { MockSandboxProvider } from "./mock-provider";
import { OpenSandboxProvider, type OpenSandboxIsolation } from "./opensandbox-provider";
import { enableSandboxProfile, SANDBOX_PROFILES_V1 } from "./profiles";
import type { RemoteSandboxTransport } from "./remote-provider";
import { createOpenSandboxSdkTransportFromEnvironment } from "./opensandbox-sdk-transport";
import { ObjectStoragePortableWorkspaceSnapshotStore } from "./portable-workspace-store";

export interface SandboxProviderFactoryResult {
  provider: SandboxProvider;
  profiles: readonly SandboxExecutionProfile[];
  hostPolicyDigest: string | null;
}

export function createSandboxProviderFromEnvironment(input: {
  environment?: Readonly<Record<string, string | undefined>>;
  transport?: RemoteSandboxTransport;
  allowMock?: boolean;
} = {}): SandboxProviderFactoryResult {
  const environment = input.environment ?? process.env;
  const selected = environment.SANDBOX_PROVIDER?.trim().toLowerCase() || "disabled";
  if (selected === "disabled") {
    return {
      provider: new DisabledSandboxProvider(),
      profiles: Object.values(SANDBOX_PROFILES_V1),
      hostPolicyDigest: null,
    };
  }

  const hostPolicyDigest = requireDigest(
    environment.SANDBOX_HOST_POLICY_DIGEST,
    "SANDBOX_HOST_POLICY_DIGEST",
  );
  const profiles = configuredProfiles(environment);
  const maxEvidenceAgeMs = positiveInteger(
    environment.SANDBOX_EVIDENCE_MAX_AGE_MS,
    5 * 60_000,
  );

  if (selected === "mock") {
    if (!input.allowMock) {
      throw new SandboxUnavailableError(
        "CONFIGURATION_INVALID",
        "The mock provider is test-only and requires explicit process opt-in.",
      );
    }
    const enabled = Object.values(SANDBOX_PROFILES_V1).map((profile) =>
      enableSandboxProfile(profile.id, {
        version: "mock-v1",
        imageDigest: `sha256:${mockDigestCharacter(profile.id).repeat(64)}`,
      }),
    );
    return {
      provider: new MockSandboxProvider({
        allowMock: true,
        hostPolicyDigest,
        profiles: enabled,
      }),
      profiles: enabled,
      hostPolicyDigest,
    };
  }

  const shared = {
    hostPolicyDigest,
    maxEvidenceAgeMs,
    profiles,
    transport: input.transport,
  };
  if (selected === "e2b") {
    return { provider: new E2BSandboxProvider(shared), profiles, hostPolicyDigest };
  }
  if (selected === "microsandbox") {
    const provider = new MicrosandboxProvider({
      ...shared,
      experimentalOptIn: environment.SANDBOX_MICROSANDBOX_EXPERIMENTAL === "true",
      hostVirtualizationAttested:
        environment.SANDBOX_MICROSANDBOX_HOST_VIRTUALIZATION_ATTESTED === "true",
    });
    return { provider, profiles, hostPolicyDigest };
  }
  if (selected === "opensandbox") {
    const isolation = openSandboxIsolation(environment);
    const transport =
      input.transport ??
      createOpenSandboxSdkTransportFromEnvironment({
        environment,
        profiles,
        workspaceSnapshots: new ObjectStoragePortableWorkspaceSnapshotStore(),
      });
    return {
      provider: new OpenSandboxProvider({ ...shared, isolation, transport }),
      profiles,
      hostPolicyDigest,
    };
  }
  throw new SandboxUnavailableError(
    "CONFIGURATION_INVALID",
    `Unknown SANDBOX_PROVIDER value: ${selected}.`,
  );
}

function configuredProfiles(
  environment: Readonly<Record<string, string | undefined>>,
): readonly SandboxExecutionProfile[] {
  return Object.values(SANDBOX_PROFILES_V1).map((profile) => {
    const stem = profile.id.replaceAll("-", "_").toUpperCase();
    if (environment[`SANDBOX_PROFILE_${stem}_ENABLED`] !== "true") return profile;
    return enableSandboxProfile(profile.id, {
      version: requireValue(environment[`SANDBOX_PROFILE_${stem}_VERSION`], `${stem}_VERSION`),
      imageDigest: requireDigest(
        environment[`SANDBOX_PROFILE_${stem}_IMAGE_DIGEST`],
        `${stem}_IMAGE_DIGEST`,
      ),
    });
  });
}

function openSandboxIsolation(
  environment: Readonly<Record<string, string | undefined>>,
): OpenSandboxIsolation {
  const kind = environment.SANDBOX_OPENSANDBOX_ISOLATION;
  const multiTenant = environment.SANDBOX_MULTI_TENANT === "true";
  if (kind === "runc-trusted-dev") {
    if (environment.SANDBOX_TRUSTED_DEVELOPMENT !== "true" || multiTenant) {
      throw new SandboxUnavailableError(
        "ISOLATION_NOT_ALLOWED",
        "runc-trusted-dev requires trusted development and forbids multi-tenant mode.",
      );
    }
    return { kind, trustedDevelopment: true, multiTenant: false };
  }
  if (kind === "gvisor-personal") {
    if (multiTenant) {
      throw new SandboxUnavailableError(
        "ISOLATION_NOT_ALLOWED",
        "gvisor-personal is a single-user profile.",
      );
    }
    return { kind, multiTenant: false };
  }
  if (kind === "kata-multitenant" && multiTenant) return { kind, multiTenant: true };
  throw new SandboxUnavailableError(
    "CONFIGURATION_INVALID",
    "OpenSandbox requires an explicit compatible isolation and tenancy mode.",
  );
}

function requireDigest(value: string | undefined, name: string): string {
  const normalized = requireValue(value, name);
  if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      `${name} must be a pinned lowercase sha256 digest.`,
    );
  }
  return normalized;
}

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new SandboxUnavailableError("CONFIGURATION_INVALID", `${name} is required.`);
  }
  return normalized;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 60 * 60_000) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "SANDBOX_EVIDENCE_MAX_AGE_MS must be a positive integer no greater than one hour.",
    );
  }
  return parsed;
}

function mockDigestCharacter(id: SandboxProfileId): string {
  return ({
    latex: "8",
    "python-data": "9",
    browser: "a",
    slides: "b",
    media: "c",
    "video-audio": "f",
    ocr: "b",
    "speech-to-text": "c",
    manim: "d",
    "image-builder": "e",
    opencode: "6",
    openhands: "7",
  } satisfies Record<SandboxProfileId, string>)[id];
}
