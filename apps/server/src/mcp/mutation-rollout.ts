import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import {
  brokeredMcpReadToolIds,
  MCP_BROKER_EXECUTION_META_KEY,
  MCP_BROKER_EXECUTION_META_VALUE,
  mcpDiscoveryOnlyToolIds,
} from "../tools/exposure-policy";

export const LEGACY_MUTATION_DISABLED = "LEGACY_MUTATION_DISABLED" as const;

/**
 * The only non-read MCP calls enabled during the plan-030 rollout. Domain
 * mutations must name their reviewed broker descriptor; the other entries are
 * action-ledger controls and cannot directly mutate an academic resource.
 */
export const MCP_EXECUTABLE_NON_READ_TOOLS = [
  {
    id: "planning.tasks.create",
    execution: "brokered-ledger-domain",
    descriptorKey: "planning.tasks.create@1",
  },
  {
    id: "learning.copy.request_analysis",
    execution: "brokered-ledger-domain",
    descriptorKey: "learning.copy.request_analysis@1",
  },
  {
    id: "learning.copy.review_analysis",
    execution: "brokered-ledger-domain",
    descriptorKey: "learning.copy.review_analysis@1",
  },
  {
    id: "learning.evidence.decide",
    execution: "brokered-ledger-domain",
    descriptorKey: "learning.evidence.decide@1",
  },
  {
    id: "learning.plan.propose",
    execution: "brokered-ledger-domain",
    descriptorKey: "learning.plan.propose@1",
  },
  {
    id: "learning.plan.apply",
    execution: "brokered-ledger-domain",
    descriptorKey: "learning.plan.apply@1",
  },
  {
    id: "learning.quiz.generate",
    execution: "brokered-ledger-domain",
    descriptorKey: "learning.quiz.generate@1",
  },
  {
    id: "learning.quiz.start",
    execution: "brokered-ledger-domain",
    descriptorKey: "learning.quiz.start@1",
  },
  {
    id: "artifact.plan",
    execution: "brokered-ledger-domain",
    descriptorKey: "artifact.plan@1",
  },
  {
    id: "artifact.cancel",
    execution: "brokered-ledger-domain",
    descriptorKey: "artifact.cancel@1",
  },
  {
    id: "artifact.retry_stage",
    execution: "brokered-ledger-domain",
    descriptorKey: "artifact.retry_stage@1",
  },
  {
    id: "artifact.promote",
    execution: "brokered-ledger-domain",
    descriptorKey: "artifact.promote@1",
  },
  {
    id: "artifact.set_state",
    execution: "brokered-ledger-domain",
    descriptorKey: "artifact.set_state@1",
  },
  {
    id: "actions.resolve_approval",
    execution: "ledger-control",
    descriptorKey: null,
  },
  {
    id: "actions.undo_execute",
    execution: "ledger-control",
    descriptorKey: null,
  },
] as const;

type ToolRegistrationConfig = {
  description?: string;
  annotations?: { readOnlyHint?: boolean };
  _meta?: Record<string, unknown>;
};

export type McpToolExecutionMode =
  | "brokered-read"
  | "brokered-or-ledger-control"
  | "human-admin-only"
  | "discovery-only"
  | "legacy-disabled";

export function mcpToolExecutionMode(
  name: string,
  config: ToolRegistrationConfig,
): McpToolExecutionMode {
  if (mcpDiscoveryOnlyToolIds.has(name)) return "discovery-only";
  if (/^(?:admin\.|social\.moderation\.)/.test(name)) {
    return "human-admin-only";
  }
  const brokerMarked =
    config._meta?.[MCP_BROKER_EXECUTION_META_KEY] ===
    MCP_BROKER_EXECUTION_META_VALUE;
  if (brokeredMcpReadToolIds.has(name)) {
    return brokerMarked ? "brokered-read" : "legacy-disabled";
  }
  const executable = MCP_EXECUTABLE_NON_READ_TOOLS.find(
    (entry) => entry.id === name,
  );
  if (executable) {
    return executable.execution === "ledger-control" || brokerMarked
      ? "brokered-or-ledger-control"
      : "legacy-disabled";
  }
  // Unknown read-looking registrations are deliberately not executable. A
  // readOnlyHint is documentation, not a registry/policy authorization.
  return "legacy-disabled";
}

export function legacyMutationDisabledResult(name: string): CallToolResult {
  const error = {
    code: LEGACY_MUTATION_DISABLED,
    message: `${name} is discoverable for compatibility but disabled until it is migrated to the durable action ledger.`,
    retryable: false,
  } as const;
  const structuredContent = { ok: false, error } as const;
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
    structuredContent,
  };
}

export function discoveryOnlyToolResult(name: string): CallToolResult {
  const error = {
    code: "AGENT_TOOL_NOT_AVAILABLE",
    message: `${name} is discoverable for compatibility but unavailable to agents until it has a bounded descriptor and safe transport.`,
    retryable: false,
  } as const;
  const structuredContent = { ok: false, error } as const;
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
    structuredContent,
  };
}

/**
 * Preserve legacy discovery schemas while replacing every non-reviewed write
 * callback at the single registration boundary. Binding all other methods to
 * the target is required because McpServer uses native private fields.
 */
export function guardMcpMutationRegistrations(
  server: McpServer,
  options: { testOnlyAllowLegacyMutations?: boolean } = {},
): McpServer {
  const originalRegister = server.registerTool.bind(server) as (
    name: string,
    config: ToolRegistrationConfig,
    callback: (...args: unknown[]) => unknown,
  ) => unknown;
  const guardedRegister = (
    name: string,
    config: ToolRegistrationConfig,
    callback: (...args: unknown[]) => unknown,
  ) => {
    const mode = mcpToolExecutionMode(name, config);
    const enabled =
      (mode !== "legacy-disabled" && mode !== "discovery-only") ||
      (mode === "legacy-disabled" &&
        options.testOnlyAllowLegacyMutations === true);
    const publishedConfig =
      mode === "legacy-disabled" || mode === "discovery-only"
        ? {
            ...config,
            description: `${config.description ?? name} [Compatibility-only: execution requires a reviewed ToolBroker descriptor and safe result transport.]`,
          }
        : config;
    return originalRegister(
      name,
      publishedConfig,
      enabled
        ? callback
        : () =>
            mode === "discovery-only"
              ? discoveryOnlyToolResult(name)
              : legacyMutationDisabledResult(name),
    );
  };

  return new Proxy(server, {
    get(target, property) {
      if (property === "registerTool") return guardedRegister;
      // SAFETY: this Proxy only forwards a property already present on the
      // concrete McpServer instance; it never reads client-controlled keys.
      const value = target[property as keyof McpServer] as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
