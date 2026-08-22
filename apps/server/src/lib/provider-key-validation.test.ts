import { describe, expect, test } from "bun:test";
import { validateProviderCredential } from "./provider-key-validation";

describe("provider credential validation boundary", () => {
  test("uses a minimal request and never returns or echoes the secret", async () => {
    const secret = "fixture-credential-material-0001";
    let observedUrl = "";
    let observedAuthorization = "";
    const result = await validateProviderCredential("openai", secret, {
      fetch: (async (input, init) => {
        observedUrl = String(input);
        observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(result).toBeUndefined();
    expect(observedUrl).toBe("https://api.openai.com/v1/models");
    expect(observedAuthorization).toBe(`Bearer ${secret}`);
  });

  test("normalizes authentication and availability errors without the secret", async () => {
    const secret = "xi-secret-value-that-must-not-escape";
    for (const [status, code] of [
      [401, "PROVIDER_KEY_REJECTED"],
      [429, "PROVIDER_KEY_VALIDATION_UNAVAILABLE"],
    ] as const) {
      let error: unknown;
      try {
        await validateProviderCredential("elevenlabs", secret, {
          fetch: (async () =>
            new Response("sensitive provider body", { status })) as unknown as typeof fetch,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(code);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("sensitive provider body");
    }
  });
});
