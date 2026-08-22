import {
  capabilityPlacementSchema,
  nodeCapabilityIdSchema,
  type CapabilityPlacement,
  type NodeCapabilityId,
  type ObjectStorageProvider,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import type { InValue } from "@libsql/client";
import { db } from "../db";
import { newId } from "../lib/id";
import {
  headStorageObject,
  putStorageObject,
  readStorageObject,
  storageDriver,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import {
  coreNodeRelay,
  createPairedNodeObjectStorageProvider,
} from "./services";
import { placementMigrationAdapter } from "./placement-migration-adapters";

async function ensureDurableAdapter(capability: NodeCapabilityId) {
  let adapter = placementMigrationAdapter(capability);
  if (adapter || !["conversations", "retrieval"].includes(capability)) {
    return adapter;
  }
  if (capability === "conversations") {
    await import("../assistant/services");
  } else {
    await import("../search/routed-corpus-store");
  }
  adapter = placementMigrationAdapter(capability);
  return adapter;
}

export type PlacementMigrationState =
  | "planned"
  | "copying"
  | "verifying"
  | "ready-to-switch"
  | "switched"
  | "source-retained"
  | "completed"
  | "failed";

export type PlacementMigrationRecord = {
  id: string;
  accountId: string;
  resourceKind: NodeCapabilityId;
  resourceId: string;
  sourcePlacement: CapabilityPlacement;
  destinationPlacement: CapabilityPlacement;
  state: PlacementMigrationState;
  sourceDigest: string | null;
  destinationDigest: string | null;
  copiedBytes: number;
  idempotencyKey: string;
  safeErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type MigrationRow = Record<string, InValue>;
type FileRow = {
  id: string;
  provider: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  purpose: string;
  userId: string;
};

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}

function iso(value: InValue) {
  return new Date(Number(value) * 1_000).toISOString();
}

function parseRow(row: MigrationRow): PlacementMigrationRecord {
  return {
    id: String(row.id),
    accountId: String(row.accountId),
    resourceKind: nodeCapabilityIdSchema.parse(row.resourceKind),
    resourceId: String(row.resourceId),
    sourcePlacement: capabilityPlacementSchema.parse(
      JSON.parse(String(row.sourcePlacementJson)),
    ),
    destinationPlacement: capabilityPlacementSchema.parse(
      JSON.parse(String(row.destinationPlacementJson)),
    ),
    state: String(row.state) as PlacementMigrationState,
    sourceDigest: row.sourceDigest === null ? null : String(row.sourceDigest),
    destinationDigest:
      row.destinationDigest === null ? null : String(row.destinationDigest),
    copiedBytes: Number(row.copiedBytes),
    idempotencyKey: String(row.idempotencyKey),
    safeErrorCode:
      row.safeErrorCode === null ? null : String(row.safeErrorCode),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function safeErrorCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : "MIGRATION_FAILED";
  return /^[A-Z0-9_:-]{3,128}$/u.test(candidate)
    ? candidate
    : "MIGRATION_FAILED";
}

class PlacementMigrationInterrupted extends Error {
  constructor(readonly migration: PlacementMigrationRecord) {
    super("PLACEMENT_MIGRATION_INTERRUPTED");
    this.name = "PlacementMigrationInterrupted";
  }
}

function assertMigrationSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("PLACEMENT_MIGRATION_ABORTED");
}

function awaitWithMigrationSignal<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
) {
  if (!signal) return operation;
  assertMigrationSignal(signal);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new Error("PLACEMENT_MIGRATION_ABORTED"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}

function digestInventory(
  values: readonly {
    id: string;
    storageKey: string;
    byteSize: number;
    mimeType: string;
    digest: string;
  }[],
) {
  const canonical = [...values]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((value) =>
      [
        value.id,
        value.storageKey,
        String(value.byteSize),
        value.mimeType,
        value.digest,
      ].join("\0"),
    )
    .join("\n");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  signal?: AbortSignal,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      assertMigrationSignal(signal);
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximum) throw new Error("MIGRATION_SOURCE_SIZE_MISMATCH");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  assertMigrationSignal(signal);
  if (total !== maximum) throw new Error("MIGRATION_SOURCE_SIZE_MISMATCH");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function nodeProviderId(nodeId: string) {
  return `node:${nodeId}:relay-storage-v1`;
}

function isNodeProvider(providerId: string, nodeId: string) {
  return providerId === nodeProviderId(nodeId);
}

async function filesAtPlacement(
  ownerId: string,
  placement: CapabilityPlacement,
) {
  const result = await db.$client.execute({
    sql:
      placement.kind === "node"
        ? `SELECT id, provider, storageKey, mimeType, byteSize, purpose, userId
           FROM files WHERE userId = ? AND status = 'stored' AND provider = ?
           ORDER BY id`
        : `SELECT id, provider, storageKey, mimeType, byteSize, purpose, userId
           FROM files WHERE userId = ? AND status = 'stored'
             AND provider IN ('local', 's3') ORDER BY id`,
    args:
      placement.kind === "node"
        ? [ownerId, nodeProviderId(placement.nodeId)]
        : [ownerId],
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    provider: String(row.provider),
    storageKey: String(row.storageKey),
    mimeType: String(row.mimeType),
    byteSize: Number(row.byteSize),
    purpose: String(row.purpose),
    userId: String(row.userId),
  })) satisfies FileRow[];
}

async function nodeProvider(ownerId: string, placement: CapabilityPlacement) {
  if (placement.kind !== "node") throw new Error("MIGRATION_NODE_REQUIRED");
  return createPairedNodeObjectStorageProvider({
    ownerId,
    nodeId: placement.nodeId,
  });
}

async function loadBytes(
  file: FileRow,
  placement: CapabilityPlacement,
  provider?: ObjectStorageProvider,
  signal?: AbortSignal,
) {
  if (placement.kind === "node") {
    if (!provider) throw new Error("MIGRATION_NODE_REQUIRED");
    return collect(
      await awaitWithMigrationSignal(
        provider.get({
          ref: {
            ownerId: file.userId,
            namespace: "files",
            key: file.storageKey,
          },
          maxBytes: file.byteSize || 1,
        }),
        signal,
      ),
      file.byteSize,
      signal,
    );
  }
  if (file.provider !== "local" && file.provider !== "s3") {
    throw new Error("MIGRATION_SOURCE_PROVIDER_UNSUPPORTED");
  }
  return new Uint8Array(
    await readStorageObject(
      file.provider as ManagedStorageProvider,
      file.storageKey,
      { maxBytes: file.byteSize || 1, signal },
    ),
  );
}

function isStorageObjectMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.code === "ENOENT" ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

async function existingCoreObjectDigest(
  provider: ManagedStorageProvider,
  file: FileRow,
  signal?: AbortSignal,
) {
  try {
    const metadata = await awaitWithMigrationSignal(
      headStorageObject(provider, file.storageKey),
      signal,
    );
    if (metadata.byteSize !== file.byteSize) {
      throw new Error("MIGRATION_DESTINATION_OBJECT_CONFLICT");
    }
    const bytes = new Uint8Array(
      await readStorageObject(provider, file.storageKey, {
        maxBytes: file.byteSize || 1,
        signal,
      }),
    );
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  } catch (error) {
    if (isStorageObjectMissing(error)) return null;
    throw error;
  }
}

async function writeBytes(
  file: FileRow,
  bytes: Uint8Array,
  digest: `sha256:${string}`,
  placement: CapabilityPlacement,
  provider?: ObjectStorageProvider,
  signal?: AbortSignal,
) {
  assertMigrationSignal(signal);
  if (placement.kind === "node") {
    if (!provider) throw new Error("MIGRATION_NODE_REQUIRED");
    const committed = await awaitWithMigrationSignal(
      provider.put({
        ref: {
          ownerId: file.userId,
          namespace: "files",
          key: file.storageKey,
        },
        body: bytesStream(bytes),
        byteSize: bytes.byteLength,
        mimeType: file.mimeType,
        expectedDigest: digest,
        idempotencyKey: `placement-copy:${file.id}:${digest}`,
      }),
      signal,
    );
    assertMigrationSignal(signal);
    return committed;
  }
  if (placement.kind !== "core") {
    throw new Error("MIGRATION_DESTINATION_UNSUPPORTED");
  }
  const target = storageDriver();
  const existingDigest = await existingCoreObjectDigest(target, file, signal);
  if (existingDigest !== null) {
    if (existingDigest !== digest) {
      throw new Error("MIGRATION_DESTINATION_OBJECT_CONFLICT");
    }
    return { digest, byteSize: file.byteSize };
  }
  const fileBytes = new Uint8Array(bytes.byteLength);
  fileBytes.set(bytes);
  await awaitWithMigrationSignal(
    putStorageObject({
      provider: target,
      storageKey: file.storageKey,
      purpose: file.purpose as never,
      file: new File(
        [fileBytes.buffer],
        file.storageKey.split("/").at(-1) ?? file.id,
        {
          type: file.mimeType,
        },
      ),
      mimeType: file.mimeType,
    }),
    signal,
  );
  assertMigrationSignal(signal);
  const writtenDigest = await existingCoreObjectDigest(target, file, signal);
  if (writtenDigest !== digest) {
    throw new Error("MIGRATION_DESTINATION_VERIFY_FAILED");
  }
  return { digest, byteSize: file.byteSize };
}

async function migrationById(ownerId: string, migrationId: string) {
  const result = await db.$client.execute({
    sql: `SELECT * FROM placement_migrations WHERE id = ? AND accountId = ? LIMIT 1`,
    args: [migrationId, ownerId],
  });
  const row = result.rows[0];
  return row ? parseRow(row as MigrationRow) : null;
}

export async function requirePlacementMigration(
  ownerId: string,
  migrationId: string,
) {
  const migration = await migrationById(ownerId, migrationId);
  if (!migration) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
  return migration;
}

async function setMigrationState(
  ownerId: string,
  migrationId: string,
  state: PlacementMigrationState,
  values: {
    sourceDigest?: string | null;
    destinationDigest?: string | null;
    copiedBytes?: number;
    safeErrorCode?: string | null;
  } = {},
  expectedStates?: readonly PlacementMigrationState[],
) {
  const fields = ["state = ?", "updatedAt = ?"];
  const args: InValue[] = [state, nowSeconds()];
  for (const [column, value] of [
    ["sourceDigest", values.sourceDigest],
    ["destinationDigest", values.destinationDigest],
    ["copiedBytes", values.copiedBytes],
    ["safeErrorCode", values.safeErrorCode],
  ] as const) {
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    args.push(value === null ? null : String(value));
  }
  args.push(migrationId, ownerId, ...(expectedStates ?? []));
  const expectedSql = expectedStates?.length
    ? ` AND state IN (${expectedStates.map(() => "?").join(",")})`
    : "";
  const result = await db.$client.execute({
    sql: `UPDATE placement_migrations SET ${fields.join(", ")}
      WHERE id = ? AND accountId = ?${expectedSql}`,
    args,
  });
  const current = await migrationById(ownerId, migrationId);
  if (!current) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
  if (expectedStates?.length && Number(result.rowsAffected) === 0) {
    throw new PlacementMigrationInterrupted(current);
  }
  return current;
}

function placementConsequences(
  migration: PlacementMigrationRecord,
  placement: CapabilityPlacement,
  migrationState: "planned" | "running" | "verified" | "failed",
) {
  return {
    durableLocation: placement.kind,
    providerVisibility:
      placement.kind === "node"
        ? "paired-node-and-configured-node-provider"
        : placement.kind,
    offlineBehavior:
      placement.kind === "node"
        ? "unavailable-when-node-offline"
        : "core-policy",
    costBehavior:
      placement.kind === "managed"
        ? "managed-metered"
        : placement.kind === "byok"
          ? "provider-billed"
          : "operator-owned",
    migrationRequired: true,
    placementMigrationId: migration.id,
    placementMigrationState: migrationState,
  };
}

function migrationMarker(value: InValue) {
  try {
    const parsed = JSON.parse(String(value)) as {
      placementMigrationId?: unknown;
    };
    return typeof parsed.placementMigrationId === "string"
      ? parsed.placementMigrationId
      : null;
  } catch {
    return null;
  }
}

function isSqliteBusy(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "SQLITE_BUSY" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("SQLITE_BUSY"))
  );
}

function placementLedgerRetryDelay(attempt: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.min(100, 5 * 2 ** attempt));
  });
}

const placementLedgerLocks = new Map<string, Promise<void>>();

async function withPlacementLedgerLock<T>(
  key: string,
  operation: () => Promise<T>,
) {
  const previous = placementLedgerLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const current = previous.catch(() => undefined).then(() => gate);
  placementLedgerLocks.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (placementLedgerLocks.get(key) === current) {
      placementLedgerLocks.delete(key);
    }
  }
}

async function appendPlacementStateOnce(
  migration: PlacementMigrationRecord,
  placement: CapabilityPlacement,
  migrationState: "planned" | "running" | "verified" | "failed",
  options: {
    storageSwitch?: {
      expectedFileIds: readonly string[];
      targetProvider: string;
    };
  } = {},
) {
  // The write transaction is the placement-ledger mutex. A check followed by
  // CoreNodeRegistry.appendPlacement() leaves a race where two lease holders
  // can append the same revision. Keeping the check and append in one SQLite
  // write transaction makes a crash replay and a concurrent replay identical.
  const transaction = await db.$client.transaction("write");
  try {
    const latest = await transaction.execute({
      sql: `SELECT * FROM node_capability_placement_revisions
        WHERE userId = ? AND capability = ?
        ORDER BY revision DESC LIMIT 1`,
      args: [migration.accountId, migration.resourceKind],
    });
    const current = latest.rows[0] as MigrationRow | undefined;
    if (!current) throw new Error("PLACEMENT_MIGRATION_PLACEMENT_MISSING");

    const ownedByMigration =
      String(current.id) === migration.resourceId ||
      migrationMarker(current.consequencesJson) === migration.id;
    if (!ownedByMigration) {
      // A newer user choice must never be silently overwritten by an older
      // migration resuming after a lease loss.
      throw new Error("PLACEMENT_MIGRATION_PLACEMENT_SUPERSEDED");
    }

    const expectedNodeId = placement.kind === "node" ? placement.nodeId : null;
    if (
      String(current.placementKind) === placement.kind &&
      String(current.providerId) === placement.providerId &&
      (current.nodeId === null ? null : String(current.nodeId)) ===
        expectedNodeId &&
      String(current.migrationState) === migrationState
    ) {
      await transaction.commit();
      return current;
    }

    if (options.storageSwitch) {
      const sourceProviderSql =
        migration.sourcePlacement.kind === "node"
          ? "provider = ?"
          : "provider IN ('local', 's3')";
      const sourceProviderArgs =
        migration.sourcePlacement.kind === "node"
          ? [nodeProviderId(migration.sourcePlacement.nodeId)]
          : [];
      const activeFiles = await transaction.execute({
        sql: `SELECT id FROM files WHERE userId = ? AND status = 'stored'
          AND ${sourceProviderSql} ORDER BY id`,
        args: [migration.accountId, ...sourceProviderArgs],
      });
      const activeIds = activeFiles.rows.map((row) => String(row.id));
      const expectedIds = [...options.storageSwitch.expectedFileIds].sort(
        (left, right) => left.localeCompare(right),
      );
      if (
        activeIds.length !== expectedIds.length ||
        activeIds.some((id, index) => id !== expectedIds[index])
      ) {
        throw new Error("PLACEMENT_MIGRATION_SOURCE_INVENTORY_CHANGED");
      }
      if (activeIds.length > 0) {
        await transaction.execute({
          sql: `UPDATE files SET provider = ?, updatedAt = ?
            WHERE userId = ? AND id IN (${activeIds.map(() => "?").join(",")})`,
          args: [
            options.storageSwitch.targetProvider,
            nowSeconds(),
            migration.accountId,
            ...activeIds,
          ],
        });
      }
    }

    const revision = Number(current.revision) + 1;
    const id = newId("nplace");
    const createdAt = nowSeconds();
    await transaction.execute({
      sql: `INSERT INTO node_capability_placement_revisions
        (id, userId, capability, revision, placementKind, nodeId,
         providerId, durableData, consequencesJson, migrationState, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      args: [
        id,
        migration.accountId,
        migration.resourceKind,
        revision,
        placement.kind,
        expectedNodeId,
        placement.providerId,
        JSON.stringify(
          placementConsequences(migration, placement, migrationState),
        ),
        migrationState,
        createdAt,
      ],
    });
    if (placement.kind === "node") {
      await transaction.execute({
        sql: `INSERT INTO node_lifecycle_events
          (id, nodeId, userId, eventType, safeMetadataJson, occurredAt)
          VALUES (?, ?, ?, 'placement-revised', ?, ?)`,
        args: [
          newId("nlife"),
          placement.nodeId,
          migration.accountId,
          JSON.stringify({
            capability: migration.resourceKind,
            revision,
            migrationId: migration.id,
          }),
          createdAt,
        ],
      });
    }
    await transaction.commit();
    return { id, revision };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

async function appendPlacementState(
  migration: PlacementMigrationRecord,
  placement: CapabilityPlacement,
  migrationState: "planned" | "running" | "verified" | "failed",
  options: {
    storageSwitch?: {
      expectedFileIds: readonly string[];
      targetProvider: string;
    };
  } = {},
) {
  return withPlacementLedgerLock(
    `${migration.accountId}\0${migration.resourceKind}`,
    async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          return await appendPlacementStateOnce(
            migration,
            placement,
            migrationState,
            options,
          );
        } catch (error) {
          if (!isSqliteBusy(error) || attempt === 7) throw error;
          await placementLedgerRetryDelay(attempt);
        }
      }
      throw new Error("PLACEMENT_MIGRATION_LEDGER_BUSY");
    },
  );
}

async function restoreSourcePlacementUnlessSuperseded(
  migration: PlacementMigrationRecord,
) {
  try {
    await appendPlacementState(
      migration,
      migration.sourcePlacement,
      "verified",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PLACEMENT_MIGRATION_PLACEMENT_SUPERSEDED"
    ) {
      return;
    }
    throw error;
  }
}

export async function planPlacementMigration(input: {
  ownerId: string;
  capability: NodeCapabilityId;
  placementRevisionId: string;
  source: CapabilityPlacement;
  destination: CapabilityPlacement;
  idempotencyKey?: string;
}) {
  if (!["storage", "conversations", "retrieval"].includes(input.capability)) {
    throw new Error("PLACEMENT_MIGRATION_NOT_REQUIRED");
  }
  const source = capabilityPlacementSchema.parse(input.source);
  const destination = capabilityPlacementSchema.parse(input.destination);
  const id = newId("pmig");
  const idempotencyKey =
    input.idempotencyKey ?? `placement:${input.placementRevisionId}`;
  await db.$client.execute({
    sql: `INSERT INTO placement_migrations
      (id, accountId, resourceKind, resourceId, sourcePlacementJson,
       destinationPlacementJson, state, copiedBytes, idempotencyKey,
       createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'planned', '0', ?, ?, ?)
      ON CONFLICT(accountId, idempotencyKey) DO NOTHING`,
    args: [
      id,
      input.ownerId,
      input.capability,
      input.placementRevisionId,
      JSON.stringify(source),
      JSON.stringify(destination),
      idempotencyKey,
      nowSeconds(),
      nowSeconds(),
    ],
  });
  const result = await db.$client.execute({
    sql: `SELECT * FROM placement_migrations
      WHERE accountId = ? AND idempotencyKey = ? LIMIT 1`,
    args: [input.ownerId, idempotencyKey],
  });
  const migration = parseRow(result.rows[0] as MigrationRow);
  if (
    migration.resourceKind !== input.capability ||
    JSON.stringify(migration.destinationPlacement) !==
      JSON.stringify(destination)
  ) {
    throw new Error("PLACEMENT_MIGRATION_IDEMPOTENCY_CONFLICT");
  }
  return migration;
}

export async function listPlacementMigrations(ownerId: string) {
  const result = await db.$client.execute({
    sql: `SELECT * FROM placement_migrations WHERE accountId = ?
      ORDER BY updatedAt DESC, id DESC`,
    args: [ownerId],
  });
  return result.rows.map((row) => parseRow(row as MigrationRow));
}

export async function placementMigrationPreview(
  ownerId: string,
  migration: PlacementMigrationRecord,
) {
  if (migration.resourceKind === "storage") {
    const inventory = await filesAtPlacement(
      ownerId,
      migration.sourcePlacement,
    );
    const totalBytes = inventory.reduce((sum, file) => sum + file.byteSize, 0);
    const destinationLimits =
      migration.destinationPlacement.kind === "node"
        ? coreNodeRelay.inspect(migration.destinationPlacement.nodeId)?.limits
        : null;
    const availableBytes = destinationLimits
      ? Math.max(
          0,
          destinationLimits.storageQuotaBytes -
            destinationLimits.storageUsedBytes,
        )
      : null;
    return {
      itemCount: inventory.length,
      totalBytes,
      availableBytes,
      spaceReady: availableBytes === null || availableBytes >= totalBytes,
    };
  }
  const itemCount = await countDurableResources(
    ownerId,
    migration.resourceKind,
  );
  const adapter = await ensureDurableAdapter(migration.resourceKind);
  return {
    itemCount,
    totalBytes: null,
    availableBytes: null,
    spaceReady: itemCount === 0 || adapter !== null,
  };
}

async function countDurableResources(
  ownerId: string,
  capability: NodeCapabilityId,
) {
  const table =
    capability === "conversations"
      ? "assistant_threads"
      : capability === "retrieval"
        ? "content_sources"
        : null;
  if (!table) return 0;
  const result = await db.$client.execute({
    sql: `SELECT count(*) AS count FROM ${table} WHERE userId = ?`,
    args: [ownerId],
  });
  return Number(result.rows[0]?.count ?? 0);
}

async function placementSwitchCommitted(migration: PlacementMigrationRecord) {
  const result = await db.$client.execute({
    sql: `SELECT * FROM node_capability_placement_revisions
      WHERE userId = ? AND capability = ? ORDER BY revision DESC LIMIT 1`,
    args: [migration.accountId, migration.resourceKind],
  });
  const current = result.rows[0] as MigrationRow | undefined;
  if (!current) return false;
  const expectedNodeId =
    migration.destinationPlacement.kind === "node"
      ? migration.destinationPlacement.nodeId
      : null;
  return (
    migrationMarker(current.consequencesJson) === migration.id &&
    String(current.placementKind) === migration.destinationPlacement.kind &&
    String(current.providerId) === migration.destinationPlacement.providerId &&
    (current.nodeId === null ? null : String(current.nodeId)) ===
      expectedNodeId &&
    String(current.migrationState) === "verified"
  );
}

async function prepareStorageSwitch(
  migration: PlacementMigrationRecord,
  signal?: AbortSignal,
) {
  if (
    !["core", "node"].includes(migration.sourcePlacement.kind) ||
    !["core", "node"].includes(migration.destinationPlacement.kind)
  ) {
    throw new Error("MIGRATION_PLACEMENT_UNSUPPORTED");
  }
  const files = await filesAtPlacement(
    migration.accountId,
    migration.sourcePlacement,
  );
  const sourceNode =
    migration.sourcePlacement.kind === "node"
      ? await nodeProvider(migration.accountId, migration.sourcePlacement)
      : undefined;
  const destinationNode =
    migration.destinationPlacement.kind === "node"
      ? await nodeProvider(migration.accountId, migration.destinationPlacement)
      : undefined;
  for (const file of files) {
    assertMigrationSignal(signal);
    const sourceBytes = await loadBytes(
      file,
      migration.sourcePlacement,
      sourceNode,
      signal,
    );
    const sourceDigest = `sha256:${createHash("sha256")
      .update(sourceBytes)
      .digest("hex")}` as const;
    let destinationDigest =
      migration.destinationPlacement.kind === "node"
        ? ((
            await awaitWithMigrationSignal(
              destinationNode!.stat({
                ref: {
                  ownerId: migration.accountId,
                  namespace: "files",
                  key: file.storageKey,
                },
              }),
              signal,
            )
          )?.digest ?? null)
        : await existingCoreObjectDigest(storageDriver(), file, signal);
    if (sourceDigest !== destinationDigest) {
      await writeBytes(
        file,
        sourceBytes,
        sourceDigest,
        migration.destinationPlacement,
        destinationNode,
        signal,
      );
      destinationDigest =
        migration.destinationPlacement.kind === "node"
          ? ((
              await awaitWithMigrationSignal(
                destinationNode!.stat({
                  ref: {
                    ownerId: migration.accountId,
                    namespace: "files",
                    key: file.storageKey,
                  },
                }),
                signal,
              )
            )?.digest ?? null)
          : await existingCoreObjectDigest(storageDriver(), file, signal);
    }
    if (sourceDigest !== destinationDigest) {
      throw new Error("MIGRATION_DESTINATION_VERIFY_FAILED");
    }
  }
  return {
    expectedFileIds: files.map((file) => file.id),
    targetProvider:
      migration.destinationPlacement.kind === "node"
        ? nodeProviderId(migration.destinationPlacement.nodeId)
        : storageDriver(),
  };
}

async function finishPlacementMigrationSwitch(
  migration: PlacementMigrationRecord,
  signal?: AbortSignal,
) {
  let current = await migrationById(migration.accountId, migration.id);
  if (!current) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");

  if (current.state === "ready-to-switch") {
    assertMigrationSignal(signal);
    // Claim the switch before producing any routing side effects. A crash now
    // leaves the durable `switched` recovery state, and concurrent workers all
    // converge through the idempotent block below.
    try {
      current = await setMigrationState(
        current.accountId,
        current.id,
        "switched",
        {},
        ["ready-to-switch"],
      );
    } catch (error) {
      if (!(error instanceof PlacementMigrationInterrupted)) throw error;
      current = error.migration;
    }
  }

  if (current.state === "switched") {
    // Once the switch is claimed, finish this short critical section even if
    // the worker lease is lost. Every side effect below is owner-scoped and
    // idempotent, so the next lease holder can safely repeat it after a crash.
    const storageSwitch =
      current.resourceKind === "storage" &&
      !(await placementSwitchCommitted(current))
        ? await prepareStorageSwitch(current, signal)
        : undefined;
    await appendPlacementState(
      current,
      current.destinationPlacement,
      "verified",
      storageSwitch ? { storageSwitch } : {},
    );
    try {
      current = await setMigrationState(
        current.accountId,
        current.id,
        "source-retained",
        {},
        ["switched"],
      );
    } catch (error) {
      if (!(error instanceof PlacementMigrationInterrupted)) throw error;
      current = error.migration;
    }
  }
  return current;
}

async function resolveMigrationInterruption(
  migration: PlacementMigrationRecord,
  signal?: AbortSignal,
) {
  assertMigrationSignal(signal);
  if (["ready-to-switch", "switched"].includes(migration.state)) {
    return finishPlacementMigrationSwitch(migration, signal);
  }
  if (["planned", "completed", "source-retained"].includes(migration.state)) {
    return migration;
  }
  throw new Error("PLACEMENT_MIGRATION_CONCURRENT_PROGRESS");
}

/**
 * Execute a resumable, fail-closed migration. Storage is copied and verified
 * object-by-object before the single provider-ledger switch. Empty durable
 * lanes can be activated without inventing bytes. Conversation and retrieval
 * adapters copy and verify their canonical snapshots before placement flips.
 */
export async function runPlacementMigration(
  ownerId: string,
  migrationId: string,
  options: { signal?: AbortSignal } = {},
) {
  assertMigrationSignal(options.signal);
  const migration = await migrationById(ownerId, migrationId);
  if (!migration) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
  if (["source-retained", "completed"].includes(migration.state)) {
    return migration;
  }
  if (["ready-to-switch", "switched"].includes(migration.state)) {
    return finishPlacementMigrationSwitch(migration, options.signal);
  }
  if (
    !["planned", "failed", "copying", "verifying"].includes(migration.state)
  ) {
    throw new Error("PLACEMENT_MIGRATION_STATE_CONFLICT");
  }
  try {
    await setMigrationState(
      ownerId,
      migrationId,
      "copying",
      {
        safeErrorCode: null,
        copiedBytes: 0,
      },
      ["planned", "failed", "copying", "verifying"],
    );
    assertMigrationSignal(options.signal);
    await appendPlacementState(
      migration,
      migration.destinationPlacement,
      "running",
    );

    if (migration.resourceKind !== "storage") {
      const adapter = await ensureDurableAdapter(migration.resourceKind);
      const count = await countDurableResources(
        ownerId,
        migration.resourceKind,
      );
      if (!adapter && count > 0) {
        throw new Error("PLACEMENT_MIGRATION_ADAPTER_UNAVAILABLE");
      }
      const result = adapter
        ? await awaitWithMigrationSignal(
            adapter({
              ownerId,
              source: migration.sourcePlacement,
              destination: migration.destinationPlacement,
            }),
            options.signal,
          )
        : {
            itemCount: 0,
            copiedBytes: 0,
            sourceDigest: digestInventory([]),
            destinationDigest: digestInventory([]),
          };
      assertMigrationSignal(options.signal);
      await setMigrationState(
        ownerId,
        migrationId,
        "verifying",
        {
          sourceDigest: result.sourceDigest,
          destinationDigest: result.destinationDigest,
          copiedBytes: result.copiedBytes,
        },
        ["copying"],
      );
      if (result.sourceDigest !== result.destinationDigest) {
        throw new Error("MIGRATION_DIGEST_MISMATCH");
      }
      const ready = await setMigrationState(
        ownerId,
        migrationId,
        "ready-to-switch",
        {},
        ["verifying"],
      );
      return finishPlacementMigrationSwitch(ready, options.signal);
    }

    const files = await filesAtPlacement(ownerId, migration.sourcePlacement);
    const sourceNode =
      migration.sourcePlacement.kind === "node"
        ? await nodeProvider(ownerId, migration.sourcePlacement)
        : undefined;
    const destinationNode =
      migration.destinationPlacement.kind === "node"
        ? await nodeProvider(ownerId, migration.destinationPlacement)
        : undefined;
    if (
      !["core", "node"].includes(migration.sourcePlacement.kind) ||
      !["core", "node"].includes(migration.destinationPlacement.kind)
    ) {
      throw new Error("MIGRATION_PLACEMENT_UNSUPPORTED");
    }
    const sourceInventory = [];
    let copiedBytes = 0;
    for (const file of files) {
      assertMigrationSignal(options.signal);
      const current = await migrationById(ownerId, migrationId);
      if (!current) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
      if (current.state !== "copying") {
        throw new PlacementMigrationInterrupted(current);
      }
      const bytes = await loadBytes(
        file,
        migration.sourcePlacement,
        sourceNode,
        options.signal,
      );
      const digest =
        `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
      sourceInventory.push({ ...file, digest });
      await writeBytes(
        file,
        bytes,
        digest,
        migration.destinationPlacement,
        destinationNode,
        options.signal,
      );
      copiedBytes += file.byteSize;
      await setMigrationState(
        ownerId,
        migrationId,
        "copying",
        { copiedBytes },
        ["copying"],
      );
    }
    const sourceDigest = digestInventory(sourceInventory);
    await setMigrationState(
      ownerId,
      migrationId,
      "verifying",
      { sourceDigest, copiedBytes },
      ["copying"],
    );
    const destinationInventory = [];
    for (const file of files) {
      assertMigrationSignal(options.signal);
      const active = await migrationById(ownerId, migrationId);
      if (!active) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
      if (active.state !== "verifying") {
        throw new PlacementMigrationInterrupted(active);
      }
      let digest: string;
      if (migration.destinationPlacement.kind === "node") {
        const metadata = await awaitWithMigrationSignal(
          destinationNode!.stat({
            ref: {
              ownerId,
              namespace: "files",
              key: file.storageKey,
            },
          }),
          options.signal,
        );
        assertMigrationSignal(options.signal);
        if (!metadata || metadata.byteSize !== file.byteSize) {
          throw new Error("MIGRATION_DESTINATION_VERIFY_FAILED");
        }
        digest = metadata.digest;
      } else {
        const bytes = new Uint8Array(
          await readStorageObject(storageDriver(), file.storageKey, {
            maxBytes: file.byteSize || 1,
            signal: options.signal,
          }),
        );
        digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      }
      destinationInventory.push({ ...file, digest });
    }
    const destinationDigest = digestInventory(destinationInventory);
    if (sourceDigest !== destinationDigest) {
      throw new Error("MIGRATION_DIGEST_MISMATCH");
    }
    const ready = await setMigrationState(
      ownerId,
      migrationId,
      "ready-to-switch",
      { destinationDigest },
      ["verifying"],
    );
    return finishPlacementMigrationSwitch(ready, options.signal);
  } catch (error) {
    if (error instanceof PlacementMigrationInterrupted) {
      return resolveMigrationInterruption(error.migration, options.signal);
    }
    const code = safeErrorCode(error);
    let failed: PlacementMigrationRecord;
    try {
      failed = await setMigrationState(
        ownerId,
        migrationId,
        "failed",
        { safeErrorCode: code },
        ["planned", "failed", "copying", "verifying"],
      );
    } catch (transitionError) {
      if (!(transitionError instanceof PlacementMigrationInterrupted)) {
        throw transitionError;
      }
      return resolveMigrationInterruption(
        transitionError.migration,
        options.signal,
      );
    }
    await appendPlacementState(
      failed,
      failed.sourcePlacement,
      "verified",
    ).catch(() => undefined);
    throw new Error(code);
  }
}

export async function pausePlacementMigration(
  ownerId: string,
  migrationId: string,
) {
  const migration = await migrationById(ownerId, migrationId);
  if (!migration) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
  if (
    !["planned", "copying", "verifying", "failed"].includes(migration.state)
  ) {
    throw new Error("PLACEMENT_MIGRATION_NOT_PAUSABLE");
  }
  try {
    const paused = await setMigrationState(
      ownerId,
      migrationId,
      "planned",
      { safeErrorCode: "PAUSED_BY_USER" },
      ["planned", "copying", "verifying", "failed"],
    );
    await restoreSourcePlacementUnlessSuperseded(paused);
    return paused;
  } catch (error) {
    if (error instanceof PlacementMigrationInterrupted) {
      throw new Error("PLACEMENT_MIGRATION_NOT_PAUSABLE");
    }
    throw error;
  }
}

export async function cancelPlacementMigration(
  ownerId: string,
  migrationId: string,
) {
  const migration = await migrationById(ownerId, migrationId);
  if (!migration) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
  if (
    !["planned", "copying", "verifying", "failed"].includes(migration.state)
  ) {
    throw new Error("PLACEMENT_MIGRATION_ALREADY_SWITCHED");
  }
  try {
    const cancelled = await setMigrationState(
      ownerId,
      migrationId,
      "completed",
      { safeErrorCode: "CANCELLED_BY_USER" },
      ["planned", "copying", "verifying", "failed"],
    );
    await restoreSourcePlacementUnlessSuperseded(cancelled);
    return cancelled;
  } catch (error) {
    if (error instanceof PlacementMigrationInterrupted) {
      throw new Error("PLACEMENT_MIGRATION_ALREADY_SWITCHED");
    }
    throw error;
  }
}

export async function completePlacementMigration(input: {
  ownerId: string;
  migrationId: string;
  deleteSource: boolean;
}) {
  const migration = await migrationById(input.ownerId, input.migrationId);
  if (!migration) throw new Error("PLACEMENT_MIGRATION_NOT_FOUND");
  if (migration.state === "completed") return migration;
  if (migration.state !== "source-retained") {
    throw new Error("PLACEMENT_MIGRATION_SOURCE_NOT_RETAINED");
  }
  if (input.deleteSource && migration.resourceKind !== "storage") {
    // Conversation recovery envelopes and Core citation/extraction metadata
    // are still part of the active routing contract. Claiming deletion here
    // would be false until those lanes expose an explicit cleanup adapter.
    throw new Error("MIGRATION_SOURCE_DELETE_UNSUPPORTED");
  }
  if (input.deleteSource && migration.resourceKind === "storage") {
    const files = await filesAtPlacement(
      input.ownerId,
      migration.destinationPlacement,
    );
    if (migration.sourcePlacement.kind === "node") {
      const source = await nodeProvider(
        input.ownerId,
        migration.sourcePlacement,
      );
      for (const file of files) {
        await source.delete({
          ref: {
            ownerId: input.ownerId,
            namespace: "files",
            key: file.storageKey,
          },
          idempotencyKey: `placement-source-delete:${migration.id}:${file.id}`,
        });
      }
    } else if (migration.sourcePlacement.kind === "core") {
      // Source cleanup is intentionally retained for Core files. The current
      // schema does not preserve a per-object source provider after a mixed
      // local/S3 migration, so deleting here could target the wrong backend.
      throw new Error("MIGRATION_CORE_SOURCE_DELETE_REQUIRES_OPERATOR_BACKUP");
    }
  }
  try {
    return await setMigrationState(
      input.ownerId,
      input.migrationId,
      "completed",
      {
        safeErrorCode: input.deleteSource ? null : "SOURCE_RETAINED_BY_USER",
      },
      ["source-retained"],
    );
  } catch (error) {
    if (
      error instanceof PlacementMigrationInterrupted &&
      error.migration.state === "completed"
    ) {
      return error.migration;
    }
    throw error;
  }
}
