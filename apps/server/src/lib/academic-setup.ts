import {
  defaultCards,
  legacyCardToWidgetDefinition,
  WIDGET_DEFINITION_VERSION,
  widgetDefinitionToLegacyProjection,
} from "@avermate/core";
import { z } from "zod";
import { badRequest, notFound } from "./orpc";

export const PERIOD_TEMPLATES = [
  {
    id: "trimesters",
    periods: [
      { key: "trimester1", from: 0, to: 1 / 3 },
      { key: "trimester2", from: 1 / 3, to: 2 / 3 },
      { key: "trimester3", from: 2 / 3, to: 1 },
    ],
  },
  {
    id: "semesters",
    periods: [
      { key: "semester1", from: 0, to: 0.5 },
      { key: "semester2", from: 0.5, to: 1 },
    ],
  },
  {
    id: "semesters-cumulative",
    periods: [
      { key: "semester1", from: 0, to: 0.5 },
      { key: "semester2", from: 0.5, to: 1, isCumulative: true },
    ],
  },
  {
    id: "quarters",
    periods: [
      { key: "quarter1", from: 0, to: 0.25 },
      { key: "quarter2", from: 0.25, to: 0.5 },
      { key: "quarter3", from: 0.5, to: 0.75 },
      { key: "quarter4", from: 0.75, to: 1 },
    ],
  },
  { id: "none", periods: [] },
] as const;

export type PeriodTemplateId = (typeof PERIOD_TEMPLATES)[number]["id"];

export const periodTemplateIds = PERIOD_TEMPLATES.map(
  (template) => template.id,
) as [PeriodTemplateId, ...PeriodTemplateId[]];

export const academicYearInput = z.object({
  name: z.string().trim().min(1).max(64),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  scale: z.number().positive().max(1000).default(20),
  defaultOutOf: z.number().positive().max(1000).default(20),
  passingRatio: z.number().min(0).max(1).default(0.5),
  decimals: z.number().int().min(0).max(4).default(2),
});

const periodNameInput = z.string().trim().min(1).max(64);

export const academicPeriodsInput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("template"),
    templateId: z.enum(periodTemplateIds),
    names: z.array(periodNameInput).max(12).default([]),
  }),
  z.object({
    mode: z.literal("custom"),
    items: z
      .array(
        z.object({
          name: periodNameInput,
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date(),
          isCumulative: z.boolean().default(false),
        }),
      )
      .max(12),
  }),
]);

export type AcademicPeriodsInput = z.infer<typeof academicPeriodsInput>;

export function assertAcademicYearRange(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) {
    badRequest("The year must end after it starts");
  }
}

function at(from: Date, to: Date, fraction: number): Date {
  return new Date(from.getTime() + (to.getTime() - from.getTime()) * fraction);
}

export function periodRowsFor(
  templateId: PeriodTemplateId,
  names: readonly string[],
  year: { id: string; startsAt: Date; endsAt: Date },
  userId: string,
) {
  const template = PERIOD_TEMPLATES.find(
    (candidate) => candidate.id === templateId,
  );
  if (!template) notFound("Period template");
  return template.periods.map((period, index) => ({
    name: names[index] ?? `Period ${index + 1}`,
    startAt: at(year.startsAt, year.endsAt, period.from),
    endAt: at(year.startsAt, year.endsAt, period.to),
    isCumulative: "isCumulative" in period ? period.isCumulative : false,
    sortOrder: index,
    yearId: year.id,
    userId,
  }));
}

const BOUNDARY_TOLERANCE_MS = 18 * 60 * 60 * 1_000;

function alignYearBoundary(value: Date, boundary: Date): Date {
  return Math.abs(value.getTime() - boundary.getTime()) <= BOUNDARY_TOLERANCE_MS
    ? new Date(boundary)
    : value;
}

export function periodRowsForSetup(
  setup: AcademicPeriodsInput,
  year: { id: string; startsAt: Date; endsAt: Date },
  userId: string,
) {
  if (setup.mode === "template") {
    return periodRowsFor(setup.templateId, setup.names, year, userId);
  }

  let previousEnd: Date | null = null;
  return setup.items.map((item, index) => {
    const startAt = alignYearBoundary(item.startsAt, year.startsAt);
    const endAt = alignYearBoundary(item.endsAt, year.endsAt);
    if (endAt.getTime() <= startAt.getTime()) {
      badRequest("Each period must end after it starts");
    }
    if (
      startAt.getTime() < year.startsAt.getTime() ||
      endAt.getTime() > year.endsAt.getTime()
    ) {
      badRequest("Each period must stay within the academic year");
    }
    if (previousEnd && startAt.getTime() < previousEnd.getTime()) {
      badRequest("Custom periods must be ordered and cannot overlap");
    }
    previousEnd = endAt;
    return {
      name: item.name,
      startAt,
      endAt,
      isCumulative: item.isCumulative,
      sortOrder: index,
      yearId: year.id,
      userId,
    };
  });
}

export function academicCardRows(userId: string, yearId: string) {
  return defaultCards().map((card) => {
    const definitionJson = legacyCardToWidgetDefinition({
      metric: card.metric,
      targetKind: card.target.kind,
      targetId: card.target.referenceId,
      goalId: null,
      display: card.display,
    });
    return {
      surface: "overview",
      ...widgetDefinitionToLegacyProjection(definitionJson),
      span: card.span,
      title: card.title,
      accent: card.accent,
      sortOrder: card.sortOrder,
      hidden: card.hidden,
      definitionVersion: WIDGET_DEFINITION_VERSION,
      definitionJson,
      yearId,
      userId,
    };
  });
}
