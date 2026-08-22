import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  files,
  gradeComponents,
  gradeAttachments,
  grades,
  gradeTypes,
  periods,
  subjects,
  syncConnections,
  syncGradeRecords,
} from "../db/schema";
import { badRequest, notFound, protectedProcedure } from "../lib/orpc";
import { assertSameYear } from "../lib/domain-integrity";
import { uniqueGradeTypeIdsByName } from "../lib/grade-type-remap";
import { newId } from "../lib/id";
import { reconcileGradeAuthorityProjection } from "../sync/grade-authority";
import {
  gradeComponentInputSchema,
  gradeCreateInputSchema,
  gradePatchInputSchema,
} from "../lib/academic-input-schemas";
import {
  requireGrade,
  requirePeriod,
  requireSubject,
  requireYear,
} from "../lib/ownership";
import { deleteFile, fileAccessUrl, resolveIncomingFile } from "../lib/storage";

/**
 * The type this result belongs to, or nothing.
 *
 * Checked against the *year* rather than only against the owner: a type from last year on
 * this year's result would group a card by a template that is not part of this contract.
 * A stranger's id and a deleted one both come back as `null` — a result with no type is a
 * perfectly ordinary result, so there is nothing here worth refusing over.
 */
async function resolveTypeId(
  userId: string,
  yearId: string,
  typeId: string | null | undefined,
): Promise<string | null> {
  if (!typeId) return null;
  const [row] = await db
    .select({ id: gradeTypes.id })
    .from(gradeTypes)
    .where(
      and(
        eq(gradeTypes.id, typeId),
        eq(gradeTypes.userId, userId),
        eq(gradeTypes.yearId, yearId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Weighted roll-up of a composite grade, expressed on `outOf` points. */
function rollUp(
  components: Array<z.infer<typeof gradeComponentInputSchema>>,
  outOf: number,
): number {
  let weighted = 0;
  let total = 0;
  for (const component of components) {
    if (component.outOf <= 0) continue;
    if (component.value > component.outOf) {
      badRequest("A grade component cannot be worth more than its maximum");
    }
    const coefficient = component.coefficient > 0 ? component.coefficient : 0;
    if (coefficient === 0) continue;
    weighted += (component.value / component.outOf) * coefficient;
    total += coefficient;
  }
  if (total === 0) return 0;
  return (weighted / total) * outOf;
}

/** The period a date belongs to, when the user did not pick one. */
async function inferPeriod(
  yearId: string,
  passedAt: Date,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(periods)
    .where(eq(periods.yearId, yearId))
    .orderBy(asc(periods.sortOrder), asc(periods.startAt), asc(periods.id));

  const time = passedAt.getTime();
  const matches = rows.filter(
    (period) =>
      time >= period.startAt.getTime() && time <= period.endAt.getTime(),
  );
  if (matches.length === 0) return null;
  const specific = matches.filter((period) => !period.isCumulative);
  return (specific[0] ?? matches[0])?.id ?? null;
}

async function attachmentRows(userId: string, gradeId: string) {
  const rows = await db
    .select({
      id: gradeAttachments.id,
      label: gradeAttachments.label,
      sortOrder: gradeAttachments.sortOrder,
      createdAt: gradeAttachments.createdAt,
      file: {
        id: files.id,
        provider: files.provider,
        storageKey: files.storageKey,
        url: files.url,
        mimeType: files.mimeType,
        byteSize: files.byteSize,
      },
    })
    .from(gradeAttachments)
    .innerJoin(files, eq(files.id, gradeAttachments.fileId))
    .where(
      and(eq(gradeAttachments.gradeId, gradeId), eq(files.status, "stored")),
    )
    .orderBy(asc(gradeAttachments.sortOrder), asc(gradeAttachments.createdAt));
  return Promise.all(
    rows.map(async (row) => {
      const { provider, storageKey, url, ...file } = row.file;
      return {
        ...row,
        file: {
          ...file,
          url: await fileAccessUrl(
            { provider, storageKey, url },
            { expiresIn: "6h" },
          ),
        },
      };
    }),
  );
}

const PROVIDER_LOCKED_GRADE_FIELDS = [
  "name",
  "value",
  "outOf",
  "coefficient",
  "passedAt",
  "subjectId",
  "periodId",
  "components",
] as const;

const PROVIDER_EDITABLE_GRADE_FIELDS = [
  "bonus",
  "note",
  "typeId",
  "excludedFromAverage",
] as const;

async function gradeSource(userId: string, gradeId: string) {
  const [source] = await db
    .select({
      id: syncGradeRecords.id,
      syncState: syncGradeRecords.syncState,
      externalId: syncGradeRecords.externalId,
      provider: syncConnections.provider,
      providerLabel: syncConnections.label,
      connectionStatus: syncConnections.status,
      gradesAuthority: syncConnections.gradesAuthority,
      sourceValue: syncGradeRecords.value,
      sourceOutOf: syncGradeRecords.outOf,
      significant: syncGradeRecords.significant,
    })
    .from(syncGradeRecords)
    .innerJoin(
      syncConnections,
      eq(syncConnections.id, syncGradeRecords.connectionId),
    )
    .where(
      and(
        eq(syncGradeRecords.localGradeId, gradeId),
        eq(syncGradeRecords.userId, userId),
      ),
    )
    .limit(1);
  return source ?? null;
}

function gradeManagement(
  source: Awaited<ReturnType<typeof gradeSource>> | null,
) {
  return source
    ? {
        mode: "provider" as const,
        syncState: source.syncState,
        externalId: source.externalId,
        provider: source.provider,
        providerLabel: source.providerLabel,
        connectionStatus: source.connectionStatus,
        gradesAuthority: source.gradesAuthority,
        sourceValue: source.sourceValue,
        sourceOutOf: source.sourceOutOf,
        significant: source.significant,
        lockedFields: [...PROVIDER_LOCKED_GRADE_FIELDS],
        editableFields: [...PROVIDER_EDITABLE_GRADE_FIELDS],
      }
    : {
        mode: "user" as const,
        syncState: "detached" as const,
        externalId: null,
        provider: null,
        providerLabel: null,
        connectionStatus: null,
        gradesAuthority: false,
        sourceValue: null,
        sourceOutOf: null,
        significant: true,
        lockedFields: [] as string[],
        editableFields: [
          ...PROVIDER_LOCKED_GRADE_FIELDS,
          ...PROVIDER_EDITABLE_GRADE_FIELDS,
        ],
      };
}

function providerFieldChanged(
  field: (typeof PROVIDER_LOCKED_GRADE_FIELDS)[number],
  patch: Record<string, unknown>,
  existing: typeof grades.$inferSelect,
) {
  if (!(field in patch)) return false;
  if (field === "components") {
    // Components are provider-owned as a whole. Even an empty array is a
    // mutation because it would delete every existing component below.
    return patch.components !== undefined;
  }
  if (field === "passedAt") {
    return (
      (patch.passedAt as Date | undefined)?.getTime() !==
      existing.passedAt.getTime()
    );
  }
  return patch[field] !== existing[field as keyof typeof existing];
}

export const gradesRouter = {
  get: protectedProcedure
    .input(z.object({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const grade = await requireGrade(context.session.user.id, input.gradeId);
      const components = await db
        .select()
        .from(gradeComponents)
        .where(eq(gradeComponents.gradeId, grade.id))
        .orderBy(gradeComponents.sortOrder);
      const source = await gradeSource(context.session.user.id, grade.id);
      return { ...grade, components, management: gradeManagement(source) };
    }),

  recent: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        limit: z.number().int().min(1).max(50).default(5),
      }),
    )
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      return db
        .select({
          id: grades.id,
          name: grades.name,
          value: grades.value,
          outOf: grades.outOf,
          coefficient: grades.coefficient,
          excludedFromAverage: grades.excludedFromAverage,
          syncExcludedFromAverage: grades.syncExcludedFromAverage,
          passedAt: grades.passedAt,
          subjectId: grades.subjectId,
          subjectName: subjects.name,
          sourceProvider: syncConnections.provider,
          sourceLabel: syncConnections.label,
          syncState: syncGradeRecords.syncState,
        })
        .from(grades)
        .innerJoin(subjects, eq(grades.subjectId, subjects.id))
        .leftJoin(
          syncGradeRecords,
          eq(syncGradeRecords.localGradeId, grades.id),
        )
        .leftJoin(
          syncConnections,
          eq(syncConnections.id, syncGradeRecords.connectionId),
        )
        .where(eq(grades.yearId, input.yearId))
        .orderBy(desc(grades.passedAt), desc(grades.createdAt))
        .limit(input.limit);
    }),

  attachments: protectedProcedure
    .input(z.object({ gradeId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      await requireGrade(context.session.user.id, input.gradeId);
      return attachmentRows(context.session.user.id, input.gradeId);
    }),

  attachCopy: protectedProcedure
    .input(
      z
        .object({
          gradeId: z.string().min(1),
          file: z.instanceof(File).optional(),
          fileId: z.string().min(1).optional(),
          fileName: z.string().trim().max(160).optional(),
          label: z.string().trim().max(120).optional(),
        })
        .refine((input) => Boolean(input.file) !== Boolean(input.fileId), {
          message: "Provide exactly one copy upload",
        }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireGrade(userId, input.gradeId);
      const existing = await db
        .select({ sortOrder: gradeAttachments.sortOrder })
        .from(gradeAttachments)
        .where(eq(gradeAttachments.gradeId, input.gradeId));
      if (existing.length >= 10) {
        badRequest("A grade can have at most 10 copy attachments");
      }

      const stored = await resolveIncomingFile({
        userId,
        purpose: "grade-copy",
        file: input.file,
        fileId: input.fileId,
        nameHint: input.fileName ?? input.file?.name,
      });
      try {
        const [created] = await db
          .insert(gradeAttachments)
          .values({
            gradeId: input.gradeId,
            fileId: stored.id,
            label:
              input.label?.trim() ||
              input.fileName?.trim().slice(0, 120) ||
              input.file?.name.trim().slice(0, 120) ||
              null,
            sortOrder: existing.reduce(
              (maximum, row) => Math.max(maximum, row.sortOrder + 1),
              0,
            ),
            userId,
          })
          .returning({ id: gradeAttachments.id });
        if (!created) badRequest("The copy attachment could not be saved");
        const rows = await attachmentRows(userId, input.gradeId);
        const result = rows.find((row) => row.id === created.id);
        if (!result) badRequest("The copy attachment could not be loaded");
        return result;
      } catch (error) {
        await deleteFile(userId, stored.id).catch(() => undefined);
        throw error;
      }
    }),

  removeCopy: protectedProcedure
    .input(z.object({ attachmentId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [attachment] = await db
        .select()
        .from(gradeAttachments)
        .where(
          and(
            eq(gradeAttachments.id, input.attachmentId),
            eq(gradeAttachments.userId, userId),
          ),
        )
        .limit(1);
      if (!attachment) notFound("Grade attachment");
      await db
        .delete(gradeAttachments)
        .where(eq(gradeAttachments.id, attachment.id));
      await deleteFile(userId, attachment.fileId);
      return { ok: true };
    }),

  create: protectedProcedure
    .input(gradeCreateInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const subject = await requireSubject(userId, input.subjectId);
      if (input.periodId) {
        const period = await requirePeriod(userId, input.periodId);
        assertSameYear("Period", subject.yearId, period.yearId);
      }

      const isComposite = input.components.length > 0;
      const value = isComposite
        ? rollUp(input.components, input.outOf)
        : input.value;
      if (value > input.outOf) {
        badRequest("A grade cannot be worth more than its maximum");
      }

      const periodId =
        input.periodId ?? (await inferPeriod(subject.yearId, input.passedAt));

      const gradeId = newId("gra");
      const insertGrade = db.insert(grades).values({
        id: gradeId,
        name: input.name,
        value,
        outOf: input.outOf,
        coefficient: input.coefficient,
        excludedFromAverage: input.excludedFromAverage,
        bonus: input.bonus,
        note: input.note,
        isComposite,
        passedAt: input.passedAt,
        subjectId: subject.id,
        periodId,
        typeId: await resolveTypeId(userId, subject.yearId, input.typeId),
        yearId: subject.yearId,
        userId,
      });
      const insertComponents = isComposite
        ? [
            db.insert(gradeComponents).values(
              input.components.map((component, index) => ({
                gradeId,
                name: component.name,
                value: component.value,
                outOf: component.outOf,
                coefficient: component.coefficient,
                sortOrder: index,
                userId,
              })),
            ),
          ]
        : [];
      const statements = [insertGrade, ...insertComponents];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );

      const [created] = await db
        .select()
        .from(grades)
        .where(eq(grades.id, gradeId))
        .limit(1);
      if (!created) badRequest("The grade could not be saved");
      return { ...created, management: gradeManagement(null) };
    }),

  update: protectedProcedure
    .input(gradePatchInputSchema.extend({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { gradeId, components, ...patch } = input;
      const existing = await requireGrade(userId, gradeId);
      const source = await gradeSource(userId, gradeId);
      if (source) {
        const requested = { ...patch, components } as Record<string, unknown>;
        const changed = PROVIDER_LOCKED_GRADE_FIELDS.filter((field) =>
          providerFieldChanged(field, requested, existing),
        );
        if (changed.length > 0) {
          badRequest(
            `Detach this provider grade before changing: ${changed.join(", ")}`,
          );
        }

        // Never echo provider-owned facts from the earlier read back into the
        // row. A synchronization may update those facts concurrently; this
        // narrow write changes only the explicitly supported local overlays.
        const providerOverlay = {
          ...(patch.bonus !== undefined ? { bonus: patch.bonus } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
          ...(patch.excludedFromAverage !== undefined
            ? { excludedFromAverage: patch.excludedFromAverage }
            : {}),
          ...(patch.typeId !== undefined
            ? {
                typeId: await resolveTypeId(
                  userId,
                  existing.yearId,
                  patch.typeId,
                ),
              }
            : {}),
          updatedAt: new Date(),
        };
        const [updated] = await db
          .update(grades)
          .set(providerOverlay)
          .where(and(eq(grades.id, gradeId), eq(grades.userId, userId)))
          .returning();
        if (!updated) notFound("Grade");
        return {
          ...updated,
          management: gradeManagement(await gradeSource(userId, updated.id)),
        };
      }

      let yearId = existing.yearId;
      if (patch.subjectId) {
        const subject = await requireSubject(userId, patch.subjectId);
        yearId = subject.yearId;
      }
      let periodId = existing.periodId;
      if (patch.periodId) {
        const period = await requirePeriod(userId, patch.periodId);
        assertSameYear("Period", yearId, period.yearId);
        periodId = period.id;
      } else if (patch.periodId === null) {
        periodId = null;
      } else if (yearId !== existing.yearId) {
        periodId = await inferPeriod(
          yearId,
          patch.passedAt ?? existing.passedAt,
        );
      } else if (periodId) {
        // Protect old/imported rows as they are edited, rather than carrying a
        // pre-existing cross-year reference forward forever.
        const period = await requirePeriod(userId, periodId);
        assertSameYear("Period", yearId, period.yearId);
      }

      const outOf = patch.outOf ?? existing.outOf;
      let value = patch.value ?? existing.value;
      let isComposite = existing.isComposite;

      if (components !== undefined) {
        isComposite = components.length > 0;
        if (isComposite) {
          value = rollUp(components, outOf);
        }
      }

      if (value > outOf) {
        badRequest("A grade cannot be worth more than its maximum");
      }

      const requestedTypeId =
        patch.typeId === undefined ? existing.typeId : patch.typeId;

      const updateGrade = db
        .update(grades)
        .set({
          ...patch,
          value,
          outOf,
          isComposite,
          yearId,
          periodId,
          // Re-checked against the year rather than trusted from the patch, and re-checked
          // *again* when the result moves to another year's subject: a type belongs to one
          // year's contract, and a result that crosses years leaves its type behind.
          ...(patch.typeId !== undefined || yearId !== existing.yearId
            ? {
                typeId: await resolveTypeId(userId, yearId, requestedTypeId),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(grades.id, gradeId));

      if (components === undefined) {
        await updateGrade;
      } else {
        const deleteComponents = db
          .delete(gradeComponents)
          .where(eq(gradeComponents.gradeId, gradeId));
        const insertComponents = isComposite
          ? [
              db.insert(gradeComponents).values(
                components.map((component, index) => ({
                  gradeId,
                  name: component.name,
                  value: component.value,
                  outOf: component.outOf,
                  coefficient: component.coefficient,
                  sortOrder: index,
                  userId,
                })),
              ),
            ]
          : [];
        const statements = [deleteComponents, ...insertComponents, updateGrade];
        await db.batch(
          statements as [
            (typeof statements)[number],
            ...(typeof statements)[number][],
          ],
        );
      }

      const [updated] = await db
        .select()
        .from(grades)
        .where(eq(grades.id, gradeId))
        .limit(1);
      return updated
        ? { ...updated, management: gradeManagement(source) }
        : updated;
    }),

  /** Bulk reassignment used by the grades table's multi-select. */
  reassign: protectedProcedure
    .input(
      z.object({
        gradeIds: z
          .array(z.string())
          .min(1)
          .max(200)
          .refine((ids) => new Set(ids).size === ids.length, {
            message: "Each grade may only be selected once",
          }),
        subjectId: z.string().optional(),
        periodId: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const target = input.subjectId
        ? await requireSubject(userId, input.subjectId)
        : null;
      const selectedPeriod = input.periodId
        ? await requirePeriod(userId, input.periodId)
        : null;

      const selectedGrades = await db
        .select()
        .from(grades)
        .where(
          and(eq(grades.userId, userId), inArray(grades.id, input.gradeIds)),
        );
      if (selectedGrades.length !== input.gradeIds.length) {
        badRequest("At least one selected grade is unavailable");
      }
      const managedSelections = await db
        .select({ localGradeId: syncGradeRecords.localGradeId })
        .from(syncGradeRecords)
        .where(
          and(
            eq(syncGradeRecords.userId, userId),
            inArray(syncGradeRecords.localGradeId, input.gradeIds),
          ),
        );
      if (managedSelections.length > 0) {
        badRequest("Detach provider grades before reassigning them");
      }
      /**
       * The kinds of assessment the destination year has, when the year changes.
       *
       * A type is local to a year — the same table as the subjects it labels — so a
       * grade carried across kept a `typeId` its new year does not hold: grouped under a
       * kind absent from every picker, and still counted against the old year's type.
       *
       * Resolved by name rather than cleared outright, and by name rather than by id,
       * because "DS" in one year and "DS" in the next are the same kind of assessment to
       * the person who wrote them. No match means no type: a label is preserved where it
       * still means something, and never invented.
       */
      const destinationTypes = target
        ? await db
            .select({ id: gradeTypes.id, name: gradeTypes.name })
            .from(gradeTypes)
            .where(eq(gradeTypes.yearId, target.yearId))
        : [];
      const typeByName = uniqueGradeTypeIdsByName(destinationTypes);
      const sourceTypes = new Map(
        (
          await db
            .select({ id: gradeTypes.id, name: gradeTypes.name })
            .from(gradeTypes)
            .where(eq(gradeTypes.userId, userId))
        ).map((type) => [type.id, type.name]),
      );

      const updates = await Promise.all(
        selectedGrades.map(async (grade) => {
          const yearId = target?.yearId ?? grade.yearId;
          if (selectedPeriod)
            assertSameYear("Period", yearId, selectedPeriod.yearId);
          const changesYear = Boolean(target && target.yearId !== grade.yearId);
          return {
            grade,
            typeId: !changesYear
              ? grade.typeId
              : grade.typeId
                ? (typeByName.get(
                    (sourceTypes.get(grade.typeId) ?? "")
                      .trim()
                      .toLocaleLowerCase(),
                  ) ?? null)
                : null,
            changesYear,
            periodId:
              input.periodId !== undefined
                ? input.periodId
                : target && target.yearId !== grade.yearId
                  ? await inferPeriod(target.yearId, grade.passedAt)
                  : grade.periodId,
          };
        }),
      );
      await db.transaction(async (tx) => {
        for (const update of updates) {
          const rows = await tx
            .update(grades)
            .set({
              ...(target
                ? { subjectId: target.id, yearId: target.yearId }
                : {}),
              ...(update.changesYear ? { typeId: update.typeId } : {}),
              periodId: update.periodId,
              updatedAt: new Date(),
            })
            .where(
              and(eq(grades.id, update.grade.id), eq(grades.userId, userId)),
            )
            .returning({ id: grades.id });
          if (rows.length !== 1) {
            throw new Error("A selected grade changed during reassignment");
          }
        }
      });

      return { ok: true, count: input.gradeIds.length };
    }),

  dismissManaged: protectedProcedure
    .input(z.object({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireGrade(userId, input.gradeId);
      const source = await gradeSource(userId, input.gradeId);
      if (!source) badRequest("This grade is not managed by a school service");
      await db.transaction(async (transaction) => {
        await transaction
          .update(syncGradeRecords)
          .set({ syncState: "dismissed", updatedAt: new Date() })
          .where(
            and(
              eq(syncGradeRecords.id, source.id),
              eq(syncGradeRecords.userId, userId),
            ),
          );
        await transaction
          .update(grades)
          .set({ syncExcludedFromAverage: true, updatedAt: new Date() })
          .where(and(eq(grades.id, input.gradeId), eq(grades.userId, userId)));
      });
      return { ok: true };
    }),

  restoreManaged: protectedProcedure
    .input(z.object({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireGrade(userId, input.gradeId);
      await db.transaction(async (transaction) => {
        const [source] = await transaction
          .select({
            id: syncGradeRecords.id,
            syncState: syncGradeRecords.syncState,
            yearId: syncGradeRecords.yearId,
          })
          .from(syncGradeRecords)
          .where(
            and(
              eq(syncGradeRecords.localGradeId, input.gradeId),
              eq(syncGradeRecords.userId, userId),
            ),
          )
          .limit(1);
        if (!source) {
          badRequest("This grade is not managed by a school service");
        }
        if (source.syncState !== "dismissed") {
          badRequest("Only an ignored provider grade can be restored");
        }
        const [restored] = await transaction
          .update(syncGradeRecords)
          .set({ syncState: "managed", updatedAt: new Date() })
          .where(
            and(
              eq(syncGradeRecords.id, source.id),
              eq(syncGradeRecords.userId, userId),
              eq(syncGradeRecords.syncState, "dismissed"),
            ),
          )
          .returning({ id: syncGradeRecords.id });
        if (!restored) {
          badRequest("The provider grade changed before it was restored");
        }
        await reconcileGradeAuthorityProjection(transaction, {
          userId,
          yearId: source.yearId,
        });
      });
      return { ok: true };
    }),

  detachManaged: protectedProcedure
    .input(z.object({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireGrade(userId, input.gradeId);
      const source = await gradeSource(userId, input.gradeId);
      if (!source) badRequest("This grade is already personal");
      const [components, attachments] = await Promise.all([
        db
          .select()
          .from(gradeComponents)
          .where(eq(gradeComponents.gradeId, existing.id))
          .orderBy(gradeComponents.sortOrder),
        db
          .select()
          .from(gradeAttachments)
          .where(eq(gradeAttachments.gradeId, existing.id))
          .orderBy(gradeAttachments.sortOrder),
      ]);
      const detachedId = newId("gra");
      const now = new Date();
      await db.transaction(async (transaction) => {
        await transaction.insert(grades).values({
          id: detachedId,
          name: existing.name,
          value: existing.value,
          outOf: existing.outOf,
          coefficient: existing.coefficient,
          bonus: existing.bonus,
          isComposite: existing.isComposite,
          excludedFromAverage: existing.excludedFromAverage,
          syncExcludedFromAverage: false,
          note: existing.note,
          passedAt: existing.passedAt,
          subjectId: existing.subjectId,
          periodId: existing.periodId,
          typeId: existing.typeId,
          yearId: existing.yearId,
          userId,
          createdAt: now,
          updatedAt: now,
        });
        if (components.length > 0) {
          await transaction.insert(gradeComponents).values(
            components.map((component) => ({
              id: newId("gc"),
              gradeId: detachedId,
              name: component.name,
              value: component.value,
              outOf: component.outOf,
              coefficient: component.coefficient,
              sortOrder: component.sortOrder,
              userId,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
        if (attachments.length > 0) {
          await transaction.insert(gradeAttachments).values(
            attachments.map((attachment) => ({
              id: newId("gatt"),
              gradeId: detachedId,
              fileId: attachment.fileId,
              label: attachment.label,
              sortOrder: attachment.sortOrder,
              userId,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
        await transaction
          .update(syncGradeRecords)
          .set({ syncState: "dismissed", updatedAt: now })
          .where(
            and(
              eq(syncGradeRecords.id, source.id),
              eq(syncGradeRecords.userId, userId),
            ),
          );
        await transaction
          .delete(grades)
          .where(and(eq(grades.id, existing.id), eq(grades.userId, userId)));
      });
      const detached = await requireGrade(userId, detachedId);
      return { ...detached, management: gradeManagement(null) };
    }),

  delete: protectedProcedure
    .input(z.object({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireGrade(userId, input.gradeId);
      if (await gradeSource(userId, input.gradeId)) {
        badRequest("Dismiss or detach a provider-managed grade instead");
      }
      const attached = await db
        .select({ fileId: gradeAttachments.fileId })
        .from(gradeAttachments)
        .where(eq(gradeAttachments.gradeId, input.gradeId));
      await db.delete(grades).where(eq(grades.id, input.gradeId));
      await Promise.all(
        attached.map(({ fileId }) =>
          deleteFile(userId, fileId).catch(() => undefined),
        ),
      );
      return { ok: true };
    }),
};
