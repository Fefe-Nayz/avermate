import { and, eq, ne } from "drizzle-orm";
import axios, {
  isAxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";
import {
  BASE_URL,
  OID_CLIENT_ID,
  OID_CLIENT_SECRET,
  Skolengo,
} from "scolengo-api";
import type { AgendaResponse } from "scolengo-api/types/models/Calendar";
import type { HomeworkAssignment } from "scolengo-api/types/models/Calendar/HomeworkAssignment";
import type { User } from "scolengo-api/types/models/Common/User";
import type { Evaluation } from "scolengo-api/types/models/Results/Evaluation";
import type { EvaluationSettings } from "scolengo-api/types/models/Results/EvaluationSettings";
import type { School } from "scolengo-api/types/models/School/School";
import type { TokenSetParameters } from "openid-client";
import { z } from "zod";
import {
  isoDateInTimeZone,
  zonedDateTimeToDate,
} from "@avermate/core/planning";
import { db } from "../db";
import { syncConnections } from "../db/schema";
import { seal } from "../lib/crypto";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "./errors";
import {
  assertPublicProviderUrl,
  fetchSafeProviderText,
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

const SKOLENGO_API_ORIGIN = new URL(BASE_URL).origin;
const SKOLENGO_API_PATH = new URL(BASE_URL).pathname.replace(/\/+$/, "");
const SKOLENGO_RESPONSE_BYTES = 16 * 1024 * 1024;
const SKOLENGO_REQUEST_TIMEOUT_MS = 20_000;
const OIDC_RESPONSE_BYTES = 512 * 1024;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const tokenSetSchema = z
  .object({
    access_token: z.string().min(1).max(65_536),
    id_token: z.string().min(1).max(65_536),
    refresh_token: z.string().min(1).max(65_536),
    token_type: z.string().trim().min(1).max(32).default("Bearer"),
    expires_at: z.number().int().positive().optional(),
    scope: z.string().trim().min(1).max(2_048).optional(),
    session_state: z.string().trim().min(1).max(8_192).optional(),
  })
  .strip();

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();

const schoolSchema = z
  .object({
    id: z.string().trim().min(1).max(300),
    name: z.string().trim().min(1).max(500).optional(),
    addressLine1: nullableText(500),
    addressLine2: nullableText(500),
    addressLine3: nullableText(500),
    zipCode: nullableText(32),
    city: nullableText(200),
    country: nullableText(200),
    homePageUrl: nullableText(2_048),
    timeZone: nullableText(100),
    emsCode: z.string().trim().min(1).max(200),
    emsOIDCWellKnownUrl: z.url().max(2_048),
  })
  .strip();

const credentialInputSchema = z
  .object({
    tokenSet: tokenSetSchema,
    school: schoolSchema,
    studentId: z.string().trim().min(1).max(300).optional(),
  })
  .strip();

const oidcMetadataSchema = z
  .object({
    issuer: z.url().max(2_048),
    token_endpoint: z.url().max(2_048),
    token_endpoint_auth_methods_supported: z
      .array(z.string().max(100))
      .max(30)
      .optional(),
  })
  .passthrough();

const officialSchoolResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1).max(300),
        type: z.literal("school"),
        attributes: schoolSchema.omit({ id: true }),
      }),
    )
    .max(100),
});

const storedCredentialsSchema = z
  .object({
    version: z.literal(1),
    school: schoolSchema,
    tokenSet: tokenSetSchema,
    targetStudentId: z.string().trim().min(1).max(300),
    oidc: z
      .object({
        discoveryUrl: z.url().max(2_048),
        issuer: z.url().max(2_048),
        tokenEndpoint: z.url().max(2_048),
        tokenEndpointAuthMethod: z.enum([
          "client_secret_basic",
          "client_secret_post",
        ]),
      })
      .strict(),
  })
  .strict();

type StoredSkolengoCredentials = z.infer<typeof storedCredentialsSchema>;

export interface SkolengoClient {
  getUserInfo(userId?: string): Promise<User>;
  getAgenda(
    studentId: string | undefined,
    startDate: string,
    endDate: string,
    limit?: number,
    offset?: number,
  ): Promise<AgendaResponse>;
  getHomeworkAssignments(
    studentId: string | undefined,
    startDate: string,
    endDate: string,
    limit?: number,
    offset?: number,
  ): Promise<HomeworkAssignment[]>;
  getEvaluationSettings(
    studentId?: string,
    limit?: number,
    offset?: number,
  ): Promise<EvaluationSettings[]>;
  getEvaluation(
    studentId: string | undefined,
    periodId: string,
    limit?: number,
    offset?: number,
  ): Promise<Evaluation[]>;
}

export interface SkolengoClientRuntime {
  school: School;
  tokenSet: TokenSetParameters;
  httpClient: AxiosInstance;
  refreshToken: (tokenSet: TokenSetParameters) => Promise<TokenSetParameters>;
}

export interface SkolengoDependencies {
  createClient?: (runtime: SkolengoClientRuntime) => SkolengoClient;
  fetch?: ProviderFetch;
  lookup?: ProviderLookup;
  /** Contract-test seam; production keeps a 20-second total request budget. */
  apiRequestTimeoutMs?: number;
  persistCredentials?: (
    connection: OpenConnection,
    credentials: string,
  ) => Promise<void>;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The Skolengo synchronization was aborted");
}

function providerRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs = SKOLENGO_REQUEST_TIMEOUT_MS,
) {
  const deadline = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, deadline]) : deadline;
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
  const status =
    isAxiosError(error) && error.response
      ? error.response.status
      : typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : null;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (
    status === 401 ||
    status === 403 ||
    ["BLOCKED_ACCOUNT", "SKO_APP_NOT_SUBSCRIBED", "SUSPENDED_ACCOUNT"].includes(
      code,
    )
  ) {
    throw new CredentialsRevokedSyncError(
      "Skolengo rejected the connection credentials or account access",
      { cause: error },
    );
  }
  if (
    status === 408 ||
    status === 429 ||
    (status !== null && status >= 500) ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ERR_NETWORK" ||
    code === "PRONOTE_RESOURCES_NOT_READY"
  ) {
    throw new RetryableSyncError(
      `Skolengo ${operation} is temporarily unavailable`,
      { cause: error },
    );
  }
  throw new RetryableSyncError(`Skolengo ${operation} failed`, {
    cause: error,
  });
}

function parseCredentialInput(input: string) {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("Paste the Skolengo OIDC bundle as valid JSON");
  }
  const parsed = credentialInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      "Paste the complete tokenSet and school bundle generated by scolengo-token",
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
      "The sealed Skolengo credentials are invalid",
    );
  }
  const parsed = storedCredentialsSchema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "The sealed Skolengo credentials are invalid",
    );
  }
  return parsed.data;
}

export function normalizeSkolengoBaseUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter the official Skolengo API URL");
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname.toLowerCase() !== "api.skolengo.com" ||
    (path !== "/" && path !== SKOLENGO_API_PATH)
  ) {
    throw new Error("Skolengo connections require the official HTTPS API");
  }
  return BASE_URL;
}

function discoveryUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("The Skolengo OIDC discovery URL must use public HTTPS");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname.endsWith("/.well-known")) {
    url.pathname += "/openid-configuration";
  } else if (!url.pathname.endsWith("/.well-known/openid-configuration")) {
    url.pathname += "/.well-known/openid-configuration";
  }
  return url.href;
}

async function discoverOidc(
  input: string,
  dependencies: Pick<
    SkolengoDependencies,
    "fetch" | "lookup" | "apiRequestTimeoutMs"
  >,
  signal?: AbortSignal,
) {
  const documentUrl = discoveryUrl(input);
  let response;
  try {
    response = await fetchSafeProviderText(
      documentUrl,
      { headers: { accept: "application/json" } },
      {
        expectedOrigin: new URL(documentUrl).origin,
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        maxRedirects: 0,
        maxResponseBytes: OIDC_RESPONSE_BYTES,
        signal,
        timeoutMs: dependencies.apiRequestTimeoutMs,
      },
    );
  } catch (error) {
    providerError(error, "OIDC discovery", signal);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableSyncError(
      "Skolengo OIDC discovery is temporarily unavailable",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new NonRetryableSyncError(
      "The Skolengo OIDC discovery document was rejected",
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(response.content);
  } catch {
    throw new NonRetryableSyncError(
      "The Skolengo OIDC discovery document is invalid",
    );
  }
  const parsed = oidcMetadataSchema.safeParse(document);
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "The Skolengo OIDC discovery document is incomplete",
    );
  }
  const issuer = new URL(parsed.data.issuer);
  const tokenEndpoint = new URL(parsed.data.token_endpoint);
  const validationSignal = providerRequestSignal(
    signal,
    dependencies.apiRequestTimeoutMs,
  );
  try {
    await awaitWithSignal(
      Promise.all([
        assertPublicProviderUrl(issuer, { lookup: dependencies.lookup }),
        assertPublicProviderUrl(tokenEndpoint, {
          lookup: dependencies.lookup,
        }),
      ]),
      validationSignal,
    );
  } catch (error) {
    providerError(error, "OIDC endpoint validation", signal);
  }
  if (
    issuer.origin !== new URL(documentUrl).origin ||
    tokenEndpoint.origin !== issuer.origin
  ) {
    throw new NonRetryableSyncError(
      "The Skolengo OIDC token endpoint leaves the approved identity-provider origin",
    );
  }
  const methods = parsed.data.token_endpoint_auth_methods_supported;
  const tokenEndpointAuthMethod =
    !methods || methods.includes("client_secret_basic")
      ? "client_secret_basic"
      : methods.includes("client_secret_post")
        ? "client_secret_post"
        : null;
  if (!tokenEndpointAuthMethod) {
    throw new NonRetryableSyncError(
      "The Skolengo identity provider does not support the required token authentication",
    );
  }
  return {
    discoveryUrl: documentUrl,
    issuer: issuer.href.replace(/\/$/, ""),
    tokenEndpoint: tokenEndpoint.href,
    tokenEndpointAuthMethod,
  } as const;
}

async function verifyOfficialSchool(
  claimed: z.infer<typeof schoolSchema>,
  dependencies: Pick<SkolengoDependencies, "fetch" | "lookup">,
  signal?: AbortSignal,
) {
  if (!claimed.name) {
    throw new NonRetryableSyncError(
      "The Skolengo bundle must include the official school name",
    );
  }
  const url = new URL(`${BASE_URL}/schools`);
  url.searchParams.set("page[limit]", "100");
  url.searchParams.set("page[offset]", "0");
  url.searchParams.set("filter[text]", claimed.name);
  let response;
  try {
    response = await fetchSafeProviderText(
      url,
      { headers: { accept: "application/vnd.api+json, application/json" } },
      {
        expectedOrigin: SKOLENGO_API_ORIGIN,
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        maxRedirects: 0,
        maxResponseBytes: 1024 * 1024,
        signal,
      },
    );
  } catch (error) {
    providerError(error, "official school verification", signal);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableSyncError(
      "The official Skolengo school catalog is temporarily unavailable",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new NonRetryableSyncError(
      "The official Skolengo school catalog rejected the request",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(response.content);
  } catch {
    throw new NonRetryableSyncError(
      "The official Skolengo school catalog returned invalid data",
    );
  }
  const parsed = officialSchoolResponseSchema.safeParse(value);
  const official = parsed.success
    ? parsed.data.data.find((school) => school.id === claimed.id)
    : undefined;
  if (!official) {
    throw new NonRetryableSyncError(
      "The school in the Skolengo bundle was not found in the official catalog",
    );
  }
  const school = schoolSchema.parse({
    id: official.id,
    ...official.attributes,
  });
  if (
    school.emsCode !== claimed.emsCode ||
    discoveryUrl(school.emsOIDCWellKnownUrl) !==
      discoveryUrl(claimed.emsOIDCWellKnownUrl)
  ) {
    throw new NonRetryableSyncError(
      "The Skolengo identity-provider metadata does not match the official school catalog",
    );
  }
  return school;
}

function apiRequestUrl(config: InternalAxiosRequestConfig) {
  const rawUrl = config.url ?? "";
  if (/^[a-z][a-z\d+.-]*:/i.test(rawUrl)) {
    throw new NonRetryableSyncError(
      "Skolengo refused an absolute SDK request URL",
    );
  }
  return new URL(
    `${BASE_URL.replace(/\/+$/, "")}/${rawUrl.replace(/^\/+/, "")}`,
  );
}

function createApiHttpClient(
  dependencies: Pick<SkolengoDependencies, "lookup" | "apiRequestTimeoutMs">,
  signal?: AbortSignal,
) {
  const requestTimeoutMs =
    dependencies.apiRequestTimeoutMs ?? SKOLENGO_REQUEST_TIMEOUT_MS;
  const httpClient = axios.create({
    baseURL: BASE_URL,
    timeout: requestTimeoutMs,
    maxRedirects: 0,
    maxContentLength: SKOLENGO_RESPONSE_BYTES,
    maxBodyLength: SKOLENGO_RESPONSE_BYTES,
    proxy: false,
    signal,
  });
  httpClient.interceptors.request.use(async (config) => {
    const requestSignal = providerRequestSignal(signal, requestTimeoutMs);
    throwIfProviderAborted(requestSignal);
    config.signal = requestSignal;
    const target = apiRequestUrl(config);
    if (
      target.origin !== SKOLENGO_API_ORIGIN ||
      (target.pathname !== SKOLENGO_API_PATH &&
        !target.pathname.startsWith(`${SKOLENGO_API_PATH}/`))
    ) {
      throw new NonRetryableSyncError(
        "Skolengo refused to send credentials outside the official API",
      );
    }
    await awaitWithSignal(
      assertPublicProviderUrl(target, {
        expectedOrigin: SKOLENGO_API_ORIGIN,
        lookup: dependencies.lookup,
      }),
      requestSignal,
    );
    config.baseURL = BASE_URL;
    config.maxRedirects = 0;
    config.maxContentLength = SKOLENGO_RESPONSE_BYTES;
    config.maxBodyLength = SKOLENGO_RESPONSE_BYTES;
    // Axios' `timeout` becomes an inactivity timeout after response headers in
    // Node. A fresh AbortSignal.timeout per SDK request remains a total
    // wall-clock deadline through JSON body consumption, including a trickle.
    return config;
  });
  return httpClient;
}

function formValue(value: string) {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

async function refreshOidcToken(
  credentials: StoredSkolengoCredentials,
  dependencies: Pick<SkolengoDependencies, "fetch" | "lookup">,
  signal?: AbortSignal,
) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credentials.tokenSet.refresh_token,
  });
  if (credentials.oidc.tokenEndpointAuthMethod === "client_secret_basic") {
    headers.authorization = `Basic ${Buffer.from(
      `${formValue(OID_CLIENT_ID)}:${formValue(OID_CLIENT_SECRET)}`,
    ).toString("base64")}`;
  } else {
    body.set("client_id", OID_CLIENT_ID);
    body.set("client_secret", OID_CLIENT_SECRET);
  }
  let response;
  try {
    response = await fetchSafeProviderText(
      credentials.oidc.tokenEndpoint,
      {
        body: body.toString(),
        headers,
        method: "POST",
        redirect: "manual",
      },
      {
        expectedOrigin: new URL(credentials.oidc.issuer).origin,
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        maxRedirects: 0,
        maxResponseBytes: OIDC_RESPONSE_BYTES,
        signal,
      },
    );
  } catch (error) {
    providerError(error, "token refresh", signal);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableSyncError(
      "Skolengo token refresh is temporarily unavailable",
    );
  }
  if (
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403
  ) {
    throw new CredentialsRevokedSyncError(
      "The Skolengo refresh token is no longer accepted; reconnect the account",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new NonRetryableSyncError(
      "The Skolengo token endpoint rejected the refresh request",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(response.content);
  } catch {
    throw new NonRetryableSyncError(
      "The Skolengo token endpoint returned an invalid response",
    );
  }
  const parsed = z
    .object({
      access_token: z.string().min(1).max(65_536),
      id_token: z.string().min(1).max(65_536).optional(),
      refresh_token: z.string().min(1).max(65_536).optional(),
      token_type: z.string().trim().min(1).max(32).optional(),
      expires_at: z.number().int().positive().optional(),
      expires_in: z.number().int().positive().optional(),
      scope: z.string().trim().min(1).max(2_048).optional(),
      session_state: z.string().trim().min(1).max(8_192).optional(),
    })
    .strip()
    .safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "The Skolengo token endpoint returned an incomplete response",
    );
  }
  return tokenSetSchema.parse({
    ...credentials.tokenSet,
    ...parsed.data,
    expires_at:
      parsed.data.expires_at ??
      (parsed.data.expires_in
        ? Math.floor(Date.now() / 1_000) + parsed.data.expires_in
        : credentials.tokenSet.expires_at),
  });
}

export async function persistSkolengoCredentials(
  connection: OpenConnection,
  credentials: string,
) {
  if (!connection.credentialRevision) {
    throw new NonRetryableSyncError(
      "The Skolengo credential revision is unavailable",
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
        eq(syncConnections.provider, "skolengo"),
        eq(syncConnections.sealedCredentials, connection.credentialRevision),
        ne(syncConnections.status, "revoked"),
      ),
    )
    .returning({ id: syncConnections.id });
  if (!updated) {
    throw new RetryableSyncError(
      "The Skolengo credentials changed concurrently; retry synchronization",
    );
  }
  connection.credentialRevision = nextRevision;
  connection.credentials = credentials;
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

function subjectRef(subject: { id: string; label: string } | undefined) {
  const name = subject?.label.trim();
  if (!subject || !name) return null;
  return {
    externalId: subject.id || name,
    name,
  } satisfies ProviderSubjectRef;
}

function validDateTime(value: string | null | undefined, timezone: string) {
  if (!value) return null;
  const local =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (local) {
    const hour = Number(local[2]);
    const minute = Number(local[3]);
    if (hour > 23 || minute > 59) return null;
    try {
      return zonedDateTimeToDate(local[1]!, hour * 60 + minute, timezone);
    } catch {
      return null;
    }
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dueDate(homework: HomeworkAssignment, timezone: string) {
  const exact = validDateTime(homework.dueDateTime, timezone);
  if (exact) return exact;
  if (!homework.dueDate) return null;
  try {
    return zonedDateTimeToDate(homework.dueDate, 1_439, timezone);
  } catch {
    return null;
  }
}

async function paginate<T>(
  page: (limit: number, offset: number) => Promise<T[]>,
  operation: string,
  signal?: AbortSignal,
) {
  const result: T[] = [];
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    let values: T[];
    try {
      values = await awaitWithSignal(
        page(PAGE_SIZE, pageIndex * PAGE_SIZE),
        signal,
      );
    } catch (error) {
      providerError(error, operation, signal);
    }
    result.push(...values);
    if (values.length < PAGE_SIZE) return result;
  }
  throw new NonRetryableSyncError(
    `Skolengo returned more than ${PAGE_SIZE * MAX_PAGES} records for ${operation}`,
  );
}

function personLabel(user: User) {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name.slice(0, 160) || user.id.slice(0, 160) || "Skolengo";
}

function resolveTargetUser(user: User, requestedStudentId?: string) {
  const available = [user, ...(user.students ?? [])];
  if (requestedStudentId) {
    const target = available.find(
      (candidate) => candidate.id === requestedStudentId,
    );
    if (!target) {
      throw new NonRetryableSyncError(
        "The selected Skolengo student is not attached to this account",
      );
    }
    return target;
  }
  return user.students?.[0] ?? user;
}

export function createSkolengoProvider(
  dependencies: SkolengoDependencies = {},
): SyncProvider & { school: SchoolProviderAdapter } {
  const createClient =
    dependencies.createClient ??
    ((runtime: SkolengoClientRuntime) =>
      new Skolengo(null, runtime.school, runtime.tokenSet, {
        handlePronoteError: false,
        httpClient: runtime.httpClient,
        refreshToken: runtime.refreshToken,
      }));
  const persistCredentials =
    dependencies.persistCredentials ?? persistSkolengoCredentials;
  const clients = new WeakMap<OpenConnection, Promise<SkolengoClient>>();
  const homeworkCache = new WeakMap<
    OpenConnection,
    Promise<ProviderHomework[]>
  >();
  const timetableCache = new WeakMap<
    OpenConnection,
    Promise<ProviderTimetableLesson[]>
  >();

  function instantiate(
    initialCredentials: StoredSkolengoCredentials,
    signal: AbortSignal | undefined,
    save: (credentials: StoredSkolengoCredentials) => Promise<void>,
  ) {
    let current = initialCredentials;
    let refreshPending: Promise<TokenSetParameters> | null = null;
    const refreshToken = () => {
      if (refreshPending) return refreshPending;
      refreshPending = (async () => {
        const tokenSet = await refreshOidcToken(current, dependencies, signal);
        const next = storedCredentialsSchema.parse({ ...current, tokenSet });
        await save(next);
        current = next;
        return tokenSet;
      })().finally(() => {
        refreshPending = null;
      });
      return refreshPending;
    };
    const client = createClient({
      school: current.school as School,
      tokenSet: current.tokenSet as TokenSetParameters,
      httpClient: createApiHttpClient(dependencies, signal),
      refreshToken,
    });
    return { client, currentCredentials: () => current };
  }

  async function connectedClient(
    connection: OpenConnection,
    options: ProviderRequestOptions = {},
  ) {
    const cached = clients.get(connection);
    if (cached) return cached;
    const pending = (async () => {
      const credentials = openCredentials(connection);
      normalizeSkolengoBaseUrl(connection.baseUrl);
      const runtime = instantiate(credentials, options.signal, async (next) => {
        await persistCredentials(connection, JSON.stringify(next));
      });
      return runtime.client;
    })();
    clients.set(connection, pending);
    pending.catch(() => clients.delete(connection));
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
      const credentials = openCredentials(connection);
      const client = await connectedClient(connection, options);
      const from = isoDateInTimeZone(
        options.window.from,
        options.window.timezone,
      );
      const to = isoDateInTimeZone(options.window.to, options.window.timezone);
      const values = await paginate(
        (limit, offset) =>
          client.getHomeworkAssignments(
            credentials.targetStudentId,
            from,
            to,
            limit,
            offset,
          ),
        "homework discovery",
        options.signal,
      );
      const unique = new Map<string, ProviderHomework>();
      for (const homework of values) {
        const subject = subjectRef(homework.subject);
        const dueAt = dueDate(homework, options.window.timezone);
        // A complete-window reconciliation needs a date that proves the row is
        // inside that window. Importing an undated row would make a later
        // upstream deletion impossible to reconcile honestly.
        if (!dueAt) continue;
        unique.set(homework.id, {
          externalId: homework.id,
          title:
            homework.title?.trim().slice(0, 160) ||
            `Travail à faire — ${subject?.name ?? "Skolengo"}`,
          instructions: plainText(homework.html),
          assignedAt: null,
          dueAt,
          subject,
          completedUpstream: homework.done,
          attachments: [],
          modifiedAt: null,
        });
      }
      return [...unique.values()];
    })();
    homeworkCache.set(connection, pending);
    pending.catch(() => homeworkCache.delete(connection));
    return pending;
  }

  async function agenda(
    connection: OpenConnection,
    options: ProviderListOptions,
  ) {
    const credentials = openCredentials(connection);
    const client = await connectedClient(connection, options);
    const from = isoDateInTimeZone(
      options.window.from,
      options.window.timezone,
    );
    const to = isoDateInTimeZone(options.window.to, options.window.timezone);
    return paginate(
      async (limit, offset) => [
        ...(await client.getAgenda(
          credentials.targetStudentId,
          from,
          to,
          limit,
          offset,
        )),
      ],
      "agenda discovery",
      options.signal,
    );
  }

  async function listTimetable(
    connection: OpenConnection,
    options: ProviderListOptions,
  ) {
    assertSchoolSyncWindow(options.window);
    const cached = timetableCache.get(connection);
    if (cached) return cached;
    const pending = (async () => {
      const days = await agenda(connection, options);
      const unique = new Map<string, ProviderTimetableLesson>();
      for (const day of days) {
        for (const lesson of day.lessons ?? []) {
          const startsAt = validDateTime(
            lesson.startDateTime,
            options.window.timezone,
          );
          const endsAt = validDateTime(
            lesson.endDateTime,
            options.window.timezone,
          );
          if (!startsAt || !endsAt || endsAt <= startsAt) continue;
          const subject = subjectRef(lesson.subject);
          unique.set(lesson.id, {
            externalId: lesson.id,
            title:
              lesson.title.trim().slice(0, 160) ||
              subject?.name ||
              "Cours Skolengo",
            notes:
              plainText(
                lesson.contents
                  ?.map((content) => `${content.title} ${content.html}`)
                  .join("\n"),
              ) ?? null,
            startsAt,
            endsAt,
            timezone: options.window.timezone,
            location:
              [lesson.location, lesson.locationComplement]
                .filter(Boolean)
                .join(" — ")
                .trim()
                .slice(0, 300) || null,
            subject,
            cancelled: lesson.canceled,
            modifiedAt: null,
          });
        }
      }
      return [...unique.values()];
    })();
    timetableCache.set(connection, pending);
    pending.catch(() => timetableCache.delete(connection));
    return pending;
  }

  const school: SchoolProviderAdapter = {
    id: "skolengo",
    timezone(connection) {
      return normalizeSchoolTimezone(
        openCredentials(connection).school.timeZone,
      );
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
          const credentials = openCredentials(connection);
          const client = await connectedClient(connection, options);
          const settings = await paginate(
            (limit, offset) =>
              client.getEvaluationSettings(
                credentials.targetStudentId,
                limit,
                offset,
              ),
            "evaluation settings discovery",
            options.signal,
          );
          const periods = new Map<
            string,
            EvaluationSettings["periods"][number]
          >();
          for (const setting of settings) {
            for (const period of setting.periods ?? [])
              periods.set(period.id, period);
          }
          const result = new Map<string, ProviderGrade>();
          for (const period of periods.values()) {
            const periodStart = validDateTime(
              `${period.startDate}T00:00:00`,
              options.window.timezone,
            );
            const periodEnd = validDateTime(
              `${period.endDate}T23:59:00`,
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
            const evaluations = await paginate(
              (limit, offset) =>
                client.getEvaluation(
                  credentials.targetStudentId,
                  period.id,
                  limit,
                  offset,
                ),
              "grade discovery",
              options.signal,
            );
            for (const evaluation of evaluations) {
              for (const detail of evaluation.evaluations ?? []) {
                const passedAt = validDateTime(
                  detail.dateTime,
                  options.window.timezone,
                );
                const subject =
                  subjectRef(evaluation.subject) ??
                  subjectRef(detail.evaluationService?.subject);
                if (
                  !passedAt ||
                  !subject ||
                  passedAt < options.window.from ||
                  passedAt > options.window.to
                ) {
                  continue;
                }
                const coefficient =
                  detail.coefficient ?? evaluation.coefficient ?? 1;
                result.set(`${period.id}:${detail.id}`, {
                  externalId: `${period.id}:${detail.id}`,
                  title:
                    detail.title?.trim().slice(0, 160) ||
                    detail.topic?.trim().slice(0, 160) ||
                    `Note — ${subject.name}`,
                  subject,
                  periodExternalId: period.id,
                  periodName: period.label,
                  passedAt,
                  value: detail.evaluationResult?.mark ?? null,
                  outOf: detail.scale ?? evaluation.scale ?? null,
                  coefficient:
                    Number.isFinite(coefficient) && coefficient > 0
                      ? coefficient
                      : 1,
                  significant:
                    detail.evaluationResult?.nonEvaluationReason == null,
                  modifiedAt: null,
                });
              }
            }
          }
          return [...result.values()];
        },
      },
      "school-calendar": {
        async list(connection, options) {
          assertSchoolSyncWindow(options.window);
          const timetable = await listTimetable(connection, options);
          const workdays = new Set(
            timetable
              .filter((lesson) => !lesson.cancelled)
              .map((lesson) =>
                isoDateInTimeZone(lesson.startsAt, options.window.timezone),
              ),
          );
          return [...workdays].map((date): ProviderSchoolCalendarEvent => ({
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
          }));
        },
      },
    },
  };

  return {
    id: "skolengo",
    capabilities: ["homework", "timetable", "grades", "school-calendar"],
    school,
    normalizeBaseUrl: normalizeSkolengoBaseUrl,
    async parseCredentialInput(baseUrl, rawInput, options) {
      if (options?.caCertPem) {
        throw new Error("Skolengo does not support a custom CA certificate");
      }
      normalizeSkolengoBaseUrl(baseUrl);
      const input = parseCredentialInput(rawInput);
      const verifiedSchool = await verifyOfficialSchool(
        input.school,
        dependencies,
        options?.signal,
      );
      const officialSchool = {
        ...verifiedSchool,
        timeZone: normalizeSchoolTimezone(verifiedSchool.timeZone),
      };
      const oidc = await discoverOidc(
        officialSchool.emsOIDCWellKnownUrl,
        dependencies,
        options?.signal,
      );
      let provisional = storedCredentialsSchema.parse({
        version: 1,
        school: officialSchool,
        tokenSet: input.tokenSet,
        targetStudentId: input.studentId ?? "pending-user-verification",
        oidc,
      });
      const runtime = instantiate(
        provisional,
        options?.signal,
        async (next) => {
          provisional = next;
        },
      );
      let authenticatedUser: User;
      try {
        authenticatedUser = await awaitWithSignal(
          runtime.client.getUserInfo(),
          options?.signal,
        );
      } catch (error) {
        providerError(error, "authentication", options?.signal);
      }
      const target = resolveTargetUser(authenticatedUser, input.studentId);
      if (!target.school?.id || target.school.id !== officialSchool.id) {
        throw new NonRetryableSyncError(
          "Skolengo could not prove that the selected student belongs to the verified school",
        );
      }
      const credentials = storedCredentialsSchema.parse({
        ...runtime.currentCredentials(),
        targetStudentId: target.id,
      });
      return {
        credentials: JSON.stringify(credentials),
        accountLabel: personLabel(target),
        remoteStudentId: target.id,
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
        "Skolengo attachments are not advertised because the upstream SDK sends Bearer tokens to provider-supplied file URLs",
      );
    },
  };
}

export const skolengoProvider = createSkolengoProvider();
