import { describe, expect, test } from "bun:test";
import {
  canonicalCapabilityJson,
  capabilityOfferingSchema,
  capabilityPolicySchema,
  frozenCapabilityRoutePlanSchema,
  providerConnectionPublicSnapshotSchema,
  type CapabilityOfferingSnapshot,
} from "./capability";
import {
  emptyCapabilityUsage,
  type CapabilityAttemptContext,
  type SpeechSynthesisRequestV1,
  type SpeechSynthesisResultV1,
} from "./capability-operation";
import {
  capabilityLiveEvidenceSchema,
  FakeUnaryCapabilityAdapter,
  runCapabilityAdapterConformance,
} from "./capability-conformance";
import {
  nodeCapabilityInferenceFeaturesSchema,
  nodeCapabilityRequestDigestPayload,
  nodeCapabilityRequestV1Schema,
  signedNodeCapabilityInvocationGrantSchema,
} from "./capability-node";
import { nodeOperationCapability } from "./node-operations";

const digest = `sha256:${"a".repeat(64)}` as const;
const otherDigest = `sha256:${"b".repeat(64)}` as const;
const now = "2026-08-28T10:00:00.000+00:00";

function ttsOffering(): CapabilityOfferingSnapshot<"speech.synthesize"> {
  return {
    schemaVersion: 1,
    id: "capoff_tts",
    connectionId: "conn_tts",
    connectionRevision: 1,
    pluginId: "ai-sdk.elevenlabs",
    pluginVersion: "1.0.0",
    adapterRevision: "adapter-1",
    capability: "speech.synthesize",
    capabilityProtocolVersion: 1,
    provider: "elevenlabs",
    modelId: "eleven-multilingual-v2",
    modelRevision: "2026-08",
    placement: { kind: "direct-byok", origin: "https://api.elevenlabs.io" },
    dataHandling: {
      egress: "external-provider",
      providerName: "ElevenLabs",
      region: null,
      disclosureRevision: "disclosure-2026-08",
      retentionDisclosureRevision: "privacy-2026-08",
      trainingDisclosureRevision: "training-2026-08",
      requiresExplicitConsent: true,
    },
    limits: {
      maxInputBytes: 1_000_000,
      maxOutputBytes: 32_000_000,
      maxBatchSize: 1,
      maxConcurrency: 4,
    },
    supportedLanguages: ["fr", "en"],
    healthCheckKind: "active-probe",
    specification: {
      streaming: true,
      inputLanguages: ["fr", "en"],
      outputFormats: [
        { container: "mp3", codec: "mp3", sampleRates: [44_100] },
      ],
      speedControl: true,
      pitchControl: false,
      styleControl: true,
      alignment: ["none", "word"],
      voiceCatalogue: "remote",
      voiceCloning: true,
    },
  };
}

describe("capability contracts", () => {
  test("round-trips an offering and rejects unknown fields", () => {
    const offering = ttsOffering();
    expect(
      capabilityOfferingSchema.parse(
        JSON.parse(JSON.stringify(offering)) as unknown,
      ),
    ).toEqual(offering);
    expect(
      capabilityOfferingSchema.safeParse({ ...offering, secret: "never" })
        .success,
    ).toBe(false);
  });

  test("canonical JSON is key-order stable and rejects non-JSON values", () => {
    expect(canonicalCapabilityJson({ z: 1, a: [true, null] })).toBe(
      '{"a":[true,null],"z":1}',
    );
    expect(canonicalCapabilityJson({ a: 1, z: 2 })).toBe(
      canonicalCapabilityJson({ z: 2, a: 1 }),
    );
    expect(() => canonicalCapabilityJson({ bad: undefined })).toThrow(
      "undefined",
    );
  });

  test("public connections cannot accidentally serialize secret material", () => {
    const connection = providerConnectionPublicSnapshotSchema.parse({
      schemaVersion: 1,
      id: "conn_tts",
      ownerKind: "user",
      ownerId: "user_1",
      pluginId: "ai-sdk.elevenlabs",
      pluginVersion: "1.0.0",
      displayName: "My TTS",
      placement: {
        kind: "direct-byok",
        origin: "https://api.elevenlabs.io",
      },
      configVersion: 1,
      config: { region: "eu" },
      configDigest: digest,
      status: "ready",
      revision: 1,
      lastValidatedAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    expect(providerConnectionPublicSnapshotSchema.parse(connection)).toEqual(
      connection,
    );
    expect(
      providerConnectionPublicSnapshotSchema.safeParse({
        ...connection,
        sealedValue: "secret",
      }).success,
    ).toBe(false);
  });

  test("policy modes and frozen routes enforce immutable route invariants", () => {
    const constraints = {
      requiredFeatures: [],
      allowedPlacements: ["direct-byok"] as const,
      allowedProviders: null,
      deniedProviders: [],
      maximumDataEgress: "external-provider" as const,
      allowPrivacyEscalationOnFallback: false,
      maximumEstimatedCostMinor: null,
      preferredLatencyClass: "normal" as const,
      requireUserCredential: true,
      allowManagedCredential: false,
      requireHealthy: true,
    };
    const policy = {
      schemaVersion: 1,
      id: "policy_1",
      ownerId: "user_1",
      scope: { kind: "user", id: "user_1" },
      capability: "speech.synthesize",
      purposePattern: "media.*",
      mode: "ordered",
      primaryOfferingId: "capoff_tts",
      fallbackOfferingIds: ["capoff_backup"],
      constraints,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    expect(capabilityPolicySchema.parse(policy).id).toBe("policy_1");
    expect(
      capabilityPolicySchema.safeParse({
        ...policy,
        mode: "pinned",
      }).success,
    ).toBe(false);

    const route = {
      offeringId: "capoff_tts",
      offeringDescriptorDigest: digest,
      connectionId: "conn_tts",
      connectionRevision: 1,
      credentialSlots: [{ slot: "apiKey", expectedVersion: 1 }],
      consentGrants: [{ id: "consent_1", expectedRevision: 1 }],
      pluginId: "ai-sdk.elevenlabs",
      pluginVersion: "1.0.0",
      adapterRevision: "adapter-1",
      modelId: "eleven-multilingual-v2",
      modelRevision: "2026-08",
      placement: {
        kind: "direct-byok",
        origin: "https://api.elevenlabs.io",
      },
      dataEgress: "external-provider",
      pricingSnapshotId: null,
    } as const;
    expect(
      frozenCapabilityRoutePlanSchema.safeParse({
        version: 1,
        operationId: "op_1",
        ownerId: "user_1",
        capability: "speech.synthesize",
        purpose: "media.podcast-narration",
        policySnapshotDigest: digest,
        primary: route,
        fallbacks: [route],
        constraints,
        createdAt: now,
        digest: otherDigest,
      }).success,
    ).toBe(false);
  });
});

describe("Node capability v1", () => {
  const artifact = {
    object: { ownerId: "user_1", namespace: "media", key: "input/audio.wav" },
    digest,
    byteSize: 128,
    mimeType: "audio/wav",
  } as const;

  test("binds inference offerings and operations to the generic capability", () => {
    const descriptor = {
      ...ttsOffering(),
      id: "capoff_node_tts",
      connectionId: "conn_node",
      placement: {
        kind: "node" as const,
        nodeId: "node_1",
        configRevision: digest,
      },
      dataHandling: {
        ...ttsOffering().dataHandling,
        egress: "owner-node" as const,
      },
    };
    expect(
      nodeCapabilityInferenceFeaturesSchema.parse({
        version: 1,
        offerings: [
          {
            descriptor,
            descriptorDigest: otherDigest,
            runtime: {
              implementation: "piper",
              runtimeRevision: "runtime-1",
              imageDigest: null,
              modelRevision: descriptor.modelRevision,
            },
            network: { egressPolicyDigest: digest },
          },
        ],
        invocationModes: ["unary-relay", "artifact-job"],
        maxConcurrent: 2,
        secretCustody: "node-local",
      }).offerings,
    ).toHaveLength(1);
    expect(nodeOperationCapability("capability.invoke")).toBe("inference");
    expect(nodeOperationCapability("capability.stream")).toBe("inference");
    expect(nodeOperationCapability("capability.artifact-job")).toBe(
      "inference",
    );
  });

  test("request digests exclude only the digest field", () => {
    const request = nodeCapabilityRequestV1Schema.parse({
      schemaVersion: 1,
      operationId: "op_1",
      ownerId: "user_1",
      capability: "speech.transcribe",
      purpose: "recordings.course-transcription",
      offeringId: "capoff_stt",
      offeringDigest: digest,
      configRevision: otherDigest,
      requestDigest: digest,
      inputArtifacts: [artifact],
      input: { timestamps: "segment" },
    });
    expect(nodeCapabilityRequestDigestPayload(request)).not.toHaveProperty(
      "requestDigest",
    );
    expect(nodeCapabilityRequestDigestPayload(request)).toHaveProperty(
      "offeringDigest",
      digest,
    );
  });

  test("invocation grants enforce owner authority and bounded validity", () => {
    const claims = {
      schemaVersion: 1,
      issuer: "core",
      audience: "node_1",
      subject: "user_1",
      ownerId: "user_1",
      nodeId: "node_1",
      operationId: "op_1",
      offeringId: "capoff_stt",
      offeringDigest: digest,
      configRevision: otherDigest,
      requestDigest: digest,
      inputArtifacts: [artifact],
      limits: {
        cpuMillis: 10_000,
        memoryBytes: 1_000_000,
        inputBytes: 128,
        outputBytes: 1_000_000,
        tokenLimit: 0,
        costMinorLimit: 0,
        deadline: "2026-08-28T10:05:00.000+00:00",
      },
      egressPolicyDigest: digest,
      issuedAt: now,
      notBefore: now,
      expiresAt: "2026-08-28T10:10:00.000+00:00",
      jti: "grant_1",
    };
    expect(
      signedNodeCapabilityInvocationGrantSchema.parse({
        claims,
        keyId: "key_1",
        signature: "a".repeat(64),
      }).claims.ownerId,
    ).toBe("user_1");
    expect(
      signedNodeCapabilityInvocationGrantSchema.safeParse({
        claims: {
          ...claims,
          inputArtifacts: [
            {
              ...artifact,
              object: { ...artifact.object, ownerId: "other" },
            },
          ],
        },
        keyId: "key_1",
        signature: "a".repeat(64),
      }).success,
    ).toBe(false);
  });
});

test("fake adapter passes the reusable base conformance suite", async () => {
  const offering = ttsOffering();
  const request: SpeechSynthesisRequestV1 = {
    schemaVersion: 1,
    text: "Bonjour",
    voice: { mode: "profile", profileId: "warm-fr" },
    output: { container: "mp3" },
    alignment: "none",
  };
  const result: SpeechSynthesisResultV1 = {
    schemaVersion: 1,
    audio: {
      object: {
        ownerId: "user_1",
        namespace: "generated-media",
        key: "tts/output.mp3",
      },
      digest,
      byteSize: 128,
      mimeType: "audio/mpeg",
    },
    mimeType: "audio/mpeg",
    durationSeconds: 1,
    voice: { providerVoiceId: "voice_1", revision: null },
    alignment: null,
    usage: emptyCapabilityUsage(),
    providerMetadata: null,
  };
  const adapter = new FakeUnaryCapabilityAdapter(offering, [
    { type: "result", result },
  ]);
  const context: CapabilityAttemptContext = {
    ownerId: "user_1",
    operationId: "op_1",
    attemptId: "attempt_1",
    attemptNumber: 0,
    purpose: "media.podcast-narration",
    offering,
    routePlanDigest: digest,
    deadline: new Date("2026-08-28T10:10:00.000Z"),
    signal: new AbortController().signal,
    authorize: async () => undefined,
    credential: async () => null,
    emit: async () => undefined,
  };
  const checks = await runCapabilityAdapterConformance({
    offering,
    createAdapter: () => adapter,
    context,
    validInput: request,
  });
  expect(checks.map((check) => check.name)).toContain(
    "descriptor is stable and secret-free",
  );
});

test("live capability evidence is strict, digest-bound and secret-free", () => {
  const evidence = {
    schemaVersion: 1 as const,
    evidenceType: "avermate.capability-live/v1" as const,
    runId: "live_20260828_tts",
    generatedAt: now,
    sourceRevision: "revision_1",
    capability: "speech.synthesize" as const,
    purpose: "media.podcast-narration",
    pluginId: "ai-sdk.elevenlabs",
    pluginVersion: "1.0.0",
    adapterRevision: "adapter-1",
    offeringId: "capoff_tts",
    offeringDigest: digest,
    routePlanDigest: otherDigest,
    operationId: "operation_1",
    placement: "direct-byok" as const,
    status: "passed" as const,
    failureCode: null,
    durationMs: 120,
    resultDigest: digest,
    observedFeatures: { mimeType: "audio/mpeg", nonEmptyAudio: true },
    checks: [{ name: "result contract", passed: true }],
  };
  expect(capabilityLiveEvidenceSchema.parse(evidence)).toEqual(evidence);
  expect(
    capabilityLiveEvidenceSchema.safeParse({
      ...evidence,
      apiKey: "must-never-be-serialized",
    }).success,
  ).toBe(false);
  expect(
    capabilityLiveEvidenceSchema.safeParse({
      ...evidence,
      offeringDigest: "sha256:not-a-digest",
    }).success,
  ).toBe(false);
});
