import { z } from "zod";
import { cardSurfaceSchema } from "../../lib/card-storage";
import {
  call,
  id,
  meta,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerReadSurface({ server, api }: McpSurfaceContext): void {
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
        "Count descendants, grades, and widgets affected by deleting a subject.",
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
    "grades.attachments",
    {
      description:
        "List the labels, public URLs and safe file metadata for copies attached to an owned grade.",
      inputSchema: z.object({ gradeId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ gradeId }) => call(() => api.grades.attachments({ gradeId })),
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
        surface: cardSurfaceSchema.default("overview"),
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
      description:
        "Read active, undismissed announcements, optionally scoped to one academic year's preset membership.",
      inputSchema: z.object({ yearId: id.optional() }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) => call(() => api.announcements.active(input)),
  );
  server.registerTool(
    "announcements.history",
    {
      description:
        "Read the user's authorized announcement history, optionally scoped to one academic year.",
      inputSchema: z.object({ yearId: id.optional() }),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) => call(() => api.announcements.history(input)),
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
  server.registerTool(
    "jobs.get",
    {
      description:
        "Read the safe status and result of one durable job owned by the connected user. Poll this after an asynchronous tool returns a jobId.",
      inputSchema: z.object({ jobId: id }).strict(),
      annotations: readOnly,
      _meta: readMeta,
    },
    (input) =>
      call(async () => {
        const job = await api.jobs.get(input);
        return {
          id: job.id,
          kind: job.kind,
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          runAt: job.runAt,
          result: job.result,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        };
      }),
  );
}

export const readSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerReadSurface,
};
