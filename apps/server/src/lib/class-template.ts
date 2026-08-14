import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { managedPresetConfigurationSchema } from "../data/managed-presets";
import type {
  ManagedPresetConfiguration,
  ManagedPresetSubject,
} from "../data/preset-types";
import { db } from "../db";
import {
  customAverageEntries,
  customAverages,
  dashboardCards,
  periods,
  subjects,
  yearPresetMemberships,
  years,
} from "../db/schema";
import { newId } from "./id";
import { academicCardRows } from "./academic-setup";
import { materializePresetConfiguration } from "./preset-membership";
export {
  buildClassTemplate,
  classTemplateSchema,
  classTemplateSubjects,
  classTemplateSummary,
  parseClassTemplate,
  serializeClassTemplate,
} from "./class-template-model";
import {
  buildClassTemplate,
  classTemplateSchema,
  sameAcademicDay,
  type ClassTemplate,
  type ClassYearStatus,
} from "./class-template-model";

type AcademicRows = Awaited<ReturnType<typeof loadAcademicRows>>;

function customSubjectKey(id: string) {
  return `class-subject:${id}`;
}

function customAverageKey(id: string) {
  return `class-average:${id}`;
}

async function loadAcademicRows(userId: string, yearId: string) {
  const [year] = await db
    .select()
    .from(years)
    .where(and(eq(years.id, yearId), eq(years.userId, userId)))
    .limit(1);
  if (!year) return null;

  const [subjectRows, periodRows, averageRows, presetMembership] =
    await Promise.all([
      db
        .select()
        .from(subjects)
        .where(and(eq(subjects.yearId, yearId), eq(subjects.userId, userId)))
        .orderBy(
          asc(subjects.sortOrder),
          asc(subjects.createdAt),
          asc(subjects.id),
        ),
      db
        .select()
        .from(periods)
        .where(and(eq(periods.yearId, yearId), eq(periods.userId, userId)))
        .orderBy(
          asc(periods.sortOrder),
          asc(periods.createdAt),
          asc(periods.id),
        ),
      db
        .select()
        .from(customAverages)
        .where(
          and(
            eq(customAverages.yearId, yearId),
            eq(customAverages.userId, userId),
          ),
        )
        .orderBy(
          asc(customAverages.sortOrder),
          asc(customAverages.createdAt),
          asc(customAverages.id),
        ),
      db
        .select()
        .from(yearPresetMemberships)
        .where(
          and(
            eq(yearPresetMemberships.yearId, yearId),
            eq(yearPresetMemberships.userId, userId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);
  const entryRows =
    averageRows.length === 0
      ? []
      : await db
          .select()
          .from(customAverageEntries)
          .where(
            inArray(
              customAverageEntries.averageId,
              averageRows.map((row) => row.id),
            ),
          )
          .orderBy(
            asc(customAverageEntries.averageId),
            asc(customAverageEntries.subjectId),
          );
  return {
    year,
    subjectRows,
    periodRows,
    averageRows,
    entryRows,
    presetMembership,
  };
}

function configurationFromRows(
  rows: NonNullable<AcademicRows>,
  keyMode: "persisted" | "source-custom",
): ManagedPresetConfiguration | null {
  const subjectKey = new Map<string, string>();
  for (const row of rows.subjectRows) {
    const key =
      keyMode === "source-custom"
        ? customSubjectKey(row.id)
        : row.presetNodeKey;
    if (!key) return null;
    subjectKey.set(row.id, key);
  }
  const averageKey = new Map<string, string>();
  for (const row of rows.averageRows) {
    const key =
      keyMode === "source-custom"
        ? customAverageKey(row.id)
        : row.presetNodeKey;
    if (!key) return null;
    averageKey.set(row.id, key);
  }

  const children = new Map<string | null, typeof rows.subjectRows>();
  const ids = new Set(rows.subjectRows.map((row) => row.id));
  for (const row of rows.subjectRows) {
    const parentId =
      row.parentId && ids.has(row.parentId) ? row.parentId : null;
    const list = children.get(parentId) ?? [];
    list.push(row);
    children.set(parentId, list);
  }
  const buildSubjects = (parentId: string | null): ManagedPresetSubject[] =>
    (children.get(parentId) ?? []).map((row) => {
      const nested = buildSubjects(row.id);
      return {
        key: subjectKey.get(row.id) as string,
        name: row.name,
        ...(row.shortName ? { shortName: row.shortName } : {}),
        // Older custom data may predate the invariant that only categories
        // own children. The class snapshot normalises that hierarchy.
        kind:
          row.kind === "category" || nested.length > 0 ? "category" : "subject",
        isMain: row.isMain,
        coefficient: row.coefficient,
        children: nested,
      };
    });

  const entriesByAverage = new Map<string, typeof rows.entryRows>();
  for (const entry of rows.entryRows) {
    const list = entriesByAverage.get(entry.averageId) ?? [];
    list.push(entry);
    entriesByAverage.set(entry.averageId, list);
  }
  const configuration = {
    subjects: buildSubjects(null),
    averages: rows.averageRows.map((average) => ({
      key: averageKey.get(average.id) as string,
      name: average.name,
      isMain: false,
      entries: (entriesByAverage.get(average.id) ?? [])
        .flatMap((entry) => {
          const key = subjectKey.get(entry.subjectId);
          return key
            ? [
                {
                  subjectKey: key,
                  coefficient: entry.coefficient,
                  includeChildren: entry.includeChildren,
                },
              ]
            : [];
        })
        .sort((left, right) => left.subjectKey.localeCompare(right.subjectKey)),
    })),
  };
  const parsed = managedPresetConfigurationSchema.safeParse(configuration);
  return parsed.success ? parsed.data : null;
}

function sameAcademicSettings(
  template: ClassTemplate,
  rows: NonNullable<AcademicRows>,
) {
  const year = rows.year;
  const periodsMatch =
    rows.periodRows.length === template.periods.length &&
    rows.periodRows.every((period, index) => {
      const expected = template.periods[index];
      return Boolean(
        expected &&
        period.name === expected.name &&
        sameAcademicDay(period.startAt.getTime(), expected.startAt) &&
        sameAcademicDay(period.endAt.getTime(), expected.endAt) &&
        period.isCumulative === expected.isCumulative &&
        period.sortOrder === expected.sortOrder,
      );
    });
  return (
    sameAcademicDay(year.startsAt.getTime(), template.year.startsAt) &&
    sameAcademicDay(year.endsAt.getTime(), template.year.endsAt) &&
    year.scale === template.year.scale &&
    year.defaultOutOf === template.year.defaultOutOf &&
    year.passingRatio === template.year.passingRatio &&
    year.decimals === template.year.decimals &&
    periodsMatch
  );
}

export async function snapshotClassTemplate(
  userId: string,
  yearId: string,
): Promise<ClassTemplate | null> {
  const rows = await loadAcademicRows(userId, yearId);
  if (!rows || rows.year.archivedAt || rows.subjectRows.length === 0)
    return null;
  const linkedPreset =
    rows.presetMembership?.mode === "linked" ? rows.presetMembership : null;
  let configuration = linkedPreset
    ? configurationFromRows(rows, "persisted")
    : null;
  const source: ClassTemplate["source"] =
    linkedPreset && configuration
      ? {
          kind: "preset",
          presetId: linkedPreset.presetId,
          presetVersion: linkedPreset.appliedVersion,
        }
      : { kind: "custom", yearId };
  configuration ??= configurationFromRows(rows, "source-custom");
  if (!configuration) return null;

  return buildClassTemplate({
    year: {
      name: rows.year.name,
      startsAt: rows.year.startsAt,
      endsAt: rows.year.endsAt,
      scale: rows.year.scale,
      defaultOutOf: rows.year.defaultOutOf,
      passingRatio: rows.year.passingRatio,
      decimals: rows.year.decimals,
    },
    periods: rows.periodRows.map((period) => ({
      name: period.name,
      startAt: period.startAt,
      endAt: period.endAt,
      isCumulative: period.isCumulative,
      sortOrder: period.sortOrder,
    })),
    configuration,
    source,
  });
}

export async function classYearStatus(
  userId: string,
  yearId: string | null,
  template: ClassTemplate | null,
): Promise<ClassYearStatus> {
  if (!yearId) return "not_connected";
  if (!template) return "incompatible";
  const rows = await loadAcademicRows(userId, yearId);
  if (!rows || rows.year.archivedAt || !sameAcademicSettings(template, rows)) {
    return "incompatible";
  }

  if (template.source.kind === "preset") {
    if (
      rows.presetMembership?.mode !== "linked" ||
      rows.presetMembership.presetId !== template.source.presetId ||
      rows.presetMembership.appliedVersion !== template.source.presetVersion
    ) {
      return "incompatible";
    }
  } else if (yearId !== template.source.yearId) {
    // A custom year is compatible only when it is the source or carries the
    // source-derived keys produced by `adoptSetup`.
    if (rows.subjectRows.some((row) => !row.presetNodeKey)) {
      return "incompatible";
    }
  }

  const matchesTemplate = (configuration: ManagedPresetConfiguration | null) =>
    configuration !== null &&
    JSON.stringify(configuration) === JSON.stringify(template.configuration);
  if (matchesTemplate(configurationFromRows(rows, "persisted"))) {
    return "connected";
  }
  if (
    template.source.kind === "custom" &&
    yearId === template.source.yearId &&
    matchesTemplate(configurationFromRows(rows, "source-custom"))
  ) {
    return "connected";
  }
  return "incompatible";
}

export async function compatibleClassYears(
  userId: string,
  template: ClassTemplate | null,
) {
  if (!template) return [];
  const candidates = await db
    .select({
      id: years.id,
      name: years.name,
      startsAt: years.startsAt,
      endsAt: years.endsAt,
    })
    .from(years)
    .where(and(eq(years.userId, userId), isNull(years.archivedAt)))
    .orderBy(asc(years.sortOrder), asc(years.startsAt));
  const statuses = await Promise.all(
    candidates.map(async (year) => ({
      year,
      status: await classYearStatus(userId, year.id, template),
    })),
  );
  return statuses
    .filter((row) => row.status === "connected")
    .map((row) => row.year);
}

/** Statements for a fresh, independent year. Callers append membership work. */
export function classYearInsertStatements(input: {
  userId: string;
  template: ClassTemplate;
  name?: string;
}) {
  const yearId = newId("y");
  const materialized = materializePresetConfiguration(
    input.template.configuration,
    yearId,
    input.userId,
  );
  const statements = [
    db.insert(years).values({
      id: yearId,
      name: input.name?.trim() || input.template.year.name,
      startsAt: new Date(input.template.year.startsAt),
      endsAt: new Date(input.template.year.endsAt),
      scale: input.template.year.scale,
      defaultOutOf: input.template.year.defaultOutOf,
      passingRatio: input.template.year.passingRatio,
      decimals: input.template.year.decimals,
      presetId:
        input.template.source.kind === "preset"
          ? input.template.source.presetId
          : null,
      userId: input.userId,
    }),
    db.insert(dashboardCards).values(academicCardRows(input.userId, yearId)),
    ...(input.template.periods.length
      ? [
          db.insert(periods).values(
            input.template.periods.map((period) => ({
              ...period,
              startAt: new Date(period.startAt),
              endAt: new Date(period.endAt),
              yearId,
              userId: input.userId,
            })),
          ),
        ]
      : []),
    ...(materialized.subjectRows.length
      ? [db.insert(subjects).values(materialized.subjectRows)]
      : []),
    ...(materialized.averageRows.length
      ? [db.insert(customAverages).values(materialized.averageRows)]
      : []),
    ...(materialized.entryRows.length
      ? [db.insert(customAverageEntries).values(materialized.entryRows)]
      : []),
    ...(input.template.source.kind === "preset"
      ? [
          db.insert(yearPresetMemberships).values({
            yearId,
            presetId: input.template.source.presetId,
            appliedVersion: input.template.source.presetVersion,
            mode: "linked",
            userId: input.userId,
          }),
        ]
      : []),
  ];
  return { yearId, statements };
}
