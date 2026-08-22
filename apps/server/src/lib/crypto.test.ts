import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";

describe("credential sealing", () => {
  test("round-trips without putting plaintext in the envelope", async () => {
    const { open, seal } = await import("./crypto");
    const plaintext = "provider-secret-1234";
    const sealed = seal(plaintext);
    expect(sealed).toStartWith("v1.");
    expect(sealed).not.toContain(plaintext);
    expect(open(sealed)).toBe(plaintext);
  });

  test("rejects a modified authenticated envelope", async () => {
    const { open, seal } = await import("./crypto");
    const sealed = seal("provider-secret-1234");
    const parts = sealed.split(".");
    parts[2] = `${parts[2]?.startsWith("A") ? "B" : "A"}${parts[2]?.slice(1)}`;
    expect(() => open(parts.join("."))).toThrow();
  });
});
