import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  addIsoDays,
  isoDateInTimeZone,
  zonedDateTimeToDate,
} from "@avermate/core/planning";
import { and, eq, ne } from "drizzle-orm";
import * as pawnote from "pawnote";
import { z } from "zod";
import { db } from "../db";
import { syncConnections } from "../db/schema";
import { seal } from "../lib/crypto";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "./errors";
import {
  fetchSafeProviderText,
  isPublicProviderAddress,
  throwIfProviderAborted,
  type ProviderFetch,
  type ProviderLookup,
} from "./provider-network";
import type {
  OpenConnection,
  ProviderRequestOptions,
  SyncProvider,
} from "./provider";
import {
  assertSchoolSyncWindow,
  normalizeSchoolTimezone,
  type ProviderGrade,
  type ProviderHomework,
  type ProviderListOptions,
  type ProviderSchoolCalendarEvent,
  type ProviderSubjectRef,
  type ProviderTimetableLesson,
  type SchoolProviderAdapter,
} from "./school-provider";

const PRONOTE_RESPONSE_BYTES = 16 * 1024 * 1024;

const credentialInputSchema = z
  .object({
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1_024),
    kind: z.enum(["student", "parent", "teacher"]).default("student"),
    resourceIndex: z.number().int().min(0).max(100).default(0),
    deviceUuid: z.string().trim().min(1).max(200).optional(),
    deviceName: z.string().trim().min(1).max(30).default("Avermate"),
    pin: z.string().trim().min(4).max(64).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const storedCredentialV1Schema = z
  .object({
    version: z.literal(1),
    username: z.string().trim().min(1).max(320),
    token: z.string().min(1).max(8_192),
    kind: z.union([z.literal(6), z.literal(7), z.literal(8)]),
    resourceIndex: z.number().int().min(0).max(100),
    deviceUuid: z.string().trim().min(1).max(200),
    navigatorIdentifier: z.string().trim().min(1).max(1_024),
    timezone: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const storedCredentialV2Schema = storedCredentialV1Schema.extend({
  version: z.literal(2),
  resourceId: z.string().trim().min(1).max(1_024),
});

const storedCredentialsSchema = z.union([
  storedCredentialV2Schema,
  storedCredentialV1Schema,
]);

type StoredPronoteCredentials = z.infer<typeof storedCredentialsSchema>;
type PronoteSession = ReturnType<typeof pawnote.createSessionHandle>;

export interface PronoteSdk {
  AccountKind: typeof pawnote.AccountKind;
  GradeKind: typeof pawnote.GradeKind;
  TabLocation: typeof pawnote.TabLocation;
  createSessionHandle: typeof pawnote.createSessionHandle;
  loginCredentials: typeof pawnote.loginCredentials;
  loginToken: typeof pawnote.loginToken;
  use: typeof pawnote.use;
  securityCheckPIN: typeof pawnote.securityCheckPIN;
  securitySave: typeof pawnote.securitySave;
  securitySource: typeof pawnote.securitySource;
  finishLoginManually: typeof pawnote.finishLoginManually;
  assignmentsFromIntervals: typeof pawnote.assignmentsFromIntervals;
  timetableFromIntervals: typeof pawnote.timetableFromIntervals;
  gradesOverview: typeof pawnote.gradesOverview;
}

export interface PronoteDependencies {
  sdk?: PronoteSdk;
  fetch?: ProviderFetch;
  lookup?: ProviderLookup;
  persistCredentials?: (
    connection: OpenConnection,
    credentials: string,
  ) => Promise<void>;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The PRONOTE synchronization was aborted");
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfProviderAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortError(signal));
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? abortError(signal) : error);
      },
    );
  });
}

function providerError(
  error: unknown,
  operation: string,
  signal?: AbortSignal,
): never {
  if (signal?.aborted) throw abortError(signal);
  if (
    error instanceof NonRetryableSyncError ||
    error instanceof RetryableSyncError
  ) {
    throw error;
  }
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (
    [
      "BadCredentialsError",
      "AccessDeniedError",
      "AccountDisabledError",
      "AuthenticateError",
      "SecurityError",
      "SessionExpiredError",
    ].includes(name)
  ) {
    throw new CredentialsRevokedSyncError(
      name === "SecurityError"
        ? "PRONOTE no longer recognizes this device; reconnect the account"
        : "PRONOTE rejected the connection credentials",
      { cause: error },
    );
  }
  if (
    [
      "RateLimitedError",
      "BusyPageError",
      "PageUnavailableError",
      "ServerSideError",
      "SuspendedIPError",
      "UnreachableError",
    ].includes(name)
  ) {
    throw new RetryableSyncError(
      `PRONOTE ${operation} is temporarily unavailable`,
      {
        cause: error,
      },
    );
  }
  throw new RetryableSyncError(`PRONOTE ${operation} failed`, {
    cause: error,
  });
}

function securityHandle(error: unknown) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("handle" in error) ||
    typeof error.handle !== "object" ||
    error.handle === null
  ) {
    return null;
  }
  return error.handle as pawnote.SecurityModal;
}

function parseCredentialInput(input: string) {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("Enter the PRONOTE credentials as valid JSON");
  }
  const parsed = credentialInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Enter a PRONOTE username, password, account kind, and student account number",
    );
  }
  return parsed.data;
}

function openCredentials(connection: Pick<OpenConnection, "credentials">) {
  let value: unknown;
  try {
    value = JSON.parse(connection.credentials);
  } catch {
    throw new NonRetryableSyncError(
      "The sealed PRONOTE credentials are invalid",
    );
  }
  const parsed = storedCredentialsSchema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "The sealed PRONOTE credentials are invalid",
    );
  }
  return parsed.data;
}

export function normalizePronoteBaseUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid PRONOTE URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname
  ) {
    throw new Error("PRONOTE connections require a public HTTPS URL");
  }
  if (isIP(url.hostname) && !isPublicProviderAddress(url.hostname)) {
    throw new Error("PRONOTE connections cannot target a private network");
  }
  const parts = url.pathname.split("/");
  if (parts.at(-1)?.toLowerCase().endsWith(".html")) parts.pop();
  url.pathname = parts.join("/").replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

function kindValue(
  sdk: PronoteSdk,
  kind: z.infer<typeof credentialInputSchema>["kind"],
) {
  if (kind === "parent") return sdk.AccountKind.PARENT;
  if (kind === "teacher") return sdk.AccountKind.TEACHER;
  return sdk.AccountKind.STUDENT;
}

function createPawnoteFetcher(
  baseUrl: string,
  dependencies: Pick<PronoteDependencies, "fetch" | "lookup">,
  signal?: AbortSignal,
): Parameters<typeof pawnote.createSessionHandle>[0] {
  const expectedOrigin = new URL(baseUrl).origin;
  return async (request) => {
    const response = await fetchSafeProviderText(
      request.url,
      {
        body: request.content,
        headers: request.headers,
        method: request.method,
        redirect: request.redirect,
      },
      {
        expectedOrigin,
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        maxResponseBytes: PRONOTE_RESPONSE_BYTES,
        signal,
      },
    );
    if (response.status === 429 || response.status >= 500) {
      throw new RetryableSyncError("PRONOTE is temporarily unavailable");
    }
    if (response.status === 401 || response.status === 403) {
      throw new CredentialsRevokedSyncError(
        "PRONOTE no longer accepts the stored credentials; reconnect the account",
      );
    }
    if (response.status >= 400) {
      throw new NonRetryableSyncError(
        `PRONOTE rejected the request (HTTP ${response.status})`,
      );
    }
    return {
      status: response.status,
      headers: response.headers,
      content: response.content,
    };
  };
}

interface SelectedPronoteResource {
  resource: pawnote.UserResource;
  resourceId: string;
  index: number;
}

function selectResource(
  sdk: PronoteSdk,
  session: PronoteSession,
  identity: {
    resourceIndex: number;
    resourceId?: string;
  },
): SelectedPronoteResource {
  let resourceIndex = identity.resourceIndex;
  if (identity.resourceId) {
    const matches = session.user.resources.flatMap((resource, index) =>
      resource.id.trim() === identity.resourceId ? [{ resource, index }] : [],
    );
    if (matches.length === 0) {
      throw new CredentialsRevokedSyncError(
        "The selected PRONOTE student account no longer exists",
      );
    }
    if (matches.length > 1) {
      throw new CredentialsRevokedSyncError(
        "PRONOTE returned an ambiguous selected student account; reconnect the account",
      );
    }
    resourceIndex = matches[0]!.index;
  }
  const resource = session.user.resources[resourceIndex];
  if (!resource) {
    throw new CredentialsRevokedSyncError(
      "The selected PRONOTE student account does not exist",
    );
  }
  const resourceId = resource.id.trim();
  if (!resourceId) {
    throw new CredentialsRevokedSyncError(
      "PRONOTE did not return a stable identity for the selected student account",
    );
  }
  sdk.use(session, resourceIndex);
  return { resource, resourceId, index: resourceIndex };
}

async function finishSecurityChallenge(
  sdk: PronoteSdk,
  session: PronoteSession,
  handle: pawnote.SecurityModal,
  input: z.infer<typeof credentialInputSchema>,
  signal?: AbortSignal,
) {
  if (handle.shouldCustomPassword) {
    throw new NonRetryableSyncError(
      "PRONOTE requires a password change in the official portal before connecting",
    );
  }
  if (handle.shouldCustomDoubleAuth) {
    throw new NonRetryableSyncError(
      "Choose a PRONOTE double-authentication method in the official portal before connecting",
    );
  }
  if (handle.shouldEnterPIN) {
    if (!input.pin) {
      throw new NonRetryableSyncError(
        "PRONOTE requires the account PIN for this new device",
      );
    }
    const valid = await awaitWithSignal(
      sdk.securityCheckPIN(session, input.pin),
      signal,
    );
    if (!valid) {
      throw new NonRetryableSyncError("PRONOTE rejected the account PIN");
    }
  }
  if (handle.shouldEnterSource) {
    await awaitWithSignal(
      sdk.securitySource(session, input.deviceName),
      signal,
    );
  }
  await awaitWithSignal(
    sdk.securitySave(session, handle, {
      deviceName: input.deviceName,
      ...(handle.shouldEnterPIN && input.pin ? { pin: input.pin } : {}),
    }),
    signal,
  );
  return awaitWithSignal(
    sdk.finishLoginManually(
      session,
      handle.context.authentication,
      handle.context.identity,
      handle.context.initialUsername,
    ),
    signal,
  );
}

function storedCredentials(
  refresh: pawnote.RefreshInformation,
  deviceUuid: string,
  selection: SelectedPronoteResource,
  timezone?: string,
): StoredPronoteCredentials {
  return storedCredentialsSchema.parse({
    version: 2,
    username: refresh.username,
    token: refresh.token,
    kind: refresh.kind,
    resourceIndex: selection.index,
    resourceId: selection.resourceId,
    deviceUuid,
    navigatorIdentifier: refresh.navigatorIdentifier,
    ...(timezone ? { timezone: normalizeSchoolTimezone(timezone) } : {}),
  });
}

function plainText(value: string | null | undefined) {
  const result = (value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return result || null;
}

function subjectRef(subject: pawnote.Subject | undefined) {
  const name = subject?.name.trim();
  if (!subject || !name) return null;
  return {
    externalId: subject.id || name,
    name,
  } satisfies ProviderSubjectRef;
}

function validDate(value: Date | null | undefined) {
  return value && Number.isFinite(value.getTime()) ? value : null;
}

function localDateParts(date: Date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  };
}

function isoDateFromLocalParts(date: Date) {
  const { year, month, day } = localDateParts(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Pawnote decodes PRONOTE wall-clock values with the host process' local Date
 * constructors. Reinterpret those components in the school's IANA timezone
 * before anything is persisted or compared with an absolute sync window.
 */
export function pronoteSdkDateToSchoolInstant(
  value: Date | null | undefined,
  timezone: string,
) {
  const date = validDate(value);
  if (!date) return null;
  const parts = localDateParts(date);
  try {
    const minuteInstant = zonedDateTimeToDate(
      isoDateFromLocalParts(date),
      parts.hour * 60 + parts.minute,
      timezone,
    );
    return new Date(
      minuteInstant.getTime() + parts.second * 1_000 + parts.millisecond,
    );
  } catch {
    return null;
  }
}

/**
 * Pawnote also reads request Dates through local getters. Build a Date whose
 * host-local components are the wall-clock components of the requested school
 * instant, so its week and interval encoders query the intended school days.
 */
export function schoolInstantToPronoteSdkDate(instant: Date, timezone: string) {
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
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const expected = {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
    millisecond: instant.getUTCMilliseconds(),
  };
  const sdkDate = new Date(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
    expected.millisecond,
  );
  const represented = localDateParts(sdkDate);
  if (
    Object.entries(expected).some(
      ([key, value]) => represented[key as keyof typeof represented] !== value,
    )
  ) {
    throw new NonRetryableSyncError(
      "The server timezone cannot represent this PRONOTE school wall time",
    );
  }
  return sdkDate;
}

export async function persistPronoteCredentials(
  connection: OpenConnection,
  credentials: string,
) {
  if (!connection.credentialRevision) {
    throw new NonRetryableSyncError(
      "The PRONOTE credential revision is unavailable",
    );
  }
  const nextRevision = seal(credentials);
  const [updated] = await db
    .update(syncConnections)
    .set({ sealedCredentials: nextRevision })
    .where(
      and(
        eq(syncConnections.id, connection.id),
        eq(syncConnections.userId, connection.userId),
        eq(syncConnections.provider, "pronote"),
        eq(syncConnections.sealedCredentials, connection.credentialRevision),
        ne(syncConnections.status, "revoked"),
      ),
    )
    .returning({ id: syncConnections.id });
  if (!updated) {
    throw new RetryableSyncError(
      "The PRONOTE credentials changed concurrently; retry synchronization",
    );
  }
  connection.credentialRevision = nextRevision;
  connection.credentials = credentials;
}

export function createPronoteProvider(
  dependencies: PronoteDependencies = {},
): SyncProvider & { school: SchoolProviderAdapter } {
  const sdk = dependencies.sdk ?? pawnote;
  const persistCredentials =
    dependencies.persistCredentials ?? persistPronoteCredentials;
  const sessions = new WeakMap<OpenConnection, Promise<PronoteSession>>();
  const homeworkCache = new WeakMap<
    OpenConnection,
    Promise<ProviderHomework[]>
  >();
  const timetableCache = new WeakMap<
    OpenConnection,
    Promise<ProviderTimetableLesson[]>
  >();

  async function connectedSession(
    connection: OpenConnection,
    options: ProviderRequestOptions = {},
  ) {
    const cached = sessions.get(connection);
    if (cached) return cached;
    const pending = (async () => {
      const credentials = openCredentials(connection);
      const baseUrl = normalizePronoteBaseUrl(connection.baseUrl);
      const session = sdk.createSessionHandle(
        createPawnoteFetcher(baseUrl, dependencies, options.signal),
      );
      let refresh: pawnote.RefreshInformation;
      try {
        refresh = await awaitWithSignal(
          sdk.loginToken(session, {
            url: baseUrl,
            username: credentials.username,
            token: credentials.token,
            kind: credentials.kind,
            deviceUUID: credentials.deviceUuid,
            navigatorIdentifier: credentials.navigatorIdentifier,
          }),
          options.signal,
        );
      } catch (error) {
        providerError(error, "authentication", options.signal);
      }
      const selection = selectResource(sdk, session, credentials);
      const refreshed = storedCredentials(
        refresh,
        credentials.deviceUuid,
        selection,
        credentials.timezone,
      );
      const serialized = JSON.stringify(refreshed);
      if (serialized !== JSON.stringify(credentials)) {
        await persistCredentials(connection, serialized);
      }
      return session;
    })();
    sessions.set(connection, pending);
    pending.catch(() => sessions.delete(connection));
    return pending;
  }

  async function listHomework(
    connection: OpenConnection,
    options: ProviderListOptions,
  ) {
    assertSchoolSyncWindow(options.window);
    const cached = homeworkCache.get(connection);
    if (cached) return cached;
    const pending = (async () => {
      const session = await connectedSession(connection, options);
      let values: pawnote.Assignment[];
      try {
        values = await awaitWithSignal(
          sdk.assignmentsFromIntervals(
            session,
            schoolInstantToPronoteSdkDate(
              options.window.from,
              options.window.timezone,
            ),
            schoolInstantToPronoteSdkDate(
              options.window.to,
              options.window.timezone,
            ),
          ),
          options.signal,
        );
      } catch (error) {
        providerError(error, "homework discovery", options.signal);
      }
      return values.flatMap((assignment): ProviderHomework[] => {
        const dueAt = pronoteSdkDateToSchoolInstant(
          assignment.deadline,
          options.window.timezone,
        );
        if (!dueAt) return [];
        const subject = subjectRef(assignment.subject);
        return [
          {
            externalId: assignment.id,
            title: `Travail à faire — ${subject?.name ?? "PRONOTE"}`.slice(
              0,
              160,
            ),
            instructions: plainText(assignment.description),
            assignedAt: null,
            dueAt,
            subject,
            completedUpstream: assignment.done,
            attachments: [],
            modifiedAt: null,
          },
        ];
      });
    })();
    homeworkCache.set(connection, pending);
    pending.catch(() => homeworkCache.delete(connection));
    return pending;
  }

  async function listTimetable(
    connection: OpenConnection,
    options: ProviderListOptions,
  ) {
    assertSchoolSyncWindow(options.window);
    const cached = timetableCache.get(connection);
    if (cached) return cached;
    const pending = (async () => {
      const session = await connectedSession(connection, options);
      let timetable: pawnote.Timetable;
      try {
        timetable = await awaitWithSignal(
          sdk.timetableFromIntervals(
            session,
            schoolInstantToPronoteSdkDate(
              options.window.from,
              options.window.timezone,
            ),
            schoolInstantToPronoteSdkDate(
              options.window.to,
              options.window.timezone,
            ),
          ),
          options.signal,
        );
      } catch (error) {
        providerError(error, "timetable discovery", options.signal);
      }
      return timetable.classes.flatMap((item): ProviderTimetableLesson[] => {
        const startsAt = pronoteSdkDateToSchoolInstant(
          item.startDate,
          options.window.timezone,
        );
        const endsAt = pronoteSdkDateToSchoolInstant(
          item.endDate,
          options.window.timezone,
        );
        if (!startsAt || !endsAt || endsAt <= startsAt) return [];
        const subject = item.is === "lesson" ? subjectRef(item.subject) : null;
        const title =
          item.is === "lesson"
            ? subject?.name || "Cours PRONOTE"
            : item.title?.trim() ||
              (item.is === "detention" ? "Retenue" : "Activité");
        const locations =
          item.is === "lesson" || item.is === "detention"
            ? item.classrooms
            : [];
        return [
          {
            externalId: `${item.is}:${item.id}`,
            title: title.slice(0, 160),
            notes: plainText(item.notes),
            startsAt,
            endsAt,
            timezone: options.window.timezone,
            location: locations.join(", ").trim().slice(0, 300) || null,
            subject,
            cancelled: item.is === "lesson" ? item.canceled : false,
            modifiedAt: null,
          },
        ];
      });
    })();
    timetableCache.set(connection, pending);
    pending.catch(() => timetableCache.delete(connection));
    return pending;
  }

  const school: SchoolProviderAdapter = {
    id: "pronote",
    timezone(connection) {
      return normalizeSchoolTimezone(openCredentials(connection).timezone);
    },
    completeWindowFacets: [
      "homework",
      "timetable",
      "grades",
      "school-calendar",
    ],
    facets: {
      homework: { list: listHomework },
      timetable: { list: listTimetable },
      grades: {
        async list(connection, options) {
          assertSchoolSyncWindow(options.window);
          const session = await connectedSession(connection, options);
          const gradeTab = session.userResource.tabs.get(
            sdk.TabLocation.Grades,
          );
          const periods = gradeTab?.periods ?? [];
          const result: ProviderGrade[] = [];
          for (const period of periods) {
            const periodStart = pronoteSdkDateToSchoolInstant(
              period.startDate,
              options.window.timezone,
            );
            const periodEnd = pronoteSdkDateToSchoolInstant(
              period.endDate,
              options.window.timezone,
            );
            if (
              !periodStart ||
              !periodEnd ||
              periodEnd < options.window.from ||
              periodStart > options.window.to
            ) {
              continue;
            }
            let overview: pawnote.GradesOverview;
            try {
              overview = await awaitWithSignal(
                sdk.gradesOverview(session, period),
                options.signal,
              );
            } catch (error) {
              providerError(error, "grade discovery", options.signal);
            }
            for (const grade of overview.grades) {
              const passedAt = pronoteSdkDateToSchoolInstant(
                grade.date,
                options.window.timezone,
              );
              const subject = subjectRef(grade.subject);
              if (
                !passedAt ||
                !subject ||
                passedAt < options.window.from ||
                passedAt > options.window.to
              ) {
                continue;
              }
              result.push({
                externalId: grade.id,
                title:
                  grade.comment.trim().slice(0, 160) ||
                  `Note — ${subject.name}`,
                subject,
                periodExternalId: period.id,
                periodName: period.name,
                passedAt,
                value:
                  grade.value.kind === sdk.GradeKind.Grade &&
                  Number.isFinite(grade.value.points)
                    ? grade.value.points
                    : null,
                outOf:
                  grade.outOf.kind === sdk.GradeKind.Grade &&
                  Number.isFinite(grade.outOf.points)
                    ? grade.outOf.points
                    : null,
                coefficient:
                  Number.isFinite(grade.coefficient) && grade.coefficient > 0
                    ? grade.coefficient
                    : 1,
                significant: grade.value.kind === sdk.GradeKind.Grade,
                modifiedAt: null,
              });
            }
          }
          return result;
        },
      },
      "school-calendar": {
        async list(connection, options) {
          assertSchoolSyncWindow(options.window);
          const [session, timetable] = await Promise.all([
            connectedSession(connection, options),
            listTimetable(connection, options),
          ]);
          const events: ProviderSchoolCalendarEvent[] = [];
          for (const holiday of session.instance.holidays ?? []) {
            const rawStart = validDate(holiday.startDate);
            const rawEnd = validDate(holiday.endDate);
            if (!rawStart || !rawEnd) continue;
            const startDate = isoDateFromLocalParts(rawStart);
            const endDate = isoDateFromLocalParts(rawEnd);
            const startsAt = zonedDateTimeToDate(
              startDate,
              0,
              options.window.timezone,
            );
            const endsAt = zonedDateTimeToDate(
              addIsoDays(endDate, 1),
              0,
              options.window.timezone,
            );
            if (startsAt > options.window.to || endsAt < options.window.from) {
              continue;
            }
            events.push({
              externalId: `holiday:${holiday.id}`,
              kind: "holiday",
              title: holiday.name.trim().slice(0, 160) || "Vacances scolaires",
              description: null,
              startsAt,
              // Local all-day events use an inclusive end instant. Midnight
              // of the following day would make the UI paint one extra day.
              endsAt: new Date(endsAt.getTime() - 1),
              allDay: true,
              timezone: options.window.timezone,
              location: null,
              modifiedAt: null,
            });
          }
          const workdays = new Set(
            timetable
              .filter((lesson) => !lesson.cancelled)
              .map((lesson) =>
                isoDateInTimeZone(lesson.startsAt, options.window.timezone),
              ),
          );
          for (const date of workdays) {
            events.push({
              externalId: `workday:${date}`,
              kind: "workday",
              title: "Journée de cours",
              description: null,
              startsAt: zonedDateTimeToDate(date, 0, options.window.timezone),
              endsAt: null,
              allDay: true,
              timezone: options.window.timezone,
              location: null,
              modifiedAt: null,
            });
          }
          return events;
        },
      },
    },
  };

  return {
    id: "pronote",
    capabilities: ["homework", "timetable", "grades", "school-calendar"],
    school,
    normalizeBaseUrl: normalizePronoteBaseUrl,
    async parseCredentialInput(baseUrl, rawInput, options) {
      if (options?.caCertPem) {
        throw new Error("PRONOTE does not support a custom CA certificate");
      }
      const normalizedBaseUrl = normalizePronoteBaseUrl(baseUrl);
      const input = parseCredentialInput(rawInput);
      const timezone = normalizeSchoolTimezone(input.timezone);
      const deviceUuid = input.deviceUuid ?? randomUUID();
      const session = sdk.createSessionHandle(
        createPawnoteFetcher(normalizedBaseUrl, dependencies, options?.signal),
      );
      let refresh: pawnote.RefreshInformation;
      try {
        refresh = await awaitWithSignal(
          sdk.loginCredentials(session, {
            url: normalizedBaseUrl,
            username: input.username,
            password: input.password,
            kind: kindValue(sdk, input.kind),
            deviceUUID: deviceUuid,
          }),
          options?.signal,
        );
      } catch (error) {
        const handle = securityHandle(error);
        if (!handle) providerError(error, "authentication", options?.signal);
        try {
          refresh = await finishSecurityChallenge(
            sdk,
            session,
            handle,
            input,
            options?.signal,
          );
        } catch (securityError) {
          providerError(securityError, "device verification", options?.signal);
        }
      }
      const selection = selectResource(sdk, session, {
        resourceIndex: input.resourceIndex,
      });
      return {
        credentials: JSON.stringify(
          storedCredentials(refresh, deviceUuid, selection, timezone),
        ),
        accountLabel:
          selection.resource.name.trim().slice(0, 160) ||
          selection.resource.establishmentName.trim().slice(0, 160) ||
          "PRONOTE",
        remoteStudentId: selection.resourceId,
      };
    },
    async listCourses() {
      return [];
    },
    async listFiles() {
      return [];
    },
    async download() {
      throw new NonRetryableSyncError(
        "PRONOTE files are not advertised until their authenticated download boundary is persisted",
      );
    },
  };
}

export const pronoteProvider = createPronoteProvider();
