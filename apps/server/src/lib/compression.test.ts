import { describe, expect, test } from "bun:test";
import { RPCHandler } from "@orpc/server/fetch";
import { os } from "@orpc/server";
import { Hono } from "hono";
import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import {
  compressRpcJson,
  negotiateCompression,
  RPC_COMPRESSION_THRESHOLD,
} from "./compression";

function yearlySnapshot() {
  const subjects = Array.from({ length: 12 }, (_, subjectIndex) => {
    const subjectId = `subject-${subjectIndex}`;
    return {
      id: subjectId,
      name: `Subject ${subjectIndex}`,
      shortName: `S${subjectIndex}`,
      parentId: null,
      coefficient: 1,
      kind: "subject",
      isMain: subjectIndex < 3,
      sortOrder: subjectIndex,
      grades: Array.from({ length: 12 }, (_, gradeIndex) => ({
        id: `grade-${subjectIndex}-${gradeIndex}`,
        name: `Assessment ${gradeIndex}`,
        value: 12 + (gradeIndex % 7),
        outOf: 20,
        coefficient: 1,
        isComposite: false,
        note:
          gradeIndex % 3 === 0 ? "Representative annual snapshot note" : null,
        passedAt: new Date(2025, gradeIndex % 10, gradeIndex + 1),
        createdAt: new Date(2025, gradeIndex % 10, gradeIndex + 1),
        subjectId,
        periodId: `period-${Math.floor(gradeIndex / 4)}`,
        components: [],
      })),
    };
  });

  return {
    year: {
      id: "year-2025",
      name: "2025–2026",
      startsAt: new Date("2025-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-01T00:00:00.000Z"),
      scale: 20,
      defaultOutOf: 20,
      passingRatio: 0.5,
      decimals: 2,
      sortOrder: 0,
      archivedAt: null,
    },
    subjects,
    periods: Array.from({ length: 3 }, (_, index) => ({
      id: `period-${index}`,
      name: `Term ${index + 1}`,
      startAt: new Date(2025, 8 + index * 3, 1),
      endAt: new Date(2025, 10 + index * 3, 30),
      isCumulative: false,
      sortOrder: index,
    })),
    customAverages: [],
    goals: [],
    cards: [],
  };
}

function createTestApp() {
  const snapshot = yearlySnapshot();
  const handler = new RPCHandler({
    snapshot: {
      get: os.handler(() => snapshot),
    },
    small: os.handler(() => ({ ok: true })),
  });
  const app = new Hono();

  app.use("/rpc/*", compressRpcJson());
  app.use("/rpc/*", async (context, next) => {
    const { matched, response } = await handler.handle(context.req.raw, {
      prefix: "/rpc",
      context: {},
    });
    if (matched) return context.newResponse(response.body, response);
    await next();
  });
  app.get(
    "/rpc/events",
    () =>
      new Response("data: still streaming\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      }),
  );
  app.get("/rpc/already-compressed", () => {
    const body = gzipSync(JSON.stringify(snapshot));
    return new Response(body, {
      headers: {
        "Content-Encoding": "gzip",
        "Content-Type": "application/json",
      },
    });
  });
  app.get("/mcp", (context) => context.json(snapshot));

  return app;
}

async function responseBytes(
  response: Response,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await response.arrayBuffer());
}

function rpcRequest(app: Hono, path: string, acceptEncoding: string) {
  return app.request(path, {
    method: "POST",
    headers: {
      "Accept-Encoding": acceptEncoding,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
}

describe("oRPC JSON compression", () => {
  test("negotiates Brotli and gzip with quality values and wildcards", () => {
    expect(negotiateCompression(undefined)).toBeUndefined();
    expect(negotiateCompression("br, gzip")).toBe("br");
    expect(negotiateCompression("br;q=0.4, gzip;q=0.9")).toBe("gzip");
    expect(negotiateCompression("gzip;q=0, *;q=0.5")).toBe("br");
    expect(negotiateCompression("br;q=0, gzip;q=0")).toBeUndefined();
  });

  test("compresses a representative annual snapshot and preserves its bytes", async () => {
    const app = createTestApp();
    const identity = await rpcRequest(app, "/rpc/snapshot/get", "identity");
    const identityBody = await responseBytes(identity);
    expect(identityBody.byteLength).toBeGreaterThan(RPC_COMPRESSION_THRESHOLD);

    const gzipResponse = await rpcRequest(app, "/rpc/snapshot/get", "gzip");
    const gzipBody = await responseBytes(gzipResponse);
    expect(gzipResponse.headers.get("Content-Encoding")).toBe("gzip");
    expect(gzipResponse.headers.get("Vary")).toContain("Accept-Encoding");
    expect(gzipResponse.headers.get("Content-Length")).toBe(
      String(gzipBody.byteLength),
    );
    expect(Uint8Array.from(gunzipSync(gzipBody))).toEqual(identityBody);
    expect(gzipBody.byteLength).toBeLessThan(identityBody.byteLength / 4);

    const brotliResponse = await rpcRequest(
      app,
      "/rpc/snapshot/get",
      "gzip;q=0.8, br",
    );
    const brotliBody = await responseBytes(brotliResponse);
    expect(brotliResponse.headers.get("Content-Encoding")).toBe("br");
    expect(Uint8Array.from(brotliDecompressSync(brotliBody))).toEqual(
      identityBody,
    );
    expect(brotliBody.byteLength).toBeLessThan(gzipBody.byteLength);
  });

  test("keeps small JSON below the threshold uncompressed", async () => {
    const response = await rpcRequest(
      createTestApp(),
      "/rpc/small",
      "br, gzip",
    );

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");
    expect(await response.json()).toEqual({ json: { ok: true } });
  });

  test("does not double-compress, compress SSE, or affect MCP", async () => {
    const app = createTestApp();
    const encoded = await app.request("/rpc/already-compressed", {
      headers: { "Accept-Encoding": "br, gzip" },
    });
    expect(encoded.headers.get("Content-Encoding")).toBe("gzip");
    expect(
      new Uint8Array(gunzipSync(await responseBytes(encoded))).byteLength,
    ).toBeGreaterThan(RPC_COMPRESSION_THRESHOLD);

    const events = await app.request("/rpc/events", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(events.headers.get("Content-Encoding")).toBeNull();
    expect(await events.text()).toBe("data: still streaming\n\n");

    const mcp = await app.request("/mcp", {
      headers: { "Accept-Encoding": "br, gzip" },
    });
    expect(mcp.headers.get("Content-Encoding")).toBeNull();
  });
});
