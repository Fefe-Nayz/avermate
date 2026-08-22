import { z } from "zod";
import {
  call,
  can,
  id,
  isoDate,
  mapDate,
  meta,
  optionalDate,
  runDestructive,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

const plannerKind = z.enum(["task", "event"]);
const plannerStatus = z.enum(["todo", "doing", "done"]);

function registerPlannerSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
  if (can(principal, "avermate:planner.read")) {
    const readMeta = meta("avermate:planner.read");
    const readOnly = { readOnlyHint: true };

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
      ({ yearId, from, to }) =>
        call(() =>
          api.planner.agenda({
            yearId,
            from: new Date(from),
            to: new Date(to),
          }),
        ),
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
      ({ from, to, ...input }) =>
        call(() =>
          api.planner.list({
            ...input,
            from: mapDate(from) ?? undefined,
            to: mapDate(to) ?? undefined,
          }),
        ),
    );
  }

  if (can(principal, "avermate:planner.write")) {
    const writeMeta = meta("avermate:planner.write");
    const itemFields = {
      kind: plannerKind,
      title: z.string().trim().min(1).max(160),
      notes: z.string().trim().max(2_000).nullable(),
      startsAt: optionalDate,
      endsAt: optionalDate,
      allDay: z.boolean(),
      subjectId: id.nullable(),
    };

    server.registerTool(
      "planner.create",
      {
        description: "Create a planner task or calendar event.",
        inputSchema: z.object({
          yearId: id,
          kind: itemFields.kind.default("task"),
          title: itemFields.title,
          notes: itemFields.notes.default(null),
          startsAt: itemFields.startsAt.default(null),
          endsAt: itemFields.endsAt.default(null),
          allDay: itemFields.allDay.default(true),
          subjectId: itemFields.subjectId.default(null),
        }),
        _meta: writeMeta,
      },
      ({ startsAt, endsAt, ...input }) =>
        call(() =>
          api.planner.create({
            ...input,
            startsAt: mapDate(startsAt) ?? null,
            endsAt: mapDate(endsAt) ?? null,
          }),
        ),
    );
    server.registerTool(
      "planner.update",
      {
        description: "Update an owned planner task or event.",
        inputSchema: z.object({
          itemId: id,
          kind: itemFields.kind.optional(),
          title: itemFields.title.optional(),
          notes: itemFields.notes.optional(),
          startsAt: itemFields.startsAt,
          endsAt: itemFields.endsAt,
          allDay: itemFields.allDay.optional(),
          subjectId: itemFields.subjectId.optional(),
        }),
        _meta: writeMeta,
      },
      ({ startsAt, endsAt, ...input }) =>
        call(() =>
          api.planner.update({
            ...input,
            startsAt: mapDate(startsAt),
            endsAt: mapDate(endsAt),
          }),
        ),
    );
    server.registerTool(
      "planner.setStatus",
      {
        description: "Move a planner task to a different status lane.",
        inputSchema: z.object({ itemId: id, status: plannerStatus }),
        _meta: writeMeta,
      },
      (input) => call(() => api.planner.setStatus(input)),
    );
    server.registerTool(
      "planner.delete",
      {
        description: "Permanently delete a planner task or event.",
        inputSchema: z.object({
          itemId: id,
          idempotencyKey: z.string().uuid(),
        }),
        annotations: { destructiveHint: true, idempotentHint: true },
        _meta: writeMeta,
      },
      (input, context) =>
        runDestructive({
          principal,
          codec,
          toolName: "planner.delete",
          input,
          context,
          description: `Delete planner item ${input.itemId}.`,
          execute: () => api.planner.delete({ itemId: input.itemId }),
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
