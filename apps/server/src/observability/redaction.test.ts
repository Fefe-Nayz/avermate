import { describe, expect, test } from "bun:test";
import {
  assertNoOperationalSecret,
  redactOperationalValue,
  safeOperationalMetadata,
} from "./redaction";

describe("privacy-safe operational telemetry", () => {
  test("redacts secret fields and values recursively", () => {
    const secret = "fixture-credential-material-0001";
    const redacted = safeOperationalMetadata({
      runId: "run-1",
      authorization: `Bearer ${secret}`,
      nested: {
        apiKey: secret,
        signedUrl: "https://objects.invalid/a?X-Amz-Signature=abcdef123456",
        prompt: "private body",
        safeReason: "RATE_LIMITED",
      },
    });
    const encoded = JSON.stringify(redacted);
    expect(encoded).not.toContain(secret);
    expect(encoded).not.toContain("private body");
    expect(encoded).not.toContain("objects.invalid");
    expect(encoded).toContain("RATE_LIMITED");
  });

  test("bounds untrusted depth, arrays and strings", () => {
    const redacted = redactOperationalValue({
      safe: "x".repeat(3_000),
      array: Array.from({ length: 200 }, (_, index) => index),
    }) as { safe: string; array: unknown[] };
    expect(redacted.safe.length).toBeLessThan(2_100);
    expect(redacted.array).toHaveLength(128);
  });

  test("rejects a secret that reaches the final boundary", () => {
    expect(() =>
      assertNoOperationalSecret("Bearer abcdefghijklmnopqrstuvwxyz"),
    ).toThrow("OPERATIONAL_PAYLOAD_CONTAINS_SECRET");
  });
});
