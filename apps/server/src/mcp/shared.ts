import {
  acceptedContent,
  inputRequired,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
  type RequestStateCodec,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { RouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CARD_METRICS, WIDGET_DEFINITION_VERSION } from "@avermate/core";
import { db } from "../db";
import { mcpOperations } from "../db/schema";
import { periodTemplateIds } from "../lib/academic-setup";
import { cardSurfaceSchema } from "../lib/card-storage";
import { env } from "../lib/env";
import type { AppRouter } from "../routers";
import type { McpPrincipal } from "./auth";

export const requestStateSecret =
  env.MCP_REQUEST_STATE_SECRET ?? env.BETTER_AUTH_SECRET;

export type JsonObject = Record<string, unknown>;
export type DestructiveState = {
  userId: string;
  clientId: string;
  toolName: string;
  argumentsHash: string;
  idempotencyKey: string;
};

export const confirmationSchema = z.object({
  confirm: z
    .boolean()
    .describe("True only after the user approved this exact operation"),
});

export const id = z.string().trim().min(1);
export const isoDate = z.iso.datetime({ offset: true });
export const optionalDate = isoDate.nullable().optional();

const yearFields = {
  name: z.string().trim().min(1).max(64),
  startsAt: isoDate,
  endsAt: isoDate,
  scale: z.number().positive().max(1000),
  defaultOutOf: z.number().positive().max(1000),
  passingRatio: z.number().min(0).max(1),
  decimals: z.number().int().min(0).max(4),
};
export const yearCreate = z.object({
  ...yearFields,
  scale: yearFields.scale.default(20),
  defaultOutOf: yearFields.defaultOutOf.default(20),
  passingRatio: yearFields.passingRatio.default(0.5),
  decimals: yearFields.decimals.default(2),
});
export const yearPatch = z.object(yearFields).partial();

const periodPatchFields = {
  name: z.string().trim().min(1).max(64),
  startAt: isoDate,
  endAt: isoDate,
  isCumulative: z.boolean(),
};
export const periodFields = {
  ...periodPatchFields,
  isCumulative: periodPatchFields.isCumulative.default(false),
};
export const periodPatch = z.object(periodPatchFields).partial();

export const classPeriods = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("template"),
    templateId: z.enum(periodTemplateIds),
    names: z.array(z.string().trim().min(1).max(64)).max(12).default([]),
  }),
  z.object({
    mode: z.literal("custom"),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(64),
          startsAt: isoDate,
          endsAt: isoDate,
          isCumulative: z.boolean().default(false),
        }),
      )
      .max(12),
  }),
]);

const subjectPatchFields = {
  name: z.string().trim().min(1).max(96),
  shortName: z.string().trim().max(24).nullable(),
  parentId: id.nullable(),
  coefficient: z.number().min(0).max(1000),
  kind: z.enum(["subject", "category"]),
  isMain: z.boolean(),
};
export const subjectFields = {
  ...subjectPatchFields,
  shortName: subjectPatchFields.shortName.default(null),
  parentId: subjectPatchFields.parentId.default(null),
  coefficient: subjectPatchFields.coefficient.default(1),
  kind: subjectPatchFields.kind.default("subject"),
  isMain: subjectPatchFields.isMain.default(false),
};
export const subjectPatch = z.object(subjectPatchFields).partial();

export const componentSchema = z.object({
  name: z.string().trim().min(1).max(64),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000).default(1),
});

export const gradePatchFields = {
  name: z.string().trim().min(1).max(96),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000),
  note: z.string().trim().max(500).nullable(),
  passedAt: isoDate,
  subjectId: id,
  periodId: id.nullable(),
  // The kind of assessment, which a grade has carried since the year gained types. An
  // agent writing results without it produces marks no type card can group.
  typeId: id.nullable(),
  components: z.array(componentSchema).max(20),
};

export const gradeFields = {
  ...gradePatchFields,
  coefficient: gradePatchFields.coefficient.default(1),
  note: gradePatchFields.note.default(null),
  periodId: gradePatchFields.periodId.default(null),
  typeId: gradePatchFields.typeId.default(null),
  components: gradePatchFields.components.default([]),
};

export const averageEntry = z.object({
  subjectId: id,
  coefficient: z.number().min(0).max(1000).nullable().default(null),
  includeChildren: z.boolean().default(false),
});

export const averageFields = {
  name: z.string().trim().min(1).max(64),
  entries: z.array(averageEntry).min(1).max(200),
};

const goalPatchFields = {
  name: z.string().trim().min(1).max(96),
  kind: z.enum(["general", "subject", "custom"]),
  referenceId: id.nullable(),
  targetRatio: z.number().min(0).max(1),
  periodId: id.nullable(),
  dueAt: optionalDate,
  isPinned: z.boolean(),
};
export const goalFields = {
  ...goalPatchFields,
  kind: goalPatchFields.kind.default("general"),
  referenceId: goalPatchFields.referenceId.default(null),
  periodId: goalPatchFields.periodId.default(null),
  dueAt: goalPatchFields.dueAt.default(null),
  isPinned: goalPatchFields.isPinned.default(false),
};
export const goalPatch = z.object(goalPatchFields).partial();

// MCP needs a publishable JSON Schema. The oRPC router still performs the
// complete canonical validation, compatibility checks and ownership checks.
export const mcpWidgetDefinition = z.object({
  apiVersion: z.literal(WIDGET_DEFINITION_VERSION),
  query: z.record(z.string(), z.json()),
  analysis: z.record(z.string(), z.json()),
  visualization: z.record(z.string(), z.json()),
  // A definition has four sections. Dropping this one from the published schema told
  // every agent the card had three, so anything they built came back stripped of its
  // caption, its empty-state text and its number formatting.
  presentation: z.record(z.string(), z.json()),
});

export const mcpCardFields = {
  surface: cardSurfaceSchema.default("overview"),
  metric: z.enum(CARD_METRICS).optional(),
  targetKind: z.enum(["general", "subject", "custom"]).optional(),
  targetId: id.nullable().optional(),
  goalId: id.nullable().optional(),
  display: z.enum(["value", "sparkline", "chart", "list", "gauge"]).optional(),
  definitionVersion: z.literal(WIDGET_DEFINITION_VERSION).optional(),
  definitionJson: mcpWidgetDefinition.optional(),
  span: z.number().int().min(1).max(4).default(1),
  title: z.string().trim().max(48).nullable().default(null),
  accent: z.string().trim().max(24).nullable().default(null),
  hidden: z.boolean().default(false),
};

export const mcpCardPatchFields = {
  surface: cardSurfaceSchema.optional(),
  metric: z.enum(CARD_METRICS).optional(),
  targetKind: z.enum(["general", "subject", "custom"]).optional(),
  targetId: id.nullable().optional(),
  goalId: id.nullable().optional(),
  display: z.enum(["value", "sparkline", "chart", "list", "gauge"]).optional(),
  definitionVersion: z.literal(WIDGET_DEFINITION_VERSION).optional(),
  definitionJson: mcpWidgetDefinition.optional(),
  span: z.number().int().min(1).max(4).optional(),
  title: z.string().trim().max(48).nullable().optional(),
  accent: z.string().trim().max(24).nullable().optional(),
  hidden: z.boolean().optional(),
};

export function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function objectValue(value: unknown): JsonObject {
  const normalized = normalize(value);
  return normalized !== null &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
    ? (normalized as JsonObject)
    : { value: normalized };
}

export function result(
  value: unknown,
  options?: { replayed?: boolean },
): CallToolResult {
  const data = objectValue(value);
  const structuredContent = {
    ok: true,
    ...(options?.replayed ? { replayed: true } : {}),
    data,
  };
  return {
    content: [
      { type: "text", text: JSON.stringify(structuredContent, null, 2) },
    ],
    structuredContent,
  };
}

export function failure(message: string, cancelled = false): CallToolResult {
  const structuredContent = { ok: false, cancelled, error: message };
  return {
    isError: !cancelled,
    content: [{ type: "text", text: message }],
    structuredContent,
  };
}

export async function call(
  run: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    return result(await run());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The operation failed";
    return failure(message);
  }
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stable(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function sameState(
  expected: DestructiveState,
  actual: DestructiveState,
): boolean {
  return (
    expected.userId === actual.userId &&
    expected.clientId === actual.clientId &&
    expected.toolName === actual.toolName &&
    expected.argumentsHash === actual.argumentsHash &&
    expected.idempotencyKey === actual.idempotencyKey
  );
}

export async function runDestructive<
  T extends { idempotencyKey: string },
>(options: {
  principal: McpPrincipal;
  codec: RequestStateCodec<DestructiveState>;
  toolName: string;
  input: T;
  context: ServerContext;
  description: string;
  execute: () => Promise<unknown>;
}): Promise<CallToolResult | InputRequiredResult> {
  const argumentsHash = await sha256(options.input);
  const expected: DestructiveState = {
    userId: options.principal.userId,
    clientId: options.principal.clientId,
    toolName: options.toolName,
    argumentsHash,
    idempotencyKey: options.input.idempotencyKey,
  };
  const state = options.context.mcpReq.requestState<DestructiveState>();

  if (!state) {
    return inputRequired({
      requestState: await options.codec.mint(expected, options.context),
      inputRequests: {
        confirmation: inputRequired.elicit({
          message: `${options.description} This action is irreversible. Confirm explicitly to continue.`,
          requestedSchema: confirmationSchema,
        }),
      },
    });
  }

  if (!sameState(expected, state)) {
    return failure("The confirmation does not match this exact operation");
  }

  const confirmation = acceptedContent(
    options.context.mcpReq.inputResponses,
    "confirmation",
    confirmationSchema,
  );
  if (!confirmation?.confirm) {
    return failure("The destructive operation was cancelled", true);
  }

  try {
    const [reservation] = await db
      .insert(mcpOperations)
      .values({
        userId: options.principal.userId,
        toolName: options.toolName,
        idempotencyKey: options.input.idempotencyKey,
        argumentsHash,
      })
      .onConflictDoNothing()
      .returning({ id: mcpOperations.id });

    if (!reservation) {
      const [previous] = await db
        .select()
        .from(mcpOperations)
        .where(
          and(
            eq(mcpOperations.userId, options.principal.userId),
            eq(mcpOperations.toolName, options.toolName),
            eq(mcpOperations.idempotencyKey, options.input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!previous || previous.argumentsHash !== argumentsHash) {
        return failure(
          "That idempotency key was already used for different arguments",
        );
      }
      if (previous.status === "completed" && previous.result) {
        return result(previous.result, { replayed: true });
      }
      return failure(
        "This operation is already pending. Inspect the resource before choosing a new idempotency key.",
      );
    }

    const domainResult = objectValue(await options.execute());
    await db
      .update(mcpOperations)
      .set({
        status: "completed",
        result: domainResult,
        completedAt: new Date(),
      })
      .where(eq(mcpOperations.id, reservation.id));
    return result(domainResult);
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "The operation failed",
    );
  }
}

export function can(principal: McpPrincipal, ...scopes: string[]): boolean {
  return scopes.every((scope) => principal.scopes.has(scope));
}

export function meta(...scopes: string[]) {
  return { "io.avermate/requiredScopes": scopes };
}

export function mapDate(
  value: string | null | undefined,
): Date | null | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? null
      : new Date(value);
}

export type Api = RouterClient<AppRouter>;

export interface McpSurfaceContext {
  server: McpServer;
  api: Api;
  principal: McpPrincipal;
  codec: RequestStateCodec<DestructiveState>;
}

export interface McpSurface {
  /** Scope(s) that must ALL be present for this surface to register. */
  scopes: readonly string[];
  /** Also require the backend admin role through the authoritative isAdmin helper. */
  requiresAdminRole?: boolean;
  register(ctx: McpSurfaceContext): void;
}
