import { z } from "zod";
import { managedPresetConfigurationSchema } from "../../data/managed-presets";
import {
  call,
  classPeriods,
  id,
  meta,
  runDestructive,
  yearCreate,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerSocialManageSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
  const manageMeta = meta("avermate:social.manage");
  const confirmed = { destructiveHint: true, idempotentHint: true };
  const key = { idempotencyKey: z.string().uuid() };

  server.registerTool(
    "social.sharing.update",
    {
      description:
        "Update the connected user's handle, shared year and sharing locks.",
      inputSchema: z.object({
        handle: z.string().trim().min(3).max(32).nullable().optional(),
        sharedYearId: id.nullable().optional(),
        shareGeneralAverage: z.boolean().optional(),
        shareHistory: z.boolean().optional(),
        shareSubjectsMode: z.enum(["all", "selected", "none"]).optional(),
        sharedSubjectIds: z.array(id).max(500).optional(),
      }),
      _meta: manageMeta,
    },
    (input) => call(() => api.social.sharing.update(input)),
  );
  server.registerTool(
    "social.friends.send",
    {
      description: "Send a friend request to an exact handle.",
      inputSchema: z.object({
        handle: z.string().trim().min(3).max(32),
        message: z.string().trim().max(280).optional(),
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
          api.social.friends.request({
            handle: input.handle,
            message: input.message,
          }),
      }),
  );
  server.registerTool(
    "social.friends.respond",
    {
      description: "Accept or decline a pending friend request.",
      inputSchema: z.object({ requestId: id, accept: z.boolean(), ...key }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.friends.respond",
        input,
        context,
        description: `${input.accept ? "Accept" : "Decline"} friend request ${input.requestId}.`,
        execute: () =>
          api.social.friends.respond({
            requestId: input.requestId,
            accept: input.accept,
          }),
      }),
  );
  server.registerTool(
    "social.friends.remove",
    {
      description: "Remove a friendship.",
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
      description: "Block an account and sever the friendship both ways.",
      inputSchema: z.object({ userId: id, ...key }),
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
        description: "Block the selected account.",
        execute: () => api.social.blocks.create({ userId: input.userId }),
      }),
  );
  server.registerTool(
    "social.groups.create",
    {
      description:
        "Create a class from an existing year or a new academic template.",
      inputSchema: z.object({
        name: z.string().trim().min(2).max(100),
        description: z.string().trim().max(500).default(""),
        template: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("year"), yearId: id }),
          z.object({
            mode: z.literal("builder"),
            year: yearCreate,
            presetId: id.nullable().default(null),
            configuration: managedPresetConfigurationSchema,
            periods: classPeriods,
          }),
        ]),
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
        description: `Create class ${input.name}.`,
        execute: () =>
          api.social.groups.create({
            name: input.name,
            description: input.description,
            template: input.template,
          }),
      }),
  );
  server.registerTool(
    "social.groups.join",
    {
      description: "Join a class through an invitation link token.",
      inputSchema: z.object({
        token: z.string().min(32).max(256),
        year: z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("existing"), yearId: id }),
          z.object({
            mode: z.literal("copy"),
            name: z.string().trim().min(1).max(100).optional(),
          }),
        ]),
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
        description: "Join the class represented by this invitation token.",
        execute: () =>
          api.social.groups.invitations.accept({
            token: input.token,
            year: input.year,
          }),
      }),
  );
  server.registerTool(
    "social.groups.set_sharing",
    {
      description: "Turn the connected user's average on or off in a class.",
      inputSchema: z.object({ groupId: id, shareAverage: z.boolean(), ...key }),
      annotations: confirmed,
      _meta: manageMeta,
    },
    (input, context) =>
      runDestructive({
        principal,
        codec,
        toolName: "social.groups.set_sharing",
        input,
        context,
        description: `${input.shareAverage ? "Share" : "Stop sharing"} the average in group ${input.groupId}.`,
        execute: () =>
          api.social.groups.setSharing({
            groupId: input.groupId,
            shareAverage: input.shareAverage,
          }),
      }),
  );
  server.registerTool(
    "social.groups.leave",
    {
      description: "Leave a group.",
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
        execute: () => api.social.groups.leave({ groupId: input.groupId }),
      }),
  );
  server.registerTool(
    "social.groups.delete",
    {
      description: "Permanently delete an owned group.",
      inputSchema: z.object({ groupId: id, ...key }),
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
        execute: () => api.social.groups.delete({ groupId: input.groupId }),
      }),
  );
  server.registerTool(
    "social.reports.create",
    {
      description: "Submit a social safety report against a person or group.",
      inputSchema: z.object({
        targetUserId: id.optional(),
        groupId: id.optional(),
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
        description: `Submit a ${input.category} safety report.`,
        execute: () =>
          api.social.reports.create({
            targetUserId: input.targetUserId,
            groupId: input.groupId,
            category: input.category,
            message: input.message,
          }),
      }),
  );
}

export const socialManageSurface: McpSurface = {
  scopes: ["avermate:social.manage"],
  register: registerSocialManageSurface,
};
