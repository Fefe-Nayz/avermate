import type { InValue } from "@libsql/client";
import {
  modelDescriptorSchema,
  type EmbedRequest,
  type EmbedResult,
  type ModelAccessContext,
  type ModelDescriptor,
  type ModelGateway,
  type ModelGatewayEvent,
  type ModelRequest,
  type TranscriptionRequest,
  type TranscriptionResult,
  type UsageEstimate,
} from "@avermate/agent-contracts";
import type { EntitlementSqlClient } from "../entitlements/service";
import type { UsageLedger } from "./ledger";
import type { ManagedCapability } from "@avermate/agent-contracts";

type Row = Record<string, InValue>;

export type ManagedModelPolicy = {
  provider: string;
  model: string;
  revision: string;
  descriptor: ModelDescriptor;
  regions: string[];
  retentionPolicy: string;
  zeroRetention: boolean;
  trainingOptInRequired: boolean;
  pricingSnapshotId?: string;
  maxOutputTokens: number;
};

/** Provider policy is data, never a hard-coded billing product name. */
export class ManagedModelPolicyRegistry {
  constructor(
    private readonly client: EntitlementSqlClient,
    private readonly region: string,
    private readonly hasTrainingOptIn: (
      ownerId: string,
      provider: string,
      model: string,
    ) => Promise<boolean> = async () => false,
  ) {}

  async list(ownerId: string): Promise<ManagedModelPolicy[]> {
    const rows = await this.client.execute({
      sql: `SELECT * FROM managed_model_catalogue
        ORDER BY provider, model, updatedAt DESC, rowid DESC`,
      args: [],
    });
    const latest = new Map<string, Row>();
    for (const row of rows.rows as Row[]) {
      const key = `${String(row.provider)}\0${String(row.model)}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const policies: ManagedModelPolicy[] = [];
    for (const row of latest.values()) {
      if (Number(row.enabled) !== 1) continue;
      const regions = JSON.parse(String(row.regionsJson)) as string[];
      if (!regions.includes(this.region)) continue;
      if (
        Number(row.trainingOptInRequired) === 1 &&
        !(await this.hasTrainingOptIn(
          ownerId,
          String(row.provider),
          String(row.model),
        ))
      ) {
        continue;
      }
      const modalities = JSON.parse(String(row.modalitiesJson));
      const context = BigInt(String(row.contextTokens));
      if (context > BigInt(Number.MAX_SAFE_INTEGER)) continue;
      const contextWindow = Number(context);
      policies.push({
        provider: String(row.provider),
        model: String(row.model),
        revision: String(row.revision),
        descriptor: modelDescriptorSchema.parse({
          id: String(row.model),
          provider: String(row.provider),
          displayName: String(row.model),
          modalities,
          capabilities: {
            tools: Number(row.supportsTools) === 1,
            reasoningSummary: false,
            cachedUsage: true,
            structuredOutput: Number(row.supportsStructuredOutput) === 1,
          },
          contextWindow,
        }),
        regions,
        retentionPolicy: String(row.retentionPolicy),
        zeroRetention: Number(row.zeroRetention) === 1,
        trainingOptInRequired: Number(row.trainingOptInRequired) === 1,
        pricingSnapshotId:
          row.pricingSnapshotId === null
            ? undefined
            : String(row.pricingSnapshotId),
        maxOutputTokens: Math.max(1, Math.min(contextWindow, 32_768)),
      });
    }
    return policies;
  }

  async require(ownerId: string, modelId: string) {
    const matching = (await this.list(ownerId)).filter(
      (candidate) => candidate.model === modelId,
    );
    if (matching.length === 0) {
      throw new Error("MANAGED_MODEL_NOT_ALLOWED_BY_PRIVACY_POLICY");
    }
    if (matching.length !== 1) {
      throw new Error("MANAGED_MODEL_ID_AMBIGUOUS");
    }
    return matching[0]!;
  }
}

/** Metered managed wrapper; the underlying gateway remains provider-neutral. */
export class MeteredModelGateway implements ModelGateway {
  constructor(
    private readonly delegate: ModelGateway,
    private readonly registry: ManagedModelPolicyRegistry,
    private readonly usage: UsageLedger,
    private readonly providerId: string,
    private readonly clock: () => Date = () => new Date(),
    private readonly assertDispatch?: (
      capability: ManagedCapability,
      provider: string,
    ) => Promise<void>,
  ) {}

  async listModels(context: ModelAccessContext): Promise<ModelDescriptor[]> {
    if (context.placement !== "managed") return [];
    const allowed = await this.registry.list(context.ownerId);
    const delegated = await this.delegate.listModels(context);
    const delegatedIds = new Set(delegated.map((model) => model.id));
    return allowed
      .filter((policy) => delegatedIds.has(policy.model))
      .map((policy) => policy.descriptor);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent> {
    const policy = await this.registry.require(request.ownerId, request.modelId);
    await Promise.all(
      [
        "model.inputTokens",
        "model.outputTokens",
        "model.cachedInputTokens",
      ].map((capability) =>
        this.assertDispatch?.(capability as ManagedCapability, policy.provider),
      ),
    );
    const inputMaximum =
      policy.descriptor.contextWindow === "unknown"
        ? 128_000
        : policy.descriptor.contextWindow;
    const expiry = new Date(this.clock().getTime() + 60 * 60_000);
    const common = {
      accountId: request.ownerId,
      userId: request.ownerId,
      unit: "tokens" as const,
      placement: { kind: "managed" as const, providerId: this.providerId },
      runId: request.runId,
      provider: policy.provider,
      model: policy.model,
      pricingSnapshotId: policy.pricingSnapshotId,
      expiresAt: expiry,
      estimatorVersion: `model-policy:${policy.revision}`,
    };
    const prepared: Awaited<ReturnType<UsageLedger["reserve"]>>[] = [];
    try {
      prepared.push(
        await this.usage.reserve({
          ...common,
          capability: "model.inputTokens",
          maximumQuantity: String(inputMaximum),
          idempotencyKey: `model:${request.runId}:input`,
        }),
      );
      prepared.push(
        await this.usage.reserve({
          ...common,
          capability: "model.outputTokens",
          maximumQuantity: String(policy.maxOutputTokens),
          idempotencyKey: `model:${request.runId}:output`,
        }),
      );
      prepared.push(
        await this.usage.reserve({
          ...common,
          capability: "model.cachedInputTokens",
          maximumQuantity: String(inputMaximum),
          idempotencyKey: `model:${request.runId}:cached-input`,
        }),
      );
    } catch (error) {
      // No provider call has happened yet, so these partial reservations are
      // authoritatively free and may be released immediately.
      await Promise.all(
        prepared.map((item) =>
          this.usage.settle({
            accountId: request.ownerId,
            reservationId: item.reservation.id,
            actualQuantity: "0",
            outcome: "cancelled",
            authoritative: true,
            provider: policy.provider,
            model: policy.model,
          }),
        ),
      );
      throw error;
    }
    const [inputReservation, outputReservation, cachedReservation] = prepared as [
      (typeof prepared)[number],
      (typeof prepared)[number],
      (typeof prepared)[number],
    ];
    let settled = false;
    for await (const event of this.delegate.stream(request)) {
      if (event.type === "usage") {
        const counts = [
          event.usage.inputTokens,
          event.usage.outputTokens,
          event.usage.cachedReadTokens,
        ];
        if (counts.every((value) => value !== "unknown")) {
          await Promise.all([
            this.usage.settle({
              accountId: request.ownerId,
              reservationId: inputReservation.reservation.id,
              actualQuantity: String(counts[0]),
              outcome: "completed",
              authoritative: true,
              provider: policy.provider,
              model: policy.model,
            }),
            this.usage.settle({
              accountId: request.ownerId,
              reservationId: outputReservation.reservation.id,
              actualQuantity: String(counts[1]),
              outcome: "completed",
              authoritative: true,
              provider: policy.provider,
              model: policy.model,
            }),
            this.usage.settle({
              accountId: request.ownerId,
              reservationId: cachedReservation.reservation.id,
              actualQuantity: String(counts[2]),
              outcome: "completed",
              authoritative: true,
              provider: policy.provider,
              model: policy.model,
            }),
          ]);
          settled = true;
        }
      }
      yield event;
    }
    // Unknown/missing provider usage deliberately remains reserved for the
    // reconciliation path; it is never guessed and labelled final.
    void settled;
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    if (!request.operationId) {
      throw new Error("MANAGED_OPERATION_ID_REQUIRED");
    }
    const policy = await this.registry.require(request.ownerId, request.modelId);
    await this.assertDispatch?.("embedding.units", policy.provider);
    const maximum = Math.max(
      1,
      request.inputs.reduce(
        (sum, value) => sum + new TextEncoder().encode(value).byteLength,
        0,
      ),
    );
    const reservation = await this.usage.reserve({
      accountId: request.ownerId,
      userId: request.ownerId,
      capability: "embedding.units",
      unit: "units",
      maximumQuantity: String(maximum),
      idempotencyKey: `embedding:${request.operationId}`,
      placement: { kind: "managed", providerId: this.providerId },
      provider: policy.provider,
      model: policy.model,
      pricingSnapshotId: policy.pricingSnapshotId,
      expiresAt: new Date(this.clock().getTime() + 60 * 60_000),
      estimatorVersion: "utf16-half-units/1",
    });
    const result = await this.delegate.embed(request);
    const authoritative = result.usage.inputTokens !== "unknown";
    if (authoritative) {
      await this.usage.settle({
        accountId: request.ownerId,
        reservationId: reservation.reservation.id,
        actualQuantity: String(result.usage.inputTokens),
        outcome: "completed",
        authoritative: true,
        provider: policy.provider,
        model: policy.model,
      });
    }
    return result;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    if (!request.operationId) {
      throw new Error("MANAGED_OPERATION_ID_REQUIRED");
    }
    if (
      !Number.isSafeInteger(request.maximumSeconds) ||
      (request.maximumSeconds ?? 0) <= 0
    ) {
      throw new Error("MANAGED_MAXIMUM_SECONDS_REQUIRED");
    }
    const policy = await this.registry.require(request.ownerId, request.modelId);
    await this.assertDispatch?.("transcription.seconds", policy.provider);
    const maximumSeconds = request.maximumSeconds!;
    const reservation = await this.usage.reserve({
      accountId: request.ownerId,
      userId: request.ownerId,
      capability: "transcription.seconds",
      unit: "seconds",
      maximumQuantity: String(maximumSeconds),
      idempotencyKey: `transcription:${request.operationId}`,
      placement: { kind: "managed", providerId: this.providerId },
      provider: policy.provider,
      model: policy.model,
      pricingSnapshotId: policy.pricingSnapshotId,
      expiresAt: new Date(this.clock().getTime() + 60 * 60_000),
      estimatorVersion: "media-bytes-upper-bound/1",
    });
    const result = await this.delegate.transcribe(request);
    if (result.durationSeconds !== "unknown") {
      await this.usage.settle({
        accountId: request.ownerId,
        reservationId: reservation.reservation.id,
        actualQuantity: String(Math.ceil(result.durationSeconds)),
        outcome: "completed",
        authoritative: true,
        provider: policy.provider,
        model: policy.model,
      });
    }
    return result;
  }

  estimate(request: ModelRequest): Promise<UsageEstimate> {
    return this.delegate.estimate(request);
  }
}
