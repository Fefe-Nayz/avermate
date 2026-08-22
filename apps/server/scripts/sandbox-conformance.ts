import {
  sandboxProfileIdSchema,
  type SandboxProfileId,
} from "@avermate/agent-contracts";
import { ADVANCED_MEDIA_EXECUTION_PROFILES } from "../src/ingestion/execution-profiles";
import { runSandboxConformance } from "../src/sandbox/conformance";
import { createSandboxProviderFromEnvironment } from "../src/sandbox/provider-factory";

export interface SandboxConformanceCliOptions {
  readonly mock: boolean;
  readonly requireLive: boolean;
  readonly requestedProfiles: readonly string[];
  readonly requiredProfileIds: readonly SandboxProfileId[];
}

export function parseSandboxConformanceArgs(
  argv: readonly string[],
): SandboxConformanceCliOptions {
  const args = argv.filter((value) => value !== "--");
  const requestedProfiles: string[] = [];
  let mock = false;
  let requireLive = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--mock") {
      mock = true;
      continue;
    }
    if (argument === "--require-live") {
      requireLive = true;
      continue;
    }
    if (argument === "--profile") {
      const profile = args[index + 1];
      if (!profile || profile.startsWith("--")) {
        throw new Error("SANDBOX_CONFORMANCE_PROFILE_VALUE_REQUIRED");
      }
      requestedProfiles.push(profile);
      index += 1;
      continue;
    }
    throw new Error(`SANDBOX_CONFORMANCE_ARGUMENT_UNKNOWN:${argument}`);
  }

  const liveRequired = requireLive || requestedProfiles.length > 0;
  if (liveRequired && requestedProfiles.length === 0) {
    throw new Error("SANDBOX_CONFORMANCE_LIVE_PROFILES_REQUIRED");
  }
  if (mock && liveRequired) {
    throw new Error("SANDBOX_CONFORMANCE_MOCK_CANNOT_SATISFY_LIVE_PROFILES");
  }

  return Object.freeze({
    mock,
    requireLive: liveRequired,
    requestedProfiles: Object.freeze([...requestedProfiles]),
    requiredProfileIds: Object.freeze([
      ...new Set(requestedProfiles.map(resolveSandboxProfileId)),
    ]),
  });
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const options = parseSandboxConformanceArgs(argv);
  const environment = options.mock
    ? {
        ...process.env,
        SANDBOX_PROVIDER: "mock",
        SANDBOX_HOST_POLICY_DIGEST: `sha256:${"f".repeat(64)}`,
      }
    : process.env;
  const configured = createSandboxProviderFromEnvironment({
    environment,
    allowMock: options.mock,
  });
  if (
    options.requireLive &&
    (configured.provider.id === "disabled" || configured.provider.id === "mock")
  ) {
    throw new Error(
      `SANDBOX_CONFORMANCE_LIVE_PROVIDER_REQUIRED:${configured.provider.id}`,
    );
  }

  const report = await runSandboxConformance({
    provider: configured.provider,
    profiles: configured.profiles,
    hostPolicyDigest: configured.hostPolicyDigest,
    requireAvailable:
      options.requireLive || configured.provider.id !== "disabled",
    requiredProfileIds: options.requiredProfileIds,
    mockEvidence: options.mock,
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

function resolveSandboxProfileId(value: string): SandboxProfileId {
  const advancedProfile =
    ADVANCED_MEDIA_EXECUTION_PROFILES[
      value as keyof typeof ADVANCED_MEDIA_EXECUTION_PROFILES
    ];
  if (advancedProfile) return advancedProfile.sandboxProfileId;

  const parsed = sandboxProfileIdSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`SANDBOX_CONFORMANCE_PROFILE_UNKNOWN:${value}`);
}

if (import.meta.main) {
  await main().catch((cause) => {
    console.error(
      JSON.stringify(
        {
          schemaVersion: 1,
          passed: false,
          error:
            cause instanceof Error
              ? cause.message
              : "Sandbox conformance configuration failed.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
