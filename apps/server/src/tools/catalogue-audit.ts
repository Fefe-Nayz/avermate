import { readdirSync, readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import {
  BROKERED_MCP_MUTATION_TOOL_IDS,
  BROKERED_MCP_READ_TOOL_IDS,
  brokeredMcpMutationToolIds,
  brokeredMcpReadToolIds,
  mcpDiscoveryOnlyToolIds,
} from "./exposure-policy";

export type ExposureClassification =
  | "agent-safe-and-registry-ready"
  | "safe-after-output-narrowing"
  | "requires-preview-or-compensation"
  | "human-or-admin-only"
  | "never-expose-to-agent";

export type McpAuditRow = {
  name: string;
  source: string;
  scopeGate: string;
  classification: ExposureClassification;
  fileTransport: "none" | "opaque-handle-required";
  execution:
    | "tool-broker"
    | "ledger-control"
    | "legacy-disabled"
    | "human-admin-direct"
    | "discovery-only";
  brokerWired: boolean | null;
};

export type OrpcAuditRow = {
  procedure: string;
  source: string;
  classification: ExposureClassification;
  fileTransport: "none" | "opaque-handle-required";
};

/**
 * This is an exposure review, not an execution allowlist. authenticated oRPC
 * ownership is not agent approval: first-party descriptors and MCP grants are
 * still the only agent entry points. In particular, an agent must not change
 * the credentials, routing policy or consent that authorizes its own work.
 */
export const capabilityControlPlaneExposureReview: Record<
  string,
  { classification: ExposureClassification; rationale: string }
> = {
  "capabilities.catalogue": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Reviewed plugin/configuration metadata, never credential values; expose only the capability summary needed by the task.",
  },
  "capabilities.readiness": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Owner-scoped readiness counts; a future tool needs a bounded readiness projection, not configuration authority.",
  },
  "capabilities.connections.list": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Owner connection and legacy-key metadata contains configuration/endpoints; omit those and credential-slot details from a model projection.",
  },
  "capabilities.connections.create": {
    classification: "human-or-admin-only",
    rationale:
      "Accepts secrets and establishes credential, endpoint and execution-placement authority; human settings only.",
  },
  "capabilities.connections.update": {
    classification: "human-or-admin-only",
    rationale:
      "Rotates secrets or changes endpoint/placement authority; revision checks do not constitute agent approval.",
  },
  "capabilities.connections.validate": {
    classification: "human-or-admin-only",
    rationale:
      "Uses a credential for an active remote probe and changes validation/health state; this is not a read.",
  },
  "capabilities.connections.discover": {
    classification: "human-or-admin-only",
    rationale:
      "Performs a credential-bearing probe and registers offerings/health, changing available execution routes; this is not a read.",
  },
  "capabilities.connections.disable": {
    classification: "human-or-admin-only",
    rationale:
      "Revokes an execution connection and its health eligibility; routing authority remains with the owner.",
  },
  "capabilities.connections.delete": {
    classification: "human-or-admin-only",
    rationale:
      "Soft-deletes connection/credential authority while retaining audit history; not an agent cleanup operation.",
  },
  "capabilities.offerings.list": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Owner offering descriptors and health require a minimized capability/model projection without private transport configuration.",
  },
  "capabilities.policies.list": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Owner routing/privacy policies may be summarized for explanation, without exposing policy-write authority.",
  },
  "capabilities.policies.upsert": {
    classification: "human-or-admin-only",
    rationale:
      "Changes routing, privacy and managed-credential constraints; an agent cannot authorize itself by editing its policy.",
  },
  "capabilities.consents.list": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Owner consent records need a current-permission summary, not a grant/revoke action or full consent history.",
  },
  "capabilities.consents.grant": {
    classification: "human-or-admin-only",
    rationale:
      "Records the owner's disclosure/privacy authorization; model output is never user consent.",
  },
  "capabilities.consents.revoke": {
    classification: "human-or-admin-only",
    rationale:
      "Changes privacy permission and route eligibility; permission management remains a human action.",
  },
  "capabilities.operations.list": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Bounded owner operation metadata includes frozen route and idempotency details; project only task-relevant status.",
  },
  "capabilities.operations.detail": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Owner route/attempt/usage metadata excludes result payloads, but needs a task-scoped diagnostic projection.",
  },
  "capabilities.operations.cancel": {
    classification: "requires-preview-or-compensation",
    rationale:
      "Cancels owner work using a revision fence; any future tool requires explicit cancellation intent and broker approval/idempotency review.",
  },
  "capabilities.usage.summary": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Owner usage/accounting aggregates need bounded task-relevant output before tool exposure.",
  },
  "capabilities.diagnostics.shadowMismatches": {
    classification: "safe-after-output-narrowing",
    rationale:
      "Bounded owner route-mismatch diagnostics contain internal identifiers; expose only sanitized explanations.",
  },
};

export const registryReadyToolIds = new Set<string>([
  ...BROKERED_MCP_READ_TOOL_IDS,
  ...BROKERED_MCP_MUTATION_TOOL_IDS,
]);

const ledgerControlToolIds = new Set([
  "actions.resolve_approval",
  "actions.undo_execute",
]);

function executionFor(name: string, source: string): McpAuditRow["execution"] {
  if (
    brokeredMcpReadToolIds.has(name) ||
    brokeredMcpMutationToolIds.has(name)
  ) {
    return "tool-broker";
  }
  if (ledgerControlToolIds.has(name)) return "ledger-control";
  if (mcpDiscoveryOnlyToolIds.has(name)) return "discovery-only";
  if (/social-moderation|admin\.ts$/i.test(source)) {
    return "human-admin-direct";
  }
  return "legacy-disabled";
}

function escapesRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brokerWired(name: string, text: string): boolean {
  const escaped = escapesRegex(name);
  const invocation = new RegExp(
    `(?:toolId\\s*:\\s*["']${escaped}["']|invokeRead\\(\\s*["']${escaped}["'])`,
  );
  const helperRegistration = new RegExp(
    `register(?:Read|Write)\\(\\s*["']${escaped}["']`,
  );
  return (
    text.includes("brokerMeta(") &&
    (invocation.test(text) ||
      (helperRegistration.test(text) && text.includes("invokeBrokerFromMcp")))
  );
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? filesUnder(path)
      : entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
        ? [path]
        : [];
  });
}

function looksRead(name: string) {
  return /(?:^|\.)(?:get|list|read|status|mine|active|history|eligible|contents|impact|agenda|day|calendar|locate|search|transcript|attachments|capabilities|viewer|snapshot)$/i.test(
    name,
  );
}

function mutates(name: string) {
  return /(?:^|\.)(?:create|update|delete|purge|archive|reorder|replace|set|move|link|unlink|dismiss|restore|detach|trigger|run|retry|cancel|upload|transcribe|build|export|revoke|block|leave|join|invite|accept|decline|remove|submit|mark|reset|rotate)/i.test(
    name,
  );
}

function hasFileBoundary(name: string, source: string) {
  return /download|attachment|artifact|export|file|preview/i.test(
    `${name} ${source}`,
  );
}

function classifyMcp(name: string, source: string): ExposureClassification {
  if (registryReadyToolIds.has(name)) return "agent-safe-and-registry-ready";
  if (/social-moderation|admin\.ts$/i.test(source))
    return "human-or-admin-only";
  if (/social-read\.ts$/i.test(source)) return "safe-after-output-narrowing";
  if (name === "account.export" || name.startsWith("admin.")) {
    return "never-expose-to-agent";
  }
  if (/destructive\.ts$/i.test(source) || mutates(name)) {
    return "requires-preview-or-compensation";
  }
  return looksRead(name)
    ? "safe-after-output-narrowing"
    : "requires-preview-or-compensation";
}

function surfaceScope(source: string): string {
  const name = basename(source, ".ts");
  const fixed: Record<string, string> = {
    read: "avermate:read",
    write: "avermate:write",
    destructive: "avermate:write",
    "social-read": "avermate:social.read",
    "social-manage": "mixed social grants",
    "social-moderation": "moderation grant + admin role",
    admin: "admin grant + admin role",
    planner: "avermate:planner.read/write",
    materials: "avermate:materials.read/write",
    documents: "avermate:documents.read/write",
    learning: "avermate:learning.read/write",
  };
  return fixed[name] ?? "surface-specific MCP grant";
}

export function inventoryMcp(root: string): McpAuditRow[] {
  const directory = resolve(root, "apps/server/src/mcp/surfaces");
  return filesUnder(directory)
    .flatMap((file) => {
      const source = relative(root, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      const matches = [
        ...text.matchAll(/registerTool\(\s*["']([^"']+)["']/g),
        ...text.matchAll(/register(?:Read|Write)\(\s*["']([^"']+)["']/g),
        ...(source.endsWith("social-read.ts")
          ? text.matchAll(/\btool\(\s*["']([^"']+)["']/g)
          : []),
      ];
      return matches.map((match) => {
        const name = match[1]!;
        const execution = executionFor(name, source);
        return {
          name,
          source,
          scopeGate: surfaceScope(source),
          classification: classifyMcp(name, source),
          fileTransport: hasFileBoundary(name, source)
            ? ("opaque-handle-required" as const)
            : ("none" as const),
          execution,
          brokerWired:
            execution === "tool-broker" ? brokerWired(name, text) : null,
        };
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function classifyOrpc(
  procedure: string,
  source: string,
): ExposureClassification {
  if (source.endsWith("/capabilities.ts")) {
    // New control-plane procedures fail closed pending explicit review below.
    return (
      capabilityControlPlaneExposureReview[procedure]?.classification ??
      "human-or-admin-only"
    );
  }
  if (/service-keys\.ts$|admin(?:-|\.)|public\.ts$/i.test(source)) {
    return /service-keys/.test(source)
      ? "never-expose-to-agent"
      : "human-or-admin-only";
  }
  if (mutates(procedure)) return "requires-preview-or-compensation";
  return looksRead(procedure)
    ? "safe-after-output-narrowing"
    : "safe-after-output-narrowing";
}

/**
 * The source inventory follows the repository's indented object declarations
 * (it does not dynamically import routers or execute handlers). Retain object
 * ancestry: `connections.list` and `operations.list` are different procedures.
 * Handler/schema objects are deeper than their procedure and are discarded on
 * the next sibling declaration; they must not leak into its route name.
 */
export function directlyDeclaredOrpcPaths(
  text: string,
  router: string,
): string[] {
  const parents: Array<{ name: string; indent: number }> = [];
  const procedures: string[] = [];
  for (const match of text.matchAll(
    /^([ \t]{2,})([A-Za-z][A-Za-z0-9]*):\s*(\{|protectedProcedure\b|publicProcedure\b|adminProcedure\b)/gm,
  )) {
    const indent = match[1]!.replaceAll("\t", "  ").length;
    while (parents.length && parents.at(-1)!.indent >= indent) parents.pop();
    if (match[3] === "{") {
      parents.push({ name: match[2]!, indent });
    } else {
      procedures.push(
        [router, ...parents.map(({ name }) => name), match[2]].join("."),
      );
    }
  }
  return procedures;
}

export function inventoryOrpc(root: string): OrpcAuditRow[] {
  const directory = resolve(root, "apps/server/src/routers");
  const rows = filesUnder(directory)
    .flatMap((file) => {
      const source = relative(root, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      const routerMatch = text.match(
        /export const\s+([A-Za-z0-9_]+Router)\s*=\s*{/,
      );
      const router =
        routerMatch?.[1]?.replace(/Router$/, "") ?? basename(file, ".ts");
      return directlyDeclaredOrpcPaths(text, router).map((procedure) => {
        return {
          procedure,
          source,
          classification: classifyOrpc(procedure, source),
          fileTransport: hasFileBoundary(procedure, source)
            ? ("opaque-handle-required" as const)
            : ("none" as const),
        };
      });
    })
    .sort((left, right) => left.procedure.localeCompare(right.procedure));
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.source}:${row.procedure}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function grouped<T extends { classification: ExposureClassification }>(
  rows: T[],
) {
  return Object.fromEntries(
    [
      "agent-safe-and-registry-ready",
      "safe-after-output-narrowing",
      "requires-preview-or-compensation",
      "human-or-admin-only",
      "never-expose-to-agent",
    ].map((classification) => [
      classification,
      rows.filter((row) => row.classification === classification),
    ]),
  ) as Record<ExposureClassification, T[]>;
}

export function renderCatalogueAudit(root: string): string {
  const mcp = inventoryMcp(root);
  const orpc = inventoryOrpc(root);
  const mcpGroups = grouped(mcp);
  const orpcGroups = grouped(orpc);
  const lines = [
    `Inventory fingerprint: MCP=${mcp.length}; oRPC=${orpc.length}.`,
    "",
    "### MCP registrations",
    "",
  ];
  for (const [classification, rows] of Object.entries(mcpGroups)) {
    lines.push(
      `- **${classification} (${rows.length})**: ${rows.map((row) => `\`${row.name}\``).join(", ") || "none"}`,
    );
  }
  lines.push("", "### oRPC procedures", "");
  for (const [classification, rows] of Object.entries(orpcGroups)) {
    lines.push(
      `- **${classification} (${rows.length})**: ${rows.map((row) => `\`${row.procedure}\``).join(", ") || "none"}`,
    );
  }
  const executionCounts = Object.fromEntries(
    [
      "tool-broker",
      "ledger-control",
      "legacy-disabled",
      "human-admin-direct",
      "discovery-only",
    ].map((execution) => [
      execution,
      mcp.filter((row) => row.execution === execution).length,
    ]),
  );
  lines.push(
    "",
    "### Effective MCP execution boundary",
    "",
    ...Object.entries(executionCounts).map(
      ([execution, count]) => `- **${execution}**: ${count}`,
    ),
  );
  lines.push(
    "",
    "Every row is derived from the checked-in registration/procedure source. File-like rows require an opaque-handle projection before registry exposure.",
  );
  lines.push(
    "",
    "### Capability control-plane review",
    "",
    "None of these oRPC procedures is an agent tool. Authentication/ownership is not agent approval; credential, routing-policy and consent changes remain human-only.",
    "",
    ...Object.entries(capabilityControlPlaneExposureReview).map(
      ([procedure, review]) =>
        `- \`${procedure}\` — ${review.classification}: ${review.rationale}`,
    ),
  );
  return lines.join("\n");
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../../../..");
  console.log(renderCatalogueAudit(root));
}
