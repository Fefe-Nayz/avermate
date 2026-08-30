import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  capabilityKindSchema,
  capabilityLiveEvidenceSchema,
  capabilityRequestSchemas,
  type CapabilityKind,
  type CapabilityRequestMap,
  type CapabilityResultMap,
} from "@avermate/agent-contracts";
import { capabilityRegistryInvoker } from "../src/capabilities/registry-invoker";
import { CapabilityOfferingStore } from "../src/capabilities/offering-store";
import { CapabilityOperationStore } from "../src/capabilities/operation-store";
import { normalizeCapabilityError } from "../src/capabilities/errors";
import { capabilityDigest } from "../src/capabilities/values";
import { newId } from "../src/lib/id";
import { executeCapabilityLiveRequest } from "./capability-live-execution";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`CAPABILITY_LIVE_REQUIRED:${name}`);
  return value;
}

function sourceRevision() {
  const configured = process.env.GITHUB_SHA?.trim();
  if (configured) return configured;
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: resolve(import.meta.dir, "../../.."),
    stdout: "pipe",
    stderr: "ignore",
  });
  const revision = result.success
    ? new TextDecoder().decode(result.stdout).trim()
    : "unknown-revision";
  return revision || "unknown-revision";
}

function readInput(capability: CapabilityKind) {
  const inline = process.env.CAPABILITY_LIVE_INPUT_JSON?.trim();
  const inputPath = process.env.CAPABILITY_LIVE_INPUT_PATH?.trim();
  if (Boolean(inline) === Boolean(inputPath)) {
    throw new Error(
      "CAPABILITY_LIVE_INPUT_EXACTLY_ONE_OF_JSON_OR_PATH_REQUIRED",
    );
  }
  const raw = inline
    ? inline
    : Bun.file(resolve(process.cwd(), inputPath!)).text();
  return Promise.resolve(raw).then((value) =>
    capabilityRequestSchemas[capability].parse(JSON.parse(value)),
  ) as Promise<CapabilityRequestMap[CapabilityKind]>;
}

function observedFeatures<K extends CapabilityKind>(
  capability: K,
  result: CapabilityResultMap[K],
): Record<string, string | number | boolean | null> {
  switch (capability) {
    case "language.generate": {
      const value = result as CapabilityResultMap["language.generate"];
      return {
        nonEmptyText: value.text.length > 0,
        outputCharacters: value.text.length,
        finishReason: value.finishReason,
      };
    }
    case "embedding.generate": {
      const value = result as CapabilityResultMap["embedding.generate"];
      return {
        vectorCount: value.vectors.length,
        dimensions: value.dimensions,
        finiteVectors: value.vectors.every((vector) =>
          vector.every(Number.isFinite),
        ),
        embeddingSpaceId: value.embeddingSpaceId,
      };
    }
    case "rerank.score": {
      const value = result as CapabilityResultMap["rerank.score"];
      return {
        scoreCount: value.scores.length,
        finiteScores: value.scores.every((score) =>
          Number.isFinite(score.score),
        ),
      };
    }
    case "speech.transcribe": {
      const value = result as CapabilityResultMap["speech.transcribe"];
      return {
        nonEmptyTranscript: value.text.trim().length > 0,
        segmentCount: value.segments.length,
        segmentTimestamps: value.segments.every(
          (segment) => segment.endMs >= segment.startMs,
        ),
        language: value.language,
      };
    }
    case "speech.synthesize": {
      const value = result as CapabilityResultMap["speech.synthesize"];
      return {
        nonEmptyAudio: value.audio.byteSize > 0,
        mimeType: value.mimeType,
        alignment: value.alignment !== null,
      };
    }
    case "document.ocr": {
      const value = result as CapabilityResultMap["document.ocr"];
      return {
        pageCount: value.pageCount,
        orderedPages: value.pages.every(
          (page, index) =>
            index === 0 || page.page > value.pages[index - 1]!.page,
        ),
        language: value.language,
      };
    }
    case "document.extract": {
      const value = result as CapabilityResultMap["document.extract"];
      return {
        sectionCount: value.document.sections.length,
        assetCount: value.document.assets.length,
        preservesLocators: value.document.sections.every((section) =>
          Boolean(section.sourceLocator.value),
        ),
      };
    }
    case "image.generate": {
      const value = result as CapabilityResultMap["image.generate"];
      return {
        imageCount: value.images.length,
        nonEmptyImages: value.images.every((image) => image.byteSize > 0),
      };
    }
    case "video.generate": {
      const value = result as CapabilityResultMap["video.generate"];
      return {
        nonEmptyVideo: value.video.byteSize > 0,
        durationSeconds: value.durationSeconds,
      };
    }
  }
}

const capability = capabilityKindSchema.parse(required("CAPABILITY_LIVE_KIND"));
const purpose = required("CAPABILITY_LIVE_PURPOSE");
const ownerId = required("CAPABILITY_LIVE_OWNER_ID");
const expectedOfferingId = required("CAPABILITY_LIVE_OFFERING_ID");
const evidencePath = resolve(
  process.cwd(),
  process.env.CAPABILITY_LIVE_EVIDENCE_PATH?.trim() ||
    `capability-live-${capability.replaceAll(".", "-")}.json`,
);
const runId =
  process.env.CAPABILITY_LIVE_RUN_ID?.trim() ||
  `${process.env.GITHUB_RUN_ID?.trim() || newId("clive")}-${process.env.GITHUB_RUN_ATTEMPT?.trim() || "1"}`;
const revision = sourceRevision();
const request = await readInput(capability);
const offerings = new CapabilityOfferingStore();
const operations = new CapabilityOperationStore();
const expectedOffering = await offerings.get(ownerId, expectedOfferingId);
if (!expectedOffering || expectedOffering.capability !== capability) {
  throw new Error("CAPABILITY_LIVE_EXPECTED_OFFERING_UNAVAILABLE");
}

const startedAt = Date.now();
const idempotencyKey = `live:${runId}:${capability}`;
const route = {
  offeringId: expectedOffering.id,
  provider: expectedOffering.provider,
  modelId: expectedOffering.modelId,
  modelRevision: expectedOffering.modelRevision,
};
let exitFailure: Error | null = null;
let result: CapabilityResultMap[CapabilityKind] | null = null;
try {
  const selected = await capabilityRegistryInvoker.resolve({
    ownerId,
    capability,
    purpose,
    route,
  });
  if (selected.offeringId !== expectedOfferingId) {
    throw new Error("CAPABILITY_LIVE_ROUTE_MISMATCH");
  }
  result = await executeCapabilityLiveRequest(
    {
      ownerId,
      capability,
      purpose,
      request,
      idempotencyKey,
      route,
    },
    capabilityRegistryInvoker,
  );
} catch (error) {
  exitFailure = error instanceof Error ? error : new Error("LIVE_GATE_FAILED");
}

const operation = await operations.findByIdempotencyKey(
  ownerId,
  capability,
  idempotencyKey,
);
const detail = operation
  ? await operations.detail(ownerId, operation.id)
  : null;
if (!exitFailure && capability === "language.generate" && operation) {
  result = await operations.getResult(
    ownerId,
    operation.id,
    "language.generate",
  );
}
const completedAttempt = detail?.attempts.find(
  (attempt) => attempt.state === "completed",
);
const executedOffering = completedAttempt
  ? await offerings.get(ownerId, completedAttempt.offeringId)
  : expectedOffering;
if (!executedOffering) {
  throw new Error("CAPABILITY_LIVE_EXECUTED_OFFERING_UNAVAILABLE");
}
const normalizedFailure = exitFailure
  ? normalizeCapabilityError(exitFailure)
  : null;
const passed = Boolean(
  !normalizedFailure &&
  result &&
  operation?.state === "completed" &&
  operation.routePlan &&
  operation.resultDigest &&
  completedAttempt &&
  executedOffering,
);
const evidence = capabilityLiveEvidenceSchema.parse({
  schemaVersion: 1,
  evidenceType: "avermate.capability-live/v1",
  runId,
  generatedAt: new Date().toISOString(),
  sourceRevision: revision,
  capability,
  purpose,
  pluginId: executedOffering.pluginId,
  pluginVersion: executedOffering.pluginVersion,
  adapterRevision: executedOffering.adapterRevision,
  offeringId: executedOffering.id,
  offeringDigest: capabilityDigest(executedOffering),
  routePlanDigest: operation?.routePlan?.digest ?? null,
  operationId: operation?.id ?? null,
  placement: executedOffering.placement.kind,
  status: passed ? "passed" : "failed",
  failureCode: passed
    ? null
    : (normalizedFailure?.code ??
      operation?.safeErrorCode ??
      "LIVE_GATE_FAILED"),
  durationMs: Math.max(0, Date.now() - startedAt),
  resultDigest: operation?.resultDigest ?? null,
  observedFeatures:
    passed && result ? observedFeatures(capability, result) : {},
  checks: [
    {
      name: "registry selected the expected offering",
      passed: operation?.routePlan?.primary.offeringId === expectedOfferingId,
    },
    {
      name: "at least one frozen attempt completed",
      passed: Boolean(completedAttempt),
    },
    {
      name: "operation persisted a validated result",
      passed: operation?.state === "completed" && operation.hasResult,
    },
  ],
});

await mkdir(dirname(evidencePath), { recursive: true });
await Bun.write(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
if (!passed) {
  throw new Error(`CAPABILITY_LIVE_FAILED:${evidence.failureCode}`);
}
