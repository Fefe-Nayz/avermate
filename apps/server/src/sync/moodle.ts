import { NonRetryableSyncError, RetryableSyncError } from "./errors";
import {
  fetchPinnedProviderResponse,
  type ProviderFetch,
  type ProviderLookup,
} from "./provider-network";
import type {
  OpenConnection,
  ProviderFile,
  ProviderRequestOptions,
  SyncProvider,
} from "./provider";

export const SYNC_FILE_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
] as const;

const TOKEN_PATTERN = /^[a-f\d]{32}$/i;
const PRIVATE_TOKEN_PATTERN = /^[a-z\d]{64}$/i;
const BASE64_PATTERN = /^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i;
const MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 20_000;

interface MoodleCredentials {
  version: 1;
  token: string;
  userId: string;
}

interface MoodleFetchInit extends RequestInit {
  tls?: { ca: string };
}

type Fetcher = (
  input: string | URL | Request,
  init?: MoodleFetchInit,
) => Promise<Response>;

interface MoodleProviderDependencies {
  fetch?: Fetcher;
  lookup?: ProviderLookup;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(
        typeof signal.reason === "string"
          ? signal.reason
          : "The synchronization was aborted",
      );
}

function throwIfAborted(signal: AbortSignal | null | undefined) {
  if (signal?.aborted) throw abortError(signal);
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | null | undefined,
): Promise<T> {
  throwIfAborted(signal);
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

function decodeTokenEnvelope(value: string): string | null {
  try {
    if (!value || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
      return null;
    }

    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) return null;

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const segments = decoded.split(":::");
    if (segments.length !== 2 && segments.length !== 3) return null;

    const [siteId, token, privateToken] = segments;
    if (!TOKEN_PATTERN.test(siteId ?? "") || !TOKEN_PATTERN.test(token ?? "")) {
      return null;
    }
    if (
      segments.length === 3 &&
      !PRIVATE_TOKEN_PATTERN.test(privateToken ?? "")
    ) {
      return null;
    }

    // Moodle may append a private browser auto-login token. Avermate only needs
    // the web-service token in the second segment and must never retain the
    // optional private token.
    return token ?? null;
  } catch {
    return null;
  }
}

/** Accept the three Moodle mobile hand-off shapes and reject ambiguous input. */
export function parseMoodleToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste the Moodle mobile token redirect");

  if (trimmed.startsWith("moodlemobile://token=")) {
    const encoded = trimmed.slice("moodlemobile://token=".length);
    let decodedInput: string;
    try {
      decodedInput = decodeURIComponent(encoded);
    } catch {
      throw new Error("The Moodle mobile token redirect is invalid");
    }
    const token = decodeTokenEnvelope(decodedInput);
    if (!token) throw new Error("The Moodle mobile token redirect is invalid");
    return token;
  }

  const decoded = decodeTokenEnvelope(trimmed);
  if (decoded) return decoded;
  if (TOKEN_PATTERN.test(trimmed)) return trimmed;
  throw new Error("The Moodle token is invalid");
}

export function normalizeMoodleBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid Moodle URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("Moodle connections require HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Enter the Moodle site URL without credentials or a query");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function sanitizeMoodlePathComponent(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 100);
}

export function buildMoodleFolderPath(input: {
  section: string;
  module: string;
  moduleType: string;
  filePath: string;
  fileName: string;
}): string[] {
  const parts: string[] = [];
  const section = input.section.trim();
  if (
    section &&
    !section
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .startsWith("general")
  ) {
    parts.push(section);
  }
  if (input.moduleType === "folder" && input.module.trim()) {
    parts.push(input.module);
  }

  const pathParts = input.filePath.split(/[\\/]+/).filter(Boolean);
  if (
    pathParts.at(-1)?.localeCompare(input.fileName, undefined, {
      sensitivity: "accent",
    }) === 0
  ) {
    pathParts.pop();
  }
  parts.push(...pathParts);
  return parts.map(sanitizeMoodlePathComponent).filter(Boolean);
}

function parseCredentials(raw: string): MoodleCredentials {
  try {
    const value = JSON.parse(raw) as Partial<MoodleCredentials>;
    if (
      value.version === 1 &&
      typeof value.token === "string" &&
      TOKEN_PATTERN.test(value.token) &&
      typeof value.userId === "string" &&
      value.userId.length > 0
    ) {
      return value as MoodleCredentials;
    }
  } catch {
    // Fall through to a stable, secret-free error.
  }
  throw new NonRetryableSyncError(
    "The Moodle connection credentials are invalid",
  );
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extensionOf(name: string) {
  const match = name.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function isMoodleError(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    ("exception" in value || "errorcode" in value)
  );
}

function userSafeMoodleError(value: Record<string, unknown>) {
  const code = safeString(value.errorcode)
    .replace(/[^a-z\d_-]/gi, "")
    .slice(0, 80);
  return new NonRetryableSyncError(
    code
      ? `Moodle rejected the request (${code})`
      : "Moodle rejected the request",
  );
}

export function createMoodleProvider(
  dependencies: MoodleProviderDependencies = {},
): SyncProvider {
  const sleep =
    dependencies.sleep ??
    ((milliseconds: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const removeAbortListener = () =>
          signal?.removeEventListener("abort", onAbort);
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          removeAbortListener();
          reject(abortError(signal!));
        };
        const finish = () => {
          removeAbortListener();
          resolve();
        };
        if (signal?.aborted) onAbort();
        else {
          signal?.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(finish, milliseconds);
        }
      }));
  const courseNames = new WeakMap<OpenConnection, Map<string, string>>();

  async function backoff(milliseconds: number, signal?: AbortSignal | null) {
    throwIfAborted(signal);
    await awaitWithSignal(sleep(milliseconds, signal ?? undefined), signal);
    throwIfAborted(signal);
  }

  async function requestWithRetry(
    url: string | URL,
    init: MoodleFetchInit,
  ): Promise<Response> {
    const signal = init.signal;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      let response: Response;
      try {
        const requestUrl = new URL(url);
        const pendingResponse = fetchPinnedProviderResponse(requestUrl, init, {
          expectedOrigin: requestUrl.origin,
          fetch: dependencies.fetch as ProviderFetch | undefined,
          lookup: dependencies.lookup,
          signal: signal ?? undefined,
        });
        void pendingResponse.then(
          (lateResponse) => {
            if (signal?.aborted) {
              void lateResponse.body?.cancel().catch(() => undefined);
            }
          },
          () => undefined,
        );
        response = await awaitWithSignal(pendingResponse, signal);
      } catch (error) {
        throwIfAborted(signal);
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new RetryableSyncError("Moodle could not be reached securely", {
            cause: error,
          });
        }
        await backoff(Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt), signal);
        continue;
      }
      if (signal?.aborted) {
        void response.body?.cancel(abortError(signal)).catch(() => undefined);
        throw abortError(signal);
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === MAX_ATTEMPTS - 1) {
          void response.body?.cancel().catch(() => undefined);
          throw new RetryableSyncError("Moodle is temporarily unavailable");
        }
        void response.body?.cancel().catch(() => undefined);
        await backoff(Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt), signal);
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new NonRetryableSyncError(
          `Moodle rejected the request (HTTP ${response.status})`,
        );
      }
      if (signal?.aborted) {
        void response.body?.cancel(abortError(signal)).catch(() => undefined);
        throw abortError(signal);
      }
      return response;
    }
    throw new RetryableSyncError("Moodle is temporarily unavailable");
  }

  function requestInit(connection: Pick<OpenConnection, "caCertPem">) {
    return connection.caCertPem
      ? ({ tls: { ca: connection.caCertPem } } satisfies MoodleFetchInit)
      : ({} satisfies MoodleFetchInit);
  }

  async function call(
    connection: Pick<OpenConnection, "baseUrl" | "credentials" | "caCertPem">,
    wsFunction: string,
    params: Record<string, string> = {},
    options: ProviderRequestOptions = {},
  ): Promise<unknown> {
    const credentials = parseCredentials(connection.credentials);
    const body = new URLSearchParams({
      wstoken: credentials.token,
      wsfunction: wsFunction,
      moodlewsrestformat: "json",
      ...params,
    });
    const response = await requestWithRetry(
      `${normalizeMoodleBaseUrl(connection.baseUrl)}/webservice/rest/server.php`,
      {
        ...requestInit(connection),
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: options.signal,
      },
    );
    let value: unknown;
    try {
      value = await awaitWithSignal(response.json(), options.signal);
    } catch (error) {
      throwIfAborted(options.signal);
      throw new RetryableSyncError("Moodle returned an invalid response", {
        cause: error,
      });
    }
    if (isMoodleError(value)) throw userSafeMoodleError(value);
    return value;
  }

  return {
    id: "moodle",
    capabilities: ["files"],
    normalizeBaseUrl: normalizeMoodleBaseUrl,

    async parseCredentialInput(baseUrl, input, options) {
      const normalizedBaseUrl = normalizeMoodleBaseUrl(baseUrl);
      const token = parseMoodleToken(input);
      const temporaryCredentials = JSON.stringify({
        version: 1,
        token,
        userId: "pending",
      } satisfies MoodleCredentials);
      const info = await call(
        {
          baseUrl: normalizedBaseUrl,
          credentials: temporaryCredentials,
          caCertPem: options?.caCertPem ?? null,
        },
        "core_webservice_get_site_info",
      );
      if (typeof info !== "object" || info === null) {
        throw new Error("Moodle returned invalid account information");
      }
      const record = info as Record<string, unknown>;
      const userId = String(record.userid ?? "").trim();
      if (!userId)
        throw new Error("Moodle returned invalid account information");
      const accountLabel =
        [record.fullname, record.username, record.sitename]
          .map(safeString)
          .find((value) => value.trim())
          ?.trim()
          .slice(0, 160) || "Moodle";
      return {
        credentials: JSON.stringify({
          version: 1,
          token,
          userId,
        } satisfies MoodleCredentials),
        accountLabel,
      };
    },

    async listCourses(connection, options) {
      const credentials = parseCredentials(connection.credentials);
      const value = await call(
        connection,
        "core_enrol_get_users_courses",
        { userid: credentials.userId },
        options,
      );
      if (!Array.isArray(value))
        throw new Error("Moodle returned an invalid course list");
      const courses = value.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const record = item as Record<string, unknown>;
        const externalId = String(record.id ?? "").trim();
        const name = (
          safeString(record.fullname) || safeString(record.shortname)
        ).trim();
        return externalId && name ? [{ externalId, name }] : [];
      });
      courseNames.set(
        connection,
        new Map(courses.map((course) => [course.externalId, course.name])),
      );
      return courses;
    },

    async listFiles(connection, courseExternalId, options) {
      const value = await call(
        connection,
        "core_course_get_contents",
        { courseid: courseExternalId },
        options,
      );
      if (!Array.isArray(value))
        throw new Error("Moodle returned invalid course contents");
      const result: ProviderFile[] = [];
      const seen = new Set<string>();
      for (const sectionValue of value) {
        if (typeof sectionValue !== "object" || sectionValue === null) continue;
        const section = sectionValue as Record<string, unknown>;
        const sectionName = safeString(section.name);
        if (!Array.isArray(section.modules)) continue;
        for (const moduleValue of section.modules) {
          if (typeof moduleValue !== "object" || moduleValue === null) continue;
          const module = moduleValue as Record<string, unknown>;
          if (!Array.isArray(module.contents)) continue;
          for (const contentValue of module.contents) {
            if (typeof contentValue !== "object" || contentValue === null)
              continue;
            const content = contentValue as Record<string, unknown>;
            if (content.type !== "file") continue;
            const externalId = safeString(content.fileurl);
            const fileName = safeString(content.filename);
            if (
              !externalId ||
              !fileName ||
              seen.has(externalId) ||
              !SYNC_FILE_EXTENSIONS.includes(
                extensionOf(fileName) as (typeof SYNC_FILE_EXTENSIONS)[number],
              )
            ) {
              continue;
            }
            seen.add(externalId);
            const modifiedSeconds = safeNumber(content.timemodified);
            const byteSize = safeNumber(content.filesize);
            result.push({
              externalId,
              fileName,
              folderPath: buildMoodleFolderPath({
                section: sectionName,
                module: safeString(module.name),
                moduleType: safeString(module.modname),
                filePath: safeString(content.filepath),
                fileName,
              }),
              mimeType: safeString(content.mimetype) || null,
              byteSize: byteSize !== null && byteSize >= 0 ? byteSize : null,
              modifiedAt:
                modifiedSeconds !== null && modifiedSeconds > 0
                  ? new Date(modifiedSeconds * 1_000)
                  : null,
              courseRef: {
                externalId: courseExternalId,
                name:
                  courseNames.get(connection)?.get(courseExternalId) ??
                  courseExternalId,
              },
            });
          }
        }
      }
      return result;
    },

    async download(connection, file, options) {
      const credentials = parseCredentials(connection.credentials);
      const baseUrl = new URL(normalizeMoodleBaseUrl(connection.baseUrl));
      let downloadUrl: URL;
      try {
        downloadUrl = new URL(file.externalId);
      } catch {
        throw new NonRetryableSyncError("Moodle returned an invalid file URL");
      }
      if (downloadUrl.origin !== baseUrl.origin) {
        throw new NonRetryableSyncError(
          "Moodle returned a file URL on another origin",
        );
      }
      downloadUrl.searchParams.set("token", credentials.token);
      const response = await requestWithRetry(downloadUrl, {
        ...requestInit(connection),
        method: "GET",
        redirect: "error",
        signal: options?.signal,
      });
      if (!response.body) {
        throw new NonRetryableSyncError(
          "Moodle returned an empty file response",
        );
      }
      const contentLengthHeader = response.headers.get("content-length");
      const parsedContentLength = contentLengthHeader
        ? Number(contentLengthHeader)
        : Number.NaN;
      return {
        body: response.body,
        contentLength:
          Number.isSafeInteger(parsedContentLength) && parsedContentLength >= 0
            ? parsedContentLength
            : null,
      };
    },
  };
}

export const moodleProvider = createMoodleProvider();
