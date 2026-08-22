import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
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
    // Advanced media ingestion adds five reviewed reads and one reviewed
    // mutation. Keep their individual classifications explicit below.
    // Keep this fingerprint explicit so every future router change requires a
    // fresh agent-exposure review rather than silently widening the surface.
    expect(rows).toHaveLength(468);
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
    ] as const) {
      expect(rows).toContainEqual({
        procedure,
        source: "apps/server/src/routers/media-studio.ts",
        classification,
        fileTransport: "none",
      });
    }
  });

  test("renders a deterministic review report", () => {
    const first = renderCatalogueAudit(root);
    expect(renderCatalogueAudit(root)).toBe(first);
    expect(first).toContain(
      `Inventory fingerprint: MCP=${inventoryMcp(root).length}`,
    );
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
  });
});
