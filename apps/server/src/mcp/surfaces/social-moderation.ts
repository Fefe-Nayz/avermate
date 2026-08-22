import { z } from "zod";
import {
  call,
  id,
  meta,
  runDestructive,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerSocialModerationSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
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
        status: z
          .enum(["all", "open", "investigating", "resolved", "dismissed"])
          .default("all"),
      }),
      annotations: readOnly,
      _meta: moderateMeta,
    },
    (input) => call(() => api.admin.socialReports(input)),
  );
  server.registerTool(
    "social.moderation.update_report",
    {
      description: "Change a report's status, priority or assignment.",
      inputSchema: z.object({
        reportId: id,
        status: z
          .enum(["open", "investigating", "resolved", "dismissed"])
          .optional(),
        priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
        assignToMe: z.boolean().optional(),
        ...key,
      }),
      annotations: confirmed,
      _meta: moderateMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.moderation.update_report",
        input,
        context,
        description: `Update social report ${input.reportId}.`,
        execute: () =>
          api.admin.updateSocialReport({
            reportId: input.reportId,
            status: input.status,
            priority: input.priority,
            assignToMe: input.assignToMe,
          }),
      }),
  );
  server.registerTool(
    "social.moderation.set_group_state",
    {
      description: "Place a group on an administrative hold or lift it.",
      inputSchema: z.object({
        groupId: id,
        state: z.enum(["active", "frozen"]),
        ...key,
      }),
      annotations: confirmed,
      _meta: moderateMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.moderation.set_group_state",
        input,
        context,
        description: `Set group ${input.groupId} to ${input.state}.`,
        execute: () =>
          api.admin.setSocialGroupState({
            groupId: input.groupId,
            state: input.state,
          }),
      }),
  );
}

export const socialModerationSurface: McpSurface = {
  scopes: ["avermate:social.moderate"],
  requiresAdminRole: true,
  register: registerSocialModerationSurface,
};
