import { z } from "zod";
import { cardSurfaceSchema } from "../../lib/card-storage";
import {
  brokerMeta,
  id,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";
import { createFirstPartyToolBroker } from "../../tools/first-party";
import { invokeBrokerFromMcp } from "../../tools/adapters/mcp";
import { fileHandleService } from "../../routes/file-handles";

function registerReadSurface({
  server,
  api,
  principal,
}: McpSurfaceContext): void {
  const readMeta = brokerMeta("avermate:read");
  const readOnly = { readOnlyHint: true };
  const broker = createFirstPartyToolBroker(api, {
    fileHandles: fileHandleService,
    ownerId: principal.userId,
  });
  const invokeRead = (toolId: string, input: unknown) =>
    invokeBrokerFromMcp({
      broker,
      principal,
      invocation: { toolId, toolVersion: 1, input },
    });

  server.registerTool(
    "account.get",
    {
      description: "Read the connected Avermate profile.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => invokeRead("account.get", {}),
  );
  server.registerTool(
    "years.list",
    {
      description: "List all academic years owned by the user.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: { toolId: "years.list", toolVersion: 1, input: {} },
      }),
  );
  server.registerTool(
    "years.get",
    {
      description: "Read one academic year.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) =>
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: {
          toolId: "years.get",
          toolVersion: 1,
          input: { yearId },
        },
      }),
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
    ({ yearId }) => invokeRead("years.contents", { yearId }),
  );
  server.registerTool(
    "periods.list",
    {
      description: "List a year's periods.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => invokeRead("periods.list", { yearId }),
  );
  server.registerTool(
    "subjects.list",
    {
      description: "List a year's subject/category hierarchy.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => invokeRead("subjects.list", { yearId }),
  );
  server.registerTool(
    "subjects.get",
    {
      description: "Read a subject or category.",
      inputSchema: z.object({ subjectId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ subjectId }) => invokeRead("subjects.get", { subjectId }),
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
    ({ subjectId }) => invokeRead("subjects.delete_impact", { subjectId }),
  );
  server.registerTool(
    "grades.get",
    {
      description: "Read a grade and its components.",
      inputSchema: z.object({ gradeId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ gradeId }) => invokeRead("grades.get", { gradeId }),
  );
  server.registerTool(
    "grades.attachments",
    {
      description:
        "List safe copy metadata for an owned grade. File access uses short-lived opaque owner-bound handles; provider URLs are never returned.",
      inputSchema: z.object({ gradeId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ gradeId }) => invokeRead("grades.attachments", { gradeId }),
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
    ({ yearId, limit }) => invokeRead("grades.recent", { yearId, limit }),
  );
  server.registerTool(
    "averages.list",
    {
      description: "List custom averages and their subject entries.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => invokeRead("averages.list", { yearId }),
  );
  server.registerTool(
    "averages.get",
    {
      description: "Read one custom average.",
      inputSchema: z.object({ averageId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ averageId }) => invokeRead("averages.get", { averageId }),
  );
  server.registerTool(
    "goals.list",
    {
      description: "List academic goals for a year.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => invokeRead("goals.list", { yearId }),
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
    ({ yearId, surface }) => invokeRead("cards.list", { yearId, surface }),
  );
  server.registerTool(
    "preferences.get",
    {
      description: "Read application, theme and chart preferences.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => invokeRead("preferences.get", {}),
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
    (input) => invokeRead("announcements.active", input),
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
    (input) => invokeRead("announcements.history", input),
  );
  server.registerTool(
    "analytics.snapshot",
    {
      description:
        "Read a bounded normalized overview for one year. At most 500 recent grades are included; notes and grade components are excluded.",
      inputSchema: z.object({ yearId: id }),
      annotations: readOnly,
      _meta: readMeta,
    },
    ({ yearId }) => invokeRead("analytics.snapshot", { yearId }),
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
      invokeRead("recap.status", { yearId, reviewKey }),
  );
  server.registerTool(
    "recap.eligible_years",
    {
      description: "List years eligible for a year recap.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => invokeRead("recap.eligible_years", {}),
  );
  server.registerTool(
    "feedback.mine",
    {
      description: "Read feedback submitted by the connected user.",
      inputSchema: z.object({}),
      annotations: readOnly,
      _meta: readMeta,
    },
    () => invokeRead("feedback.mine", {}),
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
    () =>
      Promise.resolve({
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "account.export is not available to agents",
          },
        ],
        structuredContent: {
          ok: false,
          error: {
            code: "AGENT_TOOL_NOT_AVAILABLE",
            message: "account.export is not available to agents",
            retryable: false,
          },
        },
      }),
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
      invokeBrokerFromMcp({
        broker,
        principal,
        invocation: { toolId: "jobs.get", toolVersion: 1, input },
      }),
  );
}

export const readSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerReadSurface,
};
