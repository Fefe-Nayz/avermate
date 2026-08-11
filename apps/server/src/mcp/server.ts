import {
  McpServer,
  ResourceTemplate,
  acceptedContent,
  createRequestStateCodec,
  inputRequired,
  type CallToolResult,
  type InputRequiredResult,
  type RequestStateCodec,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CARD_METRICS } from "@avermate/core";
import { db } from "../db";
import { mcpOperations } from "../db/schema";
import { env } from "../lib/env";
import { SOCIAL_POLICY_VERSION } from "../lib/social-policy";
import { appRouter } from "../routers";
import type { McpPrincipal } from "./auth";

const requestStateSecret =
  env.MCP_REQUEST_STATE_SECRET ?? env.BETTER_AUTH_SECRET;

type JsonObject = Record<string, unknown>;
type DestructiveState = {
  userId: string;
  clientId: string;
  toolName: string;
  argumentsHash: string;
  idempotencyKey: string;
};

const confirmationSchema = z.object({
  confirm: z
    .boolean()
    .describe("True only after the user approved this exact operation"),
});

const id = z.string().trim().min(1);
const isoDate = z.iso.datetime({ offset: true });
const optionalDate = isoDate.nullable().optional();

const yearCreate = z.object({
  name: z.string().trim().min(1).max(64),
  startsAt: isoDate,
  endsAt: isoDate,
  scale: z.number().positive().max(1000).default(20),
  defaultOutOf: z.number().positive().max(1000).default(20),
  passingRatio: z.number().min(0).max(1).default(0.5),
  decimals: z.number().int().min(0).max(4).default(2),
});

const periodFields = {
  name: z.string().trim().min(1).max(64),
  startAt: isoDate,
  endAt: isoDate,
  isCumulative: z.boolean().default(false),
};

const subjectFields = {
  name: z.string().trim().min(1).max(96),
  shortName: z.string().trim().max(24).nullable().default(null),
  parentId: id.nullable().default(null),
  coefficient: z.number().min(0).max(1000).default(1),
  kind: z.enum(["subject", "category"]).default("subject"),
  isMain: z.boolean().default(false),
};

const componentSchema = z.object({
  name: z.string().trim().min(1).max(64),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000).default(1),
});

const gradeFields = {
  name: z.string().trim().min(1).max(96),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000).default(1),
  note: z.string().trim().max(500).nullable().default(null),
  passedAt: isoDate,
  subjectId: id,
  periodId: id.nullable().default(null),
  components: z.array(componentSchema).max(20).default([]),
};

const averageEntry = z.object({
  subjectId: id,
  coefficient: z.number().min(0).max(1000).nullable().default(null),
  includeChildren: z.boolean().default(false),
});

const averageFields = {
  name: z.string().trim().min(1).max(64),
  isMain: z.boolean().default(false),
  entries: z.array(averageEntry).min(1).max(200),
};

const goalFields = {
  name: z.string().trim().min(1).max(96),
  kind: z.enum(["general", "subject", "custom"]).default("general"),
  referenceId: id.nullable().default(null),
  targetRatio: z.number().min(0).max(1),
  periodId: id.nullable().default(null),
  dueAt: optionalDate.default(null),
  isPinned: z.boolean().default(false),
};

const cardFields = {
  surface: z.enum(["overview", "subject", "grade"]).default("overview"),
  metric: z.enum(CARD_METRICS),
  targetKind: z.enum(["general", "subject", "custom"]).default("general"),
  targetId: id.nullable().default(null),
  goalId: id.nullable().default(null),
  display: z
    .enum(["value", "sparkline", "chart", "list", "gauge"])
    .default("value"),
  span: z.number().int().min(1).max(4).default(1),
  title: z.string().trim().max(48).nullable().default(null),
  accent: z.string().trim().max(24).nullable().default(null),
  hidden: z.boolean().default(false),
};

function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function objectValue(value: unknown): JsonObject {
  const normalized = normalize(value);
  return normalized !== null &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
    ? (normalized as JsonObject)
    : { value: normalized };
}

function result(
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

function failure(message: string, cancelled = false): CallToolResult {
  const structuredContent = { ok: false, cancelled, error: message };
  return {
    isError: !cancelled,
    content: [{ type: "text", text: message }],
    structuredContent,
  };
}

async function call(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return result(await run());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The operation failed";
    return failure(message);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stable(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sameState(
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

async function runDestructive<T extends { idempotencyKey: string }>(options: {
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

function can(principal: McpPrincipal, ...scopes: string[]): boolean {
  return scopes.every((scope) => principal.scopes.has(scope));
}

function meta(...scopes: string[]) {
  return { "io.avermate/requiredScopes": scopes };
}

function mapDate(value: string | null | undefined): Date | null | undefined {
  return value === undefined
    ? undefined
    : value === null
      ? null
      : new Date(value);
}

export function createAvermateMcpServer(principal: McpPrincipal): McpServer {
  const api = createRouterClient(appRouter, { context: principal.context });
  const codec = createRequestStateCodec<DestructiveState>({
    key: requestStateSecret,
    ttlSeconds: 10 * 60,
    bind: (context) =>
      `${principal.userId}\0${principal.clientId}\0${context.mcpReq.method}`,
  });
  const server = new McpServer(
    { name: "avermate", version: "2.0.0" },
    {
      instructions:
        "Avermate manages academic years, periods, subject hierarchies, grades and components, calculated averages, goals, dashboard cards, preferences and year recaps. Read current data before changing it. Never infer identifiers. Destructive tools always require an explicit multi-round-trip confirmation.",
      cacheHints: {
        "server/discover": { ttlMs: 300_000, cacheScope: "private" },
        "tools/list": { ttlMs: 300_000, cacheScope: "private" },
        "prompts/list": { ttlMs: 300_000, cacheScope: "private" },
        "resources/list": { ttlMs: 60_000, cacheScope: "private" },
        "resources/templates/list": { ttlMs: 300_000, cacheScope: "private" },
        "resources/read": { ttlMs: 10_000, cacheScope: "private" },
      },
      requestState: { verify: codec.verify },
      inputRequired: { maxRounds: 2, legacyShim: false },
    },
  );

  if (can(principal, "avermate:read")) {
    registerReadSurface(server, api);
    registerResources(server, api);
    registerPrompts(server, principal);
  }
  if (can(principal, "avermate:write")) registerWriteSurface(server, api);
  if (can(principal, "avermate:social.read")) {
    registerSocialReadSurface(server, api);
  }
  if (can(principal, "avermate:social.manage")) {
    registerSocialManageSurface(server, api, principal, codec);
  }
  if (can(principal, "avermate:delete")) {
    registerDestructiveSurface(server, api, principal, codec);
  }
  if (
    can(principal, "avermate:read", "avermate:admin") &&
    principal.context.session?.user.role?.split(",").includes("admin")
  ) {
    registerAdminSurface(server, api, principal, codec);
  }
  if (
    can(principal, "avermate:social.moderate") &&
    principal.context.session?.user.role?.split(",").includes("admin")
  ) {
    registerSocialModerationSurface(server, api, principal, codec);
  }

  return server;
}

type Api = ReturnType<
  typeof createRouterClient<typeof appRouter, Record<never, never>>
>;

function registerReadSurface(server: McpServer, api: Api): void {
  const readMeta = meta("avermate:read");
  const readOnly = { readOnlyHint: true };

  server.registerTool(
    "account.get",
    {
      description: "Read the connected Avermate profile.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.profile.viewer()),
  );
  server.registerTool(
    "years.list",
    {
      description: "List all academic years owned by the user.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.years.list()),
  );
  server.registerTool(
    "years.get",
    {
      description: "Read one academic year.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => call(() => api.years.get({ yearId })),
  );
  server.registerTool(
    "years.contents",
    {
      description:
        "Count subjects, grades and periods affected by deleting a year.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => call(() => api.years.contents({ yearId })),
  );
  server.registerTool(
    "periods.list",
    {
      description: "List a year's periods.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => call(() => api.periods.list({ yearId })),
  );
  server.registerTool(
    "subjects.list",
    {
      description: "List a year's subject/category hierarchy.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => call(() => api.subjects.list({ yearId })),
  );
  server.registerTool(
    "subjects.get",
    {
      description: "Read a subject or category.",
      inputSchema: z.object({ subjectId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ subjectId }) => call(() => api.subjects.get({ subjectId })),
  );
  server.registerTool(
    "subjects.delete_impact",
    {
      description:
        "Count descendants and grades affected by deleting a subject.",
      inputSchema: z.object({ subjectId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ subjectId }) => call(() => api.subjects.impact({ subjectId })),
  );
  server.registerTool(
    "grades.get",
    {
      description: "Read a grade and its components.",
      inputSchema: z.object({ gradeId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ gradeId }) => call(() => api.grades.get({ gradeId })),
  );
  server.registerTool(
    "grades.recent",
    {
      description: "Read recent grades in a year.",
      inputSchema: z.object({
        yearId: id,
        limit: z.number().int().min(1).max(50).default(10),
      }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId, limit }) => call(() => api.grades.recent({ yearId, limit })),
  );
  server.registerTool(
    "averages.list",
    {
      description: "List custom averages and their subject entries.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => call(() => api.averages.list({ yearId })),
  );
  server.registerTool(
    "averages.get",
    {
      description: "Read one custom average.",
      inputSchema: z.object({ averageId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ averageId }) => call(() => api.averages.get({ averageId })),
  );
  server.registerTool(
    "goals.list",
    {
      description: "List academic goals for a year.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => call(() => api.goals.list({ yearId })),
  );
  server.registerTool(
    "cards.list",
    {
      description: "List dashboard cards for a year and surface.",
      inputSchema: z.object({
        yearId: id,
        surface: z.enum(["overview", "subject", "grade"]).default("overview"),
      }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId, surface }) => call(() => api.cards.list({ yearId, surface })),
  );
  server.registerTool(
    "preferences.get",
    {
      description: "Read application, theme and chart preferences.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.preferences.get()),
  );
  server.registerTool(
    "announcements.active",
    {
      description: "Read active, undismissed announcements.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.announcements.active()),
  );
  server.registerTool(
    "announcements.history",
    {
      description: "Read the user's announcement history.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.announcements.history()),
  );
  server.registerTool(
    "analytics.snapshot",
    {
      description:
        "Read the complete normalized dataset for one year, including subjects, grades, components, periods, averages, goals and cards.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => call(() => api.snapshot.get({ yearId })),
  );
  server.registerTool(
    "recap.status",
    {
      description:
        "Read year-recap availability, activity percentile and seen state.",
      inputSchema: z.object({
        yearId: id,
        reviewKey: z.string().default("annual"),
      }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId, reviewKey }) =>
      call(() => api.review.status({ yearId, reviewKey })),
  );
  server.registerTool(
    "recap.eligible_years",
    {
      description: "List years eligible for a year recap.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.review.eligibleYears()),
  );
  server.registerTool(
    "feedback.mine",
    {
      description: "Read feedback submitted by the connected user.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.feedback.mine()),
  );
  server.registerTool(
    "account.export",
    {
      description:
        "Export every reconstructible application relation without authentication secrets.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => call(() => api.preferences.exportData()),
  );
}

function registerSocialReadSurface(server: McpServer, api: Api): void {
  const readMeta = meta("avermate:social.read");
  const readOnly = { readOnlyHint: true };
  const tool = <Schema extends z.ZodObject<any>>(
    name: string,
    description: string,
    inputSchema: Schema,
    handler: (input: z.infer<Schema>) => Promise<CallToolResult>,
  ) =>
    server.registerTool(
      name,
      { description, inputSchema, annotations: readOnly, _meta: readMeta },
      (async (
        input: z.infer<Schema>,
        _context: ServerContext,
      ): Promise<CallToolResult> => handler(input)) as never,
    );

  tool(
    "social.eligibility",
    "Read social eligibility and guardian requirements.",
    z.object({}),
    () => call(() => api.social.eligibility.get()),
  );
  tool(
    "social.profile",
    "Read the connected user's opt-in social profile.",
    z.object({}),
    () => call(() => api.social.profile.mine()),
  );
  tool(
    "social.grants",
    "List active field-level social profile grants.",
    z.object({}),
    () => call(() => api.social.grants.list()),
  );
  tool(
    "social.friends",
    "List friends using relationship capabilities, never account IDs.",
    z.object({}),
    () => call(() => api.social.friends.list()),
  );
  tool(
    "social.friend_requests",
    "List incoming and outgoing friend requests.",
    z.object({}),
    () => call(() => api.social.friends.requests()),
  );
  tool(
    "social.circles",
    "List friend circles and their capability-safe members.",
    z.object({}),
    () => call(() => api.social.circles.list()),
  );
  tool(
    "social.blocks",
    "List profiles blocked by the connected user.",
    z.object({}),
    () => call(() => api.social.blocks.list()),
  );
  tool(
    "social.groups",
    "List private social groups and membership consent state.",
    z.object({}),
    () => call(() => api.social.groups.list()),
  );
  tool(
    "social.group",
    "Read a private group, its immutable policy and allowed member projections.",
    z.object({ groupId: id }),
    (input) => call(() => api.social.groups.get(input)),
  );
  tool(
    "social.group_policy",
    "Read a group's current sharing policy and viewer ranking opt-ins.",
    z.object({ groupId: id }),
    (input) => call(() => api.social.groups.policy.current(input)),
  );
  tool(
    "social.group_stats",
    "Read threshold-protected aggregate statistics for an allow-listed metric.",
    z.object({
      groupId: id,
      metric: z.enum([
        "normalizedAverage",
        "median",
        "trendBand",
        "passRateBand",
        "gradeCountBand",
        "genericGoalProgress",
      ]),
    }),
    (input) => call(() => api.social.groups.stats(input)),
  );
  tool(
    "social.group_rankings",
    "Read an opt-in, threshold-protected ranking or private percentile band.",
    z.object({
      groupId: id,
      metric: z.enum([
        "normalizedAverage",
        "median",
        "trendBand",
        "passRateBand",
        "gradeCountBand",
        "genericGoalProgress",
      ]),
    }),
    (input) => call(() => api.social.groups.rankings(input)),
  );
  tool(
    "social.notifications",
    "Read privacy-safe social notifications.",
    z.object({
      unreadOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }),
    (input) => call(() => api.social.notifications.list(input)),
  );
  tool(
    "social.reports",
    "Read moderation reports submitted by the connected user.",
    z.object({}),
    () => call(() => api.social.reports.mine()),
  );
  tool(
    "social.export",
    "Export only the connected user's social relations and consent ledger.",
    z.object({}),
    () => call(() => api.social.account.export()),
  );
}

function registerSocialManageSurface(
  server: McpServer,
  api: Api,
  principal: McpPrincipal,
  codec: RequestStateCodec<DestructiveState>,
): void {
  const manageMeta = meta("avermate:social.manage");
  const confirmed = { destructiveHint: true, idempotentHint: true };
  const key = { idempotencyKey: z.string().uuid() };
  const metric = z.enum([
    "normalizedAverage",
    "median",
    "trendBand",
    "passRateBand",
    "gradeCountBand",
    "genericGoalProgress",
  ]);
  const policy = z.object({
    purpose: z.string().trim().min(10).max(500),
    audienceDescription: z.string().trim().min(3).max(240),
    window: z.enum(["current_academic_year", "last_90_days", "last_30_days"]),
    rankingsEnabled: z.boolean().default(false),
    fields: z
      .array(
        z.object({
          fieldKey: metric,
          required: z.boolean().default(false),
          exposure: z.enum(["aggregate_only", "member_visible", "ranking"]),
        }),
      )
      .min(1)
      .max(6),
  });

  server.registerTool(
    "social.profile.update",
    {
      description: "Update the connected user's opt-in friend profile.",
      inputSchema: z.object({
        status: z.enum(["off", "active"]).optional(),
        discovery: z.enum(["off", "invite_only", "exact_handle"]).optional(),
        handle: z.string().trim().min(3).max(32).nullable().optional(),
        displayName: z.string().trim().min(1).max(80).optional(),
        bio: z.string().trim().max(280).optional(),
        educationBand: z
          .enum([
            "unknown",
            "middle_school",
            "high_school",
            "higher_education",
            "other",
          ])
          .optional(),
        expectedRevision: z.number().int().min(1).optional(),
      }),
      _meta: manageMeta,
    },
    (input) => call(() => api.social.profile.update(input)),
  );
  server.registerTool(
    "social.grants.upsert",
    {
      description:
        "Grant one allow-listed profile field to friends, a circle, or one friendship capability.",
      inputSchema: z.object({
        fieldKey: z.enum(["displayName", "avatar", "bio", "educationBand"]),
        audience: z.enum(["friends", "circle", "specific_user"]),
        audienceId: id.nullable().default(null),
      }),
      _meta: manageMeta,
    },
    (input) => call(() => api.social.grants.upsert(input)),
  );
  server.registerTool(
    "social.grants.revoke",
    {
      description: "Immediately withdraw a profile field grant.",
      inputSchema: z.object({ grantId: id }),
      _meta: manageMeta,
    },
    (input) => call(() => api.social.grants.revoke(input)),
  );
  server.registerTool(
    "social.ranking_opt_in",
    {
      description: "Opt in or out of one current-policy ranking metric.",
      inputSchema: z.object({ groupId: id, metric, enabled: z.boolean() }),
      _meta: manageMeta,
    },
    (input) => call(() => api.social.groups.policy.setRankingOptIn(input)),
  );

  server.registerTool(
    "social.eligibility.begin",
    {
      description:
        "Record the user's coarse age band and social-policy consent. No date of birth or document is stored.",
      inputSchema: z.object({
        ageBand: z.enum(["under15", "15to17", "adult"]),
        acceptedPolicyVersion: z.literal(SOCIAL_POLICY_VERSION),
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.eligibility.begin",
        input,
        context,
        description: `Record ${input.ageBand} eligibility and consent to social policy ${input.acceptedPolicyVersion}.`,
        execute: () =>
          api.social.eligibility.begin({
            ageBand: input.ageBand,
            acceptedPolicyVersion: input.acceptedPolicyVersion,
            channel: "mcp",
          }),
      }),
  );
  server.registerTool(
    "social.eligibility.revoke",
    {
      description:
        "Withdraw global social consent and immediately stop all projections.",
      inputSchema: z.object(key),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.eligibility.revoke",
        input,
        context,
        description: "Withdraw all social sharing consent.",
        execute: () => api.social.eligibility.revoke({ channel: "mcp" }),
      }),
  );
  server.registerTool(
    "social.friends.send",
    {
      description:
        "Send a friend request to an exact handle without exposing account identifiers.",
      inputSchema: z.object({
        handle: z.string().trim().min(3).max(32),
        message: z.string().trim().max(180).nullable().default(null),
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.friends.send",
        input,
        context,
        description: `Send a friend request to handle ${input.handle}.`,
        execute: () =>
          api.social.friends.send({
            handle: input.handle,
            message: input.message,
          }),
      }),
  );
  server.registerTool(
    "social.friends.accept",
    {
      description: "Accept a pending friend request capability.",
      inputSchema: z.object({ requestId: id, ...key }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.friends.accept",
        input,
        context,
        description: `Accept friend request ${input.requestId}.`,
        execute: () =>
          api.social.friends.accept({ requestId: input.requestId }),
      }),
  );
  server.registerTool(
    "social.friends.remove",
    {
      description:
        "Remove a friendship and revoke its direct/circle sharing links.",
      inputSchema: z.object({ friendshipId: id, ...key }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.friends.remove",
        input,
        context,
        description: `Remove friendship ${input.friendshipId}.`,
        execute: () =>
          api.social.friends.remove({ friendshipId: input.friendshipId }),
      }),
  );
  server.registerTool(
    "social.blocks.create",
    {
      description:
        "Block a capability-resolved profile and revoke friendship sharing atomically.",
      inputSchema: z.object({
        source: z.enum(["friendship", "friend_request", "group_membership"]),
        sourceId: id,
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.blocks.create",
        input,
        context,
        description: `Block the profile resolved from ${input.source} ${input.sourceId}.`,
        execute: () =>
          api.social.blocks.create({
            source: input.source,
            sourceId: input.sourceId,
          }),
      }),
  );
  server.registerTool(
    "social.groups.create",
    {
      description:
        "Create a private group with an immutable versioned sharing policy.",
      inputSchema: z.object({
        name: z.string().trim().min(2).max(100),
        description: z.string().trim().max(500).default(""),
        type: z.enum(["friends", "study_group", "class"]),
        classSelfDeclared: z.boolean().default(false),
        alias: z.string().trim().min(1).max(60),
        sharedYearId: id,
        policy,
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.create",
        input,
        context,
        description: `Create private ${input.type} group ${input.name} and share the selected derived metrics.`,
        execute: () =>
          api.social.groups.create({
            name: input.name,
            description: input.description,
            type: input.type,
            classSelfDeclared: input.classSelfDeclared,
            alias: input.alias,
            sharedYearId: input.sharedYearId,
            policy: input.policy,
            accepted: true,
            channel: "mcp",
          }),
      }),
  );
  server.registerTool(
    "social.groups.join",
    {
      description:
        "Accept a private group invitation; policy consent remains a separate confirmed step.",
      inputSchema: z.object({
        token: z.string().min(32).max(256),
        alias: z.string().trim().min(1).max(60),
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.join",
        input,
        context,
        description:
          "Join the group represented by this one-time bearer invitation.",
        execute: () =>
          api.social.groups.invitations.accept({
            token: input.token,
            alias: input.alias,
          }),
      }),
  );
  server.registerTool(
    "social.groups.policy.create_version",
    {
      description:
        "Replace a group policy with a new immutable version and require every member to reconsent.",
      inputSchema: z.object({
        groupId: id,
        expectedRevision: z.number().int().min(1),
        policy,
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.policy.create_version",
        input,
        context,
        description: `Create a new sharing policy for group ${input.groupId}; all current sharing stops until reconsent.`,
        execute: () =>
          api.social.groups.policy.createVersion({
            groupId: input.groupId,
            expectedRevision: input.expectedRevision,
            policy: input.policy,
          }),
      }),
  );
  server.registerTool(
    "social.groups.policy.reconsent",
    {
      description:
        "Consent to an exact group policy digest and selected derived metrics.",
      inputSchema: z.object({
        groupId: id,
        policyDigest: z.string().length(64),
        selectedFields: z.array(metric).max(6),
        sharedYearId: id,
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.policy.reconsent",
        input,
        context,
        description: `Consent to policy ${input.policyDigest} in group ${input.groupId} for ${input.selectedFields.join(", ")}.`,
        execute: () =>
          api.social.groups.policy.reconsent({
            groupId: input.groupId,
            policyDigest: input.policyDigest,
            selectedFields: input.selectedFields,
            sharedYearId: input.sharedYearId,
            accepted: true,
            channel: "mcp",
          }),
      }),
  );
  server.registerTool(
    "social.groups.policy.withdraw",
    {
      description:
        "Immediately withdraw the connected user's current group sharing consent.",
      inputSchema: z.object({ groupId: id, ...key }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.policy.withdraw",
        input,
        context,
        description: `Withdraw all current sharing in group ${input.groupId}.`,
        execute: () =>
          api.social.groups.policy.withdraw({ groupId: input.groupId }),
      }),
  );
  server.registerTool(
    "social.groups.members.set_role",
    {
      description: "Change a capability-resolved group member role.",
      inputSchema: z.object({
        groupId: id,
        membershipId: id,
        role: z.enum(["member", "moderator"]),
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.members.set_role",
        input,
        context,
        description: `Set membership ${input.membershipId} to role ${input.role}.`,
        execute: () =>
          api.social.groups.members.setRole({
            groupId: input.groupId,
            membershipId: input.membershipId,
            role: input.role,
          }),
      }),
  );
  server.registerTool(
    "social.groups.members.remove",
    {
      description: "Remove a capability-resolved member from a group.",
      inputSchema: z.object({ groupId: id, membershipId: id, ...key }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.members.remove",
        input,
        context,
        description: `Remove membership ${input.membershipId} from group ${input.groupId}.`,
        execute: () =>
          api.social.groups.members.remove({
            groupId: input.groupId,
            membershipId: input.membershipId,
          }),
      }),
  );
  server.registerTool(
    "social.groups.leave",
    {
      description: "Leave a group and stop all connected sharing.",
      inputSchema: z.object({ groupId: id, ...key }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.leave",
        input,
        context,
        description: `Leave group ${input.groupId}.`,
        execute: () =>
          api.social.groups.members.leave({ groupId: input.groupId }),
      }),
  );
  server.registerTool(
    "social.groups.delete",
    {
      description:
        "Permanently delete an owned group and all group-scoped consent records.",
      inputSchema: z.object({
        groupId: id,
        expectedRevision: z.number().int().min(1),
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.delete",
        input,
        context,
        description: `Permanently delete group ${input.groupId}.`,
        execute: () =>
          api.social.groups.delete({
            groupId: input.groupId,
            expectedRevision: input.expectedRevision,
          }),
      }),
  );
  server.registerTool(
    "social.reports.create",
    {
      description:
        "Submit a social safety/privacy report against a capability-resolved target.",
      inputSchema: z.object({
        source: z.enum([
          "friendship",
          "friend_request",
          "group",
          "group_membership",
        ]),
        sourceId: id,
        category: z.enum([
          "harassment",
          "privacy",
          "impersonation",
          "unsafe_content",
          "other",
        ]),
        message: z.string().trim().min(10).max(2_000),
        ...key,
      }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.reports.create",
        input,
        context,
        description: `Submit a ${input.category} safety report for the selected social capability.`,
        execute: () =>
          api.social.reports.create({
            source: input.source,
            sourceId: input.sourceId,
            category: input.category,
            message: input.message,
          }),
      }),
  );
  server.registerTool(
    "social.account.reset",
    {
      description:
        "Reset all social profile, relations, invitations and sharing consent while preserving academic data.",
      inputSchema: z.object(key),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.account.reset",
        input,
        context,
        description: "Reset the entire social account and stop all sharing.",
        execute: () =>
          api.social.account.reset({ confirmation: "RESET SOCIAL" }),
      }),
  );
}

function registerWriteSurface(server: McpServer, api: Api): void {
  const writeMeta = meta("avermate:write");

  server.registerTool(
    "years.create",
    {
      description: "Create an academic year and seed its default dashboard.",
      inputSchema: yearCreate,
      _meta: writeMeta,
    },
    (input) =>
      call(() =>
        api.years.create({
          ...input,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
        }),
      ),
  );
  server.registerTool(
    "years.update",
    {
      description: "Update an owned academic year.",
      inputSchema: yearCreate.partial().extend({ yearId: id }),
      _meta: writeMeta,
    },
    ({ yearId, startsAt, endsAt, ...patch }) =>
      call(() =>
        api.years.update({
          yearId,
          ...patch,
          startsAt: mapDate(startsAt) ?? undefined,
          endsAt: mapDate(endsAt) ?? undefined,
        }),
      ),
  );
  server.registerTool(
    "years.archive",
    {
      description: "Archive or restore an academic year.",
      inputSchema: z.object({ yearId: id, archived: z.boolean() }),
      _meta: writeMeta,
    },
    (input) => call(() => api.years.archive(input)),
  );
  server.registerTool(
    "years.reorder",
    {
      description: "Set academic-year display order.",
      inputSchema: z.object({ yearIds: z.array(id).min(1) }),
      _meta: writeMeta,
    },
    (input) => call(() => api.years.reorder(input)),
  );

  server.registerTool(
    "periods.create",
    {
      description: "Create a period in an academic year.",
      inputSchema: z.object({ yearId: id, ...periodFields }),
      _meta: writeMeta,
    },
    (input) =>
      call(() =>
        api.periods.create({
          ...input,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
        }),
      ),
  );
  server.registerTool(
    "periods.update",
    {
      description: "Update a period.",
      inputSchema: z.object(periodFields).partial().extend({ periodId: id }),
      _meta: writeMeta,
    },
    ({ periodId, startAt, endAt, ...patch }) =>
      call(() =>
        api.periods.update({
          periodId,
          ...patch,
          startAt: mapDate(startAt) ?? undefined,
          endAt: mapDate(endAt) ?? undefined,
        }),
      ),
  );
  server.registerTool(
    "periods.reorder",
    {
      description: "Set period display order.",
      inputSchema: z.object({ periodIds: z.array(id).min(1) }),
      _meta: writeMeta,
    },
    (input) => call(() => api.periods.reorder(input)),
  );

  server.registerTool(
    "subjects.create",
    {
      description: "Create a subject or category in a year.",
      inputSchema: z.object({ yearId: id, ...subjectFields }),
      _meta: writeMeta,
    },
    (input) => call(() => api.subjects.create(input)),
  );
  server.registerTool(
    "subjects.update",
    {
      description:
        "Update a subject or category while preserving hierarchy invariants.",
      inputSchema: z.object(subjectFields).partial().extend({ subjectId: id }),
      _meta: writeMeta,
    },
    (input) => call(() => api.subjects.update(input)),
  );
  server.registerTool(
    "subjects.move",
    {
      description: "Reparent and reorder a subject among explicit siblings.",
      inputSchema: z.object({
        subjectId: id,
        parentId: id.nullable(),
        siblingIds: z.array(id),
      }),
      _meta: writeMeta,
    },
    (input) => call(() => api.subjects.move(input)),
  );

  server.registerTool(
    "grades.create",
    {
      description: "Create a simple or composite grade.",
      inputSchema: z.object(gradeFields),
      _meta: writeMeta,
    },
    (input) =>
      call(() =>
        api.grades.create({ ...input, passedAt: new Date(input.passedAt) }),
      ),
  );
  server.registerTool(
    "grades.update",
    {
      description: "Update a grade or replace its components.",
      inputSchema: z.object(gradeFields).partial().extend({ gradeId: id }),
      _meta: writeMeta,
    },
    ({ passedAt, ...input }) =>
      call(() =>
        api.grades.update({
          ...input,
          passedAt: mapDate(passedAt) ?? undefined,
        }),
      ),
  );
  server.registerTool(
    "grades.reassign",
    {
      description: "Bulk-reassign grades to a subject and/or period.",
      inputSchema: z.object({
        gradeIds: z.array(id).min(1).max(200),
        subjectId: id.optional(),
        periodId: id.nullable().optional(),
      }),
      _meta: writeMeta,
    },
    (input) => call(() => api.grades.reassign(input)),
  );

  server.registerTool(
    "averages.create",
    {
      description: "Create a custom weighted average.",
      inputSchema: z.object({ yearId: id, ...averageFields }),
      _meta: writeMeta,
    },
    (input) => call(() => api.averages.create(input)),
  );
  server.registerTool(
    "averages.update",
    {
      description:
        "Update a custom average and optionally replace its entries.",
      inputSchema: z.object(averageFields).partial().extend({ averageId: id }),
      _meta: writeMeta,
    },
    (input) => call(() => api.averages.update(input)),
  );
  server.registerTool(
    "averages.reorder",
    {
      description: "Set custom-average display order.",
      inputSchema: z.object({ averageIds: z.array(id).min(1) }),
      _meta: writeMeta,
    },
    (input) => call(() => api.averages.reorder(input)),
  );

  server.registerTool(
    "goals.create",
    {
      description: "Create a general, subject or custom-average goal.",
      inputSchema: z.object({ yearId: id, ...goalFields }),
      _meta: writeMeta,
    },
    ({ dueAt, ...input }) =>
      call(() => api.goals.create({ ...input, dueAt: mapDate(dueAt) ?? null })),
  );
  server.registerTool(
    "goals.update",
    {
      description: "Update an academic goal.",
      inputSchema: z.object(goalFields).partial().extend({ goalId: id }),
      _meta: writeMeta,
    },
    ({ dueAt, ...input }) =>
      call(() => api.goals.update({ ...input, dueAt: mapDate(dueAt) })),
  );
  server.registerTool(
    "goals.mark_achieved",
    {
      description: "Mark or unmark a goal as achieved.",
      inputSchema: z.object({ goalId: id, achieved: z.boolean() }),
      _meta: writeMeta,
    },
    (input) => call(() => api.goals.markAchieved(input)),
  );
  server.registerTool(
    "goals.reorder",
    {
      description: "Set goal display order.",
      inputSchema: z.object({ goalIds: z.array(id).min(1) }),
      _meta: writeMeta,
    },
    (input) => call(() => api.goals.reorder(input)),
  );

  server.registerTool(
    "cards.create",
    {
      description: "Create a dashboard card.",
      inputSchema: z.object({ yearId: id, ...cardFields }),
      _meta: writeMeta,
    },
    (input) => call(() => api.cards.create(input)),
  );
  server.registerTool(
    "cards.update",
    {
      description: "Update a dashboard card.",
      inputSchema: z.object(cardFields).partial().extend({ cardId: id }),
      _meta: writeMeta,
    },
    (input) => call(() => api.cards.update(input)),
  );
  server.registerTool(
    "cards.reorder",
    {
      description: "Set dashboard-card order.",
      inputSchema: z.object({ cardIds: z.array(id) }),
      _meta: writeMeta,
    },
    (input) => call(() => api.cards.reorder(input)),
  );

  const customTheme = z.object({
    light: z.record(z.string(), z.string()),
    dark: z.record(z.string(), z.string()),
  });
  server.registerTool(
    "preferences.update",
    {
      description: "Update application, theme and chart preferences.",
      inputSchema: z.object({
        theme: z.enum(["system", "light", "dark"]).optional(),
        language: z.enum(["system", "en", "fr"]).optional(),
        themePreset: z.string().max(32).optional(),
        customTheme: customTheme.optional(),
        themeShape: z
          .object({
            font: z.string().max(160),
            headingFont: z.string().max(160),
            radius: z.number().min(0).max(2),
          })
          .partial()
          .optional(),
        seasonalThemesEnabled: z.boolean().optional(),
        seasonalTheme: z.string().max(32).optional(),
        hapticsEnabled: z.boolean().optional(),
        reduceMotion: z.boolean().optional(),
        compactMode: z.boolean().optional(),
        chartSettings: z
          .object({
            autoZoom: z.boolean(),
            showTrend: z.boolean(),
            trendSubdivisions: z.number().int().min(1).max(12),
            showPoints: z.boolean(),
            showSubSubjects: z.boolean(),
          })
          .partial()
          .optional(),
      }),
      _meta: writeMeta,
    },
    (input) => call(() => api.preferences.update(input)),
  );
  server.registerTool(
    "preferences.mark_celebration_seen",
    {
      description: "Mark a one-off celebration as seen.",
      inputSchema: z.object({ key: z.string().max(48) }),
      _meta: writeMeta,
    },
    (input) => call(() => api.preferences.markCelebrationSeen(input)),
  );
  server.registerTool(
    "announcements.dismiss",
    {
      description: "Dismiss one active announcement.",
      inputSchema: z.object({ announcementId: id }),
      _meta: writeMeta,
    },
    (input) => call(() => api.announcements.dismiss(input)),
  );
  server.registerTool(
    "recap.mark_seen",
    {
      description: "Mark a year recap as seen.",
      inputSchema: z.object({
        yearId: id,
        reviewKey: z.string().default("annual"),
      }),
      _meta: writeMeta,
    },
    (input) => call(() => api.review.markSeen(input)),
  );
  server.registerTool(
    "feedback.submit",
    {
      description:
        "Submit text feedback to Avermate (image attachments are intentionally not accepted through MCP).",
      inputSchema: z.object({
        kind: z.enum(["bug", "idea", "question", "other"]).default("other"),
        subject: z.string().trim().min(3).max(120),
        message: z.string().trim().min(10).max(4000),
        context: z.record(z.string(), z.string()).default({}),
      }),
      _meta: writeMeta,
    },
    (input) => call(() => api.feedback.submit(input)),
  );
}

function registerDestructiveSurface(
  server: McpServer,
  api: Api,
  principal: McpPrincipal,
  codec: RequestStateCodec<DestructiveState>,
): void {
  const destructive = { destructiveHint: true, idempotentHint: true };
  const deleteMeta = meta("avermate:delete");
  const key = { idempotencyKey: z.string().uuid() };

  server.registerTool(
    "years.delete",
    {
      description: "Permanently delete a year and every cascading relation.",
      inputSchema: z.object({ yearId: id, ...key }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "years.delete",
        input,
        context,
        description: `Delete year ${input.yearId} and all of its contents.`,
        execute: () => api.years.delete({ yearId: input.yearId }),
      }),
  );
  server.registerTool(
    "periods.delete",
    {
      description:
        "Delete a period; grades remain and lose the explicit period link.",
      inputSchema: z.object({ periodId: id, ...key }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "periods.delete",
        input,
        context,
        description: `Delete period ${input.periodId}.`,
        execute: () => api.periods.delete({ periodId: input.periodId }),
      }),
  );
  server.registerTool(
    "subjects.delete",
    {
      description:
        "Delete a subject; optionally promote children instead of deleting the subtree.",
      inputSchema: z.object({
        subjectId: id,
        promoteChildren: z.boolean().default(false),
        ...key,
      }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "subjects.delete",
        input,
        context,
        description: `Delete subject ${input.subjectId}${input.promoteChildren ? " and promote its children" : " and its complete subtree"}.`,
        execute: () =>
          api.subjects.delete({
            subjectId: input.subjectId,
            promoteChildren: input.promoteChildren,
          }),
      }),
  );
  server.registerTool(
    "grades.delete",
    {
      description: "Permanently delete a grade and its components.",
      inputSchema: z.object({ gradeId: id, ...key }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "grades.delete",
        input,
        context,
        description: `Delete grade ${input.gradeId}.`,
        execute: () => api.grades.delete({ gradeId: input.gradeId }),
      }),
  );
  server.registerTool(
    "averages.delete",
    {
      description: "Permanently delete a custom average.",
      inputSchema: z.object({ averageId: id, ...key }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "averages.delete",
        input,
        context,
        description: `Delete custom average ${input.averageId}.`,
        execute: () => api.averages.delete({ averageId: input.averageId }),
      }),
  );
  server.registerTool(
    "goals.delete",
    {
      description: "Permanently delete a goal.",
      inputSchema: z.object({ goalId: id, ...key }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "goals.delete",
        input,
        context,
        description: `Delete goal ${input.goalId}.`,
        execute: () => api.goals.delete({ goalId: input.goalId }),
      }),
  );
  server.registerTool(
    "cards.delete",
    {
      description: "Permanently delete a dashboard card.",
      inputSchema: z.object({ cardId: id, ...key }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "cards.delete",
        input,
        context,
        description: `Delete dashboard card ${input.cardId}.`,
        execute: () => api.cards.delete({ cardId: input.cardId }),
      }),
  );
  server.registerTool(
    "cards.reset",
    {
      description:
        "Delete a surface layout and restore defaults where available.",
      inputSchema: z.object({
        yearId: id,
        surface: z.enum(["overview", "subject", "grade"]).default("overview"),
        ...key,
      }),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "cards.reset",
        input,
        context,
        description: `Reset the ${input.surface} dashboard for year ${input.yearId}.`,
        execute: () =>
          api.cards.reset({ yearId: input.yearId, surface: input.surface }),
      }),
  );
  server.registerTool(
    "account.reset_data",
    {
      description:
        "Permanently delete all academic data while retaining the account and preferences.",
      inputSchema: z.object(key),
      annotations: destructive,
      _meta: deleteMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "account.reset_data",
        input,
        context,
        description:
          "Delete every year, subject, grade, average, goal and dashboard card in this account.",
        execute: () => api.preferences.resetData({ confirmation: "RESET" }),
      }),
  );
}

function registerAdminSurface(
  server: McpServer,
  api: Api,
  principal: McpPrincipal,
  codec: RequestStateCodec<DestructiveState>,
): void {
  const adminRead = meta("avermate:read", "avermate:admin");
  const adminWrite = meta("avermate:write", "avermate:admin");
  const readOnly = { readOnlyHint: true };

  server.registerTool(
    "admin.overview",
    {
      description: "Read aggregate administration metrics.",
      inputSchema: z.object({
        days: z
          .union([z.number().int().min(7).max(365), z.literal("all")])
          .default(30),
      }),
      annotations: readOnly,
      _meta: adminRead,
    },
    (input) => call(() => api.admin.overview(input)),
  );
  server.registerTool(
    "admin.users",
    {
      description: "Search and page through user accounts.",
      inputSchema: z.object({
        query: z.string().trim().max(120).default(""),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: readOnly,
      _meta: adminRead,
    },
    (input) => call(() => api.admin.users(input)),
  );
  server.registerTool(
    "admin.user",
    {
      description: "Read an administrator's deep view of one account.",
      inputSchema: z.object({
        userId: id,
        days: z
          .union([z.number().int().min(7).max(365), z.literal("all")])
          .default(90),
      }),
      annotations: readOnly,
      _meta: adminRead,
    },
    (input) => call(() => api.admin.user(input)),
  );
  server.registerTool(
    "admin.announcements",
    {
      description:
        "List all announcements including drafts and scheduled messages.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: adminRead,
    },
    () => call(() => api.admin.announcements()),
  );
  server.registerTool(
    "admin.feedback",
    {
      description: "List user feedback for moderation.",
      inputSchema: z.object({
        status: z.enum(["open", "closed", "all"]).default("open"),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: readOnly,
      _meta: adminRead,
    },
    (input) => call(() => api.admin.feedback(input)),
  );

  if (can(principal, "avermate:write", "avermate:admin")) {
    const announcementFields = {
      title: z.string().trim().min(1).max(120),
      message: z.string().trim().min(1).max(2000),
      tone: z.enum(["info", "success", "warning", "danger"]).default("info"),
      active: z.boolean().default(true),
      startsAt: optionalDate.default(null),
      endsAt: optionalDate.default(null),
    };
    server.registerTool(
      "admin.announcements.create",
      {
        description: "Create an announcement.",
        inputSchema: z.object(announcementFields),
        _meta: adminWrite,
      },
      ({ startsAt, endsAt, ...input }) =>
        call(() =>
          api.admin.createAnnouncement({
            ...input,
            startsAt: mapDate(startsAt) ?? null,
            endsAt: mapDate(endsAt) ?? null,
          }),
        ),
    );
    server.registerTool(
      "admin.announcements.update",
      {
        description: "Update an announcement.",
        inputSchema: z
          .object(announcementFields)
          .partial()
          .extend({ announcementId: id }),
        _meta: adminWrite,
      },
      ({ startsAt, endsAt, ...input }) =>
        call(() =>
          api.admin.updateAnnouncement({
            ...input,
            startsAt: mapDate(startsAt),
            endsAt: mapDate(endsAt),
          }),
        ),
    );
    server.registerTool(
      "admin.feedback.set_status",
      {
        description: "Open or close a feedback item.",
        inputSchema: z.object({
          feedbackId: id,
          status: z.enum(["open", "closed"]),
        }),
        _meta: adminWrite,
      },
      (input) => call(() => api.admin.setFeedbackStatus(input)),
    );
    server.registerTool(
      "admin.users.set_role",
      {
        description: "Grant or remove the administrator role.",
        inputSchema: z.object({ userId: id, role: z.enum(["user", "admin"]) }),
        _meta: adminWrite,
      },
      (input) => call(() => api.admin.setRole(input)),
    );
    server.registerTool(
      "admin.users.set_suspension",
      {
        description:
          "Suspend or restore an account and revoke its browser sessions.",
        inputSchema: z.object({
          userId: id,
          banned: z.boolean(),
          reason: z.string().trim().min(1).max(300).nullable().default(null),
          expiresAt: optionalDate.default(null),
        }),
        _meta: adminWrite,
      },
      ({ expiresAt, ...input }) =>
        call(() =>
          api.admin.setBanned({
            ...input,
            expiresAt: mapDate(expiresAt) ?? null,
          }),
        ),
    );
  }

  if (can(principal, "avermate:delete", "avermate:admin")) {
    const key = { idempotencyKey: z.string().uuid() };
    const annotations = { destructiveHint: true, idempotentHint: true };
    const adminDelete = meta("avermate:delete", "avermate:admin");
    server.registerTool(
      "admin.announcements.delete",
      {
        description: "Permanently delete an announcement.",
        inputSchema: z.object({ announcementId: id, ...key }),
        annotations,
        _meta: adminDelete,
      },
      (input, context) =>
        runDestructive({
          principal,
          codec,
          toolName: "admin.announcements.delete",
          input,
          context,
          description: `Delete announcement ${input.announcementId}.`,
          execute: () =>
            api.admin.deleteAnnouncement({
              announcementId: input.announcementId,
            }),
        }),
    );
    server.registerTool(
      "admin.users.delete",
      {
        description: "Permanently delete another account and all of its data.",
        inputSchema: z.object({ userId: id, ...key }),
        annotations,
        _meta: adminDelete,
      },
      (input, context) =>
        runDestructive({
          principal,
          codec,
          toolName: "admin.users.delete",
          input,
          context,
          description: `Delete account ${input.userId} and all of its data.`,
          execute: () =>
            api.admin.deleteUser({
              userId: input.userId,
              confirmation: input.userId,
            }),
        }),
    );
  }
}

function registerSocialModerationSurface(
  server: McpServer,
  api: Api,
  principal: McpPrincipal,
  codec: RequestStateCodec<DestructiveState>,
): void {
  const moderateMeta = meta("avermate:social.moderate");
  const readOnly = { readOnlyHint: true };
  const confirmed = { destructiveHint: true, idempotentHint: true };
  const key = { idempotencyKey: z.string().uuid() };
  server.registerTool(
    "social.moderation.overview",
    {
      description:
        "Read aggregate social moderation counts without academic details.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: moderateMeta,
    },
    () => call(() => api.admin.socialOverview()),
  );
  server.registerTool(
    "social.moderation.reports",
    {
      description: "List social safety reports for moderation.",
      inputSchema: z.object({
        statuses: z
          .array(z.enum(["open", "investigating", "resolved", "dismissed"]))
          .default([]),
        priorities: z
          .array(z.enum(["low", "normal", "high", "urgent"]))
          .default([]),
        search: z.string().trim().max(100).default(""),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: readOnly,
      _meta: moderateMeta,
    },
    (input) => call(() => api.admin.socialReports(input)),
  );
  server.registerTool(
    "social.moderation.audit",
    {
      description: "Read the append-only value-free social audit ledger.",
      inputSchema: z.object({
        action: z.string().trim().max(100).default(""),
        entityType: z.string().trim().max(100).default(""),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: readOnly,
      _meta: moderateMeta,
    },
    (input) => call(() => api.admin.socialAudit(input)),
  );
  server.registerTool(
    "social.moderation.freeze_group",
    {
      description:
        "Freeze or unfreeze a social group with optimistic concurrency and audited reason.",
      inputSchema: z.object({
        groupId: id,
        frozen: z.boolean(),
        expectedRevision: z.number().int().min(1),
        reason: z.string().trim().min(10).max(500),
        ...key,
      }),
      annotations: confirmed,
      _meta: moderateMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.moderation.freeze_group",
        input,
        context,
        description: `${input.frozen ? "Freeze" : "Unfreeze"} social group ${input.groupId}.`,
        execute: () =>
          api.admin.freezeSocialGroup({
            groupId: input.groupId,
            frozen: input.frozen,
            expectedRevision: input.expectedRevision,
            reason: input.reason,
          }),
      }),
  );
  server.registerTool(
    "social.moderation.freeze_profile",
    {
      description:
        "Freeze or unfreeze a social profile and immediately revoke projections.",
      inputSchema: z.object({
        userId: id,
        frozen: z.boolean(),
        reason: z.string().trim().min(10).max(500),
        ...key,
      }),
      annotations: confirmed,
      _meta: moderateMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.moderation.freeze_profile",
        input,
        context,
        description: `${input.frozen ? "Freeze" : "Unfreeze"} the selected social profile.`,
        execute: () =>
          api.admin.freezeSocialProfile({
            userId: input.userId,
            frozen: input.frozen,
            reason: input.reason,
          }),
      }),
  );
}

function resourceText(uri: URL, value: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(normalize(value), null, 2),
      },
    ],
  };
}

function registerResources(server: McpServer, api: Api): void {
  const cacheHint = { ttlMs: 10_000, cacheScope: "private" as const };
  server.registerResource(
    "account",
    "avermate://account",
    {
      title: "Connected Avermate account",
      description: "Profile data for the OAuth resource owner.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.profile.viewer()),
  );
  server.registerResource(
    "years",
    "avermate://years",
    {
      title: "Academic years",
      description: "Every academic year owned by the connected user.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.years.list()),
  );
  server.registerResource(
    "preferences",
    "avermate://preferences",
    {
      title: "Avermate preferences",
      description: "Application, theme and chart preferences.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.preferences.get()),
  );
  server.registerResource(
    "announcements",
    "avermate://announcements",
    {
      title: "Announcement history",
      description: "Visible and previously dismissed announcements.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.announcements.history()),
  );
  server.registerResource(
    "recaps",
    "avermate://recaps",
    {
      title: "Eligible year recaps",
      description: "Academic years with enough data for an annual recap.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri) => resourceText(uri, await api.review.eligibleYears()),
  );

  server.registerResource(
    "year-snapshot",
    new ResourceTemplate("avermate://years/{yearId}/snapshot", {
      list: undefined,
      complete: {
        yearId: async (value) =>
          (await api.years.list())
            .map((year) => year.id)
            .filter((yearId) => yearId.startsWith(value))
            .slice(0, 50),
      },
    }),
    {
      title: "Complete academic-year snapshot",
      description:
        "Subjects, grades, components, periods, averages, goals and cards for one owned year.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri, variables) =>
      resourceText(
        uri,
        await api.snapshot.get({ yearId: String(variables.yearId) }),
      ),
  );
  server.registerResource(
    "subject",
    new ResourceTemplate("avermate://subjects/{subjectId}", {
      list: undefined,
    }),
    {
      title: "Avermate subject",
      description: "One owned subject or category.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri, variables) =>
      resourceText(
        uri,
        await api.subjects.get({ subjectId: String(variables.subjectId) }),
      ),
  );
  server.registerResource(
    "grade",
    new ResourceTemplate("avermate://grades/{gradeId}", { list: undefined }),
    {
      title: "Avermate grade",
      description: "One owned grade, including composite components.",
      mimeType: "application/json",
      cacheHint,
    },
    async (uri, variables) =>
      resourceText(
        uri,
        await api.grades.get({ gradeId: String(variables.gradeId) }),
      ),
  );
}

function registerPrompts(server: McpServer, principal: McpPrincipal): void {
  const promptMeta = meta("avermate:read");
  server.registerPrompt(
    "academic-check-in",
    {
      title: "Academic check-in",
      description:
        "Review recent performance and propose a short, evidence-based action plan.",
      argsSchema: z.object({
        yearId: id,
        focus: z.string().max(200).optional(),
      }),
      _meta: promptMeta,
    },
    ({ yearId, focus }) => ({
      description: "A data-grounded Avermate academic check-in",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use analytics.snapshot for year ${yearId} and grades.recent. Summarize trends without inventing data, identify at most three actionable priorities, and relate them to existing goals.${focus ? ` Focus especially on: ${focus}.` : ""}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "grade-impact-analysis",
    {
      title: "Grade impact analysis",
      description:
        "Explain a grade in the context of its subject, components and year.",
      argsSchema: z.object({ gradeId: id, yearId: id }),
      _meta: promptMeta,
    },
    ({ gradeId, yearId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read grade ${gradeId} with grades.get and year ${yearId} with analytics.snapshot. Explain the grade's weighted impact, relevant component detail and uncertainty. Do not modify data unless explicitly asked afterward.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "goal-plan",
    {
      title: "Goal plan",
      description:
        "Turn an existing Avermate goal into a practical study plan.",
      argsSchema: z.object({ goalId: id, yearId: id }),
      _meta: promptMeta,
    },
    ({ goalId, yearId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read goals.list and analytics.snapshot for year ${yearId}, then locate goal ${goalId}. Produce a realistic plan tied to the actual target, due date, recent grades and subject hierarchy. Ask before changing the goal.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "year-recap",
    {
      title: "Year recap",
      description: "Create a factual, encouraging recap from Avermate data.",
      argsSchema: z.object({ yearId: id }),
      _meta: promptMeta,
    },
    ({ yearId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read recap.status and analytics.snapshot for year ${yearId}. Create an encouraging factual recap: volume, progression, strongest moments, subject balance, composite work and goal outcomes. The activity percentile measures recording activity, not academic ranking.`,
          },
        },
      ],
    }),
  );
  void principal;
}
