import { describe, expect, test } from "bun:test";
import {
  assertPublicProviderUrl,
  createPinnedProviderLookup,
  fetchPinnedProviderResponse,
  fetchSafeProviderText,
  isPublicProviderAddress,
  type ProviderLookup,
} from "./provider-network";

const publicLookup: ProviderLookup = async () => [
  { address: "8.8.8.8", family: 4 },
];

describe("school provider network boundary", () => {
  test("rejects local, private, and mixed DNS answers", async () => {
    expect(isPublicProviderAddress("10.0.0.1")).toBeFalse();
    expect(isPublicProviderAddress("127.0.0.1")).toBeFalse();
    expect(isPublicProviderAddress("::1")).toBeFalse();
    expect(isPublicProviderAddress("8.8.8.8")).toBeTrue();

    await expect(
      assertPublicProviderUrl(new URL("https://localhost/pronote")),
    ).rejects.toThrow("public HTTPS");
    await expect(
      assertPublicProviderUrl(new URL("https://10.0.0.8/pronote")),
    ).rejects.toThrow("private network");

    for (const address of [
      "64:ff9b::7f00:1",
      "64:ff9b::a00:1",
      "fec0::1",
      "::7f00:1",
      "::ffff:7f00:1",
    ]) {
      await expect(
        assertPublicProviderUrl(new URL("https://school.example"), {
          lookup: async () => [{ address, family: 6 }],
        }),
      ).rejects.toThrow("private network");
    }
    await expect(
      assertPublicProviderUrl(new URL("https://school.example/pronote"), {
        lookup: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "192.168.1.20", family: 4 },
        ],
      }),
    ).rejects.toThrow("private network");
  });

  test("rejects a redirect outside the pinned provider origin", async () => {
    const fetches: string[] = [];
    await expect(
      fetchSafeProviderText(
        "https://school.example/pronote/eleve.html",
        {},
        {
          expectedOrigin: "https://school.example",
          lookup: publicLookup,
          fetch: async (input) => {
            fetches.push(String(input));
            return new Response(null, {
              status: 302,
              headers: { location: "https://attacker.example/collect" },
            });
          },
        },
      ),
    ).rejects.toThrow("approved origin");
    expect(fetches).toHaveLength(1);
  });

  test("connects only to the validated IP snapshot when DNS rebinds", async () => {
    let resolverCalls = 0;
    const rebindingLookup: ProviderLookup = async () => {
      resolverCalls += 1;
      return [
        {
          address: resolverCalls === 1 ? "8.8.8.8" : "127.0.0.1",
          family: 4,
        },
      ];
    };
    const socketAddresses: string[] = [];
    const response = await fetchSafeProviderText(
      "https://school.example/pronote",
      {},
      {
        lookup: rebindingLookup,
        async transport(_url, _init, validatedAddresses) {
          expect(validatedAddresses).toEqual([
            { address: "8.8.8.8", family: 4 },
          ]);
          expect(
            (
              await rebindingLookup("school.example", {
                all: true,
                verbatim: true,
              })
            )[0]?.address,
          ).toBe("127.0.0.1");
          const pinnedLookup = createPinnedProviderLookup(validatedAddresses);
          pinnedLookup("school.example", { all: false }, (error, address) => {
            expect(error).toBeNull();
            if (typeof address === "string") socketAddresses.push(address);
          });
          return new Response("safe");
        },
      },
    );
    expect(response.content).toBe("safe");
    expect(resolverCalls).toBe(2);
    expect(socketAddresses).toEqual(["8.8.8.8"]);
  });

  test("bounds response bodies and honors caller cancellation", async () => {
    await expect(
      fetchSafeProviderText(
        "https://school.example/pronote",
        {},
        {
          lookup: publicLookup,
          maxResponseBytes: 3,
          fetch: async () => new Response("four"),
        },
      ),
    ).rejects.toThrow("allowed size");

    const controller = new AbortController();
    const request = fetchSafeProviderText(
      "https://school.example/pronote",
      {},
      {
        lookup: publicLookup,
        signal: controller.signal,
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) {
              reject(init.signal.reason);
              return;
            }
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      },
    );
    controller.abort(new Error("lease lost"));
    await expect(request).rejects.toThrow("lease lost");
  });

  test("keeps a hard deadline through headers and streaming consumption", async () => {
    let transportSignal!: AbortSignal;
    await expect(
      fetchPinnedProviderResponse(
        "https://school.example/blocked",
        {},
        {
          lookup: publicLookup,
          timeoutMs: 10,
          fetch: async (_input, init) => {
            transportSignal = init?.signal as AbortSignal;
            return new Promise<Response>(() => {});
          },
        },
      ),
    ).rejects.toThrow("timed out");
    expect(transportSignal.aborted).toBe(true);

    const response = await fetchPinnedProviderResponse(
      "https://school.example/trickle",
      {},
      {
        lookup: publicLookup,
        timeoutMs: 10,
        fetch: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("partial"));
              },
            }),
          ),
      },
    );
    await expect(response.text()).rejects.toThrow("timed out");
  });
});
