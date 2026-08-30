import {
  type CapabilityKind,
  type CapabilityOffering,
  type CapabilityRequestMap,
  type CapabilityUsage,
  type CapabilityUsageUnit,
  type ManagedCapability,
  type UsageUnit,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { managedUsage } from "../managed/services";
import { ManagedCostControls } from "../operations/cost-controls";
import type { UsageLedger } from "../usage/ledger";
import { capabilityDigest } from "./values";

const RESERVATION_TTL_MS = 60 * 60_000;

type ReservationSpec = {
  capability: ManagedCapability;
  unit: UsageUnit;
  maximumQuantity: string;
  usageUnits: CapabilityUsageUnit[];
  estimatorVersion: string;
};

type ReservedEntry = ReservationSpec & {
  reservationId: string;
};

export type ManagedCapabilityReservation = {
  accountId: string;
  operationId: string;
  attemptId: string;
  provider: string;
  model: string;
  entries: ReservedEntry[];
};

export type ManagedCapabilitySettlement = {
  reservation: ManagedCapabilityReservation;
  usage: CapabilityUsage | null;
  outcome: "completed" | "failed" | "cancelled";
  /** True only after the adapter crossed its final pre-provider authorize fence. */
  dispatched: boolean;
  ambiguous: boolean;
  evidenceRef?: string;
};

export interface ManagedCapabilityExecutionBroker {
  reserve<K extends CapabilityKind>(input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
    offering: CapabilityOffering;
    request: CapabilityRequestMap[K];
    pricingSnapshotId: string | null;
    deadline: Date;
  }): Promise<ManagedCapabilityReservation>;

  settle(input: ManagedCapabilitySettlement): Promise<void>;
}

export class ManagedCapabilityAccountingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ManagedCapabilityAccountingError";
  }
}

type CostControls = Pick<ManagedCostControls, "assertAllowed">;
type Ledger = Pick<UsageLedger, "reserve" | "settle">;

function positiveCeil(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ManagedCapabilityAccountingError(
      "MANAGED_USAGE_ESTIMATE_INVALID",
      "Managed execution requires a finite positive usage bound",
    );
  }
  return String(Math.ceil(value));
}

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function reservationSpecs<K extends CapabilityKind>(input: {
  offering: CapabilityOffering;
  request: CapabilityRequestMap[K];
}): ReservationSpec[] {
  switch (input.offering.capability) {
    case "language.generate": {
      const request = input.request as CapabilityRequestMap["language.generate"];
      if (input.offering.specification.contextWindow === "unknown") {
        throw new ManagedCapabilityAccountingError(
          "MANAGED_USAGE_BOUND_UNAVAILABLE",
          "Managed language execution requires a bounded context window",
        );
      }
      // JSON byte length is not an upper bound for image/PDF/audio tokenization.
      // The reviewed offering context window is the only safe provider-neutral
      // pre-dispatch bound across every supported input modality.
      const maximumInputTokens = positiveCeil(
        input.offering.specification.contextWindow,
      );
      const specs: ReservationSpec[] = [
        {
          capability: "model.inputTokens",
          unit: "tokens",
          maximumQuantity: maximumInputTokens,
          usageUnits: ["input-token"],
          estimatorVersion: "capability-language-context-window/1",
        },
        {
          capability: "model.outputTokens",
          unit: "tokens",
          maximumQuantity: positiveCeil(request.maximumOutputTokens),
          usageUnits: ["output-token"],
          estimatorVersion: "capability-language-output-bound/1",
        },
      ];
      if (input.offering.specification.cachedUsage) {
        specs.push({
          capability: "model.cachedInputTokens",
          unit: "tokens",
          maximumQuantity: maximumInputTokens,
          usageUnits: ["cached-input-token"],
          estimatorVersion: "capability-language-cache-bound/1",
        });
      }
      return specs;
    }
    case "embedding.generate": {
      const request = input.request as CapabilityRequestMap["embedding.generate"];
      const maximumTokensPerInput = input.offering.specification.maximumTokensPerInput;
      const estimatedUnits = request.inputs.reduce((sum, value) => {
        if (value.type !== "text") return sum + maximumTokensPerInput;
        return (
          sum +
          Math.min(
            maximumTokensPerInput,
            Math.max(1, serializedBytes(value.text)),
          )
        );
      }, 0);
      return [
        {
          capability: "embedding.units",
          unit: "units",
          maximumQuantity: positiveCeil(estimatedUnits),
          usageUnits: ["input-token"],
          estimatorVersion: "capability-embedding-modality-bound/1",
        },
      ];
    }
    case "speech.transcribe": {
      const request = input.request as CapabilityRequestMap["speech.transcribe"];
      return [
        {
          capability: "transcription.seconds",
          unit: "seconds",
          maximumQuantity: positiveCeil(request.maximumSeconds),
          usageUnits: ["audio-second"],
          estimatorVersion: "capability-transcription-maximum-seconds/1",
        },
      ];
    }
    case "speech.synthesize": {
      const request = input.request as CapabilityRequestMap["speech.synthesize"];
      return [
        {
          capability: "tts.characters",
          unit: "characters",
          maximumQuantity: positiveCeil(Array.from(request.text).length),
          usageUnits: ["character"],
          estimatorVersion: "capability-tts-unicode-scalars/1",
        },
      ];
    }
    case "document.ocr": {
      const request = input.request as CapabilityRequestMap["document.ocr"];
      return [
        {
          capability: "ocr.pages",
          unit: "pages",
          maximumQuantity: positiveCeil(request.maximumPages),
          usageUnits: ["page"],
          estimatorVersion: "capability-ocr-maximum-pages/1",
        },
      ];
    }
    case "video.generate": {
      const request = input.request as CapabilityRequestMap["video.generate"];
      return [
        {
          capability: "video.outputSeconds",
          unit: "output-seconds",
          maximumQuantity: positiveCeil(request.maximumDurationSeconds),
          usageUnits: ["video-second"],
          estimatorVersion: "capability-video-maximum-seconds/1",
        },
      ];
    }
    case "rerank.score":
    case "document.extract":
    case "image.generate":
      throw new ManagedCapabilityAccountingError(
        "MANAGED_CAPABILITY_ACCOUNTING_UNSUPPORTED",
        `Managed accounting is not defined for ${input.offering.capability}`,
      );
  }
}

function addDecimalParts(values: readonly string[]) {
  let scale = 0;
  const parsed = values.map((value) => {
    const [whole = "0", fraction = ""] = value.split(".");
    scale = Math.max(scale, fraction.length);
    return { whole, fraction };
  });
  const total = parsed.reduce((sum, value) => {
    const integer = BigInt(`${value.whole}${value.fraction}`);
    return sum + integer * 10n ** BigInt(scale - value.fraction.length);
  }, 0n);
  const factor = 10n ** BigInt(scale);
  return {
    quantity: (scale === 0 ? total : (total + factor - 1n) / factor).toString(),
    exact: scale === 0 || total % factor === 0n,
  };
}

function actualQuantity(
  entry: ReservedEntry,
  usage: CapabilityUsage | null,
): { quantity: string; authoritative: boolean } {
  const items =
    usage?.items.filter((item) => entry.usageUnits.includes(item.unit)) ?? [];
  if (items.length === 0) {
    return { quantity: entry.maximumQuantity, authoritative: false };
  }
  const total = addDecimalParts(items.map((item) => item.quantity));
  return {
    quantity: total.quantity,
    // The shared entitlement ledger intentionally persists integer units. A
    // conservative ceiling of fractional provider usage is no longer an exact
    // provider measurement and must not be labelled authoritative.
    authoritative:
      total.exact &&
      items.every(
        (item) => item.source === "provider" || item.source === "measured",
      ),
  };
}

export class DefaultManagedCapabilityExecutionBroker
  implements ManagedCapabilityExecutionBroker
{
  constructor(
    private readonly controls: CostControls,
    private readonly ledger: Ledger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async reserve<K extends CapabilityKind>(input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
    offering: CapabilityOffering;
    request: CapabilityRequestMap[K];
    pricingSnapshotId: string | null;
    deadline: Date;
  }): Promise<ManagedCapabilityReservation> {
    if (input.offering.placement.kind !== "managed") {
      throw new ManagedCapabilityAccountingError(
        "MANAGED_PLACEMENT_REQUIRED",
        "Managed accounting may only reserve a managed offering",
      );
    }
    const now = this.clock();
    if (input.deadline <= now) {
      throw new ManagedCapabilityAccountingError(
        "MANAGED_RESERVATION_DEADLINE_EXPIRED",
        "Managed execution deadline elapsed before reservation",
      );
    }
    const specs = reservationSpecs({
      offering: input.offering,
      request: input.request,
    });
    for (const spec of specs) {
      await this.controls.assertAllowed({
        accountId: input.ownerId,
        capability: spec.capability,
        provider: input.offering.provider,
        maximumQuantity: spec.maximumQuantity,
        unit: spec.unit,
      });
    }

    const expiresAt = new Date(
      Math.max(
        now.getTime() + 60_000,
        Math.min(now.getTime() + RESERVATION_TTL_MS, input.deadline.getTime() + 15 * 60_000),
      ),
    );
    const entries: ReservedEntry[] = [];
    try {
      for (const spec of specs) {
        const idempotencyKey = `capreg:${capabilityDigest({
          operationId: input.operationId,
          attemptId: input.attemptId,
          capability: spec.capability,
        }).slice("sha256:".length)}`;
        const reserved = await this.ledger.reserve({
          accountId: input.ownerId,
          userId: input.ownerId,
          capability: spec.capability,
          unit: spec.unit,
          maximumQuantity: spec.maximumQuantity,
          idempotencyKey,
          placement: {
            kind: "managed",
            providerId: input.offering.provider,
          },
          runId: input.operationId,
          // The usage ledger expiry resolver uses this owner-bound attempt as
          // durable dispatch evidence after a process crash.
          jobId: input.attemptId,
          provider: input.offering.provider,
          model: input.offering.modelId,
          pricingSnapshotId: input.pricingSnapshotId ?? undefined,
          expiresAt,
          estimatorVersion: spec.estimatorVersion,
        });
        entries.push({ ...spec, reservationId: reserved.reservation.id });
      }
    } catch (error) {
      await Promise.allSettled(
        entries.map((entry) =>
          this.ledger.settle({
            accountId: input.ownerId,
            reservationId: entry.reservationId,
            actualQuantity: "0",
            outcome: "cancelled",
            authoritative: true,
            provider: input.offering.provider,
            model: input.offering.modelId,
            evidenceRef: "capability-registry-reservation-rollback",
          }),
        ),
      );
      throw error;
    }
    return {
      accountId: input.ownerId,
      operationId: input.operationId,
      attemptId: input.attemptId,
      provider: input.offering.provider,
      model: input.offering.modelId,
      entries,
    };
  }

  async settle(input: ManagedCapabilitySettlement): Promise<void> {
    await Promise.all(
      input.reservation.entries.map((entry) => {
        const measured =
          input.outcome === "completed"
            ? actualQuantity(entry, input.usage)
            : input.dispatched
              ? { quantity: entry.maximumQuantity, authoritative: false }
              : { quantity: "0", authoritative: true };
        return this.ledger.settle({
          accountId: input.reservation.accountId,
          reservationId: entry.reservationId,
          actualQuantity: measured.quantity,
          outcome: input.outcome,
          authoritative: measured.authoritative,
          provider: input.reservation.provider,
          model: input.reservation.model,
          evidenceRef:
            input.evidenceRef ??
            (input.outcome === "completed"
              ? measured.authoritative
                ? "capability-registry-provider-usage"
                : "capability-registry-reserved-maximum"
              : input.dispatched
                ? input.ambiguous
                  ? "capability-registry-ambiguous-post-dispatch"
                  : "capability-registry-post-dispatch-failure"
                : "capability-registry-pre-dispatch-failure"),
        });
      }),
    );
  }
}

let defaultBroker: ManagedCapabilityExecutionBroker | undefined;

export function defaultManagedCapabilityExecutionBroker() {
  defaultBroker ??= new DefaultManagedCapabilityExecutionBroker(
    new ManagedCostControls(db.$client),
    managedUsage(),
  );
  return defaultBroker;
}
