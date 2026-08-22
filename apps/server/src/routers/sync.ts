import {
  isoDateInTimeZone,
  isValidTimeZone,
  zonedDateTimeToDate,
} from "@avermate/core/planning";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  jobs,
  gradeAttachments,
  grades,
  periods,
  subjects,
  syncConnections,
  syncGradeRecords,
  syncPeriodMappings,
  syncSubjectMappings,
  years,
  type SyncProviderId,
} from "../db/schema";
import { open, seal } from "../lib/crypto";
import { newId } from "../lib/id";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireSyncConnection, requireYear } from "../lib/ownership";
import { reserveDurableRateLimit, reserveRateLimit } from "../lib/rate-limit";
import { normalizeMoodleBaseUrl } from "../sync/moodle";
import { deleteFile } from "../lib/storage";
import { reconcileGradeAuthorityProjection } from "../sync/grade-authority";
import { SYNC_PROVIDERS, type SyncProvider } from "../sync/provider";
import {
  enqueueSyncRun,
  nextSyncConnectionVersion,
  SYNC_JOB_KIND,
} from "../sync/run";
import { publicSchoolProviderCatalog } from "../sync/school-provider-catalog";
import type { ProviderGrade, SchoolSyncWindow } from "../sync/school-provider";

function publicConnection(row: typeof syncConnections.$inferSelect) {
  const { sealedCredentials: _sealedCredentials, caCertPem, ...visible } = row;
  return { ...visible, hasCustomCa: Boolean(caCertPem) };
}

function publicJob(row: typeof jobs.$inferSelect) {
  const { lockedBy: _lockedBy, lockedUntil: _lockedUntil, ...visible } = row;
  return visible;
}

function inputError(error: unknown): never {
  badRequest(
    error instanceof Error
      ? error.message
      : "The school service connection is invalid",
  );
}

function providerById(id: SyncProviderId) {
  const providers: Partial<Record<SyncProviderId, SyncProvider>> =
    SYNC_PROVIDERS;
  return providers[id];
}

function requireBoundConnection(
  connection: typeof syncConnections.$inferSelect,
): asserts connection is typeof connection & { yearId: string } {
  if (!connection.yearId) {
    badRequest("Choose or create an academic year before synchronizing");
  }
}

function requireConnectedCredentials(
  connection: typeof syncConnections.$inferSelect,
): asserts connection is typeof connection & { sealedCredentials: string } {
  if (
    !connection.sealedCredentials ||
    (connection.status !== "active" &&
      connection.status !== "error" &&
      connection.status !== "pending")
  ) {
    badRequest("Reconnect the school service before synchronizing");
  }
}

function defaultAcademicYearWindow(
  now = new Date(),
  timezone = "Europe/Paris",
): SchoolSyncWindow {
  const [localYear, localMonth] = isoDateInTimeZone(now, timezone)
    .split("-")
    .map(Number);
  const startYear = localMonth! >= 8 ? localYear! : localYear! - 1;
  return {
    from: zonedDateTimeToDate(`${startYear}-08-01`, 0, timezone),
    to: new Date(
      zonedDateTimeToDate(`${startYear + 1}-08-01`, 0, timezone).getTime() - 1,
    ),
    timezone,
  };
}

/**
 * Stable fallback when a provider does not expose its own academic-year id.
 * Day-level edits to a local year's bounds must not manufacture another
 * remote scope for the same pupil and school year.
 */
function fallbackAcademicYearId(window: SchoolSyncWindow) {
  return `school-year:${isoDateInTimeZone(window.from, window.timezone).slice(0, 4)}`;
}

function normalizedAcademicName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("fr");
}

function providerPeriodKey(grade: ProviderGrade) {
  const explicit = grade.periodExternalId?.trim();
  if (explicit) return explicit;
  const name = normalizedAcademicName(grade.periodName ?? "");
  return name ? `name:${name}` : null;
}

async function collectGradePreview(
  connection: typeof syncConnections.$inferSelect,
  requestedWindow?: SchoolSyncWindow,
) {
  requireConnectedCredentials(connection);
  const provider = providerById(connection.provider);
  const facet = provider?.school?.facets.grades;
  if (!provider?.school || !facet) {
    badRequest("This service does not expose school grades");
  }
  const requestedTimezone = requestedWindow?.timezone ?? "Europe/Paris";
  const openConnection = {
    id: connection.id,
    userId: connection.userId,
    yearId: connection.yearId ?? "pending",
    baseUrl: connection.baseUrl,
    credentials: open(connection.sealedCredentials),
    credentialRevision: connection.sealedCredentials,
    caCertPem: connection.caCertPem,
  };
  const timezone =
    provider.school.timezone?.(openConnection) ?? requestedTimezone;
  const window = requestedWindow
    ? { ...requestedWindow, timezone }
    : defaultAcademicYearWindow(new Date(), timezone);
  try {
    const discovered = await facet.list(openConnection, { window });
    const byExternalId = new Map<string, ProviderGrade>();
    for (const grade of discovered) {
      if (grade.passedAt < window.from || grade.passedAt > window.to) continue;
      const externalId = grade.externalId.trim();
      if (!externalId || externalId.length > 1_900) {
        badRequest("The service returned an invalid grade identity");
      }
      if (byExternalId.has(externalId)) {
        badRequest("The service returned duplicate grade identities");
      }
      byExternalId.set(externalId, grade);
    }
    const gradeRows = [...byExternalId.values()];
    const subjectMap = new Map<string, string>();
    const periodMap = new Map<
      string,
      { externalId: string; name: string; firstGradeAt: Date }
    >();
    for (const grade of gradeRows) {
      const subjectId = grade.subject.externalId.trim();
      if (!subjectId || subjectId.length > 1_900) {
        badRequest("The service returned an invalid subject identity");
      }
      const subjectName = grade.subject.name.trim() || subjectId;
      const previousSubject = subjectMap.get(subjectId);
      if (
        previousSubject &&
        normalizedAcademicName(previousSubject) !==
          normalizedAcademicName(subjectName)
      ) {
        badRequest("The service returned conflicting subject identities");
      }
      subjectMap.set(subjectId, subjectName);
      const periodId = providerPeriodKey(grade);
      if (!periodId) continue;
      const name = grade.periodName?.trim() || periodId;
      const previousPeriod = periodMap.get(periodId);
      if (
        previousPeriod &&
        normalizedAcademicName(previousPeriod.name) !==
          normalizedAcademicName(name)
      ) {
        badRequest("The service returned conflicting period identities");
      }
      if (!previousPeriod || grade.passedAt < previousPeriod.firstGradeAt) {
        periodMap.set(periodId, {
          externalId: periodId,
          name,
          firstGradeAt: grade.passedAt,
        });
      }
    }
    return {
      window,
      grades: gradeRows,
      subjects: [...subjectMap].map(([externalId, name]) => ({
        externalId,
        name,
      })),
      periods: [...periodMap.values()].sort(
        (left, right) =>
          left.firstGradeAt.getTime() - right.firstGradeAt.getTime() ||
          left.name.localeCompare(right.name, "fr"),
      ),
    };
  } finally {
    await provider.releaseConnection?.(openConnection);
  }
}

const connectionIdSchema = z.object({
  connectionId: z.string().min(1),
});

const MAX_CONNECTIONS_PER_PROVIDER_YEAR = 5;
const MAX_CONNECTIONS_PER_YEAR = 12;
type SyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertConnectionQuota(
  transaction: SyncTransaction,
  input: {
    userId: string;
    yearId: string;
    provider: SyncProviderId;
    excludeConnectionId?: string;
  },
) {
  const existing = await transaction
    .select({ id: syncConnections.id, provider: syncConnections.provider })
    .from(syncConnections)
    .where(
      and(
        eq(syncConnections.userId, input.userId),
        eq(syncConnections.yearId, input.yearId),
      ),
    );
  const counted = existing.filter(
    (connection) => connection.id !== input.excludeConnectionId,
  );
  if (
    counted.length >= MAX_CONNECTIONS_PER_YEAR ||
    counted.filter((connection) => connection.provider === input.provider)
      .length >= MAX_CONNECTIONS_PER_PROVIDER_YEAR
  ) {
    badRequest("The school service connection quota has been reached");
  }
}

async function insertConnectionWithQuota(input: {
  provider: SyncProviderId;
  label: string;
  baseUrl: string;
  sealedCredentials: string;
  caCertPem: string | null;
  capabilities: (typeof syncConnections.$inferInsert)["capabilities"];
  yearId: string | null;
  userId: string;
  remoteStudentId?: string | null;
  remoteAcademicYearId?: string | null;
  reconnectConnectionId?: string;
}) {
  return db.transaction(async (transaction) => {
    let remoteAcademicYearId = input.remoteAcademicYearId ?? null;
    if (input.yearId && !remoteAcademicYearId) {
      const [academicYear] = await transaction
        .select({ startsAt: years.startsAt, endsAt: years.endsAt })
        .from(years)
        .where(and(eq(years.id, input.yearId), eq(years.userId, input.userId)))
        .limit(1);
      if (!academicYear)
        badRequest("The selected academic year is unavailable");
      remoteAcademicYearId = fallbackAcademicYearId({
        from: academicYear.startsAt,
        to: academicYear.endsAt,
        timezone: "Europe/Paris",
      });
    }

    if (input.remoteStudentId && remoteAcademicYearId) {
      const matchingSources = await transaction
        .select({ id: syncConnections.id })
        .from(syncConnections)
        .where(
          and(
            eq(syncConnections.userId, input.userId),
            eq(syncConnections.provider, input.provider),
            eq(syncConnections.baseUrl, input.baseUrl),
            eq(syncConnections.remoteStudentId, input.remoteStudentId),
            eq(syncConnections.remoteAcademicYearId, remoteAcademicYearId),
          ),
        );
      if (
        matchingSources.some(
          (source) => source.id !== input.reconnectConnectionId,
        )
      ) {
        badRequest(
          "This student and academic year are already linked; reconnect the existing source instead",
        );
      }
    }

    if (input.yearId) {
      await assertConnectionQuota(transaction, {
        userId: input.userId,
        yearId: input.yearId,
        provider: input.provider,
        excludeConnectionId: input.reconnectConnectionId,
      });
    }

    const [currentAuthority] = input.yearId
      ? await transaction
          .select({ id: syncConnections.id })
          .from(syncConnections)
          .where(
            and(
              eq(syncConnections.userId, input.userId),
              eq(syncConnections.yearId, input.yearId),
              eq(syncConnections.gradesAuthority, true),
            ),
          )
          .limit(1)
      : [];
    const gradesAuthority =
      Boolean(input.yearId) &&
      input.capabilities.includes("grades") &&
      (!currentAuthority ||
        currentAuthority.id === input.reconnectConnectionId);

    if (input.reconnectConnectionId) {
      const [existing] = await transaction
        .select()
        .from(syncConnections)
        .where(
          and(
            eq(syncConnections.id, input.reconnectConnectionId),
            eq(syncConnections.userId, input.userId),
          ),
        )
        .limit(1);
      if (!existing || existing.provider !== input.provider) {
        badRequest("The school service connection cannot be reauthorized");
      }
      if (
        existing.remoteStudentId &&
        input.remoteStudentId &&
        existing.remoteStudentId !== input.remoteStudentId
      ) {
        badRequest(
          "This connection belongs to another student; create a separate school source instead",
        );
      }
      if (existing.remoteStudentId && existing.baseUrl !== input.baseUrl) {
        badRequest(
          "This connection belongs to another school service instance; create a separate source instead",
        );
      }
      if (existing.yearId && input.yearId && existing.yearId !== input.yearId) {
        badRequest("Move the connection with the dedicated year binding flow");
      }
      const effectiveYearId = input.yearId ?? existing.yearId;
      const [effectiveAuthority] = effectiveYearId
        ? await transaction
            .select({ id: syncConnections.id })
            .from(syncConnections)
            .where(
              and(
                eq(syncConnections.userId, input.userId),
                eq(syncConnections.yearId, effectiveYearId),
                eq(syncConnections.gradesAuthority, true),
              ),
            )
            .limit(1)
        : [];
      const reconnectGradesAuthority =
        Boolean(effectiveYearId) &&
        input.capabilities.includes("grades") &&
        (!effectiveAuthority || effectiveAuthority.id === existing.id);
      const changedAt = nextSyncConnectionVersion(existing.updatedAt);
      const [updated] = await transaction
        .update(syncConnections)
        .set({
          label: input.label,
          baseUrl: input.baseUrl,
          sealedCredentials: input.sealedCredentials,
          caCertPem: input.caCertPem,
          capabilities: input.capabilities,
          status: (input.yearId ?? existing.yearId) ? "active" : "pending",
          lastError: null,
          remoteStudentId:
            input.remoteStudentId ?? existing.remoteStudentId ?? null,
          remoteAcademicYearId:
            remoteAcademicYearId ?? existing.remoteAcademicYearId ?? null,
          gradesAuthority: reconnectGradesAuthority,
          disconnectedAt: null,
          yearId: effectiveYearId,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(syncConnections.id, existing.id),
            eq(syncConnections.userId, input.userId),
            eq(syncConnections.updatedAt, existing.updatedAt),
          ),
        )
        .returning();
      if (!updated) badRequest("The school service could not be reauthorized");
      if (effectiveYearId) {
        await reconcileGradeAuthorityProjection(transaction, {
          userId: input.userId,
          yearId: effectiveYearId,
          now: changedAt,
        });
      }
      return updated;
    }

    const [created] = await transaction
      .insert(syncConnections)
      .values({
        provider: input.provider,
        label: input.label,
        baseUrl: input.baseUrl,
        sealedCredentials: input.sealedCredentials,
        caCertPem: input.caCertPem,
        capabilities: input.capabilities,
        status: input.yearId ? "active" : "pending",
        remoteStudentId: input.remoteStudentId ?? null,
        remoteAcademicYearId,
        gradesAuthority,
        yearId: input.yearId,
        userId: input.userId,
      })
      .returning();
    if (!created)
      badRequest("The school service connection could not be created");
    if (input.yearId) {
      await reconcileGradeAuthorityProjection(transaction, {
        userId: input.userId,
        yearId: input.yearId,
      });
    }
    return created;
  });
}

export const syncRouter = {
  providers: protectedProcedure.handler(() => [
    {
      id: "moodle" as const,
      label: "Moodle",
      capabilities: ["files" as const],
      availability: { status: "ready" as const },
    },
    ...publicSchoolProviderCatalog(),
  ]),

  connections: {
    list: protectedProcedure
      .input(z.object({ yearId: z.string().min(1).optional() }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        if (input.yearId) await requireYear(userId, input.yearId);
        const rows = await db
          .select()
          .from(syncConnections)
          .where(
            and(
              eq(syncConnections.userId, userId),
              input.yearId
                ? eq(syncConnections.yearId, input.yearId)
                : undefined,
            ),
          )
          .orderBy(desc(syncConnections.createdAt));
        return rows.map(publicConnection);
      }),

    create: protectedProcedure
      .input(
        z.object({
          provider: z.enum(["moodle", "ecoledirecte", "pronote", "skolengo"]),
          yearId: z.string().min(1).nullable().optional(),
          reconnectConnectionId: z.string().min(1).optional(),
          baseUrl: z.string().trim().min(1).max(2_048),
          credentialInput: z
            .string()
            .trim()
            .min(1)
            .max(128 * 1024),
          caCertPem: z
            .string()
            .trim()
            .max(128 * 1024)
            .nullable()
            .optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        if (input.yearId) await requireYear(userId, input.yearId);
        if (input.provider === "moodle" && !input.yearId) {
          badRequest("Moodle must be connected to an existing academic year");
        }
        if (input.provider === "ecoledirecte") {
          badRequest("Use the dedicated ÉcoleDirecte connection flow");
        }
        await reserveDurableRateLimit({
          subject: `${userId}:${input.provider}`,
          action: "sync.connections.create",
          limit: 5,
          windowMs: 10 * 60_000,
        });
        const provider = providerById(input.provider);
        if (!provider) {
          badRequest(
            `${input.provider} is not enabled until its reviewed adapter is available`,
          );
        }
        const caCertPem = input.caCertPem?.trim() || null;
        let baseUrl: string;
        let parsed: Awaited<ReturnType<typeof provider.parseCredentialInput>>;
        try {
          baseUrl =
            provider.normalizeBaseUrl?.(input.baseUrl) ??
            (input.provider === "moodle"
              ? normalizeMoodleBaseUrl(input.baseUrl)
              : input.baseUrl.trim());
          parsed = await provider.parseCredentialInput(
            baseUrl,
            input.credentialInput,
            { caCertPem },
          );
        } catch (error) {
          inputError(error);
        }
        const created = await insertConnectionWithQuota({
          provider: input.provider,
          label: parsed.accountLabel,
          baseUrl,
          sealedCredentials: seal(parsed.credentials),
          caCertPem,
          capabilities: provider.capabilities,
          yearId: input.yearId ?? null,
          userId,
          remoteStudentId: parsed.remoteStudentId ?? null,
          remoteAcademicYearId: parsed.remoteAcademicYearId ?? null,
          reconnectConnectionId: input.reconnectConnectionId,
        });
        return publicConnection(created);
      }),

    delete: protectedProcedure
      .input(connectionIdSchema)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        const now = new Date();
        const disconnected = await db.transaction(async (transaction) => {
          const changedAt = nextSyncConnectionVersion(
            connection.updatedAt,
            now,
          );
          const [updated] = await transaction
            .update(syncConnections)
            .set({
              sealedCredentials: null,
              status: "disconnected",
              gradesAuthority: false,
              disconnectedAt: now,
              lastError: null,
              updatedAt: changedAt,
            })
            .where(
              and(
                eq(syncConnections.id, connection.id),
                eq(syncConnections.userId, userId),
                eq(syncConnections.updatedAt, connection.updatedAt),
              ),
            )
            .returning({ id: syncConnections.id });
          if (!updated) {
            badRequest("The connection changed; reload and try again");
          }
          if (connection.yearId) {
            await reconcileGradeAuthorityProjection(transaction, {
              userId,
              yearId: connection.yearId,
              now: changedAt,
            });
          }
          return updated;
        });
        if (!disconnected)
          badRequest("The connection could not be disconnected");
        providerById(connection.provider)?.forgetConnection?.(connection.id);
        return { ok: true, preservedData: true };
      }),

    purge: protectedProcedure
      .input(connectionIdSchema)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        const linked = await db
          .select({ localGradeId: syncGradeRecords.localGradeId })
          .from(syncGradeRecords)
          .where(
            and(
              eq(syncGradeRecords.connectionId, connection.id),
              eq(syncGradeRecords.userId, userId),
            ),
          );
        const linkedGradeIds = linked.flatMap((row) =>
          row.localGradeId ? [row.localGradeId] : [],
        );
        const linkedFiles =
          linkedGradeIds.length > 0
            ? await db
                .select({ fileId: gradeAttachments.fileId })
                .from(gradeAttachments)
                .where(inArray(gradeAttachments.gradeId, linkedGradeIds))
            : [];
        const linkedFileIds = [
          ...new Set(linkedFiles.map(({ fileId }) => fileId)),
        ];
        await db.transaction(async (transaction) => {
          await transaction
            .delete(syncConnections)
            .where(
              and(
                eq(syncConnections.id, connection.id),
                eq(syncConnections.userId, userId),
              ),
            );
          if (linkedGradeIds.length > 0) {
            await transaction
              .delete(grades)
              .where(
                and(
                  eq(grades.userId, userId),
                  inArray(grades.id, linkedGradeIds),
                ),
              );
          }
        });
        await Promise.all(
          linkedFileIds.map((fileId) =>
            deleteFile(userId, fileId).catch(() => undefined),
          ),
        );
        providerById(connection.provider)?.forgetConnection?.(connection.id);
        return {
          ok: true,
          removedGrades: linkedGradeIds.length,
          removedFiles: linkedFileIds.length,
        };
      }),

    setGradesAuthority: protectedProcedure
      .input(connectionIdSchema)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        requireBoundConnection(connection);
        requireConnectedCredentials(connection);
        if (!connection.capabilities.includes("grades")) {
          badRequest("This connection cannot synchronize grades");
        }
        await db.transaction(async (transaction) => {
          const [freshConnection] = await transaction
            .select()
            .from(syncConnections)
            .where(
              and(
                eq(syncConnections.id, connection.id),
                eq(syncConnections.userId, userId),
              ),
            )
            .limit(1);
          if (
            !freshConnection ||
            freshConnection.updatedAt.getTime() !==
              connection.updatedAt.getTime() ||
            freshConnection.yearId !== connection.yearId ||
            !freshConnection.sealedCredentials ||
            (freshConnection.status !== "active" &&
              freshConnection.status !== "error") ||
            !freshConnection.capabilities.includes("grades")
          ) {
            badRequest("The school connection changed; reload and try again");
          }
          const sources = await transaction
            .select({
              id: syncConnections.id,
              gradesAuthority: syncConnections.gradesAuthority,
              updatedAt: syncConnections.updatedAt,
            })
            .from(syncConnections)
            .where(
              and(
                eq(syncConnections.userId, userId),
                eq(syncConnections.yearId, freshConnection.yearId),
              ),
            );
          const affectedSources = sources.filter(
            (source) =>
              source.gradesAuthority || source.id === freshConnection.id,
          );
          const mutationAt = new Date(
            Math.max(
              Date.now(),
              ...affectedSources.map(
                (source) => source.updatedAt.getTime() + 1_000,
              ),
            ),
          );
          for (const previous of affectedSources) {
            if (previous.id === freshConnection.id) continue;
            const [cleared] = await transaction
              .update(syncConnections)
              .set({ gradesAuthority: false, updatedAt: mutationAt })
              .where(
                and(
                  eq(syncConnections.id, previous.id),
                  eq(syncConnections.userId, userId),
                  eq(syncConnections.yearId, freshConnection.yearId),
                  eq(syncConnections.updatedAt, previous.updatedAt),
                ),
              )
              .returning({ id: syncConnections.id });
            if (!cleared) {
              badRequest("A grade source changed; reload and try again");
            }
          }
          const [updated] = await transaction
            .update(syncConnections)
            .set({ gradesAuthority: true, updatedAt: mutationAt })
            .where(
              and(
                eq(syncConnections.id, freshConnection.id),
                eq(syncConnections.userId, userId),
                eq(syncConnections.yearId, freshConnection.yearId),
                eq(syncConnections.updatedAt, freshConnection.updatedAt),
                inArray(syncConnections.status, ["active", "error"]),
                isNotNull(syncConnections.sealedCredentials),
              ),
            )
            .returning({ id: syncConnections.id });
          if (!updated) badRequest("The grade source could not be selected");
          await reconcileGradeAuthorityProjection(transaction, {
            userId,
            yearId: freshConnection.yearId,
            now: mutationAt,
          });
        });
        return { ok: true };
      }),
  },

  ecoledirecte: {
    begin: protectedProcedure
      .input(
        z.object({
          yearId: z.string().min(1).nullable().optional(),
          reconnectConnectionId: z.string().min(1).optional(),
          credentialInput: z.string().trim().min(1).max(16_384),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        if (input.yearId) await requireYear(userId, input.yearId);
        reserveRateLimit({
          subject: userId,
          action: "sync.ecoledirecte.begin",
          limit: 5,
          windowMs: 10 * 60_000,
        });
        await reserveDurableRateLimit({
          subject: `${userId}:ecoledirecte`,
          action: "sync.ecoledirecte.begin",
          limit: 5,
          windowMs: 10 * 60_000,
        });
        const provider = providerById("ecoledirecte");
        if (!provider?.beginCredentialInput) {
          badRequest("The ÉcoleDirecte connection flow is unavailable");
        }
        let result: Awaited<
          ReturnType<NonNullable<typeof provider.beginCredentialInput>>
        >;
        try {
          result = await provider.beginCredentialInput(
            {
              userId,
              yearId: input.yearId ?? input.reconnectConnectionId ?? "pending",
            },
            "https://api.ecoledirecte.com",
            input.credentialInput,
          );
        } catch (error) {
          inputError(error);
        }
        if (result.status === "challenge") return result;
        const created = await insertConnectionWithQuota({
          provider: "ecoledirecte",
          label: result.accountLabel,
          baseUrl: "https://api.ecoledirecte.com",
          sealedCredentials: seal(result.credentials),
          caCertPem: null,
          capabilities: provider.capabilities,
          yearId: input.yearId ?? null,
          userId,
          remoteStudentId: result.remoteStudentId ?? null,
          remoteAcademicYearId: result.remoteAcademicYearId ?? null,
          reconnectConnectionId: input.reconnectConnectionId,
        });
        return {
          status: "connected" as const,
          connection: publicConnection(created),
        };
      }),

    confirm: protectedProcedure
      .input(
        z.object({
          yearId: z.string().min(1).nullable().optional(),
          reconnectConnectionId: z.string().min(1).optional(),
          challengeId: z.string().uuid(),
          response: z.string().trim().min(1).max(500),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        if (input.yearId) await requireYear(userId, input.yearId);
        reserveRateLimit({
          subject: userId,
          action: "sync.ecoledirecte.confirm",
          limit: 10,
          windowMs: 10 * 60_000,
        });
        await reserveDurableRateLimit({
          subject: `${userId}:ecoledirecte`,
          action: "sync.ecoledirecte.confirm",
          limit: 10,
          windowMs: 10 * 60_000,
        });
        const provider = providerById("ecoledirecte");
        if (!provider?.completeCredentialChallenge) {
          badRequest("The ÉcoleDirecte verification flow is unavailable");
        }
        let result: Awaited<
          ReturnType<NonNullable<typeof provider.completeCredentialChallenge>>
        >;
        try {
          result = await provider.completeCredentialChallenge(
            {
              userId,
              yearId: input.yearId ?? input.reconnectConnectionId ?? "pending",
            },
            input.challengeId,
            input.response,
          );
        } catch (error) {
          inputError(error);
        }
        const created = await insertConnectionWithQuota({
          provider: "ecoledirecte",
          label: result.accountLabel,
          baseUrl: "https://api.ecoledirecte.com",
          sealedCredentials: seal(result.credentials),
          caCertPem: null,
          capabilities: provider.capabilities,
          yearId: input.yearId ?? null,
          userId,
          remoteStudentId: result.remoteStudentId ?? null,
          remoteAcademicYearId: result.remoteAcademicYearId ?? null,
          reconnectConnectionId: input.reconnectConnectionId,
        });
        return {
          status: "connected" as const,
          connection: publicConnection(created),
        };
      }),
  },

  academic: {
    preview: protectedProcedure
      .input(
        connectionIdSchema.extend({
          startsAt: z.date().optional(),
          endsAt: z.date().optional(),
          timezone: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .refine(isValidTimeZone, "Invalid school timezone")
            .optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        let requestedWindow: SchoolSyncWindow | undefined;
        if (input.startsAt || input.endsAt) {
          if (
            !input.startsAt ||
            !input.endsAt ||
            input.startsAt >= input.endsAt
          ) {
            badRequest("Provide a valid academic-year date range");
          }
          requestedWindow = {
            from: input.startsAt,
            to: input.endsAt,
            timezone: input.timezone ?? "Europe/Paris",
          };
        } else if (connection.yearId) {
          const year = await requireYear(userId, connection.yearId);
          requestedWindow = {
            from: year.startsAt,
            to: year.endsAt,
            timezone: "Europe/Paris",
          };
        }
        const preview = await collectGradePreview(connection, requestedWindow);
        const startYear = Number(
          isoDateInTimeZone(preview.window.from, preview.window.timezone).slice(
            0,
            4,
          ),
        );
        return {
          suggestedYear: {
            name: `${startYear}–${startYear + 1}`,
            startsAt: preview.window.from,
            endsAt: preview.window.to,
            timezone: preview.window.timezone,
            scale: 20,
            defaultOutOf: 20,
          },
          subjects: preview.subjects,
          periods: preview.periods.map(
            ({ firstGradeAt: _firstGradeAt, ...row }) => row,
          ),
          grades: {
            total: preview.grades.length,
            numeric: preview.grades.filter(
              (grade) =>
                grade.significant &&
                grade.value !== null &&
                grade.outOf !== null,
            ).length,
            nonNumeric: preview.grades.filter(
              (grade) =>
                !grade.significant ||
                grade.value === null ||
                grade.outOf === null,
            ).length,
          },
        };
      }),

    bind: protectedProcedure
      .input(
        z.discriminatedUnion("mode", [
          connectionIdSchema.extend({
            mode: z.literal("existing"),
            yearId: z.string().min(1),
          }),
          connectionIdSchema.extend({
            mode: z.literal("create"),
            name: z.string().trim().min(1).max(100),
            startsAt: z.date(),
            endsAt: z.date(),
            timezone: z
              .string()
              .trim()
              .min(1)
              .max(100)
              .refine(isValidTimeZone, "Invalid school timezone")
              .default("Europe/Paris"),
            scale: z.number().positive().max(10_000).default(20),
            defaultOutOf: z.number().positive().max(10_000).default(20),
          }),
        ]),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        requireConnectedCredentials(connection);
        if (connection.yearId) {
          if (input.mode === "existing" && connection.yearId === input.yearId) {
            return { yearId: connection.yearId, alreadyBound: true };
          }
          badRequest(
            "This school connection is already bound to an academic year",
          );
        }
        const requestedWindow: SchoolSyncWindow | undefined =
          input.mode === "create"
            ? {
                from: input.startsAt,
                to: input.endsAt,
                timezone: input.timezone,
              }
            : undefined;
        if (
          input.mode === "create" &&
          (!Number.isFinite(input.startsAt.getTime()) ||
            !Number.isFinite(input.endsAt.getTime()) ||
            input.startsAt >= input.endsAt)
        ) {
          badRequest("The academic-year date range is invalid");
        }
        const targetYear =
          input.mode === "existing"
            ? await requireYear(userId, input.yearId)
            : null;
        const preview = await collectGradePreview(
          connection,
          targetYear
            ? {
                from: targetYear.startsAt,
                to: targetYear.endsAt,
                timezone: "Europe/Paris",
              }
            : requestedWindow,
        );
        const yearId = targetYear?.id ?? newId("y");
        const now = new Date();

        const result = await db.transaction(async (transaction) => {
          const [freshConnection] = await transaction
            .select()
            .from(syncConnections)
            .where(
              and(
                eq(syncConnections.id, connection.id),
                eq(syncConnections.userId, userId),
              ),
            )
            .limit(1);
          if (
            !freshConnection ||
            freshConnection.yearId ||
            freshConnection.status !== "pending" ||
            !freshConnection.sealedCredentials ||
            freshConnection.updatedAt.getTime() !==
              connection.updatedAt.getTime()
          ) {
            badRequest("The school connection changed before it was bound");
          }

          await assertConnectionQuota(transaction, {
            userId,
            yearId,
            provider: freshConnection.provider,
            excludeConnectionId: freshConnection.id,
          });

          if (input.mode === "create") {
            await transaction.insert(years).values({
              id: yearId,
              name: input.name,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              scale: input.scale,
              defaultOutOf: input.defaultOutOf,
              passingRatio: 0.5,
              decimals: 2,
              userId,
              createdAt: now,
              updatedAt: now,
            });
          }

          let localSubjects = await transaction
            .select({ id: subjects.id, name: subjects.name })
            .from(subjects)
            .where(
              and(eq(subjects.userId, userId), eq(subjects.yearId, yearId)),
            );
          if (input.mode === "create" && preview.subjects.length > 0) {
            const createdSubjects = preview.subjects.map((subject, index) => ({
              id: newId("sub"),
              name: subject.name.slice(0, 160),
              kind: "subject",
              sortOrder: index,
              yearId,
              userId,
              createdAt: now,
              updatedAt: now,
            }));
            await transaction.insert(subjects).values(createdSubjects);
            localSubjects = createdSubjects.map(({ id, name }) => ({
              id,
              name,
            }));
          }

          let localPeriods = await transaction
            .select({ id: periods.id, name: periods.name })
            .from(periods)
            .where(and(eq(periods.userId, userId), eq(periods.yearId, yearId)))
            .orderBy(asc(periods.sortOrder));
          if (input.mode === "create" && preview.periods.length > 0) {
            const starts = preview.periods.map((period, index) =>
              index === 0
                ? input.startsAt
                : new Date(
                    Math.max(
                      input.startsAt.getTime(),
                      period.firstGradeAt.getTime(),
                    ),
                  ),
            );
            const createdPeriods = preview.periods.map((period, index) => ({
              id: newId("per"),
              name: period.name.slice(0, 160),
              startAt: starts[index]!,
              endAt:
                index + 1 < starts.length
                  ? new Date(
                      Math.max(
                        starts[index]!.getTime(),
                        starts[index + 1]!.getTime() - 1,
                      ),
                    )
                  : input.endsAt,
              isCumulative: false,
              sortOrder: index,
              yearId,
              userId,
              createdAt: now,
              updatedAt: now,
            }));
            await transaction.insert(periods).values(createdPeriods);
            localPeriods = createdPeriods.map(({ id, name }) => ({ id, name }));
          }

          const subjectsByName = new Map<string, typeof localSubjects>();
          for (const subject of localSubjects) {
            const name = normalizedAcademicName(subject.name);
            const candidates = subjectsByName.get(name) ?? [];
            candidates.push(subject);
            subjectsByName.set(name, candidates);
          }
          const periodsByName = new Map<string, typeof localPeriods>();
          for (const period of localPeriods) {
            const name = normalizedAcademicName(period.name);
            const candidates = periodsByName.get(name) ?? [];
            candidates.push(period);
            periodsByName.set(name, candidates);
          }

          for (const providerSubject of preview.subjects) {
            const candidates =
              subjectsByName.get(
                normalizedAcademicName(providerSubject.name),
              ) ?? [];
            const subjectId =
              candidates.length === 1 ? candidates[0]!.id : null;
            await transaction.insert(syncSubjectMappings).values({
              connectionId: connection.id,
              providerSubjectExternalId: providerSubject.externalId,
              providerSubjectName: providerSubject.name,
              subjectId,
              matchStatus: subjectId
                ? "mapped"
                : candidates.length > 1
                  ? "ambiguous"
                  : "unmatched",
              yearId,
              userId,
              createdAt: now,
              updatedAt: now,
            });
          }
          for (const providerPeriod of preview.periods) {
            const candidates =
              periodsByName.get(normalizedAcademicName(providerPeriod.name)) ??
              [];
            const periodId = candidates.length === 1 ? candidates[0]!.id : null;
            await transaction.insert(syncPeriodMappings).values({
              connectionId: connection.id,
              providerPeriodExternalId: providerPeriod.externalId,
              providerPeriodName: providerPeriod.name,
              periodId,
              matchStatus: periodId
                ? "mapped"
                : candidates.length > 1
                  ? "ambiguous"
                  : "unmatched",
              yearId,
              userId,
              createdAt: now,
              updatedAt: now,
            });
          }

          const [authority] = await transaction
            .select({ id: syncConnections.id })
            .from(syncConnections)
            .where(
              and(
                eq(syncConnections.userId, userId),
                eq(syncConnections.yearId, yearId),
                eq(syncConnections.gradesAuthority, true),
              ),
            )
            .limit(1);
          const remoteAcademicYearId =
            freshConnection.remoteAcademicYearId ??
            fallbackAcademicYearId(preview.window);
          if (freshConnection.remoteStudentId) {
            const duplicateSources = await transaction
              .select({ id: syncConnections.id })
              .from(syncConnections)
              .where(
                and(
                  eq(syncConnections.userId, userId),
                  eq(syncConnections.provider, freshConnection.provider),
                  eq(syncConnections.baseUrl, freshConnection.baseUrl),
                  eq(
                    syncConnections.remoteStudentId,
                    freshConnection.remoteStudentId,
                  ),
                  eq(
                    syncConnections.remoteAcademicYearId,
                    remoteAcademicYearId,
                  ),
                ),
              );
            if (
              duplicateSources.some(
                (source) => source.id !== freshConnection.id,
              )
            ) {
              badRequest(
                "This student and academic year are already linked; reconnect the existing source instead",
              );
            }
          }
          const changedAt = nextSyncConnectionVersion(
            freshConnection.updatedAt,
            now,
          );
          const [updated] = await transaction
            .update(syncConnections)
            .set({
              yearId,
              status: "active",
              remoteAcademicYearId,
              gradesAuthority:
                freshConnection.capabilities.includes("grades") && !authority,
              updatedAt: changedAt,
            })
            .where(
              and(
                eq(syncConnections.id, freshConnection.id),
                eq(syncConnections.userId, userId),
                eq(syncConnections.updatedAt, freshConnection.updatedAt),
                eq(syncConnections.status, "pending"),
                isNull(syncConnections.yearId),
                isNotNull(syncConnections.sealedCredentials),
              ),
            )
            .returning();
          if (!updated) badRequest("The school connection could not be bound");
          await reconcileGradeAuthorityProjection(transaction, {
            userId,
            yearId,
            now: changedAt,
          });
          return updated;
        });
        return {
          yearId,
          alreadyBound: false,
          connection: publicConnection(result),
          preview: {
            subjects: preview.subjects.length,
            periods: preview.periods.length,
            grades: preview.grades.length,
          },
        };
      }),
  },

  subjectMappings: {
    list: protectedProcedure
      .input(connectionIdSchema)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        requireBoundConnection(connection);
        return db
          .select({
            id: syncSubjectMappings.id,
            providerSubjectExternalId:
              syncSubjectMappings.providerSubjectExternalId,
            providerSubjectName: syncSubjectMappings.providerSubjectName,
            subjectId: syncSubjectMappings.subjectId,
            subjectName: subjects.name,
            matchStatus: syncSubjectMappings.matchStatus,
            updatedAt: syncSubjectMappings.updatedAt,
          })
          .from(syncSubjectMappings)
          .leftJoin(subjects, eq(subjects.id, syncSubjectMappings.subjectId))
          .where(
            and(
              eq(syncSubjectMappings.connectionId, connection.id),
              eq(syncSubjectMappings.userId, userId),
              eq(syncSubjectMappings.yearId, connection.yearId),
            ),
          )
          .orderBy(syncSubjectMappings.providerSubjectName);
      }),

    resolve: protectedProcedure
      .input(
        connectionIdSchema.extend({
          providerSubjectExternalId: z.string().trim().min(1).max(1_900),
          subjectId: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        requireBoundConnection(connection);
        if (!providerById(connection.provider)) {
          badRequest("The synchronization provider is unavailable");
        }
        const [subject] = await db
          .select({ id: subjects.id, name: subjects.name })
          .from(subjects)
          .where(
            and(
              eq(subjects.id, input.subjectId),
              eq(subjects.userId, userId),
              eq(subjects.yearId, connection.yearId),
              eq(subjects.kind, "subject"),
            ),
          )
          .limit(1);
        if (!subject) badRequest("The selected subject is unavailable");
        const [mapping] = await db
          .update(syncSubjectMappings)
          .set({
            subjectId: subject.id,
            matchStatus: "mapped",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(syncSubjectMappings.connectionId, connection.id),
              eq(
                syncSubjectMappings.providerSubjectExternalId,
                input.providerSubjectExternalId,
              ),
              eq(syncSubjectMappings.userId, userId),
              eq(syncSubjectMappings.yearId, connection.yearId),
            ),
          )
          .returning();
        if (!mapping) badRequest("The provider subject mapping is unavailable");
        return { ...mapping, subjectName: subject.name };
      }),
  },

  periodMappings: {
    list: protectedProcedure
      .input(connectionIdSchema)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        requireBoundConnection(connection);
        return db
          .select({
            id: syncPeriodMappings.id,
            providerPeriodExternalId:
              syncPeriodMappings.providerPeriodExternalId,
            providerPeriodName: syncPeriodMappings.providerPeriodName,
            periodId: syncPeriodMappings.periodId,
            periodName: periods.name,
            matchStatus: syncPeriodMappings.matchStatus,
            updatedAt: syncPeriodMappings.updatedAt,
          })
          .from(syncPeriodMappings)
          .leftJoin(periods, eq(periods.id, syncPeriodMappings.periodId))
          .where(
            and(
              eq(syncPeriodMappings.connectionId, connection.id),
              eq(syncPeriodMappings.userId, userId),
              eq(syncPeriodMappings.yearId, connection.yearId),
            ),
          )
          .orderBy(syncPeriodMappings.providerPeriodName);
      }),

    resolve: protectedProcedure
      .input(
        connectionIdSchema.extend({
          providerPeriodExternalId: z.string().trim().min(1).max(1_900),
          periodId: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        requireBoundConnection(connection);
        const [period] = await db
          .select({ id: periods.id, name: periods.name })
          .from(periods)
          .where(
            and(
              eq(periods.id, input.periodId),
              eq(periods.userId, userId),
              eq(periods.yearId, connection.yearId),
            ),
          )
          .limit(1);
        if (!period) badRequest("The selected period is unavailable");
        const [mapping] = await db
          .update(syncPeriodMappings)
          .set({
            periodId: period.id,
            matchStatus: "mapped",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(syncPeriodMappings.connectionId, connection.id),
              eq(
                syncPeriodMappings.providerPeriodExternalId,
                input.providerPeriodExternalId,
              ),
              eq(syncPeriodMappings.userId, userId),
              eq(syncPeriodMappings.yearId, connection.yearId),
            ),
          )
          .returning();
        if (!mapping) badRequest("The provider period mapping is unavailable");
        return { ...mapping, periodName: period.name };
      }),
  },

  gradeRecords: {
    list: protectedProcedure
      .input(
        connectionIdSchema.extend({
          state: z.enum(["managed", "missing", "dismissed"]).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const connection = await requireSyncConnection(
          userId,
          input.connectionId,
        );
        requireBoundConnection(connection);
        return db
          .select()
          .from(syncGradeRecords)
          .where(
            and(
              eq(syncGradeRecords.connectionId, connection.id),
              eq(syncGradeRecords.userId, userId),
              eq(syncGradeRecords.yearId, connection.yearId),
              input.state
                ? eq(syncGradeRecords.syncState, input.state)
                : undefined,
            ),
          )
          .orderBy(desc(syncGradeRecords.passedAt));
      }),
  },

  run: protectedProcedure
    .input(connectionIdSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const connection = await requireSyncConnection(
        userId,
        input.connectionId,
      );
      requireBoundConnection(connection);
      requireConnectedCredentials(connection);
      if (!providerById(connection.provider)) {
        badRequest("The synchronization provider is unavailable");
      }
      await reserveDurableRateLimit({
        subject: `${userId}:${connection.provider}`,
        action: "sync.run",
        limit: 12,
        windowMs: 10 * 60_000,
      });
      const job = await enqueueSyncRun(userId, connection.id);
      return { jobId: job.id, status: job.status };
    }),

  status: protectedProcedure
    .input(connectionIdSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const connection = await requireSyncConnection(
        userId,
        input.connectionId,
      );
      const [lastJob] = await db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.kind, SYNC_JOB_KIND),
            eq(
              sql<string>`json_extract(${jobs.payload}, '$.connectionId')`,
              connection.id,
            ),
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      return {
        connection: publicConnection(connection),
        lastJob: lastJob ? publicJob(lastJob) : null,
      };
    }),
};
