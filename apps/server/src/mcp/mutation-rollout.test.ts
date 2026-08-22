import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Api } from "./shared";
import {
  LEGACY_MUTATION_DISABLED,
  MCP_EXECUTABLE_NON_READ_TOOLS,
  guardMcpMutationRegistrations,
  mcpToolExecutionMode,
} from "./mutation-rollout";
import { firstPartyToolDescriptors } from "../tools/first-party";
import {
  BROKERED_MCP_MUTATION_TOOL_IDS,
  BROKERED_MCP_READ_TOOL_IDS,
  MCP_BROKER_EXECUTION_META_KEY,
  MCP_BROKER_EXECUTION_META_VALUE,
} from "../tools/exposure-policy";

const brokerMeta = {
  [MCP_BROKER_EXECUTION_META_KEY]: MCP_BROKER_EXECUTION_META_VALUE,
};

type Handler = (...args: unknown[]) => unknown;

function fakeServer() {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

describe("MCP mutation rollout gate", () => {
  test("keeps reads and the reviewed ledger mutation executable but fails legacy writes closed", async () => {
    const { server, handlers } = fakeServer();
    const guarded = guardMcpMutationRegistrations(server);
    let readEffects = 0;
    let reviewedEffects = 0;
    let legacyEffects = 0;
    const register = guarded.registerTool.bind(guarded) as unknown as (
      name: string,
      config: {
        annotations?: { readOnlyHint?: boolean };
        _meta?: Record<string, unknown>;
      },
      handler: Handler,
    ) => void;
    register(
      "years.list",
      { annotations: { readOnlyHint: true }, _meta: brokerMeta },
      () => ++readEffects,
    );
    register(
      "planning.tasks.create",
      { _meta: brokerMeta },
      () => ++reviewedEffects,
    );
    register(
      "sync.trigger",
      { annotations: { readOnlyHint: true } },
      () => ++legacyEffects,
    );

    expect(await handlers.get("years.list")!()).toBe(1);
    expect(await handlers.get("planning.tasks.create")!()).toBe(1);
    expect(await handlers.get("sync.trigger")!()).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: LEGACY_MUTATION_DISABLED, retryable: false },
      },
    });
    expect({ readEffects, reviewedEffects, legacyEffects }).toEqual({
      readEffects: 1,
      reviewedEffects: 1,
      legacyEffects: 0,
    });
  });

  test("the executable domain mutation allowlist is backed by one reviewed descriptor", () => {
    const descriptors = firstPartyToolDescriptors({} as Api);
    const mutationKeys = new Set(
      descriptors
        .filter(({ effect }) => effect !== "read")
        .map(({ id, version }) => `${id}@${version}`),
    );
    const enabledDomainMutations = MCP_EXECUTABLE_NON_READ_TOOLS.filter(
      ({ execution }) => execution === "brokered-ledger-domain",
    );

    expect(enabledDomainMutations).toHaveLength(
      BROKERED_MCP_MUTATION_TOOL_IDS.length,
    );
    expect(
      enabledDomainMutations.every(
        ({ descriptorKey }) =>
          descriptorKey !== null && mutationKeys.has(descriptorKey),
      ),
    ).toBe(true);
    expect(mcpToolExecutionMode("admin.users.delete", {})).toBe(
      "human-admin-only",
    );
    expect(mcpToolExecutionMode("provider.sync", {})).toBe("legacy-disabled");
    expect(
      mcpToolExecutionMode("subjects.delete_impact", {
        annotations: { readOnlyHint: true },
        _meta: brokerMeta,
      }),
    ).toBe("brokered-read");
    expect(
      mcpToolExecutionMode("subjects.delete_impact", {
        annotations: { readOnlyHint: true },
      }),
    ).toBe("legacy-disabled");
    expect(mcpToolExecutionMode("account.export", {})).toBe("discovery-only");
  });

  test("every declared brokered MCP read requires the exact execution marker", () => {
    for (const id of BROKERED_MCP_READ_TOOL_IDS) {
      expect(
        mcpToolExecutionMode(id, {
          annotations: { readOnlyHint: true },
          _meta: brokerMeta,
        }),
      ).toBe("brokered-read");
      expect(
        mcpToolExecutionMode(id, {
          annotations: { readOnlyHint: true },
        }),
      ).toBe("legacy-disabled");
    }
  });

  test("the legacy test escape hatch never re-enables discovery-only data leaks", async () => {
    const { server, handlers } = fakeServer();
    const guarded = guardMcpMutationRegistrations(server, {
      testOnlyAllowLegacyMutations: true,
    });
    let effects = 0;
    const register = guarded.registerTool.bind(guarded) as unknown as (
      name: string,
      config: { annotations?: { readOnlyHint?: boolean } },
      handler: Handler,
    ) => void;
    register(
      "account.export",
      { annotations: { readOnlyHint: true } },
      () => ++effects,
    );

    expect(await handlers.get("account.export")!()).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "AGENT_TOOL_NOT_AVAILABLE", retryable: false },
      },
    });
    expect(effects).toBe(0);
  });
});
