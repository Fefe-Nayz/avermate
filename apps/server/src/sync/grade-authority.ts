import { and, eq, inArray } from "drizzle-orm";
import { db as applicationDb } from "../db";
import {
  grades,
  syncConnections,
  syncGradeRecords,
  syncPeriodMappings,
  syncSubjectMappings,
} from "../db/schema";

type SyncTransaction = Parameters<
  Parameters<typeof applicationDb.transaction>[0]
>[0];

/**
 * Rebuild the system-owned average gate for every provider grade in a year.
 *
 * The user's own `excludedFromAverage` preference is intentionally untouched.
 * A provider result is eligible only when it belongs to the one live authority,
 * remains present/numeric/significant, and its stable subject/period identities
 * still resolve to the canonical grade row.
 */
export async function reconcileGradeAuthorityProjection(
  transaction: SyncTransaction,
  input: { userId: string; yearId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const [connections, records] = await Promise.all([
    transaction
      .select({
        id: syncConnections.id,
        status: syncConnections.status,
        sealedCredentials: syncConnections.sealedCredentials,
        capabilities: syncConnections.capabilities,
        gradesAuthority: syncConnections.gradesAuthority,
      })
      .from(syncConnections)
      .where(
        and(
          eq(syncConnections.userId, input.userId),
          eq(syncConnections.yearId, input.yearId),
        ),
      ),
    transaction
      .select({
        connectionId: syncGradeRecords.connectionId,
        localGradeId: syncGradeRecords.localGradeId,
        syncState: syncGradeRecords.syncState,
        value: syncGradeRecords.value,
        outOf: syncGradeRecords.outOf,
        significant: syncGradeRecords.significant,
        providerSubjectExternalId: syncGradeRecords.providerSubjectExternalId,
        providerPeriodExternalId: syncGradeRecords.providerPeriodExternalId,
        subjectId: grades.subjectId,
        periodId: grades.periodId,
      })
      .from(syncGradeRecords)
      .innerJoin(grades, eq(grades.id, syncGradeRecords.localGradeId))
      .where(
        and(
          eq(syncGradeRecords.userId, input.userId),
          eq(syncGradeRecords.yearId, input.yearId),
          eq(grades.userId, input.userId),
          eq(grades.yearId, input.yearId),
        ),
      ),
  ]);

  const linkedGradeIds = [
    ...new Set(
      records.flatMap((record) =>
        record.localGradeId ? [record.localGradeId] : [],
      ),
    ),
  ];
  if (linkedGradeIds.length > 0) {
    await transaction
      .update(grades)
      .set({ syncExcludedFromAverage: true, updatedAt: now })
      .where(
        and(
          eq(grades.userId, input.userId),
          eq(grades.yearId, input.yearId),
          inArray(grades.id, linkedGradeIds),
        ),
      );
  }

  const authority = connections.find(
    (connection) =>
      connection.gradesAuthority &&
      (connection.status === "active" || connection.status === "error") &&
      Boolean(connection.sealedCredentials) &&
      connection.capabilities.includes("grades"),
  );
  if (!authority || linkedGradeIds.length === 0) {
    return { linked: linkedGradeIds.length, included: 0 };
  }

  const [subjectMappings, periodMappings] = await Promise.all([
    transaction
      .select({
        externalId: syncSubjectMappings.providerSubjectExternalId,
        subjectId: syncSubjectMappings.subjectId,
        matchStatus: syncSubjectMappings.matchStatus,
      })
      .from(syncSubjectMappings)
      .where(
        and(
          eq(syncSubjectMappings.connectionId, authority.id),
          eq(syncSubjectMappings.userId, input.userId),
          eq(syncSubjectMappings.yearId, input.yearId),
        ),
      ),
    transaction
      .select({
        externalId: syncPeriodMappings.providerPeriodExternalId,
        periodId: syncPeriodMappings.periodId,
        matchStatus: syncPeriodMappings.matchStatus,
      })
      .from(syncPeriodMappings)
      .where(
        and(
          eq(syncPeriodMappings.connectionId, authority.id),
          eq(syncPeriodMappings.userId, input.userId),
          eq(syncPeriodMappings.yearId, input.yearId),
        ),
      ),
  ]);
  const subjectByExternalId = new Map(
    subjectMappings.map((mapping) => [mapping.externalId, mapping]),
  );
  const periodByExternalId = new Map(
    periodMappings.map((mapping) => [mapping.externalId, mapping]),
  );
  const eligibleGradeIds = records.flatMap((record) => {
    if (
      record.connectionId !== authority.id ||
      !record.localGradeId ||
      record.syncState !== "managed" ||
      !record.significant ||
      record.value === null ||
      record.outOf === null ||
      record.outOf <= 0
    ) {
      return [];
    }
    const subjectMapping = subjectByExternalId.get(
      record.providerSubjectExternalId,
    );
    if (
      subjectMapping?.matchStatus !== "mapped" ||
      !subjectMapping.subjectId ||
      subjectMapping.subjectId !== record.subjectId
    ) {
      return [];
    }
    if (record.providerPeriodExternalId) {
      const periodMapping = periodByExternalId.get(
        record.providerPeriodExternalId,
      );
      if (
        periodMapping?.matchStatus !== "mapped" ||
        !periodMapping.periodId ||
        periodMapping.periodId !== record.periodId
      ) {
        return [];
      }
    }
    return [record.localGradeId];
  });
  if (eligibleGradeIds.length > 0) {
    await transaction
      .update(grades)
      .set({ syncExcludedFromAverage: false, updatedAt: now })
      .where(
        and(
          eq(grades.userId, input.userId),
          eq(grades.yearId, input.yearId),
          inArray(grades.id, eligibleGradeIds),
        ),
      );
  }
  return { linked: linkedGradeIds.length, included: eligibleGradeIds.length };
}
