import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import type { CapabilityArtifactIo } from "./artifact-io";
import { CapabilityConnectionStore } from "./connection-store";
import { CapabilityConsentStore } from "./consent-store";
import { CapabilityExecutor } from "./executor";
import { CapabilityHealthService } from "./health-service";
import { CapabilityOfferingStore } from "./offering-store";
import { CapabilityOperationStore } from "./operation-store";
import {
  ProviderPluginRegistry,
  staticProviderPluginRegistry,
} from "./plugin-registry";
import { CapabilityPolicyResolver } from "./policy-resolver";
import { CapabilityPolicyStore } from "./policy-store";
import { createWorkflowProviderPluginFactories } from "./providers/plugins";
import { CapabilityRegistryInvoker } from "./registry-invoker";
import { CapabilityRoutePlanner } from "./route-planner";
import { capabilitySystemConstraints } from "./system-policy";

const migration = readFileSync(
  join(import.meta.dir, "../../drizzle/0069_capability_control_plane.sql"),
  "utf8",
);
const openClients: Array<{ client: Client; path: string }> = [];

afterEach(() => {
  for (const { client, path } of openClients.splice(0)) {
    client.close();
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Windows can retain the SQLite handle briefly after close.
      }
    }
  }
});

function syntheticPdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function nativeFixture() {
  const path = join(
    tmpdir(),
    `avermate-health-policy-${crypto.randomUUID()}.db`,
  );
  const client = createClient({ url: `file:${path}` });
  openClients.push({ client, path });
  await client.executeMultiple(migration);
  let now = new Date("2026-08-28T10:00:00.000Z");
  const clock = () => now;
  const ownerId = "scope-health-owner";
  const bytes = syntheticPdf("Native health fixture");
  let probes = 0;
  let healthy = true;
  const artifacts: CapabilityArtifactIo = {
    async read() {
      return new Uint8Array(bytes);
    },
    async write() {
      throw new Error("not used");
    },
  };
  const registry = new ProviderPluginRegistry();
  const reviewed = staticProviderPluginRegistry.require(
    "avermate.native-document",
  );
  const factory = createWorkflowProviderPluginFactories({ artifacts })[
    "avermate.native-document"
  ]!;
  registry.register({
    ...reviewed,
    instantiate() {
      const plugin = factory();
      return {
        manifest: plugin.manifest,
        discoverOfferings: plugin.discoverOfferings.bind(plugin),
        createAdapter: plugin.createAdapter.bind(plugin),
        async validateConnection(context, config) {
          probes += 1;
          expect(context.signal).toBeInstanceOf(AbortSignal);
          return healthy
            ? plugin.validateConnection(context, config)
            : {
                valid: false as const,
                error: {
                  version: 1 as const,
                  code: "PROVIDER_UNAVAILABLE" as const,
                  message: "Probe failed",
                  retryable: true,
                  ambiguous: false,
                  providerRequestId: null,
                  safeDiagnostic: null,
                },
              };
        },
      };
    },
  });
  const connections = new CapabilityConnectionStore(client, registry, clock);
  const offerings = new CapabilityOfferingStore(client);
  const consents = new CapabilityConsentStore(client, clock);
  const health = new CapabilityHealthService(client, clock);
  const operations = new CapabilityOperationStore(client, clock);
  const policies = new CapabilityPolicyStore(client, clock);
  const dependencies = {
    connections,
    offerings,
    consents,
    health,
    operations,
    policies,
    registry,
  };
  const invoker = new CapabilityRegistryInvoker({
    ...dependencies,
    executor: new CapabilityExecutor({ ...dependencies, clock }),
    routePlanner: new CapabilityRoutePlanner(clock),
  });
  const input = {
    ownerId,
    capability: "document.extract" as const,
    purpose: "corpus.document-extraction",
  };
  return {
    ...dependencies,
    invoker,
    input,
    client,
    probes: () => probes,
    expire() {
      now = new Date(now.getTime() + 6 * 60_000);
    },
    failProbe() {
      healthy = false;
    },
  };
}

describe("registry policy scope and health lifecycle", () => {
  test("refreshes expired health once, leaves shadow read-only, and blocks a failed required probe", async () => {
    const fixture = await nativeFixture();
    await fixture.policies.upsert({
      ownerId: fixture.input.ownerId,
      expectedRevision: null,
      scope: { kind: "user", id: fixture.input.ownerId },
      capability: fixture.input.capability,
      purposePattern: "*",
      mode: "automatic",
      primaryOfferingId: null,
      fallbackOfferingIds: [],
      constraints: { ...capabilitySystemConstraints, requireHealthy: true },
    });
    const first = await fixture.invoker.prepare({
      ...fixture.input,
      refreshOfferings: true,
    });
    expect(fixture.probes()).toBe(1);
    await expect(
      fixture.invoker.resolve({
        ...fixture.input,
        route: {
          offeringId: "another-offering",
          provider: first.offering.provider,
          modelId: first.offering.modelId,
          modelRevision: first.offering.modelRevision,
        },
      }),
    ).rejects.toMatchObject({ code: "NO_COMPATIBLE_OFFERING" });
    await fixture.invoker.prepare({ ...fixture.input, refreshOfferings: true });
    expect(fixture.probes()).toBe(1);
    fixture.expire();
    expect(
      (await fixture.health.get(fixture.input.ownerId, first.offering.id))
        ?.state,
    ).toBe("unknown");
    expect(await fixture.invoker.isConfigured(fixture.input)).toBe(true);
    await expect(fixture.invoker.resolve(fixture.input)).rejects.toMatchObject({
      code: "NO_COMPATIBLE_OFFERING",
    });
    expect(fixture.probes()).toBe(1);
    await fixture.invoker.prepare({ ...fixture.input, refreshOfferings: true });
    expect(fixture.probes()).toBe(2);
    fixture.expire();
    fixture.failProbe();
    await expect(
      fixture.invoker.prepare({ ...fixture.input, refreshOfferings: true }),
    ).rejects.toMatchObject({ code: "NO_COMPATIBLE_OFFERING" });
    expect(fixture.probes()).toBe(3);
    expect(
      (await fixture.health.get(fixture.input.ownerId, first.offering.id))
        ?.state,
    ).toBe("degraded");
    expect(await fixture.invoker.isConfigured(fixture.input)).toBe(false);
  });

  test("applies project and workflow policies only to the authoritative matching scope", async () => {
    const fixture = await nativeFixture();
    await fixture.invoker.prepare({ ...fixture.input, refreshOfferings: true });
    const putDisabled = (kind: "project" | "workflow", id: string) =>
      fixture.policies.upsert({
        ownerId: fixture.input.ownerId,
        expectedRevision: null,
        scope: { kind, id },
        capability: fixture.input.capability,
        purposePattern: "*",
        mode: "disabled",
        primaryOfferingId: null,
        fallbackOfferingIds: [],
        constraints: capabilitySystemConstraints,
      });
    await putDisabled("project", "project-private");
    await expect(
      fixture.invoker.resolve({
        ...fixture.input,
        projectId: "project-private",
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    await expect(
      fixture.invoker.resolve({ ...fixture.input, projectId: "project-other" }),
    ).resolves.toMatchObject({ offeringId: expect.any(String) });
    await putDisabled("workflow", "special-import");
    await expect(
      fixture.invoker.resolve({
        ...fixture.input,
        workflowId: "special-import",
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DISABLED" });
    await expect(fixture.invoker.resolve(fixture.input)).resolves.toMatchObject(
      { offeringId: expect.any(String) },
    );
    await putDisabled("workflow", fixture.input.purpose);
    await expect(fixture.invoker.resolve(fixture.input)).rejects.toMatchObject({
      code: "CAPABILITY_DISABLED",
    });
  });
});

describe("CapabilityRegistryInvoker native bootstrap", () => {
  test("extracts a PDF in registry mode without public connection setup", async () => {
    const path = join(
      tmpdir(),
      `avermate-native-capability-${process.pid}-${crypto.randomUUID()}.db`,
    );
    const client = createClient({ url: `file:${path}` });
    openClients.push({ client, path });
    await client.execute("PRAGMA foreign_keys = ON");
    await client.executeMultiple(migration);
    const ownerId = "owner-native-document";
    const bytes = syntheticPdf("Pythagore registry native");
    const digest = `sha256:${createHash("sha256")
      .update(bytes)
      .digest("hex")}` as const;
    let reads = 0;
    const artifacts: CapabilityArtifactIo = {
      async read(readOwnerId, source) {
        reads += 1;
        expect(readOwnerId).toBe(ownerId);
        expect(source.digest).toBe(digest);
        return bytes;
      },
      async write() {
        throw new Error("native extraction does not publish a new artifact");
      },
    };
    const registry = new ProviderPluginRegistry();
    const reviewed = staticProviderPluginRegistry.require(
      "avermate.native-document",
    );
    registry.register({
      ...reviewed,
      instantiate: createWorkflowProviderPluginFactories({ artifacts })[
        "avermate.native-document"
      ]!,
    });
    const clock = () => new Date("2026-08-28T10:00:00.000Z");
    const connections = new CapabilityConnectionStore(client, registry, clock);
    const offerings = new CapabilityOfferingStore(client);
    const consents = new CapabilityConsentStore(client, clock);
    const health = new CapabilityHealthService(client, clock);
    const operations = new CapabilityOperationStore(client, clock);
    const policies = new CapabilityPolicyStore(client, clock);
    const executor = new CapabilityExecutor({
      connections,
      consents,
      health,
      offerings,
      operations,
      policies,
      registry,
      clock,
    });
    const invoker = new CapabilityRegistryInvoker({
      connections,
      consents,
      executor,
      health,
      offerings,
      operations,
      policies,
      policyResolver: new CapabilityPolicyResolver(),
      registry,
      routePlanner: new CapabilityRoutePlanner(clock),
    });
    expect(await connections.list(ownerId)).toEqual([]);

    const result = await invoker.invoke({
      ownerId,
      capability: "document.extract",
      purpose: "corpus.document-extraction",
      request: {
        schemaVersion: 1,
        source: {
          object: { ownerId, namespace: "files", key: "source-pdf" },
          digest,
          byteSize: bytes.byteLength,
          mimeType: "application/pdf",
        },
        mimeType: "application/pdf",
        maximumBytes: bytes.byteLength,
      },
      idempotencyKey: "native-extraction-without-setup",
      requirements: {
        requiredFeatures: ["deterministic", "source-locators"],
        inputBytes: bytes.byteLength,
        batchSize: 1,
      },
    });

    expect(reads).toBe(1);
    expect(result.document.sections).toEqual([
      {
        headingPath: [],
        markdown: "Pythagore registry native",
        sourceLocator: { kind: "page", value: "1" },
      },
    ]);
    expect(result.extractionPath).toEqual([
      {
        stage: "pdf-text-layer",
        implementation: "avermate-native-pdf",
        revision: "unpdf-text-layer/1",
      },
    ]);
    const [internal] = await connections.list(ownerId);
    expect(internal).toMatchObject({
      connection: {
        pluginId: "avermate.native-document",
        status: "ready",
        placement: { kind: "core", instanceId: "core-default" },
      },
      credentialSlots: [],
    });
    const operationCount = await client.execute({
      sql: `SELECT COUNT(*) AS count FROM capability_operations
        WHERE ownerId = ? AND capabilityKind = 'document.extract'`,
      args: [ownerId],
    });
    const attemptCount = await client.execute({
      sql: `SELECT COUNT(*) AS count FROM capability_attempts attempt
        JOIN capability_operations operation ON operation.id = attempt.operationId
        WHERE operation.ownerId = ? AND operation.capabilityKind = 'document.extract'`,
      args: [ownerId],
    });
    expect(Number(operationCount.rows[0]?.count)).toBe(1);
    expect(Number(attemptCount.rows[0]?.count)).toBe(1);
  });
});
