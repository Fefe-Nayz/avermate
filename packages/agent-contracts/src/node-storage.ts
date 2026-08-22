import { z } from "zod";
import { signedNodeCapabilityGrantSchema } from "./node";
import { objectStorageMetadataSchema } from "./storage";

export const nodeStorageOperationSchema = z.enum([
  "stat",
  "get",
  "get-range",
  "put",
  "delete",
  "multipart-begin",
  "multipart-part",
  "multipart-complete",
  "multipart-abort",
  "copy",
  "reconcile",
  "authorize-transfer",
]);
export type NodeStorageOperation = z.infer<typeof nodeStorageOperationSchema>;

export const nodeStorageRequestEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  requestId: z.string().min(1).max(256),
  nodeId: z.string().min(1).max(256),
  operation: nodeStorageOperationSchema,
  input: z.unknown(),
  bodyByteSize: z.number().int().nonnegative().nullable(),
  bodyDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .nullable(),
  grant: signedNodeCapabilityGrantSchema,
});
export type NodeStorageRequestEnvelope = z.infer<
  typeof nodeStorageRequestEnvelopeSchema
>;

export const nodeStorageResponseEnvelopeSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    version: z.literal(1),
    requestId: z.string().min(1).max(256),
    ok: z.literal(true),
    data: z.unknown(),
    bodyByteSize: z.number().int().nonnegative().nullable(),
    bodyDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable(),
  }),
  z.strictObject({
    version: z.literal(1),
    requestId: z.string().min(1).max(256),
    ok: z.literal(false),
    error: z.strictObject({
      code: z.string().min(1).max(128),
      message: z.string().min(1).max(512),
      retryable: z.boolean(),
    }),
    bodyByteSize: z.null(),
    bodyDigest: z.null(),
  }),
]);
export type NodeStorageResponseEnvelope = z.infer<
  typeof nodeStorageResponseEnvelopeSchema
>;

export const nodeStorageRangeDataSchema = z
  .strictObject({
    metadata: objectStorageMetadataSchema,
    start: z.number().int().nonnegative(),
    endInclusive: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  })
  .refine(
    ({ start, endInclusive, totalBytes, metadata }) =>
      endInclusive >= start &&
      endInclusive < totalBytes &&
      totalBytes === metadata.byteSize,
    "invalid storage range response",
  );
export type NodeStorageRangeData = z.infer<typeof nodeStorageRangeDataSchema>;

export type NodeStorageWireRequest = {
  envelope: NodeStorageRequestEnvelope;
  body?: ReadableStream<Uint8Array>;
};

export type NodeStorageWireResponse = {
  envelope: NodeStorageResponseEnvelope;
  body?: ReadableStream<Uint8Array>;
};

export interface NodeStorageTransport {
  online(nodeId: string): Promise<boolean>;
  exchange(request: NodeStorageWireRequest): Promise<NodeStorageWireResponse>;
}
