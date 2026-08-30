import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  capabilityControlPlaneExposureReview,
  directlyDeclaredOrpcPaths,
  inventoryMcp,
  inventoryOrpc,
  registryReadyToolIds,
  renderCatalogueAudit,
} from "./catalogue-audit";
import {
  BROKERED_MCP_MUTATION_TOOL_IDS,
  BROKERED_MCP_READ_TOOL_IDS,
  MCP_DISCOVERY_ONLY_TOOL_IDS,
} from "./exposure-policy";
import { ToolRegistry } from "./registry";
import type { Api } from "../mcp/shared";

const root = resolve(import.meta.dir, "../../../..");

describe("plan 027 catalogue audit", () => {
  test("classifies every current MCP registration exactly once", () => {
    const rows = inventoryMcp(root);
    // Any catalogue change requires an explicit classification/policy review.
    expect(rows).toHaveLength(157);
    expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length);
    for (const id of registryReadyToolIds) {
      expect(rows.some((row) => row.name === id)).toBe(true);
    }
    expect(
      rows
        .filter((row) => row.classification === "never-expose-to-agent")
        .map((row) => row.name),
    ).toContain("account.export");
    expect(
      rows.filter(({ execution }) => execution === "tool-broker"),
    ).toHaveLength(77);
    expect(
      rows
        .filter(({ execution }) => execution === "tool-broker")
        .every(({ brokerWired }) => brokerWired === true),
    ).toBe(true);
    expect(
      rows.filter(({ execution }) => execution === "ledger-control"),
    ).toHaveLength(2);
    expect(
      rows.filter(({ execution }) => execution === "legacy-disabled"),
    ).toHaveLength(59);
    expect(
      rows.filter(({ execution }) => execution === "human-admin-direct"),
    ).toHaveLength(17);
    expect(
      rows.filter(({ execution }) => execution === "discovery-only"),
    ).toHaveLength(MCP_DISCOVERY_ONLY_TOOL_IDS.length);
  });

  test("classifies every directly declared oRPC procedure", () => {
    const rows = inventoryOrpc(root);
    // 494 pre-existing paths + 20 reviewed capability control-plane paths.
    // The old leaf-name-only inventory counted 471 pre-existing paths: it
    // collapsed 23 nested procedures (and would collapse four new `list`s).
    // Any future router change must trigger a fresh agent-exposure review.
    expect(rows).toHaveLength(514);
    expect(
      new Set(rows.map((row) => `${row.source}:${row.procedure}`)).size,
    ).toBe(rows.length);
    const serviceKeyRows = rows.filter((row) =>
      row.source.endsWith("service-keys.ts"),
    );
    expect(serviceKeyRows.length).toBeGreaterThan(0);
    expect(
      serviceKeyRows.every(
        (row) => row.classification === "never-expose-to-agent",
      ),
    ).toBe(true);
    for (const [procedure, classification] of [
      ["mediaStudio.capabilities", "safe-after-output-narrowing"],
      ["mediaStudio.videoExtractionConsent", "safe-after-output-narrowing"],
      ["mediaStudio.retryVideoAudio", "requires-preview-or-compensation"],
      ["mediaStudio.listWorkflows", "safe-after-output-narrowing"],
      ["mediaStudio.listRevisions", "safe-after-output-narrowing"],
      ["mediaStudio.getOutputHandles", "safe-after-output-narrowing"],
      ["projects.retrievalPolicy", "safe-after-output-narrowing"],
      ["projects.setRetrievalPolicy", "requires-preview-or-compensation"],
      ["projects.setItemContextMode", "requires-preview-or-compensation"],
    ] as const) {
      expect(rows).toContainEqual({
        procedure,
        source: procedure.startsWith("projects.")
          ? "apps/server/src/routers/projects.ts"
          : "apps/server/src/routers/media-studio.ts",
        classification,
        fileTransport: "none",
      });
    }
  });

  test("retains nested procedure identity without leaking handler object ancestry", () => {
    expect(
      directlyDeclaredOrpcPaths(
        `
export const exampleRouter = {
  connections: {
    list: protectedProcedure.handler(() => ({
      metadata: {
        private: true,
      },
    })),
    create: protectedProcedure.handler(() => null),
  },
  operations: {
    list: protectedProcedure.handler(() => []),
    audit: {
      list: adminProcedure.handler(() => []),
    },
  },
  status: publicProcedure.handler(() => null),
};
`,
        "example",
      ),
    ).toEqual([
      "example.connections.list",
      "example.connections.create",
      "example.operations.list",
      "example.operations.audit.list",
      "example.status",
    ]);
  });

  test("explicitly reviews every capability control-plane procedure, including non-read probes", () => {
    const rows = inventoryOrpc(root).filter(({ source }) =>
      source.endsWith("/capabilities.ts"),
    );
    const reviewed = [
      ["capabilities.catalogue", "safe-after-output-narrowing"],
      ["capabilities.readiness", "safe-after-output-narrowing"],
      ["capabilities.connections.list", "safe-after-output-narrowing"],
      ["capabilities.connections.create", "human-or-admin-only"],
      ["capabilities.connections.update", "human-or-admin-only"],
      ["capabilities.connections.validate", "human-or-admin-only"],
      ["capabilities.connections.discover", "human-or-admin-only"],
      ["capabilities.connections.disable", "human-or-admin-only"],
      ["capabilities.connections.delete", "human-or-admin-only"],
      ["capabilities.offerings.list", "safe-after-output-narrowing"],
      ["capabilities.policies.list", "safe-after-output-narrowing"],
      ["capabilities.policies.upsert", "human-or-admin-only"],
      ["capabilities.consents.list", "safe-after-output-narrowing"],
      ["capabilities.consents.grant", "human-or-admin-only"],
      ["capabilities.consents.revoke", "human-or-admin-only"],
      ["capabilities.operations.list", "safe-after-output-narrowing"],
      ["capabilities.operations.detail", "safe-after-output-narrowing"],
      ["capabilities.operations.cancel", "requires-preview-or-compensation"],
      ["capabilities.usage.summary", "safe-after-output-narrowing"],
      [
        "capabilities.diagnostics.shadowMismatches",
        "safe-after-output-narrowing",
      ],
    ] as const;
    expect(rows).toEqual(
      reviewed
        .map(([procedure, classification]) => ({
          procedure,
          source: "apps/server/src/routers/capabilities.ts",
          classification,
          fileTransport: "none" as const,
        }))
        .sort((left, right) => left.procedure.localeCompare(right.procedure)),
    );
    expect(Object.keys(capabilityControlPlaneExposureReview).sort()).toEqual(
      reviewed.map(([procedure]) => procedure).sort(),
    );
    for (const review of Object.values(capabilityControlPlaneExposureReview)) {
      expect(review.rationale.length).toBeGreaterThan(40);
    }
  });

  test("renders a deterministic review report", () => {
    const first = renderCatalogueAudit(root);
    expect(renderCatalogueAudit(root)).toBe(first);
    expect(first).toContain(
      `Inventory fingerprint: MCP=${inventoryMcp(root).length}`,
    );
    expect(first).toContain("Authentication/ownership is not agent approval");
    expect(first).toContain("model output is never user consent");
  });

  test("the MCP broker manifest exactly matches first-party descriptors", async () => {
    process.env.DATABASE_URL ||= "file::memory:";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET ||=
      "catalogue-audit-secret-that-is-at-least-32-characters";
    process.env.CLIENT_URL ||= "http://localhost:3001";
    process.env.NODE_ENV = "test";
    process.env.DISABLE_EMAIL = "true";
    process.env.DISABLE_UPLOADS = "true";
    process.env.DISABLE_JOBS = "true";
    const { firstPartyToolDescriptors } = await import("./first-party");
    const descriptors = firstPartyToolDescriptors({} as Api);
    const reads = descriptors
      .filter(({ effect }) => effect === "read")
      .map(({ id }) => id)
      .sort();
    const mutations = descriptors
      .filter(({ effect }) => effect !== "read")
      .map(({ id }) => id)
      .sort();

    expect(reads).toEqual([...BROKERED_MCP_READ_TOOL_IDS].sort());
    expect(mutations).toEqual([...BROKERED_MCP_MUTATION_TOOL_IDS].sort());

    // Audit labels never grant access. These owner-facing APIs must not become
    // agent tools merely because the oRPC router is authenticated. Guard the
    // effective descriptor registry AND all MCP registrations/grant manifests.
    const registry = new ToolRegistry(descriptors);
    const exposedIds = [
      ...descriptors.map(({ id }) => id),
      ...inventoryMcp(root).map(({ name }) => name),
      ...BROKERED_MCP_READ_TOOL_IDS,
      ...BROKERED_MCP_MUTATION_TOOL_IDS,
      ...MCP_DISCOVERY_ONLY_TOOL_IDS,
    ];
    expect(exposedIds.filter((id) => id.startsWith("capabilities."))).toEqual(
      [],
    );
    for (const procedure of Object.keys(capabilityControlPlaneExposureReview)) {
      expect(registry.resolve(procedure, 1)).toBeNull();
    }
  });
});
