import { createHash } from "node:crypto";
import type {
  ObjectStorageProvider,
  ObjectStorageCommit,
  OwnedObjectRef,
} from "./storage";

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function digest(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stream(value: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    chunks.push(item.value);
    total += item.value.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function equal(left: Uint8Array, right: Uint8Array) {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`storage conformance: ${message}`);
}

async function mustReject(operation: Promise<unknown>, code: string) {
  try {
    await operation;
  } catch (error) {
    assert(
      (error as Error).message.includes(code),
      `expected ${code}, got ${(error as Error).message}`,
    );
    return;
  }
  throw new Error(`storage conformance: expected ${code} rejection`);
}

export type StorageConformanceReport = {
  providerId: string;
  passed: string[];
};

/**
 * Reusable behavior suite for Core and Node placements. It intentionally uses
 * only the public provider contract and can be invoked from Bun tests, CI or a
 * real-provider opt-in runner.
 */
export async function runObjectStorageConformance(
  provider: ObjectStorageProvider,
): Promise<StorageConformanceReport> {
  const passed: string[] = [];
  const capability = await provider.capabilities();
  assert(
    capability.providerId === provider.id,
    "capability provider id mismatch",
  );
  assert(capability.range, "range support is mandatory");
  passed.push("capabilities");

  const ref: OwnedObjectRef = {
    ownerId: "conformance-user-a",
    namespace: "conformance",
    key: `single/${crypto.randomUUID()}`,
  };
  const original = bytes("Bonjour Avermate — exact bytes");
  const originalDigest = digest(original);
  const first = await provider.put({
    ref,
    body: stream(original),
    byteSize: original.byteLength,
    mimeType: "text/plain",
    expectedDigest: originalDigest,
    idempotencyKey: "single-put",
  });
  assert(
    !first.replayed && first.digest === originalDigest,
    "first put must commit exact digest",
  );
  const replay = await provider.put({
    ref,
    body: stream(original),
    byteSize: original.byteLength,
    mimeType: "text/plain",
    expectedDigest: originalDigest,
    idempotencyKey: "single-put",
  });
  assert(replay.replayed, "exact put replay must not write twice");
  assert(
    equal(await collect(await provider.get({ ref })), original),
    "get changed object bytes",
  );
  passed.push("put-get-stat-idempotency");

  const range = await provider.getRange({ ref, start: 2, endInclusive: 8 });
  assert(
    equal(await collect(range.body), original.slice(2, 9)),
    "inclusive range returned different bytes",
  );
  await mustReject(
    provider.getRange({
      ref,
      start: original.byteLength,
      endInclusive: original.byteLength,
    }),
    "OBJECT_RANGE_NOT_SATISFIABLE",
  );
  passed.push("range");

  const changed = bytes("different");
  await mustReject(
    provider.put({
      ref,
      body: stream(changed),
      byteSize: changed.byteLength,
      mimeType: "text/plain",
      expectedDigest: digest(changed),
      idempotencyKey: "different-put",
    }),
    "OBJECT_ALREADY_EXISTS_DIFFERENT_CONTENT",
  );
  const badRef: OwnedObjectRef = { ...ref, key: `${ref.key}-bad-digest` };
  await mustReject(
    provider.put({
      ref: badRef,
      body: stream(changed),
      byteSize: changed.byteLength,
      mimeType: "text/plain",
      expectedDigest: originalDigest,
      idempotencyKey: "bad-digest",
    }),
    "OBJECT_DIGEST_MISMATCH",
  );
  assert(
    (await provider.stat({ ref: badRef })) === null,
    "digest failure published an object",
  );
  passed.push("checksum-failure-atomicity");

  const otherOwnerRef: OwnedObjectRef = {
    ownerId: "conformance-user-b",
    namespace: "conformance",
    key: ref.key,
  };
  assert(
    (await provider.stat({ ref: otherOwnerRef })) === null,
    "owner identity was ignored",
  );
  const otherOwnerBytes = bytes("same logical key, other owner");
  await provider.put({
    ref: otherOwnerRef,
    body: stream(otherOwnerBytes),
    byteSize: otherOwnerBytes.byteLength,
    mimeType: "text/plain",
    expectedDigest: digest(otherOwnerBytes),
    idempotencyKey: "other-owner-put",
  });
  assert(
    equal(await collect(await provider.get({ ref })), original),
    "other owner overwrote the first owner's bytes",
  );
  assert(
    equal(
      await collect(await provider.get({ ref: otherOwnerRef })),
      otherOwnerBytes,
    ),
    "other owner could not independently reuse an opaque key",
  );
  passed.push("owner-isolation");

  if (capability.multipart) {
    const partA = bytes("multipart-");
    const partB = bytes("payload");
    const combined = new Uint8Array(partA.byteLength + partB.byteLength);
    combined.set(partA);
    combined.set(partB, partA.byteLength);
    const multipartRef: OwnedObjectRef = {
      ownerId: ref.ownerId,
      namespace: ref.namespace,
      key: `${ref.key}-multipart`,
    };
    const handle = await provider.beginMultipart({
      ref: multipartRef,
      byteSize: combined.byteLength,
      mimeType: "application/octet-stream",
      expectedDigest: digest(combined),
      idempotencyKey: "multipart-begin",
    });
    const receiptA = await provider.uploadPart({
      uploadId: handle.uploadId,
      ownerId: ref.ownerId,
      partNumber: 1,
      body: stream(partA),
      byteSize: partA.byteLength,
      expectedDigest: digest(partA),
    });
    const receiptB = await provider.uploadPart({
      uploadId: handle.uploadId,
      ownerId: ref.ownerId,
      partNumber: 2,
      body: stream(partB),
      byteSize: partB.byteLength,
      expectedDigest: digest(partB),
    });
    await mustReject(
      provider.completeMultipart({
        uploadId: handle.uploadId,
        ownerId: ref.ownerId,
        parts: [
          { partNumber: receiptB.partNumber, etag: receiptB.etag },
          { partNumber: receiptA.partNumber, etag: receiptA.etag },
        ],
      }),
      "MULTIPART_PART_ORDER_INVALID",
    );
    const complete = await provider.completeMultipart({
      uploadId: handle.uploadId,
      ownerId: ref.ownerId,
      parts: [
        { partNumber: receiptA.partNumber, etag: receiptA.etag },
        { partNumber: receiptB.partNumber, etag: receiptB.etag },
      ],
    });
    assert(complete.digest === digest(combined), "multipart digest changed");
    assert(
      equal(await collect(await provider.get({ ref: multipartRef })), combined),
      "multipart bytes changed",
    );
    passed.push("multipart-resume-complete");
  }

  if (capability.copy && provider.copy) {
    const destination: OwnedObjectRef = { ...ref, key: `${ref.key}-copy` };
    const copied = await provider.copy({
      source: ref,
      destination,
      expectedSourceDigest: originalDigest,
      idempotencyKey: "copy",
    });
    assert(copied.digest === originalDigest, "copy changed digest");
    await mustReject(
      provider.copy({
        source: ref,
        destination: {
          ...destination,
          ownerId: "conformance-user-b",
          key: `${ref.key}-x`,
        },
        expectedSourceDigest: originalDigest,
        idempotencyKey: "cross-owner-copy",
      }),
      "OBJECT_COPY_CROSS_OWNER_DENIED",
    );
    passed.push("copy");
  }

  const visible: ObjectStorageCommit[] = [];
  for await (const entry of provider.reconcile({
    ownerId: ref.ownerId,
    namespace: ref.namespace,
    limit: 250,
  })) {
    visible.push({ ...entry, replayed: false });
  }
  assert(
    visible.some((entry) => entry.ref.key === ref.key),
    "reconciliation omitted owned object",
  );
  assert(
    visible.every((entry) => entry.ref.ownerId === ref.ownerId),
    "reconciliation leaked another owner",
  );
  passed.push("reconcile-scope");

  const transfer = await provider.authorizeTransfer({
    ref,
    operation: "download",
    mode: "core-relay",
    byteLimit: original.byteLength,
    expectedDigest: originalDigest,
    audience: "conformance-browser-session",
    expiresInSeconds: 60,
  });
  assert(
    transfer.ref.key === ref.key && transfer.token.length > 32,
    "transfer grant is not object-bound",
  );
  passed.push("transfer-grant");

  const removed = await provider.delete({
    ref,
    expectedDigest: originalDigest,
    idempotencyKey: "delete",
  });
  assert(removed.deleted, "delete did not report committed removal");
  const removedAgain = await provider.delete({
    ref,
    expectedDigest: originalDigest,
    idempotencyKey: "delete",
  });
  assert(removedAgain.alreadyAbsent, "delete replay was not idempotent");
  await provider.delete({
    ref: otherOwnerRef,
    expectedDigest: digest(otherOwnerBytes),
    idempotencyKey: "other-owner-delete",
  });
  passed.push("delete-idempotency");

  return { providerId: provider.id, passed };
}
