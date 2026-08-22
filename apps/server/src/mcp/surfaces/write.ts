import { z } from "zod";
import {
  averageFields,
  call,
  goalFields,
  gradeFields,
  gradePatchFields,
  goalPatch,
  id,
  mapDate,
  mcpCardFields,
  mcpCardPatchFields,
  meta,
  periodFields,
  periodPatch,
  subjectPatch,
  subjectFields,
  yearCreate,
  yearPatch,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerWriteSurface({ server, api }: McpSurfaceContext): void {
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
      inputSchema: yearPatch.extend({ yearId: id }),
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
      inputSchema: periodPatch.extend({ periodId: id }),
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
      inputSchema: subjectPatch.extend({ subjectId: id }),
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
      inputSchema: z.object(gradePatchFields).partial().extend({ gradeId: id }),
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
      inputSchema: z.object({
        yearId: id,
        ...averageFields,
        addDashboardCard: z.boolean().default(false),
      }),
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
      inputSchema: goalPatch.extend({ goalId: id }),
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
      description:
        "Create a dashboard card or analytical widget from either legacy fields or one complete V1 definition.",
      inputSchema: z.object({ yearId: id, ...mcpCardFields }),
      _meta: writeMeta,
    },
    (input) => call(() => api.cards.create(input as never)),
  );
  server.registerTool(
    "cards.update",
    {
      description:
        "Update presentation fields or replace a card's legacy/V1 analytical definition.",
      inputSchema: z.object({ cardId: id, ...mcpCardPatchFields }),
      _meta: writeMeta,
    },
    (input) => call(() => api.cards.update(input as never)),
  );
  server.registerTool(
    "cards.reorder",
    {
      description: "Set dashboard-card order.",
      // `expectedCardIds` is the order the caller was working from; the write is
      // refused if the stored layout has moved on. Required, so an agent cannot
      // opt out of the check by omitting it.
      inputSchema: z.object({
        cardIds: z.array(id),
        expectedCardIds: z.array(id),
      }),
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
            lineStyle: z.enum(["smooth", "straight", "step"]),
            connectGrades: z.boolean(),
          })
          .partial()
          .optional(),
        navigation: z
          .object({
            tabs: z.array(z.string().max(64)).max(4),
            sidebar: z.array(z.string().max(64)).max(12),
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
      description:
        "Dismiss one active announcement, optionally enforcing one academic year's audience.",
      inputSchema: z.object({ announcementId: id, yearId: id.optional() }),
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

export const writeSurface: McpSurface = {
  scopes: ["avermate:write"],
  register: registerWriteSurface,
};
