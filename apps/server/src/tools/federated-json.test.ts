import { describe, expect, test } from "bun:test";
import type {
  ToolSourceResponse,
  ToolSourceTransportLimits,
} from "@avermate/agent-contracts";
import { exchangeToolSourceJson } from "./federated-json";
import { FederatedToolSourceBroker } from "./federated";
import {
  InProcessMcpSource,
  InProcessMcpTransport,
  inProcessJsonResponse,
} from "./sources/in-process-mcp";

const source = new InProcessMcpSource(
  "school-tools",
  "adapter-only-credential",
);
const limits: ToolSourceTransportLimits = {
  connectDeadlineMs: 100,
  totalDeadlineMs: 200,
  maxBytes: 1_024,
  maxDepth: 8,
  maxItems: 20,
};
const context = {
  principal: { userId: "user-1", clientId: "client-1" },
  signal: new AbortController().signal,
};

function rawResponse(
  text: string,
  options: { declaredBytes?: number; chunkSize?: number } = {},
): ToolSourceResponse {
  const bytes = new TextEncoder().encode(text);
  const chunkSize = options.chunkSize ?? 3;
  return {
    ...(options.declaredBytes === undefined
      ? {}
      : { declaredBytes: options.declaredBytes }),
    contentType: "application/json; charset=utf-8",
    body: {
      async *[Symbol.asyncIterator]() {
        for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
          yield bytes.slice(offset, offset + chunkSize);
        }
      },
    },
  };
}

async function parse(response: ToolSourceResponse, custom = limits) {
  return exchangeToolSourceJson({
    source,
    request: source.listRequest(context),
    transport: new InProcessMcpTransport(() => response),
    limits: custom,
    signal: context.signal,
  });
}

describe("federated MCP transport", () => {
  test("inspects and reviews a namespaced, locally risk-floored catalog", async () => {
    const transport = new InProcessMcpTransport((request) => {
      expect(request.headers.authorization).toContain(
        "adapter-only-credential",
      );
      return inProcessJsonResponse(
        {
          protocolVersion: 1,
          tools: [
            {
              id: "grades.read",
              version: 1,
              title: "Read grades",
              description: "Read from a test source",
              advertisedRisk: "low",
            },
          ],
        },
        { chunkSize: 2 },
      );
    });
    const broker = new FederatedToolSourceBroker(transport, limits);
    const inspected = await broker.inspect(source, context);
    expect(inspected.tools[0]).toMatchObject({
      namespacedId: "external.school-tools.grades.read",
      effectiveRisk: "high",
    });
    broker.review(inspected);
    expect((await broker.assertUnchanged(source, context)).snapshot).toBe(
      inspected.snapshot,
    );
  });

  test("invalidates the reviewed snapshot when the list changes", async () => {
    let version = 1;
    const transport = new InProcessMcpTransport(() =>
      inProcessJsonResponse({
        protocolVersion: 1,
        tools: [
          {
            id: "read",
            version,
            title: "Read",
            description: "Read test data",
            advertisedRisk: "high",
          },
        ],
      }),
    );
    const broker = new FederatedToolSourceBroker(transport, limits);
    broker.review(await broker.inspect(source, context));
    version = 2;
    await expect(broker.assertUnchanged(source, context)).rejects.toMatchObject(
      {
        code: "SOURCE_SNAPSHOT_CHANGED",
      },
    );
  });

  test("rejects declared oversize before reading and catches lying lengths", async () => {
    let started = false;
    const tooLarge: ToolSourceResponse = {
      declaredBytes: limits.maxBytes + 1,
      contentType: "application/json",
      body: {
        async *[Symbol.asyncIterator]() {
          started = true;
          yield new TextEncoder().encode("{}");
        },
      },
    };
    await expect(parse(tooLarge)).rejects.toMatchObject({
      code: "RESULT_BUDGET_EXCEEDED",
    });
    expect(started).toBe(false);
    await expect(
      parse(rawResponse("{}", { declaredBytes: 1 })),
    ).rejects.toMatchObject({ code: "SOURCE_PROTOCOL_ERROR" });
  });

  test("bounds missing-length and infinite chunked bodies", async () => {
    await expect(
      parse(rawResponse(JSON.stringify({ value: "x".repeat(2_000) }))),
    ).rejects.toMatchObject({ code: "RESULT_BUDGET_EXCEEDED" });

    const infinite: ToolSourceResponse = {
      contentType: "application/json",
      body: {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<Uint8Array>>(() => undefined),
          };
        },
      },
    };
    await expect(
      parse(infinite, { ...limits, totalDeadlineMs: 15 }),
    ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
  });

  test("rejects depth, item, duplicate-sensitive-key and trailing JSON bombs", async () => {
    await expect(
      parse(rawResponse('{"a":{"b":{"c":{}}}}'), {
        ...limits,
        maxDepth: 3,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_PROTOCOL_ERROR" });
    await expect(
      parse(rawResponse("[1,2,3,4]"), { ...limits, maxItems: 3 }),
    ).rejects.toMatchObject({ code: "SOURCE_PROTOCOL_ERROR" });
    await expect(
      parse(rawResponse('{"authorization":"a","authorization":"b"}')),
    ).rejects.toMatchObject({ code: "SOURCE_PROTOCOL_ERROR" });
    await expect(
      parse(rawResponse('{} {"second":true}')),
    ).rejects.toMatchObject({
      code: "SOURCE_PROTOCOL_ERROR",
    });
  });

  test("rejects malformed JSON before any consumer receives a value", async () => {
    await expect(parse(rawResponse('{"a":1,}'))).rejects.toMatchObject({
      code: "SOURCE_PROTOCOL_ERROR",
    });
    await expect(parse(rawResponse('{"a": tru}'))).rejects.toMatchObject({
      code: "SOURCE_PROTOCOL_ERROR",
    });
  });
});
