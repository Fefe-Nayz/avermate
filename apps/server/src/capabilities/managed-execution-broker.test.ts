import { describe, expect, test } from "bun:test";
import {
  capabilityOfferingSchema,
  type CapabilityRequestMap,
  type CapabilityUsage,
} from "@avermate/agent-contracts";
import {
  DefaultManagedCapabilityExecutionBroker,
  ManagedCapabilityAccountingError,
} from "./managed-execution-broker";

const now = new Date("2026-08-28T12:00:00.000Z");

const languageOffering = capabilityOfferingSchema.parse({
  schemaVersion: 1,
  id: "managed-language-fixture",
  connectionId: "managed-connection-fixture",
  connectionRevision: 1,
  pluginId: "fixture.managed",
  pluginVersion: "1",
  adapterRevision: "1",
  capabilityProtocolVersion: 1,
  provider: "fixture-provider",
  modelId: "fixture-model",
  modelRevision: "1",
  placement: { kind: "managed", pool: "primary", region: "eu-west" },
  dataHandling: {
    egress: "avermate-managed",
    providerName: "Fixture",
    region: "eu-west",
    disclosureRevision: "1",
    retentionDisclosureRevision: null,
    trainingDisclosureRevision: null,
    requiresExplicitConsent: true,
  },
  limits: {
    maxInputBytes: 1_000_000,
    maxOutputBytes: 1_000_000,
    maxBatchSize: 1,
    maxConcurrency: 8,
  },
  supportedLanguages: "unknown",
  healthCheckKind: "passive",
  capability: "language.generate",
  specification: {
    inputModalities: ["text"],
    contextWindow: 100_000,
    maximumOutputTokens: 8_192,
    tools: false,
    parallelTools: false,
    structuredOutput: true,
    streaming: true,
    reasoningSummary: false,
    opaqueReasoningContinuation: false,
    cachedUsage: true,
  },
});

const languageRequest: CapabilityRequestMap["language.generate"] = {
  schemaVersion: 1,
  messages: [
    { role: "user", parts: [{ type: "text", text: "Explique ce cours." }] },
  ],
  tools: [],
  maximumOutputTokens: 100,
  responseFormat: "text",
};

type ControlCall = {
  capability: string;
  maximumQuantity?: string;
};
type ReserveCall = {
  capability: string;
  maximumQuantity: string;
  idempotencyKey: string;
};
type SettleCall = {
  reservationId: string;
  actualQuantity: string;
  outcome: string;
  authoritative: boolean;
  evidenceRef?: string;
};

function fixture(options: { failReservation?: number } = {}) {
  const sequence: string[] = [];
  const controls: ControlCall[] = [];
  const reserves: ReserveCall[] = [];
  const settlements: SettleCall[] = [];
  let reservationNumber = 0;
  const broker = new DefaultManagedCapabilityExecutionBroker(
    {
      async assertAllowed(input: ControlCall) {
        controls.push(input);
        sequence.push(`control:${input.capability}`);
      },
    },
    {
      async reserve(input: ReserveCall) {
        reservationNumber += 1;
        sequence.push(`reserve:${input.capability}`);
        if (options.failReservation === reservationNumber) {
          throw new Error("fixture reservation failure");
        }
        reserves.push(input);
        return {
          reservation: { id: `reservation-${reservationNumber}` },
        } as never;
      },
      async settle(input: SettleCall) {
        settlements.push(input);
        sequence.push(`settle:${input.reservationId}`);
        return {} as never;
      },
    },
    () => new Date(now),
  );
  return { broker, sequence, controls, reserves, settlements };
}

async function reserve(current: ReturnType<typeof fixture>) {
  return current.broker.reserve({
    ownerId: "owner-managed-accounting",
    operationId: "cop-managed-accounting",
    attemptId: "catt-managed-accounting",
    offering: languageOffering,
    request: languageRequest,
    pricingSnapshotId: "price-fixture",
    deadline: new Date(now.getTime() + 60_000),
  });
}

const measuredUsage: CapabilityUsage = {
  version: 1,
  items: [
    { unit: "input-token", quantity: "12", source: "provider" },
    { unit: "output-token", quantity: "7", source: "provider" },
    { unit: "cached-input-token", quantity: "3", source: "measured" },
  ],
  cost: {
    amountMinor: "2",
    currency: "EUR",
    authoritative: true,
    pricingSnapshotId: "price-fixture",
  },
};

describe("DefaultManagedCapabilityExecutionBroker", () => {
  test("checks controls and reserves every quota before execution", async () => {
    const current = fixture();
    const reservation = await reserve(current);

    expect(current.controls.map((call) => call.capability)).toEqual([
      "model.inputTokens",
      "model.outputTokens",
      "model.cachedInputTokens",
    ]);
    expect(current.reserves.map((call) => call.capability)).toEqual([
      "model.inputTokens",
      "model.outputTokens",
      "model.cachedInputTokens",
    ]);
    expect(current.reserves.map((call) => call.maximumQuantity)).toEqual([
      "100000",
      "100",
      "100000",
    ]);
    expect(
      current.sequence.findIndex((entry) => entry.startsWith("reserve:")),
    ).toBe(3);
    expect(new Set(current.reserves.map((call) => call.idempotencyKey)).size).toBe(
      3,
    );
    expect(reservation.entries).toHaveLength(3);
  });

  test("settles measured provider usage and conservatively keeps unknown usage", async () => {
    const measured = fixture();
    const measuredReservation = await reserve(measured);
    await measured.broker.settle({
      reservation: measuredReservation,
      usage: measuredUsage,
      outcome: "completed",
      dispatched: true,
      ambiguous: false,
    });
    expect(
      measured.settlements.map((entry) => ({
        quantity: entry.actualQuantity,
        authoritative: entry.authoritative,
      })),
    ).toEqual([
      { quantity: "12", authoritative: true },
      { quantity: "7", authoritative: true },
      { quantity: "3", authoritative: true },
    ]);

    const unknown = fixture();
    const unknownReservation = await reserve(unknown);
    await unknown.broker.settle({
      reservation: unknownReservation,
      usage: { ...measuredUsage, items: [] },
      outcome: "completed",
      dispatched: true,
      ambiguous: false,
    });
    expect(
      unknown.settlements.map((entry) => ({
        quantity: entry.actualQuantity,
        authoritative: entry.authoritative,
      })),
    ).toEqual(
      unknown.reserves.map((entry) => ({
        quantity: entry.maximumQuantity,
        authoritative: false,
      })),
    );

    const fractional = fixture();
    const fractionalReservation = await reserve(fractional);
    await fractional.broker.settle({
      reservation: fractionalReservation,
      usage: {
        ...measuredUsage,
        items: [
          { unit: "input-token", quantity: "12.5", source: "provider" },
          { unit: "output-token", quantity: "7", source: "provider" },
          { unit: "cached-input-token", quantity: "3", source: "provider" },
        ],
      },
      outcome: "completed",
      dispatched: true,
      ambiguous: false,
    });
    expect(fractional.settlements[0]).toMatchObject({
      actualQuantity: "13",
      authoritative: false,
    });
  });

  test("releases pre-dispatch failures but keeps the maximum after dispatch", async () => {
    const beforeDispatch = fixture();
    const beforeReservation = await reserve(beforeDispatch);
    await beforeDispatch.broker.settle({
      reservation: beforeReservation,
      usage: null,
      outcome: "failed",
      dispatched: false,
      ambiguous: false,
    });
    expect(beforeDispatch.settlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actualQuantity: "0",
          authoritative: true,
          outcome: "failed",
        }),
      ]),
    );

    const afterDispatch = fixture();
    const afterReservation = await reserve(afterDispatch);
    await afterDispatch.broker.settle({
      reservation: afterReservation,
      usage: null,
      outcome: "failed",
      dispatched: true,
      ambiguous: true,
    });
    expect(
      afterDispatch.settlements.map((entry) => ({
        quantity: entry.actualQuantity,
        authoritative: entry.authoritative,
        evidenceRef: entry.evidenceRef,
      })),
    ).toEqual(
      afterDispatch.reserves.map((entry) => ({
        quantity: entry.maximumQuantity,
        authoritative: false,
        evidenceRef: "capability-registry-ambiguous-post-dispatch",
      })),
    );
  });

  test("rolls back earlier reservations if a later quota reservation fails", async () => {
    const current = fixture({ failReservation: 2 });
    await expect(reserve(current)).rejects.toThrow("fixture reservation failure");
    expect(current.reserves).toHaveLength(1);
    expect(current.settlements).toEqual([
      expect.objectContaining({
        reservationId: "reservation-1",
        actualQuantity: "0",
        outcome: "cancelled",
        authoritative: true,
      }),
    ]);
  });

  test("refuses capabilities without a quota contract before touching the ledger", async () => {
    const current = fixture();
    const unsupported = {
      ...languageOffering,
      capability: "rerank.score" as const,
      specification: {
        modalities: ["text" as const],
        maxCandidates: 10,
        maxTokensPerCandidate: 1_000,
        languages: "multilingual" as const,
        scoreSemantics: "relative" as const,
      },
    };

    await expect(
      current.broker.reserve({
        ownerId: "owner-managed-accounting",
        operationId: "cop-managed-accounting",
        attemptId: "catt-managed-accounting",
        offering: unsupported,
        request: {
          schemaVersion: 1,
          query: "question",
          candidates: [{ id: "candidate-1", text: "answer" }],
          topK: 1,
        },
        pricingSnapshotId: null,
        deadline: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toBeInstanceOf(ManagedCapabilityAccountingError);
    expect(current.controls).toEqual([]);
    expect(current.reserves).toEqual([]);
  });

  test("refuses an unbounded managed language context before touching the ledger", async () => {
    const current = fixture();
    if (languageOffering.capability !== "language.generate") {
      throw new Error("Language fixture capability mismatch");
    }
    const unbounded = {
      ...languageOffering,
      specification: {
        ...languageOffering.specification,
        contextWindow: "unknown" as const,
      },
    };

    await expect(
      current.broker.reserve({
        ownerId: "owner-managed-accounting",
        operationId: "cop-managed-accounting",
        attemptId: "catt-managed-accounting",
        offering: unbounded,
        request: languageRequest,
        pricingSnapshotId: null,
        deadline: new Date(now.getTime() + 60_000),
      }),
    ).rejects.toMatchObject({ code: "MANAGED_USAGE_BOUND_UNAVAILABLE" });
    expect(current.controls).toEqual([]);
    expect(current.reserves).toEqual([]);
  });
});
