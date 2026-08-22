import { describe, expect, test } from "bun:test"
import {
  customMcpSourceSummarySchema,
  nodeMcpConnectionSchema,
  nodeMcpInspectResultSchema,
  nodeMcpInvokeResultSchema,
} from "./custom-mcp"
import { nodeCapabilityFeaturesSchema } from "./node"
import { nodeOperationCapability } from "./node-operations"

describe("node MCP contracts", () => {
  test("binds the dedicated operations to the exact MCP capability", () => {
    expect(nodeOperationCapability("mcp.inspect")).toBe("mcp")
    expect(nodeOperationCapability("mcp.invoke")).toBe("mcp")
    expect(
      nodeCapabilityFeaturesSchema.parse({
        mcp: {
          version: 1,
          transports: ["streamable-http"],
          maxCatalogueTools: 500,
          maxRequestBytes: 16 * 1024,
          maxResponseBytes: 1024 * 1024,
        },
      }).mcp?.version
    ).toBe(1)
  })

  test("keeps credentials input-only", () => {
    expect(
      nodeMcpConnectionSchema.safeParse({
        endpointUrl: "http://mcp.internal/mcp",
        authKind: "bearer",
        credential: null,
      }).success
    ).toBe(false)
    expect(
      nodeMcpInspectResultSchema.safeParse({
        tools: [],
        credential: "must-not-cross-back",
      }).success
    ).toBe(false)
    expect(
      nodeMcpInvokeResultSchema.safeParse({
        isError: false,
        text: "ok",
        authorization: "must-not-cross-back",
      }).success
    ).toBe(false)
  })

  test("requires an immutable node binding for a node source summary", () => {
    const base = {
      id: "amcp_1",
      name: "Local MCP",
      endpointUrl: "http://mcp.internal/mcp",
      endpointOrigin: "http://mcp.internal",
      placement: "node" as const,
      placementRef: "node_1",
      authKind: "none" as const,
      credentialHint: null,
      status: "review-required" as const,
      catalogDigest: "a".repeat(64),
      catalogRevision: 1,
      tools: [],
      lastCheckedAt: "2026-08-22T00:00:00.000Z",
      lastError: null,
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    }
    expect(customMcpSourceSummarySchema.parse(base).placementRef).toBe("node_1")
    expect(
      customMcpSourceSummarySchema.safeParse({ ...base, placementRef: null })
        .success
    ).toBe(false)
  })
})
