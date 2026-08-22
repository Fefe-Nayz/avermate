import { describe, expect, test } from "bun:test";
import {
  normalizeRemoteMcpCatalogue,
  normalizeRemoteMcpEndpoint,
  SdkRemoteMcpClient,
} from "./remote-mcp-client";

describe("remote MCP client boundary", () => {
  test("normalizes endpoint syntax without accepting hosted plaintext or credentials", () => {
    expect(
      normalizeRemoteMcpEndpoint(
        "https://MCP.Example.test//mcp/",
        "hosted-core",
      ).href,
    ).toBe("https://mcp.example.test/mcp/");
    expect(() =>
      normalizeRemoteMcpEndpoint("http://mcp.example.test/mcp", "hosted-core"),
    ).toThrow("public HTTPS");
    expect(() =>
      normalizeRemoteMcpEndpoint(
        "https://secret@mcp.example.test/mcp",
        "hosted-core",
      ),
    ).toThrow("cannot contain credentials");
    expect(
      normalizeRemoteMcpEndpoint("http://mcp.internal/mcp", "node").href,
    ).toBe("http://mcp.internal/mcp");
  });

  test("bounds, orders, and preserves only reviewed catalogue metadata", () => {
    const catalog = normalizeRemoteMcpCatalogue([
      {
        name: "z.read",
        description: "Z",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: "a.read",
        title: "A",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    expect(catalog.map((tool) => tool.remoteToolId)).toEqual([
      "a.read",
      "z.read",
    ]);
    expect(catalog[0]?.destructiveHint).toBe(true);
    expect(catalog[1]?.readOnlyHint).toBe(true);
    expect(() =>
      normalizeRemoteMcpCatalogue([
        {
          name: "same",
          inputSchema: { type: "object" },
        },
        {
          name: "same",
          inputSchema: { type: "object" },
        },
      ]),
    ).toThrow("duplicate");
  });

  test("never falls back to hosted Core for a node-private endpoint", async () => {
    const client = new SdkRemoteMcpClient();
    await expect(
      client.inspect({
        endpointUrl: "http://mcp.internal/mcp",
        placement: "node",
        ownerId: "owner-a",
        placementRef: "node-a",
        authKind: "none",
        credential: null,
      }),
    ).rejects.toThrow("NODE_MCP_CAPABILITY_OFFLINE");
  });

  test("binds node calls to the exact owner and node", async () => {
    const calls: Array<{ nodeId: string; ownerId: string }> = [];
    const client = new SdkRemoteMcpClient({
      nodeTransport: {
        async inspectNodeMcp(input) {
          calls.push(input);
          return [];
        },
        async invokeNodeMcp(input) {
          calls.push(input);
          return { isError: false, text: "ok" };
        },
      },
    });
    const connection = {
      endpointUrl: "http://mcp.internal/mcp",
      placement: "node" as const,
      ownerId: "owner-a",
      placementRef: "node-a",
      authKind: "bearer" as const,
      credential: "private-node-credential",
    };
    await client.inspect(connection);
    await client.invoke(connection, {
      remoteToolId: "read.notes",
      arguments: {},
    });
    expect(calls).toEqual([
      expect.objectContaining({ nodeId: "node-a", ownerId: "owner-a" }),
      expect.objectContaining({ nodeId: "node-a", ownerId: "owner-a" }),
    ]);
    expect(JSON.stringify(calls)).toContain("private-node-credential");
    await expect(
      client.inspect({ ...connection, placementRef: null }),
    ).rejects.toThrow("NODE_MCP_BINDING_INVALID");
  });
});
