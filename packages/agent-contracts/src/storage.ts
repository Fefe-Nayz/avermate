import { z } from "zod";

const boundedIdSchema = z.string().min(1).max(256);
const opaqueObjectKeySchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("//") &&
      value.split("/").every((part) => part !== "." && part !== ".."),
    "object keys must be opaque relative paths without traversal",
  );

export const objectSha256Schema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "expected a lowercase sha256 digest");
export type ObjectSha256 = z.infer<typeof objectSha256Schema>;

export const ownedObjectRefSchema = z.strictObject({
  ownerId: boundedIdSchema,
  namespace: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9-]*$/u),
  key: opaqueObjectKeySchema,
});
export type OwnedObjectRef = z.infer<typeof ownedObjectRefSchema>;

export const objectStorageCapabilitiesSchema = z.strictObject({
  providerId: boundedIdSchema,
  maxObjectBytes: z.number().int().positive(),
  maxPartBytes: z.number().int().positive(),
  minPartBytes: z.number().int().positive(),
  multipart: z.boolean(),
  range: z.boolean(),
  copy: z.boolean(),
  reconcile: z.boolean(),
  directTransfer: z.boolean(),
  checksumAlgorithms: z.tuple([z.literal("sha256")]),
});
export type ObjectStorageCapabilities = z.infer<
  typeof objectStorageCapabilitiesSchema
>;

export const objectStorageMetadataSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  byteSize: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(255),
  digest: objectSha256Schema,
  etag: z.string().min(1).max(256),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ObjectStorageMetadata = z.infer<typeof objectStorageMetadataSchema>;

export const objectStorageStatInputSchema = z.strictObject({
  ref: ownedObjectRefSchema,
});
export type ObjectStorageStatInput = z.infer<
  typeof objectStorageStatInputSchema
>;

export const objectStorageGetInputSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  maxBytes: z.number().int().positive().optional(),
});
export type ObjectStorageGetInput = z.infer<typeof objectStorageGetInputSchema>;

export const objectStorageRangeInputSchema = z
  .strictObject({
    ref: ownedObjectRefSchema,
    start: z.number().int().nonnegative(),
    endInclusive: z.number().int().nonnegative(),
  })
  .refine(({ start, endInclusive }) => endInclusive >= start, {
    message: "range end must not precede its start",
  });
export type ObjectStorageRangeInput = z.infer<
  typeof objectStorageRangeInputSchema
>;

export type ObjectStorageRange = {
  metadata: ObjectStorageMetadata;
  start: number;
  endInclusive: number;
  totalBytes: number;
  body: ReadableStream<Uint8Array>;
};

export type ObjectStoragePutInput = {
  ref: OwnedObjectRef;
  body: ReadableStream<Uint8Array>;
  byteSize: number;
  mimeType: string;
  expectedDigest: ObjectSha256;
  idempotencyKey: string;
};

export const objectStorageCommitSchema = objectStorageMetadataSchema.extend({
  replayed: z.boolean(),
});
export type ObjectStorageCommit = z.infer<typeof objectStorageCommitSchema>;

export const objectStorageDeleteInputSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  expectedDigest: objectSha256Schema.optional(),
  idempotencyKey: boundedIdSchema,
});
export type ObjectStorageDeleteInput = z.infer<
  typeof objectStorageDeleteInputSchema
>;

export const objectStorageDeleteResultSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  deleted: z.boolean(),
  alreadyAbsent: z.boolean(),
});
export type ObjectStorageDeleteResult = z.infer<
  typeof objectStorageDeleteResultSchema
>;

export const multipartBeginInputSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  byteSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(255),
  expectedDigest: objectSha256Schema,
  idempotencyKey: boundedIdSchema,
});
export type MultipartBeginInput = z.infer<typeof multipartBeginInputSchema>;

export const multipartHandleSchema = z.strictObject({
  uploadId: boundedIdSchema,
  ref: ownedObjectRefSchema,
  byteSize: z.number().int().positive(),
  expectedDigest: objectSha256Schema,
  expiresAt: z.iso.datetime({ offset: true }),
  replayed: z.boolean(),
});
export type MultipartHandle = z.infer<typeof multipartHandleSchema>;

export type MultipartPartInput = {
  uploadId: string;
  ownerId: string;
  partNumber: number;
  body: ReadableStream<Uint8Array>;
  byteSize: number;
  expectedDigest: ObjectSha256;
};

export const multipartPartReceiptSchema = z.strictObject({
  uploadId: boundedIdSchema,
  partNumber: z.number().int().positive().max(10_000),
  byteSize: z.number().int().positive(),
  digest: objectSha256Schema,
  etag: z.string().min(1).max(256),
  replayed: z.boolean(),
});
export type MultipartPartReceipt = z.infer<typeof multipartPartReceiptSchema>;

export const multipartCompleteInputSchema = z.strictObject({
  uploadId: boundedIdSchema,
  ownerId: boundedIdSchema,
  parts: z
    .array(
      z.strictObject({
        partNumber: z.number().int().positive().max(10_000),
        etag: z.string().min(1).max(256),
      }),
    )
    .min(1)
    .max(10_000),
});
export type MultipartCompleteInput = z.infer<
  typeof multipartCompleteInputSchema
>;

export const multipartAbortInputSchema = z.strictObject({
  uploadId: boundedIdSchema,
  ownerId: boundedIdSchema,
});
export type MultipartAbortInput = z.infer<typeof multipartAbortInputSchema>;

export const objectStorageCopyInputSchema = z.strictObject({
  source: ownedObjectRefSchema,
  destination: ownedObjectRefSchema,
  expectedSourceDigest: objectSha256Schema,
  idempotencyKey: boundedIdSchema,
});
export type ObjectStorageCopyInput = z.infer<
  typeof objectStorageCopyInputSchema
>;

export const objectStorageReconcileInputSchema = z.strictObject({
  ownerId: boundedIdSchema,
  namespace: z.string().min(1).max(128),
  afterKey: opaqueObjectKeySchema.optional(),
  limit: z.number().int().positive().max(1_000).default(250),
});
export type ObjectStorageReconcileInput = z.infer<
  typeof objectStorageReconcileInputSchema
>;
export type ObjectStorageEntry = ObjectStorageMetadata;

export const objectTransferGrantInputSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  operation: z.enum(["upload", "download"]),
  mode: z.enum(["core-relay", "direct-https"]),
  byteLimit: z.number().int().positive(),
  expectedDigest: objectSha256Schema.optional(),
  audience: boundedIdSchema,
  expiresInSeconds: z
    .number()
    .int()
    .min(10)
    .max(15 * 60),
});
export type ObjectTransferGrantInput = z.infer<
  typeof objectTransferGrantInputSchema
>;

export const objectTransferGrantSchema = z.strictObject({
  grantId: boundedIdSchema,
  ref: ownedObjectRefSchema,
  operation: z.enum(["upload", "download"]),
  mode: z.enum(["core-relay", "direct-https"]),
  audience: boundedIdSchema,
  byteLimit: z.number().int().positive(),
  expectedDigest: objectSha256Schema.optional(),
  expiresAt: z.iso.datetime({ offset: true }),
  token: z.string().min(32).max(8_192),
});
export type ObjectTransferGrant = z.infer<typeof objectTransferGrantSchema>;

export interface ObjectStorageProvider {
  readonly id: string;
  capabilities(): Promise<ObjectStorageCapabilities>;
  stat(input: ObjectStorageStatInput): Promise<ObjectStorageMetadata | null>;
  get(input: ObjectStorageGetInput): Promise<ReadableStream<Uint8Array>>;
  getRange(input: ObjectStorageRangeInput): Promise<ObjectStorageRange>;
  put(input: ObjectStoragePutInput): Promise<ObjectStorageCommit>;
  delete(input: ObjectStorageDeleteInput): Promise<ObjectStorageDeleteResult>;
  beginMultipart(input: MultipartBeginInput): Promise<MultipartHandle>;
  uploadPart(input: MultipartPartInput): Promise<MultipartPartReceipt>;
  completeMultipart(
    input: MultipartCompleteInput,
  ): Promise<ObjectStorageCommit>;
  abortMultipart(input: MultipartAbortInput): Promise<void>;
  copy?(input: ObjectStorageCopyInput): Promise<ObjectStorageCommit>;
  reconcile(
    input: ObjectStorageReconcileInput,
  ): AsyncIterable<ObjectStorageEntry>;
  authorizeTransfer(
    input: ObjectTransferGrantInput,
  ): Promise<ObjectTransferGrant>;
}
