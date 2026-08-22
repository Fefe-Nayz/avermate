import { z } from "zod";
import {
  brokerMeta,
  can,
  id,
  isoDate,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";
import { managedToolActionContinuationStore } from "../../tools/managed-action-continuation";

function registerPlannerSurface({
  server,
  api,
  principal,
}: McpSurfaceContext): void {
  if (can(principal, "avermate:planner.read")) {
    const readMeta = brokerMeta("avermate:planner.read");
    const readOnly = { readOnlyHint: true };
    const broker = createFirstPartyToolBroker(api);

    server.registerTool(
      "planner.agenda",
      {
        description:
          "Read a bounded agenda combining planner items, goals, grades and academic periods.",
        inputSchema: z.object({
          yearId: id,
          from: isoDate,
          to: isoDate,
        }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "planner.agenda",
            toolVersion: 1,
            input,
          },
        }),
    );
    server.registerTool(
      "planner.list",
      {
        description:
          "List planner tasks and events for a year, optionally within a date window.",
        inputSchema: z.object({
          yearId: id,
          from: isoDate.optional(),
          to: isoDate.optional(),
          includeCompleted: z.boolean().default(false),
        }),
        annotations: readOnly,
        _meta: readMeta,
      },
      (input) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: { toolId: "planner.list", toolVersion: 1, input },
        }),
    );
  }

  if (can(principal, "avermate:planner.write")) {
    const writeMeta = brokerMeta("avermate:planner.write");
    const broker = createFirstPartyToolBroker(api, {
      includeMutations: true,
      continuations: managedToolActionContinuationStore,
    });

    server.registerTool(
      "planning.tasks.create",
      {
        description:
          "Create one personal planning task through Avermate's durable action ledger.",
        inputSchema: z.object({
          yearId: id,
          title: z.string().trim().min(1).max(160),
          notes: z.string().trim().max(10_000).nullable().default(null),
          localNote: z.string().trim().max(4_000).nullable().default(null),
          startsAt: isoDate.nullable().default(null),
          scheduledAt: isoDate.nullable().default(null),
          dueAt: isoDate.nullable().default(null),
          subjectId: id.nullable().default(null),
          idempotencyKey: z.string().trim().min(1).max(256),
        }),
        annotations: { idempotentHint: true, destructiveHint: false },
        _meta: writeMeta,
      },
      ({ idempotencyKey, ...input }) =>
        invokeBrokerFromMcp({
          broker,
          principal,
          invocation: {
            toolId: "planning.tasks.create",
            toolVersion: 1,
            input,
            idempotencyKey,
          },
        }),
    );
  }
}

export const plannerSurface: McpSurface = {
  // Every MCP token already carries the base read scope. The domain-specific
  // read and write grants remain independent inside the surface.
  scopes: ["avermate:read"],
  register: registerPlannerSurface,
};
