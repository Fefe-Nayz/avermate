import { ORPCError } from "@orpc/server";
import {
  capabilityKindSchema,
  capabilityOperationStateSchema,
  capabilityPolicyConstraintsSchema,
  capabilityPolicyModeSchema,
  capabilityPurposePatternSchema,
  type ProviderConnectionValidationResult,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { CapabilityConnectionStore } from "../capabilities/connection-store";
import { CapabilityConsentStore } from "../capabilities/consent-store";
import {
  capabilityFailure,
  normalizeCapabilityError,
} from "../capabilities/errors";
import { CapabilityHealthService } from "../capabilities/health-service";
import { legacyServiceKeysAsConnections } from "../capabilities/legacy-bridge";
import { CapabilityOfferingStore } from "../capabilities/offering-store";
import { CapabilityOperationStore } from "../capabilities/operation-store";
import {
  staticProviderPluginRegistry,
  type ProviderPluginFactory,
} from "../capabilities/plugin-registry";
import { CapabilityPolicyStore } from "../capabilities/policy-store";
import { capabilityShadowDiagnostics } from "../capabilities/shadow-diagnostics";
import { capabilityExecutionMode } from "../capabilities/runtime";
import { CapabilityUsageService } from "../capabilities/usage-service";
import { protectedProcedure } from "../lib/orpc";

const idSchema = z.string().trim().min(1).max(256);
const revisionSchema = z.number().int().positive();
const reasonSchema = z.string().trim().min(3).max(1_024);
const secretInputSchema = z.strictObject({
  slot: z.string().trim().min(1).max(128),
  value: z.string().trim().min(1).max(8_192),
});
/**
 * User-facing connections may either call a public provider directly with the
 * owner's credential, or target a Node already paired to that owner. Core,
 * managed and full-self-host placements are instance/operator authority and
 * must never be accepted from an authenticated SaaS account: treating an
 * arbitrary URL as `full-self-host` would turn the hosted Core into an SSRF
 * relay for private networks.
 */
const publicConnectionPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("direct-byok"),
    origin: z.url().max(2_048),
  }),
  z.strictObject({
    kind: z.literal("node"),
    nodeId: idSchema,
    configRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  }),
]);
const connectionCreateSchema = z.strictObject({
  pluginId: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(256),
  placement: publicConnectionPlacementSchema,
  configVersion: z.literal(1),
  config: z.unknown(),
  secrets: z.array(secretInputSchema).max(32),
});
const connectionUpdateSchema = z
  .strictObject({
    connectionId: idSchema,
    expectedRevision: revisionSchema,
    displayName: z.string().trim().min(1).max(256).optional(),
    placement: publicConnectionPlacementSchema.optional(),
    configVersion: z.literal(1).optional(),
    config: z.unknown().optional(),
    secrets: z.array(secretInputSchema).max(32).optional(),
  })
  .refine(
    (input) =>
      input.displayName !== undefined ||
      input.placement !== undefined ||
      input.configVersion !== undefined ||
      input.config !== undefined ||
      input.secrets !== undefined,
    { message: "At least one connection field must change" },
  );
const connectionRevisionSchema = z.strictObject({
  connectionId: idSchema,
  expectedRevision: revisionSchema,
});
const publicPolicyScopeSchema = z.strictObject({ kind: z.literal("user") });
const policyUpsertSchema = z.strictObject({
  policyId: idSchema.optional(),
  expectedRevision: revisionSchema.nullable(),
  scope: publicPolicyScopeSchema,
  capability: capabilityKindSchema,
  purposePattern: capabilityPurposePatternSchema,
  mode: capabilityPolicyModeSchema,
  primaryOfferingId: idSchema.nullable(),
  fallbackOfferingIds: z.array(idSchema).max(32),
  constraints: capabilityPolicyConstraintsSchema,
});

const connections = new CapabilityConnectionStore();
const offerings = new CapabilityOfferingStore();
const policies = new CapabilityPolicyStore();
const consents = new CapabilityConsentStore();
const operations = new CapabilityOperationStore();
const usage = new CapabilityUsageService();
const health = new CapabilityHealthService();

function translate(error: unknown): never {
  if (error instanceof ORPCError) throw error;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  if (code === "NOT_FOUND") {
    throw new ORPCError("NOT_FOUND", {
      message: "Capability resource not found",
    });
  }
  if (
    code === "REVISION_CONFLICT" ||
    code === "POLICY_CONFLICT" ||
    code === "DIVERGENT_REPLAY"
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        error instanceof Error ? error.message : "Capability state changed",
    });
  }
  if (
    code?.startsWith("INVALID_") ||
    code === "DISCLOSURE_NOT_PUBLISHED" ||
    code === "OFFERING_MISMATCH" ||
    code === "ROUTE_MISMATCH"
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        error instanceof Error ? error.message : "Invalid capability request",
    });
  }
  throw error;
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    translate(error);
  }
}

function requireInstantiation(factory: ProviderPluginFactory) {
  if (!factory.instantiate) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This reviewed plugin is catalogue-only in the current server build",
    });
  }
  return factory.instantiate();
}

async function currentConnection(
  ownerId: string,
  connectionId: string,
  revision: number,
) {
  const current = await connections.get(ownerId, connectionId);
  if (!current) {
    throw new ORPCError("NOT_FOUND", {
      message: "Capability connection not found",
    });
  }
  if (current.connection.revision !== revision) {
    throw new ORPCError("CONFLICT", {
      message: "Capability connection changed",
    });
  }
  return current;
}

function credentialAccess(
  ownerId: string,
  connection: Awaited<ReturnType<typeof currentConnection>>,
) {
  return async (slot: string) => {
    const metadata = connection.credentialSlots.find(
      (candidate) => candidate.slot === slot && candidate.status === "active",
    );
    if (metadata?.keyVersion === null || metadata?.keyVersion === undefined) {
      return null;
    }
    return connections.leaseSecret({
      ownerId,
      connectionId: connection.connection.id,
      slot,
      expectedVersion: metadata.keyVersion,
    });
  };
}

function requiredCredentialsReady(
  factory: ProviderPluginFactory,
  connection: Awaited<ReturnType<typeof currentConnection>>,
) {
  return factory.manifest.secretSlots
    .filter((slot) => slot.required)
    .every((slot) =>
      connection.credentialSlots.some(
        (credential) =>
          credential.slot === slot.name && credential.status === "active",
      ),
    );
}

export const capabilitiesRouter = {
  catalogue: protectedProcedure.handler(() => ({
    catalogueDigest: staticProviderPluginRegistry.catalogueDigest(),
    plugins: staticProviderPluginRegistry
      .list()
      .map(({ manifest, instantiate }) => ({
        ...manifest,
        runtimeAvailability: instantiate
          ? ("ready" as const)
          : ("catalogue-only" as const),
      })),
  })),

  readiness: protectedProcedure.handler(async ({ context }) => {
    const ownerId = context.session.user.id;
    const [ownerOfferings, ownerConnections, ownerHealth, legacyConnections] =
      await Promise.all([
        offerings.list({ ownerId }),
        connections.list(ownerId),
        health.list(ownerId),
        legacyServiceKeysAsConnections(ownerId),
      ]);
    const connectionById = new Map(
      ownerConnections.map((connection) => [
        connection.connection.id,
        connection,
      ]),
    );
    const healthById = new Map(
      ownerHealth.map((item) => [item.offeringId, item]),
    );
    return {
      capabilities: capabilityKindSchema.options.map((capability) => {
        const configured = ownerOfferings.filter(
          (offering) => offering.capability === capability,
        );
        return {
          capability,
          executionMode: capabilityExecutionMode(capability),
          configuredOfferings: configured.length,
          readyOfferings: configured.filter((offering) => {
            const connection = connectionById.get(offering.connectionId);
            const state = healthById.get(offering.id)?.state ?? "unknown";
            return (
              connection?.connection.status === "ready" &&
              state === "healthy"
            );
          }).length,
          unhealthyOfferings: configured.filter((offering) =>
            ["degraded", "offline", "unauthorized", "disabled"].includes(
              healthById.get(offering.id)?.state ?? "unknown",
            ),
          ).length,
        };
      }),
      legacyConnectionCount: legacyConnections.length,
    };
  }),

  connections: {
    list: protectedProcedure.handler(async ({ context }) => {
      const ownerId = context.session.user.id;
      const [current, legacyConnections] = await Promise.all([
        connections.list(ownerId),
        legacyServiceKeysAsConnections(ownerId),
      ]);
      return { connections: current, legacyConnections };
    }),
    create: protectedProcedure
      .input(connectionCreateSchema)
      .handler(({ context, input }) =>
        call(() =>
          connections.create({ ownerId: context.session.user.id, ...input }),
        ),
      ),
    update: protectedProcedure
      .input(connectionUpdateSchema)
      .handler(({ context, input }) =>
        call(() =>
          connections.update({ ownerId: context.session.user.id, ...input }),
        ),
      ),
    validate: protectedProcedure
      .input(connectionRevisionSchema)
      .handler(({ context, input }) =>
        call(async () => {
          const ownerId = context.session.user.id;
          const current = await currentConnection(
            ownerId,
            input.connectionId,
            input.expectedRevision,
          );
          const factory = staticProviderPluginRegistry.require(
            current.connection.pluginId,
          );
          const knownOfferings = (await offerings.list({ ownerId })).filter(
            (offering) => offering.connectionId === current.connection.id,
          );
          const startedAt = performance.now();
          let validation: ProviderConnectionValidationResult;
          if (!requiredCredentialsReady(factory, current)) {
            validation = {
              valid: false,
              error: capabilityFailure(
                "AUTHENTICATION_REQUIRED",
                "A required provider credential is missing",
              ),
            };
          } else {
            const plugin = requireInstantiation(factory);
            try {
              validation = await plugin.validateConnection(
                {
                  ownerId,
                  signal: AbortSignal.timeout(15_000),
                  credential: credentialAccess(ownerId, current),
                },
                current.connection.config,
              );
            } catch (error) {
              validation = {
                valid: false,
                error: normalizeCapabilityError(error),
              };
            }
          }
          const connection = await connections.markValidated({
            ownerId,
            connectionId: input.connectionId,
            expectedRevision: input.expectedRevision,
            valid: validation.valid,
          });
          for (const offering of knownOfferings) {
            if (validation.valid) {
              if (
                offering.connectionRevision === connection.connection.revision
              ) {
                await health.recordSuccess({
                  ownerId,
                  offeringId: offering.id,
                  latencyMs: performance.now() - startedAt,
                });
              }
            } else {
              await health.recordFailure({
                ownerId,
                offeringId: offering.id,
                error: validation.error,
              });
            }
          }
          return { connection, validation };
        }),
      ),
    discover: protectedProcedure
      .input(connectionRevisionSchema)
      .handler(({ context, input }) =>
        call(async () => {
          const ownerId = context.session.user.id;
          const current = await currentConnection(
            ownerId,
            input.connectionId,
            input.expectedRevision,
          );
          if (current.connection.status !== "ready") {
            throw new ORPCError("CONFLICT", {
              message: "Validate the capability connection before discovery",
            });
          }
          const plugin = requireInstantiation(
            staticProviderPluginRegistry.require(current.connection.pluginId),
          );
          const discoveryStartedAt = Date.now();
          // Discovery is an explicit user action. Do not turn a stale "ready"
          // connection into fresh healthy offerings without probing it first.
          let validation: ProviderConnectionValidationResult;
          try {
            validation = await plugin.validateConnection(
              {
                ownerId,
                signal: AbortSignal.timeout(15_000),
                credential: credentialAccess(ownerId, current),
              },
              current.connection.config,
            );
          } catch (error) {
            validation = {
              valid: false,
              error: normalizeCapabilityError(error),
            };
          }
          if (!validation.valid) {
            const probeError = validation.error;
            const knownOfferings = (await offerings.list({ ownerId })).filter(
              (offering) => offering.connectionId === current.connection.id,
            );
            await Promise.all(
              knownOfferings.map((offering) =>
                health.recordFailure({
                  ownerId,
                  offeringId: offering.id,
                  error: probeError,
                }),
              ),
            );
            throw new ORPCError("BAD_REQUEST", { message: probeError.message });
          }
          await currentConnection(
            ownerId,
            input.connectionId,
            input.expectedRevision,
          );
          const discovered = await plugin.discoverOfferings(
            {
              ownerId,
              now: new Date(),
              signal: AbortSignal.timeout(30_000),
              credential: credentialAccess(ownerId, current),
            },
            current.connection,
          );
          const registered = [];
          for (const offering of discovered) {
            const currentOffering = await offerings.register({
              ownerId,
              offering,
              status: "ready",
            });
            registered.push(currentOffering);
            await health.recordSuccess({
              ownerId,
              offeringId: currentOffering.id,
              latencyMs: Math.max(0, Date.now() - discoveryStartedAt),
            });
          }
          return {
            connectionId: current.connection.id,
            connectionRevision: current.connection.revision,
            offerings: registered,
          };
        }),
      ),
    disable: protectedProcedure
      .input(connectionRevisionSchema.extend({ reason: reasonSchema }))
      .handler(({ context, input }) =>
        call(async () => {
          const ownerId = context.session.user.id;
          const currentOfferings = await offerings.list({ ownerId });
          const connection = await connections.disable({
            ownerId,
            connectionId: input.connectionId,
            expectedRevision: input.expectedRevision,
          });
          await Promise.all(
            currentOfferings
              .filter(
                (offering) => offering.connectionId === input.connectionId,
              )
              .map((offering) =>
                health
                  .markDisabled(ownerId, offering.id)
                  .catch(() => undefined),
              ),
          );
          return connection;
        }),
      ),
    delete: protectedProcedure
      .input(connectionRevisionSchema)
      .handler(({ context, input }) =>
        call(() =>
          connections.softDelete({
            ownerId: context.session.user.id,
            ...input,
          }),
        ),
      ),
  },

  offerings: {
    list: protectedProcedure
      .input(
        z
          .strictObject({ capability: capabilityKindSchema.optional() })
          .default({}),
      )
      .handler(async ({ context, input }) => {
        const ownerId = context.session.user.id;
        const [ownerOfferings, ownerHealth] = await Promise.all([
          offerings.list({ ownerId, capability: input.capability }),
          health.list(ownerId),
        ]);
        const ids = new Set(ownerOfferings.map((offering) => offering.id));
        return {
          offerings: ownerOfferings,
          health: ownerHealth.filter((item) => ids.has(item.offeringId)),
        };
      }),
  },

  policies: {
    list: protectedProcedure
      .input(
        z
          .strictObject({ capability: capabilityKindSchema.optional() })
          .default({}),
      )
      .handler(async ({ context, input }) => ({
        policies: await policies.list(
          context.session.user.id,
          input.capability,
        ),
      })),
    upsert: protectedProcedure
      .input(policyUpsertSchema)
      .handler(({ context, input }) =>
        call(() =>
          policies.upsert({
            ...input,
            ownerId: context.session.user.id,
            scope: { kind: "user", id: context.session.user.id },
          }),
        ),
      ),
  },

  consents: {
    list: protectedProcedure.handler(async ({ context }) => ({
      consents: await consents.list(context.session.user.id),
    })),
    grant: protectedProcedure
      .input(
        z.strictObject({
          connectionId: idSchema,
          capability: capabilityKindSchema,
          disclosureRevision: z.string().trim().min(1).max(256),
          expectedRevision: revisionSchema.nullable(),
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          consents.grant({ ownerId: context.session.user.id, ...input }),
        ),
      ),
    revoke: protectedProcedure
      .input(
        z.strictObject({
          consentId: idSchema,
          expectedRevision: revisionSchema,
          reason: reasonSchema,
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          consents.revoke({
            ownerId: context.session.user.id,
            consentId: input.consentId,
            expectedRevision: input.expectedRevision,
          }),
        ),
      ),
  },

  operations: {
    list: protectedProcedure
      .input(
        z
          .strictObject({
            state: capabilityOperationStateSchema.optional(),
            limit: z.number().int().min(1).max(250).default(50),
          })
          .default({ limit: 50 }),
      )
      .handler(async ({ context, input }) => ({
        operations: await operations.list({
          ownerId: context.session.user.id,
          ...input,
        }),
      })),
    detail: protectedProcedure
      .input(z.strictObject({ operationId: idSchema }))
      .handler(({ context, input }) =>
        call(async () => {
          const detail = await operations.detail(
            context.session.user.id,
            input.operationId,
          );
          if (!detail) {
            throw new ORPCError("NOT_FOUND", {
              message: "Capability operation not found",
            });
          }
          return detail;
        }),
      ),
    cancel: protectedProcedure
      .input(
        z.strictObject({
          operationId: idSchema,
          expectedRevision: revisionSchema,
          reason: reasonSchema,
        }),
      )
      .handler(({ context, input }) =>
        call(() =>
          operations.cancel({
            ownerId: context.session.user.id,
            operationId: input.operationId,
            expectedRevision: input.expectedRevision,
          }),
        ),
      ),
  },

  usage: {
    summary: protectedProcedure
      .input(z.strictObject({ since: z.iso.datetime().optional() }).default({}))
      .handler(async ({ context, input }) => ({
        summary: await usage.summary({
          ownerId: context.session.user.id,
          ...(input.since ? { since: new Date(input.since) } : {}),
        }),
      })),
  },

  diagnostics: {
    shadowMismatches: protectedProcedure
      .input(
        z
          .strictObject({
            limit: z.number().int().min(1).max(250).default(100),
          })
          .default({ limit: 100 }),
      )
      .handler(({ context, input }) => ({
        mismatches: capabilityShadowDiagnostics.list(
          context.session.user.id,
          input.limit,
        ),
      })),
  },
};
