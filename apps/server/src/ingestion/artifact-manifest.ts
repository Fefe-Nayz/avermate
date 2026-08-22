import {
  generatedArtifactManifestV1Schema,
  type GeneratedArtifactKind,
  type GeneratedArtifactManifestV1,
  type ModelRunReference,
} from "@avermate/agent-contracts";
import { canonicalJson, sha256 } from "../search/values";

const LEGACY_KINDS = new Set<GeneratedArtifactKind>([
  "pdf",
  "pptx",
  "audio",
  "image",
  "anki",
  "html",
]);

export interface LegacyDocumentArtifactSnapshot {
  readonly id: string;
  readonly kind: "pdf" | "pptx" | "audio" | "image" | "anki" | "html";
  readonly sourceDocumentId: string;
  readonly sourceRevision: number;
  readonly fileId: string;
  readonly byteDigest: string;
  readonly byteSize?: number;
  readonly mimeType: string;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly createdAt: Date;
}

export function manifestDigest(manifest: GeneratedArtifactManifestV1) {
  return sha256(canonicalJson(generatedArtifactManifestV1Schema.parse(manifest)));
}

export function createArtifactManifest(input: {
  artifactId: string;
  artifactRevisionId: string;
  revision: number;
  kind: GeneratedArtifactKind;
  parentArtifactRevisionIds?: readonly string[];
  sourceVersionIds?: readonly string[];
  workflow: { id: string; version: number };
  modelRuns?: readonly ModelRunReference[];
  renderer: GeneratedArtifactManifestV1["renderer"];
  output: GeneratedArtifactManifestV1["output"];
}) {
  const manifest = generatedArtifactManifestV1Schema.parse({
    schemaVersion: 1,
    kind: input.kind,
    artifactId: input.artifactId,
    artifactRevisionId: input.artifactRevisionId,
    revision: input.revision,
    parentArtifactRevisionIds: [...(input.parentArtifactRevisionIds ?? [])],
    sourceVersionIds: [...(input.sourceVersionIds ?? [])],
    workflow: input.workflow,
    modelRuns: [...(input.modelRuns ?? [])],
    renderer: input.renderer,
    output: input.output,
  });
  return Object.freeze({ manifest, digest: manifestDigest(manifest) });
}

/**
 * Compatibility is deliberately best-effort: old rows retain their exact byte
 * digest but cannot claim an image digest or a replayable historical runtime.
 */
export function manifestFromLegacyDocumentArtifact(
  input: LegacyDocumentArtifactSnapshot,
) {
  if (!LEGACY_KINDS.has(input.kind)) {
    throw new Error(`Unsupported legacy artifact kind: ${input.kind}`);
  }
  if (!/^[a-f0-9]{64}$/u.test(input.byteDigest)) {
    throw new Error("Legacy output digest must be the verified stored byte digest");
  }
  const artifactId = `legacy:${input.id}`;
  const artifactRevisionId = `legacy:${input.id}:r${input.sourceRevision}`;
  const modelRuns =
    input.provider && input.model
      ? [
          {
            runId: `legacy:${input.id}`,
            provider: input.provider,
            model: input.model,
            promptVersion: "legacy-unknown",
            usageRef: null,
          },
        ]
      : [];
  return createArtifactManifest({
    artifactId,
    artifactRevisionId,
    revision: Math.max(1, input.sourceRevision),
    kind: input.kind,
    sourceVersionIds: [],
    workflow: { id: "legacy.document-artifact", version: 1 },
    modelRuns,
    renderer: {
      profile: "legacy.document-artifact.compatibility-reader",
      imageDigest: null,
      toolVersions: {
        reader: "1",
        sourceDocumentRevision: String(input.sourceRevision),
        createdAt: input.createdAt.toISOString(),
      },
      reproducibility: "best-effort",
    },
    output: {
      fileId: input.fileId,
      digest: input.byteDigest,
      bytes: input.byteSize,
      mime: input.mimeType,
    },
  });
}

