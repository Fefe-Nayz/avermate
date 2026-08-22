import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  customAverageEntries,
  customAverages,
  gradeTypes,
  grades,
  subjects,
  yearPresetMemberships,
  years,
} from "../db/schema";
import { parsePresetConfiguration } from "../data/managed-presets";
import type {
  ManagedPresetConfiguration,
  ManagedPresetSubject,
} from "../data/preset-types";
import { newId } from "./id";
import { findPresetDefinition, findPresetVersion } from "./preset-catalog";

interface FlatManagedSubject {
  key: string;
  name: string;
  shortName: string | null;
  parentKey: string | null;
  coefficient: number;
  kind: "subject" | "category";
  isMain: boolean;
  sortOrder: number;
}

export interface PresetChangeSummary {
  subjectsAdded: number;
  subjectsChanged: number;
  subjectsRemoved: number;
  averagesAdded: number;
  averagesChanged: number;
  averagesRemoved: number;
  gradeTypesAdded: number;
  gradeTypesChanged: number;
  gradeTypesRemoved: number;
}

function flattenSubjects(
  nodes: readonly ManagedPresetSubject[],
  parentKey: string | null = null,
  output: FlatManagedSubject[] = [],
): FlatManagedSubject[] {
  nodes.forEach((node, sortOrder) => {
    output.push({
      key: node.key,
      name: node.name,
      shortName: node.shortName ?? null,
      parentKey,
      coefficient: node.coefficient,
      kind: node.kind,
      isMain: node.isMain,
      sortOrder,
    });
    flattenSubjects(node.children, node.key, output);
  });
  return output;
}

export function summarizePresetChanges(
  from: ManagedPresetConfiguration,
  to: ManagedPresetConfiguration,
): PresetChangeSummary {
  const fromSubjects = new Map(
    flattenSubjects(from.subjects).map((row) => [row.key, row]),
  );
  const toSubjects = new Map(
    flattenSubjects(to.subjects).map((row) => [row.key, row]),
  );
  const fromAverages = new Map(from.averages.map((row) => [row.key, row]));
  const toAverages = new Map(to.averages.map((row) => [row.key, row]));
  const fromTypes = new Map(from.gradeTypes.map((row) => [row.key, row]));
  const toTypes = new Map(to.gradeTypes.map((row) => [row.key, row]));
  const changed = <T>(left: T, right: T) =>
    JSON.stringify(left) !== JSON.stringify(right);

  return {
    subjectsAdded: [...toSubjects.keys()].filter(
      (key) => !fromSubjects.has(key),
    ).length,
    subjectsChanged: [...toSubjects].filter(
      ([key, row]) =>
        fromSubjects.has(key) && changed(fromSubjects.get(key), row),
    ).length,
    subjectsRemoved: [...fromSubjects.keys()].filter(
      (key) => !toSubjects.has(key),
    ).length,
    averagesAdded: [...toAverages.keys()].filter(
      (key) => !fromAverages.has(key),
    ).length,
    averagesChanged: [...toAverages].filter(
      ([key, row]) =>
        fromAverages.has(key) && changed(fromAverages.get(key), row),
    ).length,
    averagesRemoved: [...fromAverages.keys()].filter(
      (key) => !toAverages.has(key),
    ).length,
    gradeTypesAdded: [...toTypes.keys()].filter((key) => !fromTypes.has(key))
      .length,
    gradeTypesChanged: [...toTypes].filter(
      ([key, row]) => fromTypes.has(key) && changed(fromTypes.get(key), row),
    ).length,
    gradeTypesRemoved: [...fromTypes.keys()].filter((key) => !toTypes.has(key))
      .length,
  };
}

export function detachYearPresetStatement(
  userId: string,
  yearId: string,
  reason: string,
) {
  const now = new Date();
  return db
    .update(yearPresetMemberships)
    .set({
      mode: "customized",
      detachedReason: reason,
      detachedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(yearPresetMemberships.yearId, yearId),
        eq(yearPresetMemberships.userId, userId),
        eq(yearPresetMemberships.mode, "linked"),
      ),
    );
}

export async function markYearPresetCustomized(
  userId: string,
  yearId: string,
  reason: string,
): Promise<void> {
  await detachYearPresetStatement(userId, yearId, reason);
}

export function materializePresetConfiguration(
  configuration: ManagedPresetConfiguration,
  yearId: string,
  userId: string,
  existingSubjectIds: ReadonlyMap<string, string> = new Map(),
  existingAverageIds: ReadonlyMap<string, string> = new Map(),
  existingGradeTypeIds: ReadonlyMap<string, string> = new Map(),
) {
  const flat = flattenSubjects(configuration.subjects);
  const subjectIds = new Map(
    flat.map((node) => [
      node.key,
      existingSubjectIds.get(node.key) ?? newId("sub"),
    ]),
  );
  const subjectRows: Array<typeof subjects.$inferInsert> = flat.map((node) => ({
    id: subjectIds.get(node.key) as string,
    name: node.name,
    shortName: node.shortName,
    parentId: node.parentKey ? (subjectIds.get(node.parentKey) ?? null) : null,
    coefficient: node.coefficient,
    kind: node.kind,
    isMain: node.isMain,
    sortOrder: node.sortOrder,
    presetNodeKey: node.key,
    yearId,
    userId,
  }));

  const averageRows: Array<typeof customAverages.$inferInsert> =
    configuration.averages.map((average, sortOrder) => ({
      id: existingAverageIds.get(average.key) ?? newId("avg"),
      name: average.name,
      isMain: false,
      sortOrder,
      presetNodeKey: average.key,
      yearId,
      userId,
    }));
  const averageIds = new Map(
    averageRows.map((row) => [row.presetNodeKey as string, row.id as string]),
  );
  const entryRows: Array<typeof customAverageEntries.$inferInsert> =
    configuration.averages.flatMap((average) =>
      average.entries.map((entry) => ({
        averageId: averageIds.get(average.key) as string,
        subjectId: subjectIds.get(entry.subjectKey) as string,
        coefficient: entry.coefficient,
        includeChildren: entry.includeChildren,
      })),
    );

  const gradeTypeRows: Array<typeof gradeTypes.$inferInsert> =
    configuration.gradeTypes.map((type, sortOrder) => ({
      id: existingGradeTypeIds.get(type.key) ?? newId("gtype"),
      name: type.name,
      titlePrefix: type.titlePrefix,
      coefficient: type.coefficient,
      outOf: type.outOf,
      accent: type.accent,
      sortOrder,
      presetNodeKey: type.key,
      yearId,
      userId,
    }));
  const gradeTypeIds = new Map(
    gradeTypeRows.map((row) => [row.presetNodeKey as string, row.id as string]),
  );

  return {
    subjectRows,
    averageRows,
    entryRows,
    gradeTypeRows,
    subjectIds,
    averageIds,
    gradeTypeIds,
  };
}

async function loadYearConfiguration(yearId: string) {
  const [subjectRows, averageRows, entryRows, gradeTypeRows] =
    await Promise.all([
      db
        .select()
        .from(subjects)
        .where(eq(subjects.yearId, yearId))
        .orderBy(asc(subjects.sortOrder)),
      db
        .select()
        .from(customAverages)
        .where(eq(customAverages.yearId, yearId))
        .orderBy(asc(customAverages.sortOrder)),
      db
        .select({
          averageId: customAverageEntries.averageId,
          subjectId: customAverageEntries.subjectId,
          coefficient: customAverageEntries.coefficient,
          includeChildren: customAverageEntries.includeChildren,
        })
        .from(customAverageEntries)
        .innerJoin(
          customAverages,
          eq(customAverageEntries.averageId, customAverages.id),
        )
        .where(eq(customAverages.yearId, yearId)),
      db
        .select()
        .from(gradeTypes)
        .where(eq(gradeTypes.yearId, yearId))
        .orderBy(asc(gradeTypes.sortOrder)),
    ]);
  return { subjectRows, averageRows, entryRows, gradeTypeRows };
}

/** Exact comparison protects sync even if a future write path forgets to detach. */
export async function yearMatchesPresetConfiguration(
  yearId: string,
  configuration: ManagedPresetConfiguration,
): Promise<boolean> {
  const actual = await loadYearConfiguration(yearId);
  const expectedSubjects = flattenSubjects(configuration.subjects);
  if (
    actual.subjectRows.length !== expectedSubjects.length ||
    actual.averageRows.length !== configuration.averages.length
  ) {
    return false;
  }

  const actualSubjectByKey = new Map(
    actual.subjectRows
      .filter((row) => row.presetNodeKey)
      .map((row) => [row.presetNodeKey as string, row]),
  );
  const actualSubjectKeyById = new Map(
    actual.subjectRows
      .filter((row) => row.presetNodeKey)
      .map((row) => [row.id, row.presetNodeKey as string]),
  );
  for (const expected of expectedSubjects) {
    const row = actualSubjectByKey.get(expected.key);
    if (
      !row ||
      row.name !== expected.name ||
      row.shortName !== expected.shortName ||
      row.coefficient !== expected.coefficient ||
      row.kind !== expected.kind ||
      row.isMain !== expected.isMain ||
      row.sortOrder !== expected.sortOrder ||
      (row.parentId
        ? (actualSubjectKeyById.get(row.parentId) ?? null)
        : null) !== expected.parentKey
    ) {
      return false;
    }
  }

  /**
   * Only the types the preset owns are the preset's business.
   *
   * A subject or a custom average is a term of the contract: adding one changes what the
   * year computes, so any extra row means the year is no longer this preset. A type is
   * stationery — it fills a title and a coefficient in as somebody writes a result down,
   * and it moves no average. Severing the link for it would cost a reader the next
   * corrected coefficient in exchange for nothing, so a type they added themselves is
   * theirs, and only the rows carrying a preset key have to match.
   */
  const presetOwnedTypes = actual.gradeTypeRows.filter(
    (row) => row.presetNodeKey,
  );
  if (presetOwnedTypes.length !== configuration.gradeTypes.length) return false;
  const actualTypeByKey = new Map(
    presetOwnedTypes.map((row) => [row.presetNodeKey as string, row]),
  );
  for (const expected of configuration.gradeTypes) {
    // By key, and no position: this list is one the reader drags into the order they
    // want, and the picker that offers it is the only thing the order feeds. A preset
    // proposes which types exist and what each fills in — not where each one sits.
    const row = actualTypeByKey.get(expected.key);
    if (
      !row ||
      row.name !== expected.name ||
      row.titlePrefix !== expected.titlePrefix ||
      row.coefficient !== expected.coefficient ||
      row.outOf !== expected.outOf ||
      (row.accent ?? null) !== expected.accent
    ) {
      return false;
    }
  }

  const actualAverageByKey = new Map(
    actual.averageRows
      .filter((row) => row.presetNodeKey)
      .map((row) => [row.presetNodeKey as string, row]),
  );
  for (
    let sortOrder = 0;
    sortOrder < configuration.averages.length;
    sortOrder += 1
  ) {
    const expected = configuration.averages[sortOrder];
    if (!expected) return false;
    const row = actualAverageByKey.get(expected.key);
    if (
      !row ||
      row.name !== expected.name ||
      row.isMain !== false ||
      row.sortOrder !== sortOrder
    ) {
      return false;
    }
    const entries = actual.entryRows
      .filter((entry) => entry.averageId === row.id)
      .map((entry) => ({
        subjectKey: actualSubjectKeyById.get(entry.subjectId),
        coefficient: entry.coefficient,
        includeChildren: entry.includeChildren,
      }))
      .sort((left, right) =>
        String(left.subjectKey).localeCompare(String(right.subjectKey)),
      );
    const expectedEntries = [...expected.entries].sort((left, right) =>
      left.subjectKey.localeCompare(right.subjectKey),
    );
    if (JSON.stringify(entries) !== JSON.stringify(expectedEntries))
      return false;
  }
  return true;
}

async function removalBlockers(
  yearId: string,
  target: ManagedPresetConfiguration,
) {
  const targetKeys = new Set(
    flattenSubjects(target.subjects).map((row) => row.key),
  );
  const current = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      presetNodeKey: subjects.presetNodeKey,
    })
    .from(subjects)
    .where(eq(subjects.yearId, yearId));
  const removed = current.filter(
    (row) => row.presetNodeKey && !targetKeys.has(row.presetNodeKey),
  );
  if (removed.length === 0) return [];
  const gradeRows = await db
    .select({ subjectId: grades.subjectId })
    .from(grades)
    .where(
      inArray(
        grades.subjectId,
        removed.map((row) => row.id),
      ),
    );
  const counts = new Map<string, number>();
  for (const grade of gradeRows) {
    counts.set(grade.subjectId, (counts.get(grade.subjectId) ?? 0) + 1);
  }
  return removed
    .filter((row) => (counts.get(row.id) ?? 0) > 0)
    .map((row) => ({
      subjectId: row.id,
      subjectName: row.name,
      gradeCount: counts.get(row.id) ?? 0,
    }));
}

export async function getYearPresetStatus(userId: string, yearId: string) {
  const [membership] = await db
    .select()
    .from(yearPresetMemberships)
    .where(
      and(
        eq(yearPresetMemberships.yearId, yearId),
        eq(yearPresetMemberships.userId, userId),
      ),
    )
    .limit(1);
  if (!membership) {
    return {
      state: "none" as const,
      membership: null,
      preset: null,
      changes: null,
      blockers: [],
    };
  }

  const definition = await findPresetDefinition(membership.presetId);
  const appliedRow = await findPresetVersion(
    membership.presetId,
    membership.appliedVersion,
  );
  if (!definition || !appliedRow) {
    return {
      state: "action_required" as const,
      membership,
      preset: definition,
      changes: null,
      blockers: [],
    };
  }
  const applied = parsePresetConfiguration(appliedRow.configuration);
  if (membership.mode === "customized") {
    return {
      state: "customized" as const,
      membership,
      preset: definition,
      changes: null,
      blockers: [],
    };
  }
  if (!(await yearMatchesPresetConfiguration(yearId, applied))) {
    await markYearPresetCustomized(userId, yearId, "configuration_changed");
    return {
      state: "customized" as const,
      membership: {
        ...membership,
        mode: "customized",
        detachedReason: "configuration_changed",
      },
      preset: definition,
      changes: null,
      blockers: [],
    };
  }
  if (definition.currentVersion <= membership.appliedVersion) {
    return {
      state: "current" as const,
      membership,
      preset: definition,
      changes: null,
      blockers: [],
    };
  }
  const targetRow = await findPresetVersion(
    membership.presetId,
    definition.currentVersion,
  );
  if (!targetRow) {
    return {
      state: "action_required" as const,
      membership,
      preset: definition,
      changes: null,
      blockers: [],
    };
  }
  const target = parsePresetConfiguration(targetRow.configuration);
  const blockers = await removalBlockers(yearId, target);
  return {
    state:
      blockers.length > 0
        ? ("action_required" as const)
        : ("update_available" as const),
    membership,
    preset: definition,
    changes: summarizePresetChanges(applied, target),
    blockers,
  };
}

export async function synchronizeYearPreset(userId: string, yearId: string) {
  const status = await getYearPresetStatus(userId, yearId);
  if (status.state === "current") return status;
  if (
    status.state !== "update_available" ||
    !status.membership ||
    !status.preset
  ) {
    throw new Error(
      status.state === "action_required"
        ? "This update would remove a subject that already has grades"
        : "This year is not linked to an updatable preset",
    );
  }
  const targetRow = await findPresetVersion(
    status.preset.id,
    status.preset.currentVersion,
  );
  if (!targetRow) throw new Error("Preset version not found");
  const configuration = parsePresetConfiguration(targetRow.configuration);
  const current = await loadYearConfiguration(yearId);
  const subjectIds = new Map(
    current.subjectRows
      .filter((row) => row.presetNodeKey)
      .map((row) => [row.presetNodeKey as string, row.id]),
  );
  const averageIds = new Map(
    current.averageRows
      .filter((row) => row.presetNodeKey)
      .map((row) => [row.presetNodeKey as string, row.id]),
  );
  const gradeTypeIds = new Map(
    current.gradeTypeRows
      .filter((row) => row.presetNodeKey)
      .map((row) => [row.presetNodeKey as string, row.id]),
  );
  const materialized = materializePresetConfiguration(
    configuration,
    yearId,
    userId,
    subjectIds,
    averageIds,
    gradeTypeIds,
  );
  // A type arriving in a new version lands after everything the year already holds,
  // including the reader's own types. Renumbering from zero would reshuffle a list
  // somebody arranged, to say something the update never said.
  const nextTypeSortOrder =
    current.gradeTypeRows.reduce(
      (highest, row) => Math.max(highest, row.sortOrder),
      -1,
    ) + 1;
  const targetSubjectKeys = materialized.subjectRows.map(
    (row) => row.presetNodeKey as string,
  );
  const targetAverageKeys = materialized.averageRows.map(
    (row) => row.presetNodeKey as string,
  );
  const nextGradeTypeIds = new Set(
    materialized.gradeTypeRows.map((row) => row.id as string),
  );
  // By id, for the reason the reapply path says at length: a row survives when it is
  // carried forward, not when some incoming row happens to share its key.
  const removedGradeTypeIds = current.gradeTypeRows
    .filter((row) => row.presetNodeKey && !nextGradeTypeIds.has(row.id))
    .map((row) => row.id);
  const removedAverageIds = current.averageRows
    .filter(
      (row) =>
        row.presetNodeKey && !targetAverageKeys.includes(row.presetNodeKey),
    )
    .map((row) => row.id);
  const removedSubjectIds = current.subjectRows
    .filter(
      (row) =>
        row.presetNodeKey && !targetSubjectKeys.includes(row.presetNodeKey),
    )
    .map((row) => row.id);

  const statements = [
    // The results of a withdrawn kind keep their marks and lose their label: `set null`
    // on the column does that, so a preset update never deletes a grade.
    ...(removedGradeTypeIds.length > 0
      ? [
          db
            .delete(gradeTypes)
            .where(inArray(gradeTypes.id, removedGradeTypeIds)),
        ]
      : []),
    ...materialized.gradeTypeRows.map((row, index) =>
      gradeTypeIds.has(row.presetNodeKey as string)
        ? db
            .update(gradeTypes)
            .set({
              name: row.name,
              titlePrefix: row.titlePrefix,
              coefficient: row.coefficient,
              outOf: row.outOf,
              accent: row.accent,
              updatedAt: new Date(),
            })
            .where(eq(gradeTypes.id, row.id as string))
        : db
            .insert(gradeTypes)
            .values({ ...row, sortOrder: nextTypeSortOrder + index }),
    ),
    ...(removedAverageIds.length > 0
      ? [
          db
            .delete(customAverages)
            .where(inArray(customAverages.id, removedAverageIds)),
        ]
      : []),
    ...(removedSubjectIds.length > 0
      ? [db.delete(subjects).where(inArray(subjects.id, removedSubjectIds))]
      : []),
    ...materialized.subjectRows.map((row) =>
      subjectIds.has(row.presetNodeKey as string)
        ? db
            .update(subjects)
            .set({
              name: row.name,
              shortName: row.shortName,
              parentId: row.parentId,
              coefficient: row.coefficient,
              kind: row.kind,
              isMain: row.isMain,
              sortOrder: row.sortOrder,
              updatedAt: new Date(),
            })
            .where(eq(subjects.id, row.id as string))
        : db.insert(subjects).values(row),
    ),
    ...materialized.averageRows.map((row) =>
      averageIds.has(row.presetNodeKey as string)
        ? db
            .update(customAverages)
            .set({
              name: row.name,
              isMain: row.isMain,
              sortOrder: row.sortOrder,
              updatedAt: new Date(),
            })
            .where(eq(customAverages.id, row.id as string))
        : db.insert(customAverages).values(row),
    ),
    ...(materialized.averageRows.length > 0
      ? [
          db.delete(customAverageEntries).where(
            inArray(
              customAverageEntries.averageId,
              materialized.averageRows.map((row) => row.id as string),
            ),
          ),
        ]
      : []),
    ...(materialized.entryRows.length > 0
      ? [db.insert(customAverageEntries).values(materialized.entryRows)]
      : []),
    db
      .update(yearPresetMemberships)
      .set({
        appliedVersion: status.preset.currentVersion,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(yearPresetMemberships.yearId, yearId)),
    db.update(years).set({ updatedAt: new Date() }).where(eq(years.id, yearId)),
  ];
  await db.batch(
    statements as [
      (typeof statements)[number],
      ...(typeof statements)[number][],
    ],
  );
  return getYearPresetStatus(userId, yearId);
}
