import { describe, expect, test } from "bun:test";
import { SandboxUnavailableError } from "./errors";
import { createSandboxProviderFromEnvironment } from "./provider-factory";

const hostPolicyDigest = `sha256:${"f".repeat(64)}`;

describe("sandbox provider factory", () => {
  test("defaults to disabled without reading provider secrets", () => {
    const result = createSandboxProviderFromEnvironment({ environment: {} });
    expect(result.provider.id).toBe("disabled");
    expect(result.profiles.every((profile) => !profile.enabled)).toBe(true);
  });

  test("mock requires explicit process opt-in", () => {
    expect(() =>
      createSandboxProviderFromEnvironment({
        environment: {
          SANDBOX_PROVIDER: "mock",
          SANDBOX_HOST_POLICY_DIGEST: hostPolicyDigest,
        },
      }),
    ).toThrow(SandboxUnavailableError);
  });

  test("real provider remains unavailable without injected transport evidence", async () => {
    const result = createSandboxProviderFromEnvironment({
      environment: {
        SANDBOX_PROVIDER: "e2b",
        SANDBOX_HOST_POLICY_DIGEST: hostPolicyDigest,
        SANDBOX_PROFILE_LATEX_ENABLED: "true",
        SANDBOX_PROFILE_LATEX_VERSION: "reviewed-v1",
        SANDBOX_PROFILE_LATEX_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(result.profiles.find((profile) => profile.id === "latex")?.enabled).toBe(true);
    expect(await result.provider.capabilities()).toMatchObject({
      providerId: "e2b",
      available: false,
      profiles: [],
    });
  });

  test("rejects unsafe OpenSandbox tenancy combinations", () => {
    expect(() =>
      createSandboxProviderFromEnvironment({
        environment: {
          SANDBOX_PROVIDER: "opensandbox",
          SANDBOX_HOST_POLICY_DIGEST: hostPolicyDigest,
          SANDBOX_OPENSANDBOX_ISOLATION: "runc-trusted-dev",
          SANDBOX_TRUSTED_DEVELOPMENT: "true",
          SANDBOX_MULTI_TENANT: "true",
        },
      }),
    ).toThrow("forbids multi-tenant");
  });

  test("auto-wires the official OpenSandbox SDK transport only with pinned images and a host probe", () => {
    const imageDigest = `sha256:${"a".repeat(64)}`;
    const result = createSandboxProviderFromEnvironment({
      environment: {
        SANDBOX_PROVIDER: "opensandbox",
        SANDBOX_HOST_POLICY_DIGEST: hostPolicyDigest,
        SANDBOX_OPENSANDBOX_ISOLATION: "runc-trusted-dev",
        SANDBOX_TRUSTED_DEVELOPMENT: "true",
        SANDBOX_MULTI_TENANT: "false",
        SANDBOX_OPENSANDBOX_DOMAIN: "localhost:8080",
        SANDBOX_OPENSANDBOX_EVIDENCE_URL:
          "http://127.0.0.1:8081/v1/evidence",
        SANDBOX_PROFILE_LATEX_ENABLED: "true",
        SANDBOX_PROFILE_LATEX_VERSION: "reviewed-v1",
        SANDBOX_PROFILE_LATEX_IMAGE_DIGEST: imageDigest,
        SANDBOX_PROFILE_LATEX_IMAGE_URI: `avermate/latex@${imageDigest}`,
      },
    });
    expect(result.provider.id).toBe("opensandbox");
    expect(result.profiles.find((profile) => profile.id === "latex")?.enabled).toBe(
      true,
    );
  });

  test("refuses to select OpenSandbox without its host-produced evidence service", () => {
    expect(() =>
      createSandboxProviderFromEnvironment({
        environment: {
          SANDBOX_PROVIDER: "opensandbox",
          SANDBOX_HOST_POLICY_DIGEST: hostPolicyDigest,
          SANDBOX_OPENSANDBOX_ISOLATION: "runc-trusted-dev",
          SANDBOX_TRUSTED_DEVELOPMENT: "true",
          SANDBOX_MULTI_TENANT: "false",
        },
      }),
    ).toThrow("SANDBOX_OPENSANDBOX_DOMAIN");
  });
});
