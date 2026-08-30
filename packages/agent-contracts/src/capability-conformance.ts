import {
  canonicalCapabilityJson,
  capabilityKindSchema,
  capabilityOfferingSchema,
  capabilityPlacementKindSchema,
  capabilityPurposeSchema,
  type CapabilityKind,
  type CapabilityOfferingSnapshot,
} from "./capability";
import { z } from "zod";
import {
  capabilityRequestSchemas,
  capabilityResultSchemas,
  type CapabilityAttemptContext,
  type CapabilityRequestMap,
  type CapabilityResultMap,
  type UnaryCapabilityAdapter,
} from "./capability-operation";

export type CapabilityConformanceCheck = {
  name: string;
  passed: true;
};

const liveDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const liveIdentifierSchema = z.string().trim().min(1).max(256);

const liveObservedValueSchema = z.union([
  z.string().trim().max(1_024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/**
 * Secret-free, digest-bound evidence emitted only by explicit live gates.
 * Normal unit/fixture CI never needs provider credentials and never fabricates
 * one of these records.
 */
export const capabilityLiveEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evidenceType: z.literal("avermate.capability-live/v1"),
    runId: liveIdentifierSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    sourceRevision: liveIdentifierSchema,
    capability: capabilityKindSchema,
    purpose: capabilityPurposeSchema,
    pluginId: liveIdentifierSchema,
    pluginVersion: liveIdentifierSchema,
    adapterRevision: liveIdentifierSchema,
    offeringId: liveIdentifierSchema,
    offeringDigest: liveDigestSchema,
    routePlanDigest: liveDigestSchema.nullable(),
    operationId: liveIdentifierSchema.nullable(),
    placement: capabilityPlacementKindSchema,
    status: z.enum(["passed", "failed"]),
    failureCode: liveIdentifierSchema.nullable(),
    durationMs: z.number().int().nonnegative().max(86_400_000),
    resultDigest: liveDigestSchema.nullable(),
    observedFeatures: z.record(
      z.string().trim().min(1).max(128),
      liveObservedValueSchema,
    ),
    checks: z
      .array(
        z.strictObject({
          name: z.string().trim().min(1).max(256),
          passed: z.boolean(),
        }),
      )
      .min(1)
      .max(256),
  })
  .superRefine((evidence, context) => {
    if (Object.keys(evidence.observedFeatures).length > 256) {
      context.addIssue({
        code: "custom",
        path: ["observedFeatures"],
        message: "live evidence contains too many observed features",
      });
    }
    if (evidence.status === "passed" && evidence.failureCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "passed live evidence cannot contain a failure code",
      });
    }
    if (
      evidence.status === "passed" &&
      (evidence.routePlanDigest === null ||
        evidence.operationId === null ||
        evidence.resultDigest === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "passed live evidence requires operation, route and result digests",
      });
    }
    if (evidence.status === "failed" && evidence.failureCode === null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "failed live evidence requires a safe failure code",
      });
    }
  });
export type CapabilityLiveEvidence = z.infer<
  typeof capabilityLiveEvidenceSchema
>;

export type CapabilityAdapterConformanceInput<K extends CapabilityKind> = {
  offering: CapabilityOfferingSnapshot<K>;
  createAdapter():
    Promise<UnaryCapabilityAdapter<K>> | UnaryCapabilityAdapter<K>;
  context: CapabilityAttemptContext;
  validInput: CapabilityRequestMap[K];
};

/**
 * Provider-neutral smoke suite used by plugin unit tests and live gates.
 * Capability-specific fixture suites remain responsible for semantic checks
 * such as embedding dimensions, timestamp ordering and output MIME types.
 */
export async function runCapabilityAdapterConformance<K extends CapabilityKind>(
  input: CapabilityAdapterConformanceInput<K>,
): Promise<CapabilityConformanceCheck[]> {
  const checks: CapabilityConformanceCheck[] = [];
  const parsedOffering = capabilityOfferingSchema.parse(input.offering);
  checks.push({ name: "offering parses strictly", passed: true });

  const adapter = await input.createAdapter();
  if (adapter.kind !== parsedOffering.capability) {
    throw new Error("adapter kind does not match its offering");
  }
  checks.push({ name: "adapter kind matches offering", passed: true });

  const first = canonicalCapabilityJson(adapter.descriptor());
  const second = canonicalCapabilityJson(adapter.descriptor());
  if (first !== second || first !== canonicalCapabilityJson(parsedOffering)) {
    throw new Error("adapter descriptor is unstable or differs from offering");
  }
  if (/secret|api[-_]?key|bearer\s|authorization/iu.test(first)) {
    throw new Error("adapter descriptor appears to serialize a secret");
  }
  checks.push({ name: "descriptor is stable and secret-free", passed: true });

  const requestSchema = capabilityRequestSchemas[adapter.kind];
  const request = requestSchema.parse(
    input.validInput,
  ) as CapabilityRequestMap[K];
  checks.push({ name: "request parses strictly", passed: true });

  if (input.context.signal.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
  const result = await adapter.invoke(input.context, request);
  capabilityResultSchemas[adapter.kind].parse(result);
  checks.push({ name: "result parses strictly", passed: true });

  return checks;
}

export type FakeCapabilityAdapterStep<K extends CapabilityKind> =
  | { type: "result"; result: CapabilityResultMap[K] }
  | { type: "error"; error: Error }
  | { type: "wait-for-abort" };

/** Deterministic fake used by executor, retry, fence and health tests. */
export class FakeUnaryCapabilityAdapter<
  K extends CapabilityKind,
> implements UnaryCapabilityAdapter<K> {
  readonly kind: K;
  readonly calls: Array<{
    context: CapabilityAttemptContext;
    input: CapabilityRequestMap[K];
  }> = [];
  #steps: FakeCapabilityAdapterStep<K>[];

  constructor(
    readonly offering: CapabilityOfferingSnapshot<K>,
    steps: readonly FakeCapabilityAdapterStep<K>[],
  ) {
    this.kind = offering.capability;
    this.#steps = [...steps];
  }

  descriptor(): CapabilityOfferingSnapshot<K> {
    return structuredClone(this.offering);
  }

  async invoke(
    context: CapabilityAttemptContext,
    input: CapabilityRequestMap[K],
  ): Promise<CapabilityResultMap[K]> {
    if (context.signal.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    this.calls.push({ context, input });
    const step = this.#steps.shift();
    if (!step) throw new Error("fake capability adapter has no scripted step");
    if (step.type === "result") return structuredClone(step.result);
    if (step.type === "error") throw step.error;
    return new Promise<CapabilityResultMap[K]>((_, reject) => {
      const abort = () => {
        context.signal.removeEventListener("abort", abort);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      context.signal.addEventListener("abort", abort, { once: true });
    });
  }
}
