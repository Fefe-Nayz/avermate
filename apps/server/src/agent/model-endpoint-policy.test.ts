import { describe, expect, test } from "bun:test";
import {
  ModelEndpointPolicyError,
  createPinnedModelLookup,
  safeModelFetchResponse,
  safeModelRequestText,
  validateModelEndpoint,
  type ModelLookup,
} from "./model-endpoint-policy";

const publicLookup: ModelLookup = async () => [
  { address: "8.8.8.8", family: 4 },
];
const hosted = {
  placement: "hosted-core" as const,
  allowedOrigins: ["https://models.example.test"],
  lookup: publicLookup,
};

describe("model endpoint trust boundary", () => {
  test("rejects alternate IPv4 spellings, private IPv6 and mapped IPv6", async () => {
    for (const value of [
      "https://127.1/v1",
      "https://2130706433/v1",
      "https://0x7f000001/v1",
      "https://0177.0.0.1/v1",
      "https://[::1]/v1",
      "https://[::ffff:127.0.0.1]/v1",
    ]) {
      const url = new URL(value);
      await expect(
        validateModelEndpoint(url, {
          placement: "hosted-core",
          allowedOrigins: [url.origin],
        }),
      ).rejects.toMatchObject({ code: "unsafe_address" });
    }
  });

  test("rejects credentialed URLs and non-curated origins", async () => {
    await expect(
      validateModelEndpoint("https://user:pass@models.example.test/v1", hosted),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(
      validateModelEndpoint("https://other.example.test/v1", hosted),
    ).rejects.toMatchObject({ code: "origin_not_allowed" });
  });

  test("pins the validated DNS snapshot even when the resolver rebinds", async () => {
    let lookups = 0;
    const lookup: ModelLookup = async () => {
      lookups += 1;
      return [
        {
          address: lookups === 1 ? "8.8.8.8" : "127.0.0.1",
          family: 4,
        },
      ];
    };
    const socketAddresses: string[] = [];
    const response = await safeModelRequestText(
      "https://models.example.test/v1/chat",
      {
        policy: { ...hosted, lookup },
        body: "{}",
        async transport(_url, _init, addresses) {
          expect(addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
          expect(
            (
              await lookup("models.example.test", { all: true, verbatim: true })
            )[0]?.address,
          ).toBe("127.0.0.1");
          createPinnedModelLookup(addresses, "hosted-core")(
            "models.example.test",
            { all: false },
            (_error, address) => {
              if (typeof address === "string") socketAddresses.push(address);
            },
          );
          return new Response("ok");
        },
      },
    );
    expect(response.text).toBe("ok");
    expect(socketAddresses).toEqual(["8.8.8.8"]);
  });

  test("rejects redirects to localhost before forwarding a bound secret", async () => {
    const seenAuthorization: Array<string | null> = [];
    await expect(
      safeModelRequestText("https://models.example.test/v1/chat", {
        policy: hosted,
        credential: {
          origin: "https://models.example.test",
          headerName: "Authorization",
          value: "Bearer synthetic-test-value",
        },
        async transport(_url, init) {
          seenAuthorization.push(
            new Headers(init.headers).get("authorization"),
          );
          return new Response(null, {
            status: 307,
            headers: { location: "http://localhost:11434/v1/chat" },
          });
        },
      }),
    ).rejects.toMatchObject({ code: "redirect_rejected" });
    expect(seenAuthorization).toHaveLength(1);
  });

  test("does not bind a secret to a different initial origin", async () => {
    let transportCalled = false;
    await expect(
      safeModelRequestText("https://models.example.test/v1/chat", {
        policy: hosted,
        credential: {
          origin: "https://other.example.test",
          headerName: "Authorization",
          value: "Bearer synthetic-test-value",
        },
        async transport() {
          transportCalled = true;
          return new Response("unexpected");
        },
      }),
    ).rejects.toMatchObject({ code: "redirect_rejected" });
    expect(transportCalled).toBe(false);
  });

  test("allows explicitly curated node-local models but always blocks metadata", async () => {
    await expect(
      validateModelEndpoint("http://127.0.0.1:11434/v1", {
        placement: "node",
        allowedOrigins: ["http://127.0.0.1:11434"],
      }),
    ).resolves.toMatchObject({
      addresses: [{ address: "127.0.0.1", family: 4 }],
    });
    await expect(
      validateModelEndpoint("http://169.254.169.254/latest/meta-data", {
        placement: "node",
        allowedOrigins: ["http://169.254.169.254"],
      }),
    ).rejects.toMatchObject({ code: "unsafe_address" });
    await expect(
      validateModelEndpoint("http://ollama.local:11434/v1", {
        placement: "hosted-core",
        allowedOrigins: ["http://ollama.local:11434"],
        lookup: async () => [{ address: "192.168.1.5", family: 4 }],
      }),
    ).rejects.toBeInstanceOf(ModelEndpointPolicyError);
  });

  test("enforces response limits and read deadlines", async () => {
    await expect(
      safeModelRequestText("https://models.example.test/v1/chat", {
        policy: hosted,
        maxResponseBytes: 3,
        transport: async () => new Response("four"),
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });

    await expect(
      safeModelRequestText("https://models.example.test/v1/chat", {
        policy: hosted,
        readTimeoutMs: 5,
        totalTimeoutMs: 50,
        transport: async () =>
          new Response(new ReadableStream<Uint8Array>({ start() {} })),
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  test("enforces the same byte limit while a provider stream is consumed", async () => {
    const response = await safeModelFetchResponse(
      "https://models.example.test/v1/chat",
      {
        policy: hosted,
        maxResponseBytes: 3,
        transport: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("two"));
                controller.enqueue(new TextEncoder().encode("more"));
                controller.close();
              },
            }),
          ),
      },
    );
    await expect(response.text()).rejects.toMatchObject({
      code: "response_too_large",
    });
  });
});
