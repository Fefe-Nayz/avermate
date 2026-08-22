export type PlanningSyncState =
  "managed" | "detached" | "missing" | "dismissed";

export type PlanningManagementMode = "user" | "provider";

export type PlanningResourceKind = "task" | "assignment" | "event" | "lesson";

export interface PlanningManagementSource {
  sourceConnectionId: string | null;
  externalId: string | null;
  syncState: PlanningSyncState;
  provider?: string | null;
  providerLabel?: string | null;
}

export interface PlanningManagement {
  mode: PlanningManagementMode;
  syncState: PlanningSyncState;
  sourceConnectionId: string | null;
  externalId: string | null;
  provider: string | null;
  providerLabel: string | null;
  lockedFields: string[];
  editableFields: string[];
}

const EDITABLE_FIELDS = {
  task: [
    "title",
    "notes",
    "localNote",
    "startsAt",
    "scheduledAt",
    "dueAt",
    "status",
    "subjectId",
  ],
  assignment: [
    "title",
    "instructions",
    "assignedAt",
    "startsAt",
    "dueAt",
    "subjectId",
    "localNote",
    "completed",
  ],
  event: [
    "eventKind",
    "title",
    "description",
    "localNote",
    "startsAt",
    "endsAt",
    "allDay",
    "timezone",
    "location",
    "subjectId",
  ],
  lesson: [
    "title",
    "notes",
    "localNote",
    "startsAt",
    "endsAt",
    "timezone",
    "location",
    "subjectId",
    "recurrence",
    "status",
  ],
} satisfies Record<PlanningResourceKind, readonly string[]>;

const PROVIDER_EDITABLE_FIELDS = {
  task: ["localNote", "startsAt", "status"],
  assignment: ["localNote", "startsAt", "completed"],
  event: ["localNote"],
  lesson: ["localNote"],
} satisfies Record<PlanningResourceKind, readonly string[]>;

/**
 * Builds the public edit contract for a planning resource.
 *
 * Provider-owned fields remain explicit in the DTO. Clients may use this for
 * affordances, while the server independently enforces the same matrix.
 */
export function planningManagement(
  kind: PlanningResourceKind,
  source: PlanningManagementSource,
): PlanningManagement {
  const providerOwned =
    source.externalId !== null && source.syncState !== "detached";
  const allFields = [...EDITABLE_FIELDS[kind]];
  const editableFields = providerOwned
    ? [...PROVIDER_EDITABLE_FIELDS[kind]]
    : allFields;
  const editable = new Set(editableFields);
  return {
    mode: providerOwned ? "provider" : "user",
    syncState: source.syncState,
    sourceConnectionId: source.sourceConnectionId,
    externalId: source.externalId,
    provider: source.provider ?? null,
    providerLabel: source.providerLabel ?? null,
    lockedFields: allFields.filter((field) => !editable.has(field)),
    editableFields,
  };
}

export function lockedPlanningFields(
  kind: PlanningResourceKind,
  source: PlanningManagementSource,
  fields: readonly string[],
) {
  const locked = new Set(planningManagement(kind, source).lockedFields);
  return fields.filter((field) => locked.has(field));
}

export type TimetableRecurrenceFrequency = "daily" | "weekly";

/** ISO weekdays: Monday = 1, Sunday = 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface TimetableRecurrenceRule {
  frequency: TimetableRecurrenceFrequency;
  interval: number;
  weekdays: IsoWeekday[];
  startsOn: string;
  endsOn: string | null;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(value: string) {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return { year, month, day, instant };
}

function isoDate(instant: Date) {
  return [
    String(instant.getUTCFullYear()).padStart(4, "0"),
    String(instant.getUTCMonth() + 1).padStart(2, "0"),
    String(instant.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function isIsoDate(value: string) {
  try {
    dateParts(value);
    return true;
  } catch {
    return false;
  }
}

export function addIsoDays(value: string, days: number) {
  const { instant } = dateParts(value);
  instant.setUTCDate(instant.getUTCDate() + days);
  return isoDate(instant);
}

export function isoWeekday(value: string): IsoWeekday {
  const weekday = dateParts(value).instant.getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

function daysBetween(left: string, right: string) {
  return Math.floor(
    (dateParts(right).instant.getTime() - dateParts(left).instant.getTime()) /
      86_400_000,
  );
}

/**
 * Expands a bounded daily/weekly academic recurrence into local calendar
 * dates. It intentionally works on date-only values, so DST never changes the
 * weekday selected by the rule.
 */
export function expandTimetableRecurrence(
  rule: TimetableRecurrenceRule,
  from: string,
  to: string,
  maximum = 2_000,
) {
  dateParts(rule.startsOn);
  if (rule.endsOn) dateParts(rule.endsOn);
  dateParts(from);
  dateParts(to);
  if (from > to) throw new Error("The recurrence window is inverted");
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new Error("The recurrence interval must be a positive integer");
  }
  const span = daysBetween(from, to);
  if (span > 732)
    throw new Error("The recurrence window cannot exceed 732 days");

  const first = from > rule.startsOn ? from : rule.startsOn;
  const last = rule.endsOn && rule.endsOn < to ? rule.endsOn : to;
  if (first > last) return [];

  const weekdays = new Set<IsoWeekday>(
    rule.weekdays.length > 0 ? rule.weekdays : [isoWeekday(rule.startsOn)],
  );
  const dates: string[] = [];
  for (let date = first; date <= last; date = addIsoDays(date, 1)) {
    const elapsedDays = daysBetween(rule.startsOn, date);
    const occurs =
      rule.frequency === "daily"
        ? elapsedDays % rule.interval === 0
        : Math.floor(elapsedDays / 7) % rule.interval === 0 &&
          weekdays.has(isoWeekday(date));
    if (!occurs) continue;
    dates.push(date);
    if (dates.length > maximum) {
      throw new Error(`The recurrence expands beyond ${maximum} occurrences`);
    }
  }
  return dates;
}

export function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** Converts a local timetable wall time into an instant without a timezone dependency. */
export function zonedDateTimeToDate(
  date: string,
  minuteOfDay: number,
  timezone: string,
) {
  const { year, month, day } = dateParts(date);
  if (
    !Number.isInteger(minuteOfDay) ||
    minuteOfDay < 0 ||
    minuteOfDay > 1_439
  ) {
    throw new Error("The minute of day must be between 0 and 1439");
  }
  if (!isValidTimeZone(timezone))
    throw new Error(`Invalid timezone: ${timezone}`);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = new Date(desired);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const current = zonedParts(candidate, timezone);
    const represented = Date.UTC(
      current.year,
      current.month - 1,
      current.day,
      current.hour,
      current.minute,
      current.second,
    );
    const next = new Date(candidate.getTime() + desired - represented);
    if (next.getTime() === candidate.getTime()) break;
    candidate = next;
  }
  const resolved = zonedParts(candidate, timezone);
  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    throw new Error(`The local time does not exist in ${timezone}`);
  }
  return candidate;
}

export function isoDateInTimeZone(instant: Date, timezone: string) {
  if (!isValidTimeZone(timezone))
    throw new Error(`Invalid timezone: ${timezone}`);
  const { year, month, day } = zonedParts(instant, timezone);
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function zonedDayRange(date: string, timezone: string) {
  return {
    from: zonedDateTimeToDate(date, 0, timezone),
    to: new Date(
      zonedDateTimeToDate(addIsoDays(date, 1), 0, timezone).getTime() - 1,
    ),
  };
}
