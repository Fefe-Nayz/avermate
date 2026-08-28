import { afterEach, describe, expect, test } from "bun:test";
import {
  Client,
  type Credential,
  InvalidCredentials,
  Require2FA,
} from "@blockshub/blocksdirecte";

const originalFetch = globalThis.fetch;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
});

describe("the pinned BlocksDirecte transport patch", () => {
  test("bootstraps GTK and forwards the session without exposing it", async () => {
    const requests: Array<{
      url: URL;
      method: string;
      headers: Headers;
    }> = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({ url, method, headers });
      if (method === "GET") {
        return Response.json(
          { code: 200 },
          { headers: { "Set-Cookie": "GTK=contract-gtk; Path=/; Secure" } },
        );
      }
      return Response.json({ code: 505, message: "invalid", data: {} });
    }) as unknown as typeof fetch;

    const client = new Client();
    try {
      await expect(
        client.auth.loginUsername("contract-user", "contract-password"),
      ).rejects.toBeInstanceOf(InvalidCredentials);
    } finally {
      client.dispose();
    }

    expect(requests).toHaveLength(2);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url.pathname).toBe("/v3/login.awp");
    expect(requests[0]?.url.searchParams.get("gtk")).toBe("1");
    expect(requests[1]?.method).toBe("POST");
    expect(requests[1]?.headers.get("cookie")).toContain("GTK=contract-gtk");
    expect(requests[1]?.headers.get("x-gtk")).toBe("contract-gtk");
  });

  test("unrefs and clears the SDK rate-limit timer", () => {
    const timer = {
      unrefCalls: 0,
      unref() {
        this.unrefCalls += 1;
        return this;
      },
    };
    let cleared: unknown;
    globalThis.setInterval = (() => timer) as unknown as typeof setInterval;
    globalThis.clearInterval = ((value: unknown) => {
      cleared = value;
    }) as typeof clearInterval;

    const client = new Client();
    expect(timer.unrefCalls).toBe(1);
    client.dispose();
    expect(cleared).toBe(timer);
  });

  test("replays a TOTP factor with an empty cn and without another GTK bootstrap", async () => {
    const requests: Array<{ method: string; data: Record<string, unknown> }> =
      [];
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const method = init?.method ?? "GET";
      const encoded =
        typeof init?.body === "string"
          ? new URLSearchParams(init.body).get("data")
          : null;
      const data = encoded
        ? (JSON.parse(encoded) as Record<string, unknown>)
        : {};
      requests.push({ method, data });
      if (method === "GET") {
        return Response.json(
          { code: 200 },
          { headers: { "Set-Cookie": "GTK=contract-gtk; Path=/; Secure" } },
        );
      }
      if (requests.length === 2) {
        return Response.json(
          { code: 250, data: { totp: true } },
          { headers: { "2FA-Token": "challenge-token" } },
        );
      }
      return Response.json({
        code: 200,
        token: "session-token",
        data: { accounts: [] },
      });
    }) as unknown as typeof fetch;

    const client = new Client();
    try {
      let challenge: unknown;
      try {
        await client.auth.loginUsername("contract-user", "contract-password");
      } catch (error) {
        challenge = error;
      }
      expect(challenge).toBeInstanceOf(Require2FA);
      expect(challenge).toMatchObject({
        kind: "totp",
        token: "challenge-token",
      });
      await client.auth.loginUsername(
        "contract-user",
        "contract-password",
        "",
        "123456",
      );
    } finally {
      client.dispose();
    }

    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "POST",
      "POST",
    ]);
    expect(requests[2]?.data.fa).toEqual([
      { cn: "", cv: "123456", uniq: false },
    ]);
  });

  test("cancels an oversized JSON response before buffering it", async () => {
    let requests = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    globalThis.fetch = (async () => {
      requests += 1;
      if (requests === 1) {
        return Response.json(
          { code: 200 },
          { headers: { "Set-Cookie": "GTK=contract-gtk; Path=/; Secure" } },
        );
      }
      let emitted = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            emitted += 1;
            controller.enqueue(chunk);
            if (emitted === 18) controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new Client();
    try {
      await expect(
        client.auth.loginUsername("contract-user", "contract-password"),
      ).rejects.toThrow("exceeds 16 MiB");
    } finally {
      client.dispose();
    }

    expect(cancelled).toBe(true);
  });

  test("keeps the 0.0.9 wallet module guard non-recursive", () => {
    const client = new Client({
      token: "session-token",
      selectedAccounts: 0,
      accounts: [
        {
          modules: [
            {
              code: "CANTINE_BARCODE",
              params: { numeroBadge: "badge-42" },
            },
          ],
        },
      ],
    } as unknown as Credential);

    try {
      expect(client.wallets.getBadgeNumber()).toBe("badge-42");
    } finally {
      client.dispose();
    }
  });
});

test.skipIf(process.env.ECOLEDIRECTE_LIVE_CONTRACT !== "1")(
  "the current ÉcoleDirecte login endpoint accepts the GTK preflight contract",
  async () => {
    const client = new Client();
    try {
      await expect(
        client.auth.loginUsername(
          `avermate-contract-${crypto.randomUUID()}`,
          crypto.randomUUID(),
          undefined,
          undefined,
          false,
          crypto.randomUUID(),
        ),
      ).rejects.toBeInstanceOf(InvalidCredentials);
    } finally {
      client.dispose();
    }
  },
  30_000,
);
