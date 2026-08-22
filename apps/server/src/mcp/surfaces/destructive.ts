import { z } from "zod";
import { cardSurfaceSchema } from "../../lib/card-storage";
import {
  id,
  meta,
  runDestructive,
  type McpSurface,
  type McpSurfaceContext,
} from "../shared";

function registerDestructiveSurface({
  server,
  api,
  principal,
  codec,
}: McpSurfaceContext): void {
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
        surface: cardSurfaceSchema.default("overview"),
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

export const destructiveSurface: McpSurface = {
  scopes: ["avermate:delete"],
  register: registerDestructiveSurface,
};
