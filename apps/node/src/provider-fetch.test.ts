import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoundedNodeProviderFetcher } from "./provider-fetch";
import { NodeSecretStore } from "./secret-store";

let directory = "";

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

function wire(value: string) {
  const bytes = new TextEncoder().encode(value);
  return {
    encoding: "base64url" as const,
    byteLength: bytes.byteLength,
    data: Buffer.from(bytes).toString("base64url"),
  };
}

describe("BoundedNodeProviderFetcher", () => {
  test("allows only the configured route and injects the Node-local secret", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-provider-fetch-"));
    const secrets = new NodeSecretStore(join(directory, "secrets"));
    const secretRef = await secrets.put("tei-token", "node-private-token");
    const observed: Array<{ url: string; authorization: string | null }> = [];
    const provider = new BoundedNodeProviderFetcher({
      routes: [
        {
          purpose: "rerank",
          baseUrl: "http://127.0.0.1:8080",
          secretRef,
        },
      ],
      secrets,
      fetch: (async (url, init) => {
        observed.push({
          url: url.toString(),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Response.json({ ranks: [{ index: 0, score: 0.9 }] });
      }) as typeof fetch,
    });
    const response = await provider.fetch({
      purpose: "rerank",
      url: "http://127.0.0.1:8080/rerank",
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: wire('{"query":"maths","texts":["algèbre"]}'),
    });
    expect(observed[0]).toEqual({
      url: "http://127.0.0.1:8080/rerank",
      authorization: "Bearer node-private-token",
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(Buffer.from(response.body.data, "base64url").toString()))
      .toEqual({ ranks: [{ index: 0, score: 0.9 }] });

    await expect(
      provider.fetch({
        purpose: "rerank",
        url: "http://169.254.169.254/latest/meta-data",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: wire("{}"),
      }),
    ).rejects.toThrow("NODE_PROVIDER_ENDPOINT_DENIED");
  });

  test("rejects redirects and declared oversized responses", async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-provider-fetch-"));
    const secrets = new NodeSecretStore(join(directory, "secrets"));
    const route = {
      purpose: "rerank" as const,
      baseUrl: "http://tei.local",
    };
    const request = {
      purpose: "rerank" as const,
      url: "http://tei.local/rerank",
      method: "POST" as const,
      headers: { "content-type": "application/json" },
      body: wire("{}"),
    };
    const redirecting = new BoundedNodeProviderFetcher({
      routes: [route],
      secrets,
      fetch: (async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://unexpected.local" },
        })) as unknown as typeof fetch,
    });
    await expect(redirecting.fetch(request)).rejects.toThrow(
      "NODE_PROVIDER_REDIRECT_DENIED",
    );

    const oversized = new BoundedNodeProviderFetcher({
      routes: [route],
      secrets,
      fetch: (async () =>
        new Response("{}", {
          headers: { "content-length": String(128 * 1024 + 1) },
        })) as unknown as typeof fetch,
    });
    await expect(oversized.fetch(request)).rejects.toThrow(
      "NODE_PROVIDER_RESPONSE_TOO_LARGE",
    );
  });
});
