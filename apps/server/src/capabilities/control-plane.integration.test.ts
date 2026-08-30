import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import type {
  CapabilityArtifactRef,
  CapabilityPolicyConstraints,
} from "@avermate/agent-contracts";
import type { CapabilityArtifactIo } from "./artifact-io";
import { CapabilityConnectionStore } from "./connection-store";
import { CapabilityConsentStore } from "./consent-store";
import { CapabilityExecutionError, normalizeCapabilityError } from "./errors";
import { CapabilityExecutor } from "./executor";
import { CapabilityHealthService } from "./health-service";
import { capabilityOfferingIdentity, CapabilityOfferingStore } from "./offering-store";
import { CapabilityOperationStore } from "./operation-store";
import {
  ProviderPluginRegistry,
  staticProviderPluginRegistry,
} from "./plugin-registry";
import { CapabilityPolicyResolver } from "./policy-resolver";
import { CapabilityPolicyStore } from "./policy-store";
import { createWorkflowProviderPluginFactories } from "./providers/plugins";
import type { SpeechProviderFetcher } from "./providers/speech-synthesis";
import { CapabilityRoutePlanner, CapabilityRoutePlannerError } from "./route-planner";
import { capabilityDigest } from "./values";

const migration = readFileSync(
  join(import.meta.dir, "../../drizzle/0069_capability_control_plane.sql"),
  "utf8",
);
const ownerId = "owner-capability-e2e";
const now = new Date("2026-08-28T10:00:00.000Z");
const openClients: Array<{ client: Client; path: string }> = [];

afterEach(() => {
  for (const { client, path } of openClients.splice(0)) {
    client.close();
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // Windows may retain the SQLite handle briefly after client.close().
        // The OS temp directory remains the only target; test correctness does
        // not depend on synchronous cleanup of that handle.
      }
    }
  }
});

function artifactIo(writes: Uint8Array[]): CapabilityArtifactIo {
  return {
    async read() {
      throw new Error("not used by TTS");
    },
    async write(input) {
      input.signal.throwIfAborted();
      writes.push(input.bytes);
      const digest = `sha256:${createHash("sha256")
        .update(input.bytes)
        .digest("hex")}` as const;
      return {
        object: {
          ownerId: input.ownerId,
          namespace: "files",
          key: `artifact-${writes.length}`,
        },
        digest,
        byteSize: input.bytes.byteLength,
        mimeType: input.mimeType,
      } satisfies CapabilityArtifactRef;
    },
  };
}

const constraints = (
  maximumDataEgress: CapabilityPolicyConstraints["maximumDataEgress"] =
    "external-provider",
  placement: CapabilityPolicyConstraints["allowedPlacements"][number] =
    "direct-byok",
): CapabilityPolicyConstraints => ({
  requiredFeatures: [],
  allowedPlacements: [placement],
  allowedProviders: ["mistral"],
  deniedProviders: [],
  maximumDataEgress,
  allowPrivacyEscalationOnFallback: false,
  maximumEstimatedCostMinor: null,
  preferredLatencyClass: "interactive",
  requireUserCredential: placement === "direct-byok",
  allowManagedCredential: placement === "managed",
  requireHealthy: false,
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(input: {
  fetch: SpeechProviderFetcher;
  maximumDataEgress?: CapabilityPolicyConstraints["maximumDataEgress"];
  managed?: boolean;
}) {
  const path = join(
    tmpdir(),
    `avermate-capability-${process.pid}-${crypto.randomUUID()}.db`,
  );
  const client = createClient({ url: `file:${path}` });
  openClients.push({ client, path });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.executeMultiple(migration);
  const clock = () => new Date(now);
  const writes: Uint8Array[] = [];
  const base = staticProviderPluginRegistry.require("avermate.mistral");
  const instantiate = createWorkflowProviderPluginFactories({
    artifacts: artifactIo(writes),
    mistralFetch: input.fetch,
  })["avermate.mistral"]!;
  const registry = new ProviderPluginRegistry();
  registry.register({ ...base, instantiate });
  const connections = new CapabilityConnectionStore(
    client,
    registry,
    clock,
    async () => undefined,
  );
  const offerings = new CapabilityOfferingStore(client, clock);
  const consents = new CapabilityConsentStore(client, clock);
  const policies = new CapabilityPolicyStore(client, clock);
  const operations = new CapabilityOperationStore(client, clock);
  const health = new CapabilityHealthService(client, clock);

  const draft = await connections.create({
    ownerId,
    pluginId: "avermate.mistral",
    displayName: "Mistral TTS",
    placement: { kind: "direct-byok", origin: "https://api.mistral.ai" },
    configVersion: 1,
    config: {},
    secrets: [{ slot: "apiKey", value: "mistral-secret-value" }],
  });
  let connection = await connections.markValidated({
    ownerId,
    connectionId: draft.connection.id,
    expectedRevision: draft.connection.revision,
    valid: true,
  });
  if (input.managed) {
    // Managed connections are operator-owned and intentionally absent from the
    // public write API. Seed the operator placement at the SQL boundary so this
    // test covers future managed bootstraps without weakening that API fence.
    await client.execute({
      sql: `UPDATE capability_provider_connections SET
        placementKind = 'managed', placementRef = 'fixture-pool',
        placementJson = ? WHERE id = ? AND ownerId = ?`,
      args: [
        JSON.stringify({
          kind: "managed",
          pool: "fixture-pool",
          region: "eu-west",
        }),
        draft.connection.id,
        ownerId,
      ],
    });
    const managedConnection = await connections.get(ownerId, draft.connection.id);
    if (!managedConnection) throw new Error("Managed fixture connection missing");
    connection = managedConnection;
  }
  const plugin = instantiate();
  const discovered = await plugin.discoverOfferings(
    {
      ownerId,
      now,
      signal: new AbortController().signal,
      credential: async (slot) => {
        const metadata = connection.credentialSlots.find(
          (candidate) => candidate.slot === slot,
        );
        if (!metadata?.keyVersion) return null;
        return connections.leaseSecret({
          ownerId,
          connectionId: connection.connection.id,
          slot,
          expectedVersion: metadata.keyVersion,
        });
      },
    },
    connection.connection,
  );
  const speech = discovered.find(
    (offering) => offering.capability === "speech.synthesize",
  );
  if (!speech || speech.capability !== "speech.synthesize") {
    throw new Error("Mistral speech offering missing from fixture");
  }
  const offering = await offerings.register({
    ownerId,
    offering: speech,
    status: "ready",
  });
  const consent = await consents.grant({
    ownerId,
    connectionId: connection.connection.id,
    capability: "speech.synthesize",
    disclosureRevision: offering.dataHandling.disclosureRevision,
    expectedRevision: null,
  });
  const policy = await policies.upsert({
    ownerId,
    expectedRevision: null,
    scope: { kind: "user", id: ownerId },
    capability: "speech.synthesize",
    purposePattern: "media.podcast-narration",
    mode: "pinned",
    primaryOfferingId: offering.id,
    fallbackOfferingIds: [],
    constraints: constraints(
      input.maximumDataEgress,
      input.managed ? "managed" : "direct-byok",
    ),
  });
  const resolved = new CapabilityPolicyResolver().resolve({
    context: { ownerId },
    capability: "speech.synthesize",
    purpose: "media.podcast-narration",
    policies: [policy],
    systemConstraints: constraints(
      input.maximumDataEgress,
      input.managed ? "managed" : "direct-byok",
    ),
  });
  const request = {
    schemaVersion: 1 as const,
    text: "Bonjour, voici votre cours.",
    voice: { mode: "exact" as const, voiceId: "default" },
    output: { container: "mp3" as const },
    alignment: "none" as const,
  };
  const reserved = await operations.reserve({
    ownerId,
    capability: "speech.synthesize",
    purpose: "media.podcast-narration",
    inputDigest: capabilityDigest(request),
    idempotencyKey: "tts-e2e-idempotency",
    policySnapshot: resolved,
  });
  const plan = await new CapabilityRoutePlanner(clock).plan({
    operationId: reserved.operation.id,
    ownerId,
    policy: resolved,
    offerings: [offering],
    requirements: { voiceMode: "exact" },
    credentialReadiness: async () => ({
      ready: true,
      source: "user",
      slots: connection.credentialSlots.flatMap((slot) =>
        slot.status === "active" && slot.keyVersion
          ? [{ slot: slot.slot, expectedVersion: slot.keyVersion }]
          : [],
      ),
    }),
    consentReadiness: async () => ({
      ready: true,
      grants: [{ id: consent.id, expectedRevision: consent.revision }],
    }),
    health: async () => ({ state: "unknown", latencyP50Ms: null }),
  });
  const ready = await operations.freezeRoute({
    ownerId,
    operationId: reserved.operation.id,
    expectedRevision: reserved.operation.revision,
    routePlan: plan,
  });
  const policyEpoch = { value: resolved.systemPolicyEpoch };
  const executor = new CapabilityExecutor({
    operations,
    offerings,
    connections,
    consents,
    health,
    policies,
    registry,
    clock,
    systemPolicyEpoch: () => policyEpoch.value,
  });
  return {
    client,
    writes,
    connections,
    offerings,
    consents,
    policies,
    policy,
    policyEpoch,
    operations,
    connection,
    consent,
    offering,
    request,
    resolved,
    plan,
    ready,
    executor,
  };
}

async function execute(current: Fixture, options: { deadline?: Date; signal?: AbortSignal } = {}) {
  return current.executor.execute<"speech.synthesize">({
    ownerId,
    operationId: current.ready.id,
    expectedRevision: current.ready.revision,
    routePlan: current.plan,
    request: current.request,
    deadline: options.deadline ?? new Date(now.getTime() + 60_000),
    signal: options.signal,
  });
}

describe("capability control-plane policy to real plugin", () => {
  test("successful revalidation preserves a ready connection's pinned offerings and frozen route", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    const refreshed = await current.connections.markValidated({
      ownerId,
      connectionId: current.connection.connection.id,
      expectedRevision: current.connection.connection.revision,
      valid: true,
    });
    expect(refreshed.connection.revision).toBe(current.connection.connection.revision);
    expect(await current.offerings.list({ ownerId, statuses: ["ready"] })).toEqual([
      current.offering,
    ]);
    await execute(current);
    expect(current.writes).toHaveLength(1);
  });

  test("configuration changes atomically retire old offerings while preserving historical descriptors", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    const updated = await current.connections.update({
      ownerId,
      connectionId: current.connection.connection.id,
      expectedRevision: current.connection.connection.revision,
      secrets: [{ slot: "apiKey", value: "replacement-key" }],
    });
    expect(updated.connection.status).toBe("draft");
    expect(await current.offerings.list({ ownerId })).toEqual([]);
    expect(await current.offerings.get(ownerId, current.offering.id)).toEqual(current.offering);
    expect((await current.client.execute({
      sql: "SELECT status, retiredAt FROM capability_offerings WHERE id = ?",
      args: [current.offering.id],
    })).rows[0]).toMatchObject({ status: "retired", retiredAt: Math.floor(now.getTime() / 1_000) });
    expect(await current.offerings.setStatus({ ownerId, offeringId: current.offering.id, status: "ready" })).toBe(false);
    await expect(current.offerings.register({ ownerId, offering: current.offering, status: "ready" }))
      .rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect((await current.operations.detail(ownerId, current.ready.id))?.operation.id).toBe(current.ready.id);
  });

  test("failed validation and disable require new discovery after re-enabling", async () => {
    for (const action of ["invalidate", "disable"] as const) {
      const current = await fixture({
        fetch: async () => Response.json({ audio_data: "AQID" }),
      });
      const revisionInput = {
        ownerId,
        connectionId: current.connection.connection.id,
        expectedRevision: current.connection.connection.revision,
      };
      const stopped = action === "disable"
        ? await current.connections.disable(revisionInput)
        : await current.connections.markValidated({ ...revisionInput, valid: false });
      expect(stopped.connection.revision).toBe(revisionInput.expectedRevision + 1);
      expect(await current.offerings.list({ ownerId })).toEqual([]);
      const enabled = await current.connections.markValidated({
        ...revisionInput,
        expectedRevision: stopped.connection.revision,
        valid: true,
      });
      expect(await current.offerings.list({ ownerId })).toEqual([]);
      const descriptor = { ...current.offering, connectionRevision: enabled.connection.revision };
      const fresh = { ...descriptor, id: capabilityOfferingIdentity(descriptor) };
      await current.offerings.register({ ownerId, offering: fresh, status: "ready" });
      expect(fresh.id).not.toBe(current.offering.id);
      expect(await current.offerings.list({ ownerId })).toEqual([fresh]);
      expect(await current.offerings.get(ownerId, current.offering.id)).toEqual(current.offering);
    }
  });

  test("listing fences stale revisions and expiry even when an old row still says ready", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    await current.offerings.register({ ownerId, offering: current.offering, status: "ready", expiresAt: now });
    expect(await current.offerings.list({ ownerId })).toEqual([]);
    expect(await current.offerings.get(ownerId, current.offering.id)).toEqual(current.offering);
    await expect(current.consents.grant({
      ownerId,
      connectionId: current.offering.connectionId,
      capability: current.offering.capability,
      disclosureRevision: current.offering.dataHandling.disclosureRevision,
      expectedRevision: current.consent.revision,
    })).rejects.toMatchObject({ code: "DISCLOSURE_NOT_PUBLISHED" });
    await current.offerings.register({
      ownerId,
      offering: current.offering,
      status: "ready",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(await current.offerings.list({ ownerId })).toEqual([current.offering]);
    await current.client.execute({
      sql: "UPDATE capability_provider_connections SET revision = revision + 1 WHERE id = ?",
      args: [current.connection.connection.id],
    });
    expect(await current.offerings.list({ ownerId, statuses: ["ready"] })).toEqual([]);
    expect(await current.offerings.get(ownerId, current.offering.id)).toEqual(current.offering);
  });

  test("discovery cannot register against a connection revision that changes after the ownership read", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    let rotated = false;
    const racingStore = new CapabilityOfferingStore({
      execute: async (statement) => {
        const result = await current.client.execute(statement);
        if (!rotated && typeof statement === "object" && statement.sql.includes("SELECT revision, pluginId")) {
          rotated = true;
          await current.connections.update({
            ownerId,
            connectionId: current.connection.connection.id,
            expectedRevision: current.connection.connection.revision,
            displayName: "Changed during discovery",
          });
        }
        return result;
      },
    }, () => new Date(now));
    await expect(racingStore.register({ ownerId, offering: current.offering, status: "ready" }))
      .rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(await current.offerings.list({ ownerId })).toEqual([]);
    expect((await current.client.execute({
      sql: "SELECT status FROM capability_offerings WHERE id = ?",
      args: [current.offering.id],
    })).rows[0]).toMatchObject({ status: "retired" });
  });

  test("rolls back connection and credential edits if offering retirement fails", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    await current.client.execute(`CREATE TRIGGER reject_offering_retirement
      BEFORE UPDATE OF status ON capability_offerings
      BEGIN SELECT RAISE(ABORT, 'test retirement failure'); END`);
    await expect(current.connections.update({
      ownerId,
      connectionId: current.connection.connection.id,
      expectedRevision: current.connection.connection.revision,
      secrets: [{ slot: "apiKey", value: "must-not-persist" }],
    })).rejects.toThrow("test retirement failure");
    expect(await current.connections.get(ownerId, current.connection.connection.id)).toEqual(current.connection);
    expect(await current.offerings.list({ ownerId })).toEqual([current.offering]);
  });

  test("offering access rejects foreign accounts and instance ownership with a colliding owner id", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    expect(await current.offerings.list({ ownerId: "foreign-owner" })).toEqual([]);
    expect(await current.offerings.get("foreign-owner", current.offering.id)).toBeNull();
    expect(await current.offerings.setStatus({ ownerId: "foreign-owner", offeringId: current.offering.id, status: "retired" })).toBe(false);
    await current.client.execute({
      sql: "UPDATE capability_provider_connections SET ownerKind = 'instance' WHERE id = ?",
      args: [current.connection.connection.id],
    });
    expect(await current.offerings.list({ ownerId })).toEqual([]);
    expect(await current.offerings.get(ownerId, current.offering.id)).toBeNull();
    await expect(current.offerings.register({ ownerId, offering: current.offering }))
      .rejects.toMatchObject({ code: "OWNER_MISMATCH" });
    await expect(current.consents.grant({
      ownerId,
      connectionId: current.offering.connectionId,
      capability: current.offering.capability,
      disclosureRevision: current.offering.dataHandling.disclosureRevision,
      expectedRevision: current.consent.revision,
    })).rejects.toMatchObject({ code: "DISCLOSURE_NOT_PUBLISHED" });
    await expect(current.policies.upsert({
      ...current.policy,
      ownerId,
      policyId: current.policy.id,
      expectedRevision: current.policy.revision,
    })).rejects.toMatchObject({ code: "OFFERING_MISMATCH" });
  });

  test("freezes policy, fences authority, invokes real Mistral adapter, and records result/usage", async () => {
    let calls = 0;
    const current = await fixture({
      fetch: async (_url, init) => {
        calls += 1;
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer mistral-secret-value",
        );
        return Response.json(
          {
            audio_data: Buffer.from([1, 2, 3, 4]).toString("base64"),
          },
          { headers: { "x-request-id": "mistral-request-1" } },
        );
      },
    });
    const result = await execute(current);
    expect(calls).toBe(1);
    expect(JSON.stringify(await current.connections.list(ownerId))).not.toContain(
      "mistral-secret-value",
    );
    expect(result.audio.object).toMatchObject({ ownerId, key: "artifact-1" });
    expect(current.writes).toHaveLength(1);
    const detail = await current.operations.detail(ownerId, current.ready.id);
    expect(detail).toMatchObject({
      operation: { state: "completed", hasResult: true, safeErrorCode: null },
      attempts: [
        {
          state: "completed",
          ordinal: 0,
          providerRequestId: "mistral-request-1",
        },
      ],
      usage: [
        {
          usage: {
            items: [{ unit: "character", source: "measured" }],
          },
        },
      ],
    });

    const replay = await current.operations.reserve({
      ownerId,
      capability: "speech.synthesize",
      purpose: "media.podcast-narration",
      inputDigest: capabilityDigest(current.request),
      idempotencyKey: "tts-e2e-idempotency",
      policySnapshot: current.resolved,
    });
    expect(replay.replayed).toBe(true);
    expect(
      await current.operations.getResult(
        ownerId,
        replay.operation.id,
        "speech.synthesize",
      ),
    ).toEqual(result);
    expect(calls).toBe(1);
  });

  test("enforces CAS/digests/FKs while soft-delete preserves operation history", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    await execute(current);
    await expect(
      current.connections.update({
        ownerId,
        connectionId: current.connection.connection.id,
        expectedRevision: current.connection.connection.revision - 1,
        displayName: "stale update",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      current.client.execute({
        sql: `UPDATE capability_provider_connections SET configDigest = ?
          WHERE id = ?`,
        args: [
          `sha256:${"g".repeat(64)}`,
          current.connection.connection.id,
        ],
      }),
    ).rejects.toThrow();
    await expect(
      current.client.execute({
        sql: "DELETE FROM capability_provider_connections WHERE id = ?",
        args: [current.connection.connection.id],
      }),
    ).rejects.toThrow();
    await expect(
      current.connections.softDelete({
        ownerId,
        connectionId: current.connection.connection.id,
        expectedRevision: current.connection.connection.revision,
      }),
    ).resolves.toEqual({
      deleted: true,
      revision: current.connection.connection.revision + 1,
    });
    expect(await current.connections.list(ownerId)).toEqual([]);
    expect(
      await current.connections.leaseSecret({
        ownerId,
        connectionId: current.connection.connection.id,
        slot: "apiKey",
        expectedVersion: 1,
      }),
    ).toBeNull();
    expect(
      (
        await current.client.execute({
          sql: `SELECT status, sealedValue FROM capability_connection_secrets
            WHERE connectionId = ?`,
          args: [current.connection.connection.id],
        })
      ).rows[0],
    ).toMatchObject({ status: "revoked", sealedValue: expect.any(String) });
    expect(
      (
        await current.client.execute({
          sql: `SELECT status FROM capability_offerings WHERE connectionId = ?`,
          args: [current.connection.connection.id],
        })
      ).rows[0],
    ).toMatchObject({ status: "retired" });
    expect(await current.operations.detail(ownerId, current.ready.id)).toMatchObject({
      operation: { state: "completed", hasResult: true },
      attempts: [{ state: "completed", offeringId: current.offering.id }],
      usage: [{ usage: { items: [{ unit: "character" }] } }],
    });
  });

  test("rejects operator placements and private SaaS-compatible endpoints for user writes", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    for (const placement of [
      { kind: "core" as const, instanceId: "core-1" },
      { kind: "managed" as const, pool: "pool-1", region: "eu-west" },
      { kind: "full-self-host" as const, instanceId: "self-host-1" },
    ]) {
      await expect(
        current.connections.create({
          ownerId,
          pluginId: "avermate.mistral",
          displayName: "unauthorized operator placement",
          placement,
          configVersion: 1,
          config: {},
          secrets: [{ slot: "apiKey", value: "never-persisted" }],
        }),
      ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
    }

    const strictConnections = new CapabilityConnectionStore(
      current.client,
      staticProviderPluginRegistry,
      () => new Date(now),
    );
    await expect(
      strictConnections.create({
        ownerId,
        pluginId: "avermate.openai-compatible",
        displayName: "private endpoint",
        placement: { kind: "direct-byok", origin: "https://127.0.0.1" },
        configVersion: 1,
        config: { origin: "https://127.0.0.1", modelId: "private-model" },
        secrets: [{ slot: "apiKey", value: "never-persisted" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  test("fails closed before provider dispatch when a managed route has no reservation broker", async () => {
    let calls = 0;
    const current = await fixture({
      managed: true,
      fetch: async () => {
        calls += 1;
        return Response.json({ audio_data: "AQID" });
      },
    });

    expect(current.plan.primary.placement.kind).toBe("managed");
    await expect(execute(current)).rejects.toMatchObject({
      capabilityError: { code: "CAPABILITY_UNAVAILABLE", ambiguous: false },
    });
    expect(calls).toBe(0);
    expect(current.writes).toHaveLength(0);
  });

  test("fails closed when a frozen credential/connection revision rotates", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    await current.connections.update({
      ownerId,
      connectionId: current.connection.connection.id,
      expectedRevision: current.connection.connection.revision,
      secrets: [{ slot: "apiKey", value: "rotated-secret-value" }],
    });
    await expect(execute(current)).rejects.toMatchObject({
      capabilityError: { code: "CREDENTIAL_CHANGED" },
    });
    expect(current.writes).toHaveLength(0);
  });

  test("fails closed when consent is revoked after route freeze", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    await current.consents.revoke({
      ownerId,
      consentId: current.consent.id,
      expectedRevision: current.consent.revision,
    });
    await expect(execute(current)).rejects.toMatchObject({
      capabilityError: { code: "CONSENT_REQUIRED" },
    });
    expect(current.writes).toHaveLength(0);
  });

  test("fences applied policy revisions and the compiled system policy epoch", async () => {
    let calls = 0;
    const changedPolicy = await fixture({
      fetch: async () => {
        calls += 1;
        return Response.json({ audio_data: "AQID" });
      },
    });
    await changedPolicy.client.execute({
      sql: `UPDATE capability_policies SET revision = revision + 1
        WHERE id = ? AND ownerId = ?`,
      args: [changedPolicy.policy.id, ownerId],
    });
    await expect(execute(changedPolicy)).rejects.toMatchObject({
      capabilityError: { code: "POLICY_CHANGED" },
    });
    expect(calls).toBe(0);

    const changedSystem = await fixture({
      fetch: async () => {
        calls += 1;
        return Response.json({ audio_data: "AQID" });
      },
    });
    changedSystem.policyEpoch.value = capabilityDigest({ epoch: "next" });
    await expect(execute(changedSystem)).rejects.toMatchObject({
      capabilityError: { code: "POLICY_CHANGED" },
    });
    expect(calls).toBe(0);
  });

  test("honours owner-scoped cancellation before provider dispatch", async () => {
    let calls = 0;
    const current = await fixture({
      fetch: async () => {
        calls += 1;
        return Response.json({ audio_data: "AQID" });
      },
    });
    await current.operations.cancel({
      ownerId,
      operationId: current.ready.id,
      expectedRevision: current.ready.revision,
    });
    await expect(execute(current)).rejects.toMatchObject({
      capabilityError: { code: "POLICY_CHANGED" },
    });
    expect(calls).toBe(0);
    expect(current.writes).toHaveLength(0);
  });

  test("cancels the active attempt atomically with its operation", async () => {
    const current = await fixture({
      fetch: async () => Response.json({ audio_data: "AQID" }),
    });
    const attempt = await current.operations.beginAttempt({
      ownerId,
      operationId: current.ready.id,
      expectedOperationRevision: current.ready.revision,
      offeringId: current.offering.id,
      requestDigest: capabilityDigest(current.request),
      credentialVersion:
        current.plan.primary.credentialSlots[0]?.expectedVersion ?? null,
      consentRevision:
        current.plan.primary.consentGrants[0]?.expectedRevision ?? null,
    });
    const dispatching = await current.operations.get(ownerId, current.ready.id);

    await current.operations.cancel({
      ownerId,
      operationId: current.ready.id,
      expectedRevision: dispatching!.revision,
    });

    expect(await current.operations.detail(ownerId, current.ready.id)).toMatchObject({
      operation: { state: "cancelled", safeErrorCode: "CANCELLED" },
      attempts: [
        {
          id: attempt.id,
          state: "cancelled",
          errorClass: "CANCELLED",
          retryable: false,
          completedAt: expect.any(String),
        },
      ],
    });
  });

  test("classifies malformed and rate-limited provider responses deterministically", async () => {
    const malformed = await fixture({
      fetch: async () => Response.json({ audio_data: "not base64!" }),
    });
    await expect(execute(malformed)).rejects.toMatchObject({
      capabilityError: { code: "PROVIDER_MALFORMED_RESPONSE", ambiguous: false },
    });
    expect((await malformed.operations.get(ownerId, malformed.ready.id))?.state).toBe(
      "failed",
    );

    const limited = await fixture({
      fetch: async () => Response.json({ message: "busy" }, { status: 429 }),
    });
    await expect(execute(limited)).rejects.toMatchObject({
      capabilityError: { code: "RATE_LIMITED", retryable: true, ambiguous: false },
    });
    expect(await limited.operations.get(ownerId, limited.ready.id)).toMatchObject({
      state: "failed",
      retryable: true,
      ambiguous: false,
    });
  });

  test("marks an uncertain transport outcome inspect-required and never auto-retries", async () => {
    let calls = 0;
    const current = await fixture({
      fetch: async () => {
        calls += 1;
        throw new TypeError("network disconnected");
      },
    });
    await expect(execute(current)).rejects.toMatchObject({
      capabilityError: { code: "INSPECT_REQUIRED", ambiguous: true },
    });
    expect(calls).toBe(1);
    expect(await current.operations.get(ownerId, current.ready.id)).toMatchObject({
      state: "inspect-required",
      ambiguous: true,
    });
  });

  test("turns a deadline abort into an ambiguous timeout", async () => {
    const current = await fixture({
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    });
    await expect(
      execute(current, { deadline: new Date(now.getTime() + 5) }),
    ).rejects.toMatchObject({
      capabilityError: { code: "INSPECT_REQUIRED", ambiguous: true },
    });
  });

  test("planner rejects a route that exceeds the privacy egress ceiling", async () => {
    await expect(
      fixture({
        fetch: async () => Response.json({ audio_data: "AQID" }),
        maximumDataEgress: "none",
      }),
    ).rejects.toBeInstanceOf(CapabilityRoutePlannerError);
  });

  test("error normalizer never carries provider secrets into diagnostics", () => {
    const error = normalizeCapabilityError(
      new Error("Authorization Bearer should-never-appear"),
    );
    expect(JSON.stringify(error)).not.toContain("should-never-appear");
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(new CapabilityExecutionError(error).message).toBe(
      "Capability execution failed",
    );
  });
});
