import { z } from "zod";
import { sourceLocatorV1Schema } from "./corpus";

const boundedId = z.string().min(1).max(256);
const contentDigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u, "expected a lowercase SHA-256 digest");

/**
 * Provider tokenizers price visual inputs differently and their accounting can
 * change independently of a stored derivative. Context packing therefore uses
 * a deliberately coarse, provider-neutral upper-bound per visual unit instead
 * of presenting a provider-specific estimate as exact accounting.
 */
export const CONSERVATIVE_CONTEXT_MEDIA_INPUT_TOKENS = 8_192 as const;
export const CONTEXT_MEDIA_TOKEN_ESTIMATION_POLICY =
  "conservative-provider-neutral-v1" as const;

/**
 * An opaque server-side reference. Context contracts deliberately never carry
 * storage keys, provider URLs or inline bytes across the durable boundary.
 */
export const contextAssetHandleSchema = z
  .string()
  .regex(/^cah1\.[A-Za-z0-9_-]{32,4096}$/u)
  .brand<"ContextAssetHandle">();
export type ContextAssetHandle = z.infer<typeof contextAssetHandleSchema>;

const optionalEvidenceSchema = z
  .strictObject({
    chunkId: boundedId.nullable(),
    locator: sourceLocatorV1Schema.nullable(),
    digest: contentDigestSchema.nullable(),
  })
  .refine(
    ({ locator, digest }) => (locator === null) === (digest === null),
    "Text evidence must provide locator and digest together",
  );

export const contextTextPartSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().max(2_000_000),
  mime: z.string().min(1).max(256),
  evidence: optionalEvidenceSchema,
});

const contextMediaEvidenceSchema = z.strictObject({
  chunkId: boundedId.nullable(),
  locator: sourceLocatorV1Schema,
  digest: contentDigestSchema,
});

export const contextImagePartSchema = z.strictObject({
  type: z.literal("image"),
  assetHandle: contextAssetHandleSchema,
  mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
  evidence: contextMediaEvidenceSchema,
  estimatedInputTokens: z
    .literal(CONSERVATIVE_CONTEXT_MEDIA_INPUT_TOKENS)
    .optional(),
  tokenEstimationPolicy: z
    .literal(CONTEXT_MEDIA_TOKEN_ESTIMATION_POLICY)
    .optional(),
  /** OCR, caption or other owner-authorized text used for text-only models. */
  fallbackText: z.string().min(1).max(2_000_000),
});

export const contextPdfPagePartSchema = z
  .strictObject({
    type: z.literal("pdf-page"),
    assetHandle: contextAssetHandleSchema,
    mime: z.literal("application/pdf"),
    evidence: contextMediaEvidenceSchema,
    estimatedInputTokens: z
      .literal(CONSERVATIVE_CONTEXT_MEDIA_INPUT_TOKENS)
      .optional(),
    tokenEstimationPolicy: z
      .literal(CONTEXT_MEDIA_TOKEN_ESTIMATION_POLICY)
      .optional(),
    /** OCR/native text for this exact page, never an implicit empty fallback. */
    fallbackText: z.string().min(1).max(2_000_000),
  })
  .refine(({ evidence }) => evidence.locator.kind === "pdf", {
    path: ["evidence", "locator"],
    message: "A PDF page context part requires a PDF page locator",
  });

export const contextPartSchema = z.discriminatedUnion("type", [
  contextTextPartSchema,
  contextImagePartSchema,
  contextPdfPagePartSchema,
]);
export type ContextPart = z.infer<typeof contextPartSchema>;

export const contextTrustSchema = z.enum([
  "system-policy",
  "user-instruction",
  "application-data",
  "retrieved-untrusted",
  "tool-result",
]);
export type ContextTrust = z.infer<typeof contextTrustSchema>;

export const contextBlockSchema = z.strictObject({
  id: z.string().min(1).max(256),
  trust: contextTrustSchema,
  mediaType: z.string().min(1).max(256),
  /**
   * Canonical structured content when present. `content` remains required as
   * the bounded legacy/text projection so version-1 manifests round-trip.
   */
  parts: z.array(contextPartSchema).min(1).max(256).optional(),
  content: z.string().max(2_000_000),
  sourceRef: z.string().min(1).max(512).nullable(),
  redactions: z.array(z.string().min(1).max(256)).max(1_000).default([]),
});
export type ContextBlock = z.infer<typeof contextBlockSchema>;

export const agentPolicySnapshotSchema = z.strictObject({
  policyVersion: z.string().min(1).max(128),
  approvalMode: z.enum(["auto-read", "confirm-medium", "confirm-all"]),
  grantedScopes: z.array(z.string().min(1).max(256)).max(1_000),
  deniedScopes: z.array(z.string().min(1).max(256)).max(1_000),
  allowedModelOrigins: z.array(z.url()).max(100),
});
export type AgentPolicySnapshot = z.infer<typeof agentPolicySnapshotSchema>;

export const contextManifestSchema = z.strictObject({
  manifestVersion: z.literal(1),
  policy: agentPolicySnapshotSchema,
  blocks: z.array(contextBlockSchema).max(10_000),
});
export type ContextManifest = z.infer<typeof contextManifestSchema>;

export function createContextManifest(
  input: z.input<typeof contextManifestSchema>,
): ContextManifest {
  return contextManifestSchema.parse(input);
}
