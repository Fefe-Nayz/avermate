import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { managedReadiness } from "./readiness";

describe.serial("side-effect-free readiness", () => {
  test("reports the complete managed schema without calling a costly adapter", async () => {
    const client = await createManagedTestDatabase();
    try {
      expect(
        await managedReadiness(client, {
          deploymentMode: "hosted",
          accountingMode: "shadow",
          managedAdaptersEnabled: true,
        }),
      ).toMatchObject({
        ready: true,
        checks: { database: "ready", managedSchema: "ready" },
        mode: {
          billingEnabled: false,
          checkoutEnabled: false,
          telemetryExporter: "none",
        },
      });
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("fails closed when managed adapters are enabled without their schema", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      const result = await managedReadiness(client, {
        managedAdaptersEnabled: true,
      });
      expect(result.ready).toBe(false);
      expect(result.checks.managedSchema).toBe("missing");
      expect(result.checks.missingManagedTables).toContain("usage_events");
    } finally {
      client.close();
    }
  });

  test("keeps full self-host ready when optional managed components are absent", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      expect(
        await managedReadiness(client, {
          deploymentMode: "full-self-host",
          accountingMode: "shadow",
          managedAdaptersEnabled: false,
        }),
      ).toMatchObject({ ready: true, mode: { managedAdaptersEnabled: false } });
    } finally {
      client.close();
    }
  });
});
