import { describe, expect, test } from "bun:test";
import type {
  EmbedRequest,
  ModelAccessContext,
  ModelDescriptor,
  ModelGateway,
  ModelGatewayEvent,
  ModelRequest,
  TranscriptionRequest,
} from "@avermate/agent-contracts";
import { capabilityMap } from "../entitlements/capabilities";
import { EntitlementService } from "../entitlements/service";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { UsageLedger } from "./ledger";
import {
  ManagedModelPolicyRegistry,
  MeteredModelGateway,
} from "./metered-model-gateway";

const now = new Date("2026-08-22T12:00:00.000Z");
const descriptor: ModelDescriptor = {
  id: "school-model",
  provider: "fixture-provider",
  displayName: "School model",
  modalities: ["text"],
  capabilities: {
    tools: true,
    reasoningSummary: false,
    cachedUsage: true,
    structuredOutput: true,
  },
  contextWindow: 1_000,
};

class FixtureGateway implements ModelGateway {
  calls = 0;
  async listModels(_context: ModelAccessContext) {
    return [descriptor];
  }
  async *stream(_request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    this.calls += 1;
    yield { type: "content-delta", delta: "ok" };
    yield {
      type: "usage",
      usage: {
        inputTokens: 50,
        outputTokens: 20,
        reasoningTokens: 0,
        cachedReadTokens: 10,
        cachedWriteTokens: 0,
      },
    };
    yield { type: "finish", reason: "stop" };
  }
  async embed(_request: EmbedRequest) {
    return {
      vectors: [[1, 0]],
      usage: {
        inputTokens: 2,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      },
    };
  }
  async transcribe(_request: TranscriptionRequest) {
    return {
      text: "fixture",
      language: "fr",
      durationSeconds: 3,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      },
    };
  }
  async estimate() {
    return {
      usage: {
        inputTokens: "unknown" as const,
        outputTokens: "unknown" as const,
        reasoningTokens: "unknown" as const,
        cachedReadTokens: "unknown" as const,
        cachedWriteTokens: "unknown" as const,
      },
      estimatedCostMinor: "unknown" as const,
      currency: "unknown" as const,
    };
  }
}

describe.serial("managed model policy and usage normalization", () => {
  test("filters models by region/privacy and settles cached tokens separately", async () => {
    const client = await createManagedTestDatabase();
    try {
      const entitlements = new EntitlementService(client, {
        mode: "enforce",
        clock: () => now,
        cacheTtlMs: 0,
      });
      await entitlements.publishSnapshot(
        {
          version: 1,
          id: "model-snapshot",
          accountId: "account-a",
          revision: "models/1",
          plan: "test",
          status: "active",
          period: {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-09-01T00:00:00.000Z",
          },
          capabilities: capabilityMap((_capability, unit) => ({
            enabled: true,
            unit,
            hardLimit: "100000",
            concurrency: 100,
          })),
          source: "operator",
          issuedAt: now.toISOString(),
        },
        {
          actorId: "test-admin",
          justification: "fixture",
          correlationId: "model-snapshot",
        },
      );
      await client.batch([
        {
          sql: `INSERT INTO managed_model_catalogue
            (provider, model, revision, enabled, modalitiesJson, contextTokens,
             supportsTools, supportsStructuredOutput, regionsJson,
             retentionPolicy, zeroRetention, trainingOptInRequired, updatedAt)
            VALUES (?, ?, 'v1', 1, '["text"]', '1000', 1, 1, '["eu-test"]',
              'zero-retention-contract', 1, 0, ?)`,
          args: ["fixture-provider", "school-model", Math.floor(now.getTime() / 1_000)],
        },
        {
          sql: `INSERT INTO managed_model_catalogue
            (provider, model, revision, enabled, modalitiesJson, contextTokens,
             supportsTools, supportsStructuredOutput, regionsJson,
             retentionPolicy, zeroRetention, trainingOptInRequired, updatedAt)
            VALUES (?, ?, 'v1', 1, '["text"]', '1000', 0, 0, '["eu-test"]',
              'training-opt-in-required', 0, 1, ?)`,
          args: ["fixture-provider", "training-model", Math.floor(now.getTime() / 1_000)],
        },
      ]);
      const delegate = new FixtureGateway();
      const registry = new ManagedModelPolicyRegistry(client, "eu-test");
      const usage = new UsageLedger(client, entitlements, { clock: () => now });
      const gateway = new MeteredModelGateway(
        delegate,
        registry,
        usage,
        "managed-model-eu",
        () => now,
      );
      expect(
        await gateway.listModels({
          ownerId: "account-a",
          placement: "core",
          allowedOrigins: [],
        }),
      ).toEqual([]);
      expect(
        (
          await gateway.listModels({
            ownerId: "account-a",
            placement: "managed",
            allowedOrigins: [],
          })
        ).map((model) => model.id),
      ).toEqual(["school-model"]);

      const events: ModelGatewayEvent[] = [];
      for await (const event of gateway.stream({
        ownerId: "account-a",
        runId: "model-run-1",
        modelId: "school-model",
        messages: [],
        tools: [],
      })) {
        events.push(event);
      }
      expect(delegate.calls).toBe(1);
      expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
      const consumed = await client.execute(
        `SELECT capability, quantity FROM usage_events
         WHERE direction = 'consume' ORDER BY capability`,
      );
      expect(consumed.rows).toEqual([
        expect.objectContaining({
          capability: "model.cachedInputTokens",
          quantity: "10",
        }),
        expect.objectContaining({
          capability: "model.inputTokens",
          quantity: "50",
        }),
        expect.objectContaining({
          capability: "model.outputTokens",
          quantity: "20",
        }),
      ]);

      await expect(
        gateway.transcribe({
          ownerId: "account-a",
          operationId: "transcription-without-bound",
          modelId: "school-model",
          media: new Blob(["audio"]),
        }),
      ).rejects.toThrow("MANAGED_MAXIMUM_SECONDS_REQUIRED");
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("rejects an ambiguous model id instead of charging the wrong provider", async () => {
    const client = await createManagedTestDatabase();
    try {
      await client.batch(
        ["provider-a", "provider-b"].map((provider) => ({
          sql: `INSERT INTO managed_model_catalogue
            (provider, model, revision, enabled, modalitiesJson, contextTokens,
             supportsTools, supportsStructuredOutput, regionsJson,
             retentionPolicy, zeroRetention, trainingOptInRequired, updatedAt)
            VALUES (?, 'shared-model', 'v1', 1, '["text"]', '1000', 1, 1,
              '["eu-test"]', 'zero-retention-contract', 1, 0, ?)`,
          args: [provider, Math.floor(now.getTime() / 1_000)],
        })),
      );
      const registry = new ManagedModelPolicyRegistry(client, "eu-test");
      await expect(
        registry.require("account-a", "shared-model"),
      ).rejects.toThrow("MANAGED_MODEL_ID_AMBIGUOUS");
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("a newer disabled revision cannot resurrect an older enabled policy", async () => {
    const client = await createManagedTestDatabase();
    try {
      await client.batch([
        {
          sql: `INSERT INTO managed_model_catalogue
            (provider, model, revision, enabled, modalitiesJson, contextTokens,
             supportsTools, supportsStructuredOutput, regionsJson,
             retentionPolicy, zeroRetention, trainingOptInRequired, updatedAt)
            VALUES ('provider-a', 'retired-model', 'v1', 1, '["text"]',
              '1000', 1, 1, '["eu-test"]', 'zero-retention-contract', 1, 0, ?)`,
          args: [Math.floor(now.getTime() / 1_000) - 1],
        },
        {
          sql: `INSERT INTO managed_model_catalogue
            (provider, model, revision, enabled, modalitiesJson, contextTokens,
             supportsTools, supportsStructuredOutput, regionsJson,
             retentionPolicy, zeroRetention, trainingOptInRequired, updatedAt)
            VALUES ('provider-a', 'retired-model', 'v2', 0, '["text"]',
              '1000', 1, 1, '["eu-test"]', 'retired', 1, 0, ?)`,
          args: [Math.floor(now.getTime() / 1_000)],
        },
      ]);
      const registry = new ManagedModelPolicyRegistry(client, "eu-test");
      expect(await registry.list("account-a")).toEqual([]);
      await expect(
        registry.require("account-a", "retired-model"),
      ).rejects.toThrow("MANAGED_MODEL_NOT_ALLOWED_BY_PRIVACY_POLICY");
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
