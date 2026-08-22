import { z } from "zod";
import {
  call,
  can,
  id,
  mapDate,
  meta,
  optionalDate,
  runDestructive,
  stable,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerAdminSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
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
    "admin.presets",
    {
      description:
        "List managed preset identities, archive state, versions and adoption counts for announcement targeting.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: adminRead,
    },
    () => call(() => api.presets.admin.list()),
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
    const announcementPatchFields = {
      title: z.string().trim().min(1).max(120),
      message: z.string().trim().min(1).max(2000),
      tone: z.enum(["info", "success", "warning", "danger"]),
      audience: z.enum(["global", "preset"]),
      presetIds: z.array(id).max(50),
      active: z.boolean(),
      startsAt: optionalDate,
      endsAt: optionalDate,
    };
    const announcementCreateFields = {
      ...announcementPatchFields,
      tone: announcementPatchFields.tone.default("info"),
      audience: announcementPatchFields.audience.default("global"),
      presetIds: announcementPatchFields.presetIds.default([]),
      active: announcementPatchFields.active.default(true),
      startsAt: optionalDate.default(null),
      endsAt: optionalDate.default(null),
    };
    server.registerTool(
      "admin.announcements.create",
      {
        description:
          "Create a global announcement or target one or more stable preset identities.",
        inputSchema: z.object(announcementCreateFields),
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
        description:
          "Update an announcement and atomically replace its preset audience when supplied.",
        inputSchema: z
          .object(announcementPatchFields)
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

export const adminSurface: McpSurface = {
  scopes: ["avermate:read", "avermate:admin"],
  requiresAdminRole: true,
  register: registerAdminSurface,
};
