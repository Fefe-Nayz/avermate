import { planningManagement } from "@avermate/core/planning";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { calendarEvents } from "../../db/schema";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import {
  assertActive,
  assertEditablePatch,
  assertManaged,
  assertWindow,
  idSchema,
  localNoteSchema,
  loadPlanningConnectionInfo,
  optionalTextSchema,
  publicEvent,
  requireCalendarEvent,
  timezoneSchema,
  titleSchema,
  validatePlanningScope,
} from "./shared";

const eventKindSchema = z.enum(["event", "block", "holiday", "workday"]);
const eventFields = {
  eventKind: eventKindSchema,
  title: titleSchema,
  description: optionalTextSchema,
  localNote: localNoteSchema,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable(),
  allDay: z.boolean(),
  timezone: timezoneSchema,
  location: z.string().trim().max(300).nullable(),
  subjectId: idSchema.nullable(),
};

const createInput = z.object({
  yearId: idSchema,
  eventKind: eventFields.eventKind.default("event"),
  title: eventFields.title,
  description: eventFields.description.default(null),
  localNote: eventFields.localNote.default(null),
  startsAt: eventFields.startsAt,
  endsAt: eventFields.endsAt.default(null),
  allDay: eventFields.allDay.default(false),
  timezone: eventFields.timezone.default("UTC"),
  location: eventFields.location.default(null),
  subjectId: eventFields.subjectId.default(null),
});

const updateInput = z
  .object({
    eventId: idSchema,
    eventKind: eventFields.eventKind.optional(),
    title: eventFields.title.optional(),
    description: eventFields.description.optional(),
    localNote: eventFields.localNote.optional(),
    startsAt: eventFields.startsAt.optional(),
    endsAt: eventFields.endsAt.optional(),
    allDay: eventFields.allDay.optional(),
    timezone: eventFields.timezone.optional(),
    location: eventFields.location.optional(),
    subjectId: eventFields.subjectId.optional(),
  })
  .refine(
    ({ eventId: _eventId, ...patch }) =>
      Object.values(patch).some((value) => value !== undefined),
    "At least one event field must change",
  );

const listInput = z
  .object({
    yearId: idSchema,
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    includeMissing: z.boolean().default(false),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "The calendar event window is inverted",
  });

export const planningEventsRouter = {
  list: protectedProcedure
    .input(listInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await validatePlanningScope({
        userId,
        yearId: input.yearId,
        subjectId: null,
      });
      const rows = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, userId),
            eq(calendarEvents.yearId, input.yearId),
            input.to ? lte(calendarEvents.startsAt, input.to) : undefined,
            input.from
              ? or(
                  gte(calendarEvents.endsAt, input.from),
                  and(
                    isNull(calendarEvents.endsAt),
                    gte(calendarEvents.startsAt, input.from),
                  ),
                )
              : undefined,
            input.includeMissing
              ? undefined
              : inArray(calendarEvents.syncState, ["managed", "detached"]),
          ),
        )
        .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.title));
      const connections = await loadPlanningConnectionInfo(userId);
      return rows.map((row) => publicEvent(row, connections));
    }),

  create: protectedProcedure
    .input(createInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await validatePlanningScope({ userId, ...input });
      assertWindow(input.startsAt, input.endsAt);
      if (input.eventKind === "block" && !input.endsAt) {
        badRequest("A calendar block requires an end time");
      }
      const [created] = await db
        .insert(calendarEvents)
        .values({ ...input, userId, syncState: "detached" })
        .returning();
      return publicEvent(created!);
    }),

  update: protectedProcedure
    .input(updateInput)
    .handler(async ({ context, input }) => {
      const { eventId, ...patch } = input;
      const userId = context.session.user.id;
      const existing = await requireCalendarEvent(userId, eventId);
      assertActive(existing, "Calendar event");
      assertEditablePatch("event", existing, patch);
      const startsAt = patch.startsAt ?? existing.startsAt;
      const endsAt =
        patch.endsAt === undefined ? existing.endsAt : patch.endsAt;
      assertWindow(startsAt, endsAt);
      const eventKind = patch.eventKind ?? existing.eventKind;
      if (eventKind === "block" && !endsAt) {
        badRequest("A calendar block requires an end time");
      }
      const subjectId =
        patch.subjectId === undefined ? existing.subjectId : patch.subjectId;
      await validatePlanningScope({
        userId,
        yearId: existing.yearId,
        subjectId,
      });
      const [updated] = await db
        .update(calendarEvents)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(calendarEvents.id, eventId),
            eq(calendarEvents.userId, userId),
          ),
        )
        .returning();
      return publicEvent(updated!);
    }),

  delete: protectedProcedure
    .input(z.object({ eventId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireCalendarEvent(userId, input.eventId);
      if (planningManagement("event", existing).mode === "provider") {
        badRequest(
          "Dismiss or detach a provider-managed event instead of deleting it",
        );
      }
      await db
        .delete(calendarEvents)
        .where(
          and(
            eq(calendarEvents.id, input.eventId),
            eq(calendarEvents.userId, userId),
          ),
        );
      return { ok: true };
    }),

  dismiss: protectedProcedure
    .input(z.object({ eventId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireCalendarEvent(userId, input.eventId);
      assertManaged(existing, "Calendar event");
      const [updated] = await db
        .update(calendarEvents)
        .set({ syncState: "dismissed", updatedAt: new Date() })
        .where(
          and(
            eq(calendarEvents.id, input.eventId),
            eq(calendarEvents.userId, userId),
          ),
        )
        .returning();
      return publicEvent(updated!);
    }),

  detach: protectedProcedure
    .input(z.object({ eventId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireCalendarEvent(userId, input.eventId);
      assertManaged(existing, "Calendar event");
      const now = new Date();
      const detached = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(calendarEvents)
          .values({
            eventKind: existing.eventKind,
            title: existing.title,
            description: existing.description,
            localNote: existing.localNote,
            startsAt: existing.startsAt,
            endsAt: existing.endsAt,
            allDay: existing.allDay,
            timezone: existing.timezone,
            location: existing.location,
            subjectId: existing.subjectId,
            yearId: existing.yearId,
            userId,
            syncState: "detached",
          })
          .returning();
        await tx
          .update(calendarEvents)
          .set({ syncState: "dismissed", updatedAt: now })
          .where(
            and(
              eq(calendarEvents.id, input.eventId),
              eq(calendarEvents.userId, userId),
            ),
          );
        return created!;
      });
      return publicEvent(detached);
    }),
};
