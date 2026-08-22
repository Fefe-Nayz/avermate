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
  gradeTypes,
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
  compareClassTemplateKeys,
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

function customGradeTypeKey(id: string) {
  return `class-type:${id}`;
}

async function loadAcademicRows(userId: string, yearId: string) {
  const [year] = await db
    .select()
    .from(years)
    .where(and(eq(years.id, yearId), eq(years.userId, userId)))
    .limit(1);
  if (!year) return null;

  const [
    subjectRows,
    periodRows,
    averageRows,
    gradeTypeRows,
    presetMembership,
  ] = await Promise.all([
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
      .orderBy(asc(periods.sortOrder), asc(periods.createdAt), asc(periods.id)),
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
      .from(gradeTypes)
      .where(and(eq(gradeTypes.yearId, yearId), eq(gradeTypes.userId, userId)))
      .orderBy(
        asc(gradeTypes.sortOrder),
        asc(gradeTypes.createdAt),
        asc(gradeTypes.id),
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
    gradeTypeRows,
    entryRows,
    presetMembership,
  };
}

function configurationFromRows(
  rows: NonNullable<AcademicRows>,
  keyMode: "persisted" | "source-custom",
  /**
   * The type keys the class actually declares, when there is a class to compare with.
   *
   * Omitted while a template is being *taken*, where every type the year holds is part
   * of the snapshot. Supplied while one is being *checked*, so a type added afterwards
   * is left out of the comparison rather than counted as divergence.
   */
  expectedTypeKeys?: ReadonlySet<string>,
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
  /**
   * A type the member added for themselves is not a term of the class.
   *
   * Persisted mode reads the keys the class handed out, so a type of their own — which
   * has none — is simply not part of this comparison, and adding one cannot disconnect
   * their year. Sorted by key rather than by their arrangement, for the same reason the
   * average entries are: the order of the picker is theirs.
   */
  const typeRows = (
    keyMode === "source-custom"
      ? rows.gradeTypeRows.map((row) => ({
          row,
          key: customGradeTypeKey(row.id),
        }))
      : rows.gradeTypeRows.flatMap((row) =>
          row.presetNodeKey ? [{ row, key: row.presetNodeKey }] : [],
        )
  ).filter(({ key }) => !expectedTypeKeys || expectedTypeKeys.has(key));

  const configuration = {
    subjects: buildSubjects(null),
    gradeTypes: typeRows
      .map(({ row, key }) => ({
        key,
        name: row.name,
        titlePrefix: row.titlePrefix,
        coefficient: row.coefficient,
        outOf: row.outOf,
        accent: row.accent,
      }))
      .sort((left, right) => compareClassTemplateKeys(left.key, right.key)),
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

/** The pure half of the status check, shared by the single and batch paths. */
function evaluateClassYearStatus(
  yearId: string | null,
  template: ClassTemplate | null,
  rows: NonNullable<AcademicRows> | null,
): ClassYearStatus {
  if (!yearId) return "not_connected";
  if (!template) return "incompatible";
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
  /**
   * The types the class declares, and only those.
   *
   * A member — the owner included — writes their own year, and one kind of assessment
   * their year happens to have is not a term of the class: it moves no average and the
   * class never mentioned it. Counting it as divergence disconnected people from a class
   * for defining "TP noté" on their own side, which is exactly the same call the preset
   * link makes, made in the one place the class checks.
   */
  const declaredTypeKeys = new Set(
    template.configuration.gradeTypes.map((type) => type.key),
  );
  if (matchesTemplate(configurationFromRows(rows, "persisted", declaredTypeKeys))) {
    return "connected";
  }
  if (
    template.source.kind === "custom" &&
    yearId === template.source.yearId &&
    matchesTemplate(
      configurationFromRows(rows, "source-custom", declaredTypeKeys),
    )
  ) {
    return "connected";
  }
  return "incompatible";
}

export interface ClassYearStatusRequest {
  userId: string;
  yearId: string | null;
  template: ClassTemplate | null;
}

function byAcademicOrder(
  left: { sortOrder: number; createdAt: Date; id: string },
  right: { sortOrder: number; createdAt: Date; id: string },
): number {
  return (
    left.sortOrder - right.sortOrder ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

/**
 * Status for many (member, year) pairs in six grouped queries instead of up
 * to six PER pair — the class page checks every member and every candidate
 * year of the viewer, which multiplied into the hundreds on a real class.
 * Results align with the requests by index. In-memory sorting mirrors the
 * single loader's ORDER BY exactly: the configuration comparison serialises
 * rows in order, so ordering is part of correctness here.
 */
export async function classYearStatuses(
  requests: readonly ClassYearStatusRequest[],
): Promise<ClassYearStatus[]> {
  const pairs = new Map<string, { userId: string; yearId: string }>();
  for (const request of requests) {
    if (request.yearId && request.template) {
      pairs.set(`${request.userId}:${request.yearId}`, {
        userId: request.userId,
        yearId: request.yearId,
      });
    }
  }

  const loaded = new Map<string, NonNullable<AcademicRows>>();
  if (pairs.size > 0) {
    const yearIds = [...new Set([...pairs.values()].map((p) => p.yearId))];
    const [
      yearRows,
      subjectRowsAll,
      periodRowsAll,
      averageRowsAll,
      gradeTypeRowsAll,
      presetAll,
    ] = await Promise.all([
      db.select().from(years).where(inArray(years.id, yearIds)),
      db.select().from(subjects).where(inArray(subjects.yearId, yearIds)),
      db.select().from(periods).where(inArray(periods.yearId, yearIds)),
      db
        .select()
        .from(customAverages)
        .where(inArray(customAverages.yearId, yearIds)),
      db.select().from(gradeTypes).where(inArray(gradeTypes.yearId, yearIds)),
      db
        .select()
        .from(yearPresetMemberships)
        .where(inArray(yearPresetMemberships.yearId, yearIds)),
    ]);
    const averageIds = averageRowsAll.map((row) => row.id);
    const entryRowsAll =
      averageIds.length === 0
        ? []
        : await db
            .select()
            .from(customAverageEntries)
            .where(inArray(customAverageEntries.averageId, averageIds));

    for (const { userId, yearId } of pairs.values()) {
      const year = yearRows.find(
        (row) => row.id === yearId && row.userId === userId,
      );
      if (!year) continue;
      const averageRows = averageRowsAll
        .filter((row) => row.yearId === yearId && row.userId === userId)
        .sort(byAcademicOrder);
      const ownedAverages = new Set(averageRows.map((row) => row.id));
      loaded.set(`${userId}:${yearId}`, {
        year,
        subjectRows: subjectRowsAll
          .filter((row) => row.yearId === yearId && row.userId === userId)
          .sort(byAcademicOrder),
        periodRows: periodRowsAll
          .filter((row) => row.yearId === yearId && row.userId === userId)
          .sort(byAcademicOrder),
        averageRows,
        gradeTypeRows: gradeTypeRowsAll
          .filter((row) => row.yearId === yearId && row.userId === userId)
          .sort(byAcademicOrder),
        entryRows: entryRowsAll
          .filter((row) => ownedAverages.has(row.averageId))
          .sort(
            (left, right) =>
              (left.averageId < right.averageId
                ? -1
                : left.averageId > right.averageId
                  ? 1
                  : 0) ||
              (left.subjectId < right.subjectId
                ? -1
                : left.subjectId > right.subjectId
                  ? 1
                  : 0),
          ),
        // Same runtime shape as the single loader (`rows[0] ?? null`);
        // its inferred type just never widened to include the null.
        presetMembership: (presetAll.find(
          (row) => row.yearId === yearId && row.userId === userId,
        ) ?? null) as NonNullable<AcademicRows>["presetMembership"],
      });
    }
  }

  return requests.map((request) =>
    evaluateClassYearStatus(
      request.yearId,
      request.template,
      request.yearId
        ? (loaded.get(`${request.userId}:${request.yearId}`) ?? null)
        : null,
    ),
  );
}

export async function classYearStatus(
  userId: string,
  yearId: string | null,
  template: ClassTemplate | null,
): Promise<ClassYearStatus> {
  const [status] = await classYearStatuses([{ userId, yearId, template }]);
  return status as ClassYearStatus;
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
  const statuses = await classYearStatuses(
    candidates.map((year) => ({ userId, yearId: year.id, template })),
  );
  return candidates.filter((_, index) => statuses[index] === "connected");
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
    ...(materialized.gradeTypeRows.length
      ? [db.insert(gradeTypes).values(materialized.gradeTypeRows)]
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
