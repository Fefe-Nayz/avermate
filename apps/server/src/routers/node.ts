import {
  capabilityPlacementSchema,
  nodeCapabilityIdSchema,
  type CapabilityPlacement,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { env } from "../lib/env";
import { protectedProcedure } from "../lib/orpc";
import {
  coreNodeRegistry,
  coreNodeRelay,
  coreRemoteDeletionRepository,
  retryPairedNodeDeletion,
} from "../node/services";
import { nodePlacementMigrationReady } from "../node/readiness";
import { storageDriver } from "../lib/storage-backend";
import {
  cancelPlacementMigration,
  completePlacementMigration,
  listPlacementMigrations,
  pausePlacementMigration,
  placementMigrationPreview,
  requirePlacementMigration,
  planPlacementMigration,
} from "../node/placement-migration";
import { enqueuePlacementMigrationJob } from "../jobs/placement-migration";

const boundedId = z.string().trim().min(1).max(256);

function iso(value: unknown) {
  return new Date(Number(value) * 1_000).toISOString();
}

function consequences(
  capability: z.infer<typeof nodeCapabilityIdSchema>,
  placement: "core" | "node" | "managed" | "byok",
) {
  const durableData = ["storage", "conversations", "retrieval"].includes(
    capability,
  );
  return {
    durableData,
    durableLocation: durableData ? placement : "request-scoped",
    providerVisibility:
      placement === "node"
        ? "paired-node-and-configured-node-provider"
        : placement === "byok"
          ? "selected-third-party-provider"
          : placement,
    offlineBehavior:
      placement === "node" ? "unavailable-when-node-offline" : "core-policy",
    costBehavior:
      placement === "managed"
        ? "managed-metered"
        : placement === "byok"
          ? "provider-billed"
          : "operator-owned",
    migrationRequired: durableData,
  };
}

function placementContract(input: {
  placementKind: string;
  nodeId?: string | null;
  providerId: string;
}): CapabilityPlacement {
  return capabilityPlacementSchema.parse(
    input.placementKind === "node"
      ? {
          kind: "node",
          nodeId: input.nodeId,
          providerId: input.providerId,
        }
      : { kind: input.placementKind, providerId: input.providerId },
  );
}

function defaultCorePlacement(
  capability: z.infer<typeof nodeCapabilityIdSchema>,
): CapabilityPlacement {
  return {
    kind: "core",
    providerId:
      capability === "storage"
        ? storageDriver()
        : capability === "conversations"
          ? "core-conversation-v1"
          : capability === "retrieval"
            ? "core-lexical-v1"
            : "core-default",
  };
}

export const nodeRouter = {
  claim: protectedProcedure
    .input(z.strictObject({ code: z.string().trim().min(9).max(9) }))
    .handler(({ context, input }) =>
      coreNodeRegistry.claimPairing({
        userId: context.session.user.id,
        code: input.code.toUpperCase(),
      }),
    ),

  confirm: protectedProcedure
    .input(
      z.strictObject({
        pairingAttemptId: boundedId,
        fingerprint: z.string().regex(/^[A-Z2-7]{16,64}$/u),
        capabilities: z.array(nodeCapabilityIdSchema).min(1).max(16),
      }),
    )
    .handler(({ context, input }) =>
      coreNodeRegistry.confirmPairing({
        userId: context.session.user.id,
        ...input,
      }),
    ),

  list: protectedProcedure.handler(({ context }) =>
    coreNodeRegistry.listNodes(context.session.user.id),
  ),

  readiness: protectedProcedure.handler(async ({ context }) => {
    const ownerId = context.session.user.id;
    const [registeredNodes, placements] = await Promise.all([
      coreNodeRegistry.listNodes(ownerId),
      coreNodeRegistry.currentPlacements(ownerId),
    ]);
    const nodes = registeredNodes.map((node) => {
      const relay = node.online ? coreNodeRelay.inspect(node.nodeId) : null;
      return {
        ...node,
        configRevision: relay?.configRevision ?? node.configRevision,
        connectionEpoch: relay?.connectionEpoch ?? null,
        features: relay?.features ?? null,
        health: relay?.health ?? [],
        manifestFresh: Boolean(relay),
        providerNativeRuntimeCheckpoints:
          relay?.features.sandbox?.runtimeCheckpoints === true,
        specialistKinds:
          relay?.features.jobs?.kinds.filter((kind) =>
            kind.startsWith("specialist."),
          ) ?? [],
      };
    });
    const fullSelfHost = env.AVERMATE_DEPLOYMENT_MODE === "full-self-host";
    const requiredNodeCapabilities = [
      "storage",
      "conversations",
      "retrieval",
      "models",
      "sandbox",
      "jobs",
    ] as const;
    const diagnostics = requiredNodeCapabilities.map((capability) => {
      const placement = placements.find(
        (candidate) => candidate.capability === capability,
      );
      const node = placement?.nodeId
        ? nodes.find((candidate) => candidate.nodeId === placement.nodeId)
        : null;
      const ready = Boolean(
        placement?.placementKind === "node" &&
        nodePlacementMigrationReady(capability, placement.migrationState) &&
        node?.online &&
        node.features?.[capability],
      );
      return {
        capability,
        ready,
        reasonCode: ready
          ? null
          : placement?.placementKind !== "node"
            ? "node-placement-required"
            : !nodePlacementMigrationReady(capability, placement.migrationState)
              ? "migration-not-verified"
              : !node?.online
                ? "node-offline"
                : "capability-not-advertised",
      };
    });
    return {
      expectedProtocolMajor: 2 as const,
      deploymentMode: env.AVERMATE_DEPLOYMENT_MODE,
      fullSelfHost,
      ready: !fullSelfHost || diagnostics.every((item) => item.ready),
      nodes,
      placements,
      diagnostics,
    };
  }),

  rotateCredentials: protectedProcedure
    .input(
      z.strictObject({
        nodeId: boundedId,
        overlapSeconds: z.number().int().min(30).max(3_600).default(300),
      }),
    )
    .handler(({ context, input }) =>
      coreNodeRegistry.rotateCredentials({
        userId: context.session.user.id,
        ...input,
      }),
    ),

  revoke: protectedProcedure
    .input(
      z.strictObject({
        nodeId: boundedId,
        reason: z
          .enum(["USER_REVOKED", "NODE_RETIRED", "CREDENTIAL_COMPROMISED"])
          .default("USER_REVOKED"),
      }),
    )
    .handler(({ context, input }) =>
      coreNodeRegistry.revokeNode({
        userId: context.session.user.id,
        ...input,
      }),
    ),

  setPlacement: protectedProcedure
    .input(
      z.strictObject({
        capability: nodeCapabilityIdSchema,
        placement: z.enum(["core", "node", "managed", "byok"]),
        nodeId: boundedId.optional(),
        providerId: boundedId,
        idempotencyKey: boundedId.optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const impact = consequences(input.capability, input.placement);
      const previous = (
        await coreNodeRegistry.currentPlacements(context.session.user.id)
      ).find((candidate) => candidate.capability === input.capability);
      const placement = await coreNodeRegistry.appendPlacement({
        userId: context.session.user.id,
        capability: input.capability,
        placementKind: input.placement,
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        providerId: input.providerId,
        durableData: impact.durableData,
        consequences: {
          durableLocation: impact.durableLocation,
          providerVisibility: impact.providerVisibility,
          offlineBehavior: impact.offlineBehavior,
          costBehavior: impact.costBehavior,
          migrationRequired: impact.migrationRequired,
        },
        migrationState: impact.migrationRequired ? "planned" : "not-required",
      });
      if (!impact.migrationRequired) return { ...placement, migration: null };
      const migration = await planPlacementMigration({
        ownerId: context.session.user.id,
        capability: input.capability,
        placementRevisionId: placement.id,
        source: previous
          ? placementContract(previous)
          : defaultCorePlacement(input.capability),
        destination: placementContract({
          placementKind: input.placement,
          nodeId: input.nodeId,
          providerId: input.providerId,
        }),
        idempotencyKey: input.idempotencyKey,
      });
      return { ...placement, migration };
    }),

  migrations: protectedProcedure.handler(async ({ context }) => {
    const migrations = await listPlacementMigrations(context.session.user.id);
    return Promise.all(
      migrations.map(async (migration) => ({
        ...migration,
        preview: await placementMigrationPreview(
          context.session.user.id,
          migration,
        ),
      })),
    );
  }),

  startMigration: protectedProcedure
    .input(z.strictObject({ migrationId: boundedId }))
    .handler(async ({ context, input }) => {
      await requirePlacementMigration(
        context.session.user.id,
        input.migrationId,
      );
      const job = await enqueuePlacementMigrationJob({
        ownerId: context.session.user.id,
        migrationId: input.migrationId,
      });
      return {
        accepted: true as const,
        migrationId: input.migrationId,
        jobId: job.id,
        status: job.status,
      };
    }),

  pauseMigration: protectedProcedure
    .input(z.strictObject({ migrationId: boundedId }))
    .handler(({ context, input }) =>
      pausePlacementMigration(context.session.user.id, input.migrationId),
    ),

  retryMigration: protectedProcedure
    .input(z.strictObject({ migrationId: boundedId }))
    .handler(async ({ context, input }) => {
      await requirePlacementMigration(
        context.session.user.id,
        input.migrationId,
      );
      const job = await enqueuePlacementMigrationJob({
        ownerId: context.session.user.id,
        migrationId: input.migrationId,
      });
      return {
        accepted: true as const,
        migrationId: input.migrationId,
        jobId: job.id,
        status: job.status,
      };
    }),

  cancelMigration: protectedProcedure
    .input(z.strictObject({ migrationId: boundedId }))
    .handler(({ context, input }) =>
      cancelPlacementMigration(context.session.user.id, input.migrationId),
    ),

  completeMigration: protectedProcedure
    .input(
      z.strictObject({
        migrationId: boundedId,
        deleteSource: z.boolean().default(false),
      }),
    )
    .handler(({ context, input }) =>
      completePlacementMigration({
        ownerId: context.session.user.id,
        ...input,
      }),
    ),

  lifecycle: protectedProcedure
    .input(
      z
        .strictObject({
          nodeId: boundedId.optional(),
          limit: z.number().int().min(1).max(250).default(100),
        })
        .default({ limit: 100 }),
    )
    .handler(async ({ context, input }) => {
      const result = await db.$client.execute({
        sql: `SELECT e.nodeId, e.eventType, e.safeMetadataJson, e.occurredAt
        FROM node_lifecycle_events e
        JOIN node_account_bindings b ON b.nodeId = e.nodeId
        WHERE b.userId = ? AND b.state IN ('active', 'revoked')
          AND (e.userId IS NULL OR e.userId = ?)
          AND (? IS NULL OR e.nodeId = ?)
        ORDER BY e.occurredAt DESC LIMIT ?`,
        args: [
          context.session.user.id,
          context.session.user.id,
          input.nodeId ?? null,
          input.nodeId ?? null,
          input.limit,
        ],
      });
      return result.rows.map((row) => ({
        nodeId: String(row.nodeId),
        eventType: String(row.eventType),
        safeMetadata: JSON.parse(String(row.safeMetadataJson)) as unknown,
        occurredAt: iso(row.occurredAt),
      }));
    }),

  remoteDeletions: protectedProcedure
    .input(
      z
        .strictObject({
          nodeId: boundedId.optional(),
          state: z
            .enum([
              "pending_remote_deletion",
              "revoked_unreachable",
              "user_action_required",
              "verified_deleted",
            ])
            .optional(),
          limit: z.number().int().min(1).max(250).default(100),
        })
        .default({ limit: 100 }),
    )
    .handler(async ({ context, input }) => {
      const rows = await coreRemoteDeletionRepository.listForOwner({
        ownerId: context.session.user.id,
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        ...(input.state ? { state: input.state } : {}),
        limit: input.limit,
      });
      return rows.map(({ record, createdAt, updatedAt }) => ({
        manifestDigest: record.manifest.digest,
        nodeId: record.manifest.nodeId,
        state: record.state,
        objectCount: record.manifest.refs.length,
        expiresAt: record.manifest.expiresAt,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        receiptDigest: record.acceptedReceiptDigest ?? null,
        deletedCount: record.receipt?.deletedCount ?? null,
        safeOperatorInstruction: record.safeOperatorInstruction ?? null,
      }));
    }),

  retryRemoteDeletion: protectedProcedure
    .input(
      z.strictObject({
        manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await retryPairedNodeDeletion({
        ownerId: context.session.user.id,
        manifestDigest: input.manifestDigest,
      });
      return {
        manifestDigest: result!.manifest.digest,
        state: result!.state,
        receiptDigest: result!.acceptedReceiptDigest ?? null,
        deletedCount: result!.receipt?.deletedCount ?? null,
        safeOperatorInstruction: result!.safeOperatorInstruction ?? null,
      };
    }),
};
