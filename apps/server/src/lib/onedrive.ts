import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contentConnections } from "../db/schema";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "../sync/errors";
import {
  fetchPinnedProviderResponse,
  fetchSafeProviderText,
  type ProviderFetch,
  type ProviderLookup,
} from "../sync/provider-network";
import { open, seal } from "./crypto";
import { env, isProduction } from "./env";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_ROOT = `${GRAPH_ORIGIN}/v1.0/`;
const LOGIN_ORIGIN = "https://login.microsoftonline.com";
const TOKEN_CLOCK_SKEW_MS = 2 * 60_000;
const GRAPH_JSON_MAX_BYTES = 8 * 1024 * 1024;
const MAX_BROWSE_PAGES = 25;
const MAX_BROWSE_ITEMS = 5_000;
const SUBSCRIPTION_LIFETIME_MS = 28 * 24 * 60 * 60_000;

export type ContentConnection = typeof contentConnections.$inferSelect;

export interface OneDriveHttpDependencies {
  fetch?: ProviderFetch;
  lookup?: ProviderLookup;
  now?: () => Date;
  signal?: AbortSignal;
}

const tokenResponseSchema = z
  .object({
    access_token: z
      .string()
      .min(1)
      .max(128 * 1024),
    expires_in: z
      .number()
      .int()
      .positive()
      .max(24 * 60 * 60),
    refresh_token: z
      .string()
      .min(1)
      .max(128 * 1024)
      .optional(),
    scope: z.string().max(8_192).optional(),
    token_type: z.string().max(32).optional(),
  })
  .strip();

const storedCredentialsSchema = z.object({
  version: z.literal(1),
  accessToken: z
    .string()
    .min(1)
    .max(128 * 1024),
  accessTokenExpiresAt: z.number().int().positive(),
  refreshToken: z
    .string()
    .min(1)
    .max(128 * 1024),
  scope: z.string().max(8_192).nullable(),
  accountId: z.string().min(1).max(1_024),
  driveId: z.string().min(1).max(1_024),
});

export type OneDriveCredentials = z.infer<typeof storedCredentialsSchema>;

const profileSchema = z
  .object({
    id: z.string().min(1).max(1_024),
    displayName: z.string().max(1_024).optional(),
    mail: z.string().max(2_048).nullable().optional(),
    userPrincipalName: z.string().max(2_048).optional(),
  })
  .strip();

const driveSchema = z
  .object({
    id: z.string().min(1).max(1_024),
  })
  .strip();

const driveItemSchema = z
  .object({
    id: z.string().min(1).max(1_024),
    name: z.string().min(1).max(4_096),
    size: z.number().int().nonnegative().optional(),
    eTag: z.string().max(8_192).optional(),
    cTag: z.string().max(8_192).optional(),
    lastModifiedDateTime: z.string().max(128).optional(),
    deleted: z.record(z.string(), z.unknown()).optional(),
    file: z
      .object({ mimeType: z.string().max(1_024).optional() })
      .passthrough()
      .optional(),
    folder: z
      .object({ childCount: z.number().int().nonnegative().optional() })
      .passthrough()
      .optional(),
    parentReference: z
      .object({
        id: z.string().max(1_024).optional(),
        driveId: z.string().max(1_024).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type OneDriveDriveItem = z.infer<typeof driveItemSchema>;

const driveItemPageSchema = z
  .object({
    value: z.array(driveItemSchema),
    "@odata.nextLink": z
      .string()
      .url()
      .max(32 * 1024)
      .optional(),
    "@odata.deltaLink": z
      .string()
      .url()
      .max(32 * 1024)
      .optional(),
  })
  .passthrough();

export interface OneDriveDeltaPage {
  items: OneDriveDriveItem[];
  nextLink: string | null;
  deltaLink: string | null;
}

/** Graph asks the caller to discard an expired delta token and start anew. */
export class OneDriveDeltaCursorExpiredError extends Error {
  override readonly name = "OneDriveDeltaCursorExpiredError";

  constructor(readonly restartCursor: string | null) {
    super("The OneDrive delta cursor expired and must be rebuilt");
  }
}

const subscriptionSchema = z
  .object({
    id: z.string().min(1).max(1_024),
    expirationDateTime: z.string().min(1).max(128),
  })
  .passthrough();

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeJson(content: string, label: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new NonRetryableSyncError(`${label} returned invalid JSON`, {
      cause: error,
    });
  }
}

function configuredClientId() {
  return env.ONEDRIVE_CLIENT_ID ?? env.MICROSOFT_CLIENT_ID;
}

function configuredClientSecret() {
  return env.ONEDRIVE_CLIENT_SECRET ?? env.MICROSOFT_CLIENT_SECRET;
}

export function oneDriveConfigured() {
  return Boolean(configuredClientId() && configuredClientSecret());
}

export function oneDriveRedirectUri() {
  return (
    env.ONEDRIVE_REDIRECT_URI ??
    `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/connectors/onedrive/callback`
  );
}

export function oneDriveWebhookUrl() {
  const value = env.ONEDRIVE_WEBHOOK_URL;
  if (!value) return null;
  if (isProduction && new URL(value).protocol !== "https:") {
    throw new Error("The OneDrive webhook URL must use HTTPS in production");
  }
  return value;
}

function tenantSegment() {
  return encodeURIComponent(env.ONEDRIVE_TENANT_ID || "common");
}

function tokenEndpoint() {
  return `${LOGIN_ORIGIN}/${tenantSegment()}/oauth2/v2.0/token`;
}

export function oneDriveOauthStateHash(state: string) {
  return sha256(state);
}

/**
 * Generate a one-use OAuth state and its PKCE verifier. Callers persist only
 * the state digest and a sealed verifier so a server restart can finish the
 * callback without exposing either value at rest.
 */
export function createOneDriveAuthorization() {
  const clientId = configuredClientId();
  if (!clientId || !configuredClientSecret()) {
    throw new NonRetryableSyncError(
      "The OneDrive connector is not configured on this server",
    );
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  const url = new URL(
    `${LOGIN_ORIGIN}/${tenantSegment()}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: oneDriveRedirectUri(),
    response_mode: "query",
    scope: "offline_access User.Read Files.Read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { state, verifier, url: url.toString() };
}

async function tokenRequest(
  values: Record<string, string>,
  dependencies: OneDriveHttpDependencies = {},
) {
  const clientId = configuredClientId();
  const clientSecret = configuredClientSecret();
  if (!clientId || !clientSecret) {
    throw new NonRetryableSyncError(
      "The OneDrive connector is not configured on this server",
    );
  }
  const response = await fetchSafeProviderText(
    tokenEndpoint(),
    {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "offline_access User.Read Files.Read",
        ...values,
      }),
    },
    {
      expectedOrigin: LOGIN_ORIGIN,
      fetch: dependencies.fetch,
      lookup: dependencies.lookup,
      maxRedirects: 0,
      maxResponseBytes: 1024 * 1024,
      signal: dependencies.signal,
    },
  );
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableSyncError(
      "Microsoft identity is temporarily unavailable",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new CredentialsRevokedSyncError(
      "Microsoft no longer accepts this OneDrive authorization; reconnect the account",
    );
  }
  const parsed = tokenResponseSchema.safeParse(
    safeJson(response.content, "Microsoft identity"),
  );
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "Microsoft identity returned an incomplete token response",
    );
  }
  return parsed.data;
}

function graphUrl(input: string) {
  const url = new URL(input, GRAPH_ROOT);
  if (url.origin !== GRAPH_ORIGIN || url.username || url.password) {
    throw new NonRetryableSyncError(
      "Microsoft Graph returned an unsafe continuation URL",
    );
  }
  return url;
}

async function graphTextWithToken(
  accessToken: string,
  input: string,
  init: RequestInit = {},
  dependencies: OneDriveHttpDependencies = {},
) {
  const url = graphUrl(input);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${accessToken}`);
  return fetchSafeProviderText(
    url,
    { ...init, headers, redirect: "manual" },
    {
      expectedOrigin: GRAPH_ORIGIN,
      fetch: dependencies.fetch,
      lookup: dependencies.lookup,
      maxRedirects: 0,
      maxResponseBytes: GRAPH_JSON_MAX_BYTES,
      signal: dependencies.signal,
    },
  );
}

function graphResponseError(status: number): never {
  if (status === 429 || status >= 500) {
    throw new RetryableSyncError("Microsoft Graph is temporarily unavailable");
  }
  if (status === 401) {
    throw new CredentialsRevokedSyncError(
      "The OneDrive access token is no longer accepted; reconnect the account",
    );
  }
  if (status === 403) {
    throw new NonRetryableSyncError(
      "OneDrive no longer grants access to the requested files",
    );
  }
  throw new NonRetryableSyncError(
    `Microsoft Graph rejected the request (HTTP ${status})`,
  );
}

async function graphJsonWithToken<T>(
  accessToken: string,
  input: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  dependencies: OneDriveHttpDependencies = {},
) {
  const response = await graphTextWithToken(
    accessToken,
    input,
    init,
    dependencies,
  );
  if (response.status < 200 || response.status >= 300) {
    graphResponseError(response.status);
  }
  const parsed = schema.safeParse(
    safeJson(response.content, "Microsoft Graph"),
  );
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "Microsoft Graph returned an incomplete response",
    );
  }
  return parsed.data;
}

export async function exchangeOneDriveAuthorizationCode(
  code: string,
  codeVerifier: string,
  dependencies: OneDriveHttpDependencies = {},
) {
  const token = await tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: oneDriveRedirectUri(),
      code_verifier: codeVerifier,
    },
    dependencies,
  );
  if (!token.refresh_token) {
    throw new NonRetryableSyncError(
      "Microsoft did not issue offline OneDrive access; reconnect and grant file access",
    );
  }
  const [profile, drive] = await Promise.all([
    graphJsonWithToken(
      token.access_token,
      "me?$select=id,displayName,mail,userPrincipalName",
      profileSchema,
      {},
      dependencies,
    ),
    graphJsonWithToken(
      token.access_token,
      "me/drive?$select=id,driveType",
      driveSchema,
      {},
      dependencies,
    ),
  ]);
  const now = dependencies.now?.() ?? new Date();
  const credentials: OneDriveCredentials = {
    version: 1,
    accessToken: token.access_token,
    accessTokenExpiresAt: now.getTime() + token.expires_in * 1_000,
    refreshToken: token.refresh_token,
    scope: token.scope ?? null,
    accountId: profile.id,
    driveId: drive.id,
  };
  return {
    credentials,
    accountLabel:
      profile.mail?.trim() ||
      profile.userPrincipalName?.trim() ||
      profile.displayName?.trim() ||
      "OneDrive",
  };
}

export function parseOneDriveCredentials(sealedCredentials: string) {
  let value: unknown;
  try {
    value = JSON.parse(open(sealedCredentials));
  } catch (error) {
    throw new NonRetryableSyncError(
      "The OneDrive credentials could not be opened",
      { cause: error },
    );
  }
  const parsed = storedCredentialsSchema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "The OneDrive credential envelope is unsupported",
    );
  }
  return parsed.data;
}

export function sealOneDriveCredentials(credentials: OneDriveCredentials) {
  return seal(JSON.stringify(credentials));
}

async function markConnectionExpired(connection: ContentConnection) {
  await db
    .update(contentConnections)
    .set({
      status: "expired",
      lastError: "Microsoft authorization expired; reconnect OneDrive",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
      ),
    );
}

async function refreshConnectionAccessToken(
  connection: ContentConnection,
  dependencies: OneDriveHttpDependencies,
) {
  const currentRevision = connection.sealedCredentials;
  const current = parseOneDriveCredentials(currentRevision);
  let token: z.infer<typeof tokenResponseSchema>;
  try {
    token = await tokenRequest(
      {
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      },
      dependencies,
    );
  } catch (error) {
    if (error instanceof CredentialsRevokedSyncError) {
      await markConnectionExpired(connection);
    }
    throw error;
  }
  const now = dependencies.now?.() ?? new Date();
  const next: OneDriveCredentials = {
    ...current,
    accessToken: token.access_token,
    accessTokenExpiresAt: now.getTime() + token.expires_in * 1_000,
    refreshToken: token.refresh_token ?? current.refreshToken,
    scope: token.scope ?? current.scope,
  };
  const nextRevision = sealOneDriveCredentials(next);
  const [updated] = await db
    .update(contentConnections)
    .set({
      sealedCredentials: nextRevision,
      status: "connected",
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
        eq(contentConnections.provider, "onedrive"),
        eq(contentConnections.sealedCredentials, currentRevision),
      ),
    )
    .returning({ sealedCredentials: contentConnections.sealedCredentials });
  if (updated) {
    connection.sealedCredentials = updated.sealedCredentials;
    connection.status = "connected";
    return next.accessToken;
  }

  // Another browse/job refreshed first. Adopt its ciphertext instead of
  // overwriting a rotated refresh token with our stale response.
  const [raced] = await db
    .select()
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
        eq(contentConnections.provider, "onedrive"),
      ),
    )
    .limit(1);
  if (!raced) {
    throw new NonRetryableSyncError("The OneDrive connection was disconnected");
  }
  connection.sealedCredentials = raced.sealedCredentials;
  connection.status = raced.status;
  return parseOneDriveCredentials(raced.sealedCredentials).accessToken;
}

export async function oneDriveAccessToken(
  connection: ContentConnection,
  dependencies: OneDriveHttpDependencies = {},
  options: { forceRefresh?: boolean } = {},
) {
  if (connection.provider !== "onedrive") {
    throw new NonRetryableSyncError("This content source is not OneDrive");
  }
  if (connection.status === "expired" && !options.forceRefresh) {
    throw new CredentialsRevokedSyncError(
      "The OneDrive connection has expired; reconnect the account",
    );
  }
  const credentials = parseOneDriveCredentials(connection.sealedCredentials);
  const now = dependencies.now?.() ?? new Date();
  if (
    !options.forceRefresh &&
    credentials.accessTokenExpiresAt > now.getTime() + TOKEN_CLOCK_SKEW_MS
  ) {
    return credentials.accessToken;
  }
  return refreshConnectionAccessToken(connection, dependencies);
}

export async function oneDriveGraphJson<T>(
  connection: ContentConnection,
  input: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  dependencies: OneDriveHttpDependencies = {},
) {
  let accessToken = await oneDriveAccessToken(connection, dependencies);
  let response = await graphTextWithToken(
    accessToken,
    input,
    init,
    dependencies,
  );
  if (response.status === 401) {
    accessToken = await oneDriveAccessToken(connection, dependencies, {
      forceRefresh: true,
    });
    response = await graphTextWithToken(accessToken, input, init, dependencies);
  }
  if (response.status === 410) {
    const location = response.headers.get("location");
    const restartCursor = location
      ? graphUrl(new URL(location, response.finalUrl).toString()).toString()
      : null;
    throw new OneDriveDeltaCursorExpiredError(restartCursor);
  }
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) await markConnectionExpired(connection);
    graphResponseError(response.status);
  }
  const parsed = schema.safeParse(
    safeJson(response.content, "Microsoft Graph"),
  );
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "Microsoft Graph returned an incomplete response",
    );
  }
  return parsed.data;
}

export async function browseOneDrive(
  connection: ContentConnection,
  remoteFolderId?: string,
  dependencies: OneDriveHttpDependencies = {},
) {
  const id = remoteFolderId?.trim();
  let next: string | null = id
    ? `me/drive/items/${encodeURIComponent(id)}/children?$select=id,name,size,file,folder&$top=200`
    : "me/drive/root/children?$select=id,name,size,file,folder&$top=200";
  const rows: Array<{
    id: string;
    name: string;
    kind: "folder" | "file";
    childCount?: number;
  }> = [];
  for (let page = 0; next; page += 1) {
    if (page >= MAX_BROWSE_PAGES || rows.length >= MAX_BROWSE_ITEMS) {
      throw new NonRetryableSyncError(
        "This OneDrive folder is too large to browse safely",
      );
    }
    const result: z.infer<typeof driveItemPageSchema> = await oneDriveGraphJson(
      connection,
      next,
      driveItemPageSchema,
      {},
      dependencies,
    );
    for (const item of result.value) {
      if (!item.folder && !item.file) continue;
      rows.push({
        id: item.id,
        name: item.name,
        kind: item.folder ? "folder" : "file",
        ...(item.folder?.childCount === undefined
          ? {}
          : { childCount: item.folder.childCount }),
      });
      if (rows.length > MAX_BROWSE_ITEMS) {
        throw new NonRetryableSyncError(
          "This OneDrive folder is too large to browse safely",
        );
      }
    }
    next = result["@odata.nextLink"] ?? null;
    if (next) graphUrl(next);
  }
  return rows;
}

export async function requireOneDriveFolder(
  connection: ContentConnection,
  folderId: string,
  dependencies: OneDriveHttpDependencies = {},
) {
  const item = await oneDriveGraphJson(
    connection,
    `me/drive/items/${encodeURIComponent(folderId)}?$select=id,name,folder,parentReference`,
    driveItemSchema,
    {},
    dependencies,
  );
  if (!item.folder) {
    throw new NonRetryableSyncError(
      "The selected OneDrive item is not a folder",
    );
  }
  return item;
}

const MAX_SCOPE_ANCESTOR_HOPS = 256;
const MAX_SCOPE_ANCESTOR_LOOKUPS = 2_000;

/**
 * Reduce selected folders to an antichain: when both an ancestor and one of
 * its descendants are selected, only the ancestor is retained. Walking Graph
 * parent links (with a bounded cache) also handles non-adjacent descendants.
 */
export async function normalizeOneDriveFolderScope(
  connection: ContentConnection,
  folderIds: readonly string[],
  dependencies: OneDriveHttpDependencies = {},
) {
  const unique = [...new Set(folderIds)];
  const selected = new Set(unique);
  const folders = new Map<string, z.infer<typeof driveItemSchema>>();
  let lookups = 0;
  const load = async (folderId: string) => {
    const cached = folders.get(folderId);
    if (cached) return cached;
    lookups += 1;
    if (lookups > MAX_SCOPE_ANCESTOR_LOOKUPS) {
      throw new NonRetryableSyncError(
        "The selected OneDrive folder ancestry is too large to validate safely",
      );
    }
    const folder = await requireOneDriveFolder(
      connection,
      folderId,
      dependencies,
    );
    if (folder.id !== folderId) {
      throw new NonRetryableSyncError(
        "Microsoft Graph returned an inconsistent folder identity",
      );
    }
    folders.set(folderId, folder);
    return folder;
  };

  for (const folderId of unique) await load(folderId);
  const descendants = new Set<string>();
  for (const folderId of unique) {
    let cursor = (await load(folderId)).parentReference?.id;
    const seen = new Set([folderId]);
    for (let hop = 0; cursor; hop += 1) {
      if (hop >= MAX_SCOPE_ANCESTOR_HOPS || seen.has(cursor)) {
        throw new NonRetryableSyncError(
          "The selected OneDrive folder ancestry is invalid or too deep",
        );
      }
      if (selected.has(cursor)) {
        descendants.add(folderId);
        break;
      }
      seen.add(cursor);
      cursor = (await load(cursor)).parentReference?.id;
    }
  }
  return unique.filter((folderId) => !descendants.has(folderId));
}

export async function readOneDriveDeltaPage(
  connection: ContentConnection,
  cursor?: string | null,
  dependencies: OneDriveHttpDependencies = {},
): Promise<OneDriveDeltaPage> {
  const input =
    cursor ??
    "me/drive/root/delta?$select=id,name,size,eTag,cTag,lastModifiedDateTime,file,folder,parentReference,deleted";
  const result = await oneDriveGraphJson(
    connection,
    input,
    driveItemPageSchema,
    { headers: { deltaExcludeParent: "true" } },
    dependencies,
  );
  const nextLink = result["@odata.nextLink"] ?? null;
  const deltaLink = result["@odata.deltaLink"] ?? null;
  if (nextLink) graphUrl(nextLink);
  if (deltaLink) graphUrl(deltaLink);
  return { items: result.value, nextLink, deltaLink };
}

async function streamingGraphRequest(
  connection: ContentConnection,
  input: string,
  dependencies: OneDriveHttpDependencies,
) {
  let accessToken = await oneDriveAccessToken(connection, dependencies);
  const request = (token: string) =>
    fetchPinnedProviderResponse(
      graphUrl(input),
      {
        headers: { authorization: `Bearer ${token}` },
        redirect: "manual",
      },
      {
        expectedOrigin: GRAPH_ORIGIN,
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        signal: dependencies.signal,
      },
    );
  let response = await request(accessToken);
  if (response.status === 401) {
    void response.body?.cancel().catch(() => undefined);
    accessToken = await oneDriveAccessToken(connection, dependencies, {
      forceRefresh: true,
    });
    response = await request(accessToken);
  }
  return response;
}

export async function downloadOneDriveItem(
  connection: ContentConnection,
  itemId: string,
  dependencies: OneDriveHttpDependencies = {},
) {
  let response = await streamingGraphRequest(
    connection,
    `me/drive/items/${encodeURIComponent(itemId)}/content`,
    dependencies,
  );
  for (
    let redirect = 0;
    response.status >= 300 && response.status < 400;
    redirect += 1
  ) {
    const location = response.headers.get("location");
    void response.body?.cancel().catch(() => undefined);
    if (!location || redirect >= 2) {
      throw new NonRetryableSyncError(
        "OneDrive returned an invalid download redirect",
      );
    }
    // Pre-authenticated download URLs are credentials. They are used once,
    // never persisted/logged, and never receive the Graph Authorization header.
    response = await fetchPinnedProviderResponse(
      new URL(location),
      { redirect: "manual" },
      {
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        signal: dependencies.signal,
      },
    );
  }
  if (response.status < 200 || response.status >= 300 || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    graphResponseError(response.status);
  }
  const declared = Number(response.headers.get("content-length"));
  return {
    body: response.body,
    contentLength: Number.isFinite(declared) && declared >= 0 ? declared : null,
  };
}

export function newOneDriveWebhookClientState() {
  return randomBytes(32).toString("base64url");
}

export function oneDriveWebhookSecretHash(clientState: string) {
  return sha256(clientState);
}

export function matchesOneDriveWebhookSecret(
  clientState: string,
  expectedHash: string,
) {
  const actual = Buffer.from(oneDriveWebhookSecretHash(clientState), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actual.length === expected.length &&
    actual.length === 32 &&
    timingSafeEqual(actual, expected)
  );
}

function subscriptionExpiry(now: Date) {
  return new Date(now.getTime() + SUBSCRIPTION_LIFETIME_MS);
}

export async function createOneDriveSubscription(
  connection: ContentConnection,
  clientState: string,
  dependencies: OneDriveHttpDependencies = {},
) {
  const notificationUrl = oneDriveWebhookUrl();
  if (!notificationUrl) return null;
  const credentials = parseOneDriveCredentials(connection.sealedCredentials);
  const now = dependencies.now?.() ?? new Date();
  const result = await oneDriveGraphJson(
    connection,
    "subscriptions",
    subscriptionSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changeType: "updated",
        notificationUrl,
        resource: `/drives/${encodeURIComponent(credentials.driveId)}/root`,
        expirationDateTime: subscriptionExpiry(now).toISOString(),
        clientState,
        latestSupportedTlsVersion: "v1_2",
      }),
    },
    dependencies,
  );
  const expiresAt = new Date(result.expirationDateTime);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new NonRetryableSyncError(
      "Microsoft Graph returned an invalid subscription expiry",
    );
  }
  return { id: result.id, expiresAt };
}

export async function renewOneDriveSubscription(
  connection: ContentConnection,
  dependencies: OneDriveHttpDependencies = {},
) {
  if (!connection.subscriptionId) {
    throw new NonRetryableSyncError("The OneDrive subscription is unavailable");
  }
  const now = dependencies.now?.() ?? new Date();
  const result = await oneDriveGraphJson(
    connection,
    `subscriptions/${encodeURIComponent(connection.subscriptionId)}`,
    subscriptionSchema,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expirationDateTime: subscriptionExpiry(now).toISOString(),
      }),
    },
    dependencies,
  );
  const expiresAt = new Date(result.expirationDateTime);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new NonRetryableSyncError(
      "Microsoft Graph returned an invalid subscription expiry",
    );
  }
  return { id: result.id, expiresAt };
}

export async function deleteOneDriveSubscription(
  connection: ContentConnection,
  dependencies: OneDriveHttpDependencies = {},
) {
  if (!connection.subscriptionId) return;
  let token = await oneDriveAccessToken(connection, dependencies);
  let response = await graphTextWithToken(
    token,
    `subscriptions/${encodeURIComponent(connection.subscriptionId)}`,
    { method: "DELETE" },
    dependencies,
  );
  if (response.status === 401) {
    token = await oneDriveAccessToken(connection, dependencies, {
      forceRefresh: true,
    });
    response = await graphTextWithToken(
      token,
      `subscriptions/${encodeURIComponent(connection.subscriptionId)}`,
      { method: "DELETE" },
      dependencies,
    );
  }
  if (
    response.status !== 204 &&
    response.status !== 404 &&
    (response.status < 200 || response.status >= 300)
  ) {
    graphResponseError(response.status);
  }
}
