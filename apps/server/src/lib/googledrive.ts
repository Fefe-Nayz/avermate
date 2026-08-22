import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
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

const GOOGLE_AUTH_ORIGIN = "https://accounts.google.com";
const GOOGLE_TOKEN_ORIGIN = "https://oauth2.googleapis.com";
const GOOGLE_API_ORIGIN = "https://www.googleapis.com";
const GOOGLE_DRIVE_ROOT = `${GOOGLE_API_ORIGIN}/drive/v3/`;
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_CLOCK_SKEW_MS = 2 * 60_000;
const GOOGLE_JSON_MAX_BYTES = 8 * 1024 * 1024;
const MAX_BROWSE_PAGES = 25;
const MAX_BROWSE_ITEMS = 5_000;
const CHANNEL_LIFETIME_MS = 6 * 24 * 60 * 60_000;

export const GOOGLE_DRIVE_SHARED_WITH_ME_ROOT =
  "__avermate_google_drive_shared_with_me__";
export const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_DRIVE_SHORTCUT_MIME =
  "application/vnd.google-apps.shortcut";

export type ContentConnection = typeof contentConnections.$inferSelect;

export interface GoogleDriveHttpDependencies {
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
});

export type GoogleDriveCredentials = z.infer<typeof storedCredentialsSchema>;

export interface GoogleDriveAuthorization {
  credentials: Omit<GoogleDriveCredentials, "refreshToken"> & {
    refreshToken: string | null;
  };
  accountLabel: string;
}

const aboutSchema = z
  .object({
    user: z.object({
      displayName: z.string().max(1_024).optional(),
      emailAddress: z.string().max(2_048).optional(),
      permissionId: z.string().min(1).max(1_024),
    }),
  })
  .strip();

const googleDriveFileSchema = z
  .object({
    id: z.string().min(1).max(1_024),
    name: z.string().min(1).max(4_096),
    mimeType: z.string().min(1).max(1_024),
    size: z.union([z.string(), z.number()]).optional(),
    modifiedTime: z.string().max(128).optional(),
    md5Checksum: z.string().max(256).optional(),
    version: z.union([z.string(), z.number()]).optional(),
    parents: z.array(z.string().min(1).max(1_024)).max(2).optional(),
    trashed: z.boolean().optional(),
    driveId: z.string().max(1_024).optional(),
    capabilities: z
      .object({ canDownload: z.boolean().optional() })
      .passthrough()
      .optional(),
    shortcutDetails: z
      .object({
        targetId: z.string().max(1_024).optional(),
        targetMimeType: z.string().max(1_024).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type GoogleDriveFile = z.infer<typeof googleDriveFileSchema>;

const fileListSchema = z
  .object({
    files: z.array(googleDriveFileSchema),
    nextPageToken: z
      .string()
      .max(16 * 1024)
      .optional(),
    incompleteSearch: z.boolean().optional(),
  })
  .passthrough();

const sharedDriveSchema = z
  .object({
    id: z.string().min(1).max(1_024),
    name: z.string().min(1).max(4_096),
  })
  .passthrough();

const sharedDriveListSchema = z
  .object({
    drives: z.array(sharedDriveSchema),
    nextPageToken: z
      .string()
      .max(16 * 1024)
      .optional(),
  })
  .passthrough();

const startPageTokenSchema = z
  .object({
    startPageToken: z
      .string()
      .min(1)
      .max(16 * 1024),
  })
  .passthrough();

const changeSchema = z
  .object({
    removed: z.boolean().optional(),
    // Drive membership changes share the user change feed with file changes.
    // Those entries have a driveId rather than a fileId and must not make the
    // complete page fail validation.
    fileId: z.string().min(1).max(1_024).optional(),
    driveId: z.string().min(1).max(1_024).optional(),
    file: googleDriveFileSchema.optional(),
    changeType: z.string().max(64).optional(),
  })
  .passthrough();

const changeListSchema = z
  .object({
    changes: z.array(changeSchema),
    nextPageToken: z
      .string()
      .max(16 * 1024)
      .optional(),
    newStartPageToken: z
      .string()
      .max(16 * 1024)
      .optional(),
  })
  .passthrough();

export type GoogleDriveChange = z.infer<typeof changeSchema>;

const channelSchema = z
  .object({
    id: z.string().min(1).max(1_024),
    resourceId: z.string().min(1).max(2_048),
    expiration: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/** Google asks the caller to rebuild a no-longer-valid changes cursor. */
export class GoogleDriveCursorExpiredError extends Error {
  override readonly name = "GoogleDriveCursorExpiredError";

  constructor() {
    super("The Google Drive changes cursor expired and must be rebuilt");
  }
}

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
  return env.GOOGLE_DRIVE_CLIENT_ID ?? env.GOOGLE_CLIENT_ID;
}

function configuredClientSecret() {
  return env.GOOGLE_DRIVE_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET;
}

export function googleDriveConfigured() {
  return Boolean(configuredClientId() && configuredClientSecret());
}

export function googleDriveRedirectUri() {
  return (
    env.GOOGLE_DRIVE_REDIRECT_URI ??
    `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/connectors/googledrive/callback`
  );
}

export function googleDriveWebhookUrl() {
  const value = env.GOOGLE_DRIVE_WEBHOOK_URL;
  if (!value) return null;
  if (isProduction && new URL(value).protocol !== "https:") {
    throw new Error(
      "The Google Drive webhook URL must use HTTPS in production",
    );
  }
  return value;
}

export function googleDriveOauthStateHash(state: string) {
  return sha256(state);
}

/** Create a replay-resistant OAuth request with a sealed-at-rest PKCE verifier. */
export function createGoogleDriveAuthorization() {
  const clientId = configuredClientId();
  if (!clientId || !configuredClientSecret()) {
    throw new NonRetryableSyncError(
      "The Google Drive connector is not configured on this server",
    );
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  const url = new URL("/o/oauth2/v2/auth", GOOGLE_AUTH_ORIGIN);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: googleDriveRedirectUri(),
    scope: GOOGLE_DRIVE_SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
  }).toString();
  return { state, verifier, url: url.toString() };
}

async function tokenRequest(
  values: Record<string, string>,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const clientId = configuredClientId();
  const clientSecret = configuredClientSecret();
  if (!clientId || !clientSecret) {
    throw new NonRetryableSyncError(
      "The Google Drive connector is not configured on this server",
    );
  }
  const response = await fetchSafeProviderText(
    `${GOOGLE_TOKEN_ORIGIN}/token`,
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
        ...values,
      }),
    },
    {
      expectedOrigin: GOOGLE_TOKEN_ORIGIN,
      fetch: dependencies.fetch,
      lookup: dependencies.lookup,
      maxRedirects: 0,
      maxResponseBytes: 1024 * 1024,
      signal: dependencies.signal,
    },
  );
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableSyncError("Google identity is temporarily unavailable");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new CredentialsRevokedSyncError(
      "Google no longer accepts this Drive authorization; reconnect the account",
    );
  }
  const parsed = tokenResponseSchema.safeParse(
    safeJson(response.content, "Google identity"),
  );
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "Google identity returned an incomplete token response",
    );
  }
  return parsed.data;
}

function googleApiUrl(input: string) {
  const url = new URL(input, GOOGLE_DRIVE_ROOT);
  if (url.origin !== GOOGLE_API_ORIGIN || url.username || url.password) {
    throw new NonRetryableSyncError(
      "Google Drive returned an unsafe continuation URL",
    );
  }
  return url;
}

async function googleTextWithToken(
  accessToken: string,
  input: string,
  init: RequestInit = {},
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${accessToken}`);
  return fetchSafeProviderText(
    googleApiUrl(input),
    { ...init, headers, redirect: "manual" },
    {
      expectedOrigin: GOOGLE_API_ORIGIN,
      fetch: dependencies.fetch,
      lookup: dependencies.lookup,
      maxRedirects: 0,
      maxResponseBytes: GOOGLE_JSON_MAX_BYTES,
      signal: dependencies.signal,
    },
  );
}

function googleResponseError(status: number): never {
  if (status === 429 || status >= 500) {
    throw new RetryableSyncError("Google Drive is temporarily unavailable");
  }
  if (status === 401) {
    throw new CredentialsRevokedSyncError(
      "The Google Drive access token is no longer accepted; reconnect the account",
    );
  }
  if (status === 403 || status === 404) {
    throw new NonRetryableSyncError(
      "Google Drive no longer grants access to the requested file",
    );
  }
  throw new NonRetryableSyncError(
    `Google Drive rejected the request (HTTP ${status})`,
  );
}

async function googleJsonWithToken<T>(
  accessToken: string,
  input: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const response = await googleTextWithToken(
    accessToken,
    input,
    init,
    dependencies,
  );
  if (response.status < 200 || response.status >= 300) {
    googleResponseError(response.status);
  }
  const parsed = schema.safeParse(safeJson(response.content, "Google Drive"));
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "Google Drive returned an incomplete response",
    );
  }
  return parsed.data;
}

export async function exchangeGoogleDriveAuthorizationCode(
  code: string,
  codeVerifier: string,
  dependencies: GoogleDriveHttpDependencies = {},
): Promise<GoogleDriveAuthorization> {
  const token = await tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: googleDriveRedirectUri(),
      code_verifier: codeVerifier,
    },
    dependencies,
  );
  const profile = await googleJsonWithToken(
    token.access_token,
    "about?fields=user(displayName,emailAddress,permissionId)",
    aboutSchema,
    {},
    dependencies,
  );
  const now = dependencies.now?.() ?? new Date();
  return {
    credentials: {
      version: 1,
      accessToken: token.access_token,
      accessTokenExpiresAt: now.getTime() + token.expires_in * 1_000,
      refreshToken: token.refresh_token ?? null,
      scope: token.scope ?? null,
      accountId: profile.user.permissionId,
    },
    accountLabel:
      profile.user.emailAddress?.trim() ||
      profile.user.displayName?.trim() ||
      "Google Drive",
  };
}

export function parseGoogleDriveCredentials(sealedCredentials: string) {
  let value: unknown;
  try {
    value = JSON.parse(open(sealedCredentials));
  } catch (error) {
    throw new NonRetryableSyncError(
      "The Google Drive credentials could not be opened",
      { cause: error },
    );
  }
  const parsed = storedCredentialsSchema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "The Google Drive credential envelope is unsupported",
    );
  }
  return parsed.data;
}

export function sealGoogleDriveCredentials(
  credentials: GoogleDriveCredentials,
) {
  return seal(JSON.stringify(credentials));
}

async function markConnectionExpired(connection: ContentConnection) {
  const credentialRevision = connection.sealedCredentials;
  await db
    .update(contentConnections)
    .set({
      status: "expired",
      lastError: "Google authorization expired; reconnect Google Drive",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
        eq(contentConnections.provider, "googledrive"),
        eq(contentConnections.sealedCredentials, credentialRevision),
      ),
    );
}

async function refreshConnectionAccessToken(
  connection: ContentConnection,
  dependencies: GoogleDriveHttpDependencies,
) {
  const currentRevision = connection.sealedCredentials;
  const current = parseGoogleDriveCredentials(currentRevision);
  let token: z.infer<typeof tokenResponseSchema>;
  try {
    token = await tokenRequest(
      { grant_type: "refresh_token", refresh_token: current.refreshToken },
      dependencies,
    );
  } catch (error) {
    if (error instanceof CredentialsRevokedSyncError) {
      await markConnectionExpired(connection);
    }
    throw error;
  }
  const now = dependencies.now?.() ?? new Date();
  const next: GoogleDriveCredentials = {
    ...current,
    accessToken: token.access_token,
    accessTokenExpiresAt: now.getTime() + token.expires_in * 1_000,
    refreshToken: token.refresh_token ?? current.refreshToken,
    scope: token.scope ?? current.scope,
  };
  const nextRevision = sealGoogleDriveCredentials(next);
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
        eq(contentConnections.provider, "googledrive"),
        eq(contentConnections.sealedCredentials, currentRevision),
      ),
    )
    .returning({ sealedCredentials: contentConnections.sealedCredentials });
  if (updated) {
    connection.sealedCredentials = updated.sealedCredentials;
    connection.status = "connected";
    return next.accessToken;
  }

  const [raced] = await db
    .select()
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
        eq(contentConnections.provider, "googledrive"),
      ),
    )
    .limit(1);
  if (!raced) {
    throw new NonRetryableSyncError(
      "The Google Drive connection was disconnected",
    );
  }
  connection.sealedCredentials = raced.sealedCredentials;
  connection.status = raced.status;
  if (raced.status === "expired") {
    throw new CredentialsRevokedSyncError(
      "The Google Drive connection has expired; reconnect the account",
    );
  }
  return parseGoogleDriveCredentials(raced.sealedCredentials).accessToken;
}

export async function googleDriveAccessToken(
  connection: ContentConnection,
  dependencies: GoogleDriveHttpDependencies = {},
  options: { forceRefresh?: boolean } = {},
) {
  if (connection.provider !== "googledrive") {
    throw new NonRetryableSyncError("This content source is not Google Drive");
  }
  if (connection.status === "expired" && !options.forceRefresh) {
    throw new CredentialsRevokedSyncError(
      "The Google Drive connection has expired; reconnect the account",
    );
  }
  const credentials = parseGoogleDriveCredentials(connection.sealedCredentials);
  const now = dependencies.now?.() ?? new Date();
  if (
    !options.forceRefresh &&
    credentials.accessTokenExpiresAt > now.getTime() + TOKEN_CLOCK_SKEW_MS
  ) {
    return credentials.accessToken;
  }
  return refreshConnectionAccessToken(connection, dependencies);
}

export async function googleDriveJson<T>(
  connection: ContentConnection,
  input: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  dependencies: GoogleDriveHttpDependencies = {},
) {
  let accessToken = await googleDriveAccessToken(connection, dependencies);
  let response = await googleTextWithToken(
    accessToken,
    input,
    init,
    dependencies,
  );
  if (response.status === 401) {
    accessToken = await googleDriveAccessToken(connection, dependencies, {
      forceRefresh: true,
    });
    response = await googleTextWithToken(
      accessToken,
      input,
      init,
      dependencies,
    );
  }
  if (response.status === 410) throw new GoogleDriveCursorExpiredError();
  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401) await markConnectionExpired(connection);
    googleResponseError(response.status);
  }
  const parsed = schema.safeParse(safeJson(response.content, "Google Drive"));
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "Google Drive returned an incomplete response",
    );
  }
  return parsed.data;
}

const FILE_FIELDS =
  "id,name,mimeType,size,modifiedTime,md5Checksum,version,parents,trashed,driveId,capabilities(canDownload),shortcutDetails(targetId,targetMimeType)";

function escapeDriveQueryLiteral(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function listGoogleDriveFiles(
  connection: ContentConnection,
  query: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const rows: GoogleDriveFile[] = [];
  let pageToken: string | null = null;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_BROWSE_PAGES || rows.length >= MAX_BROWSE_ITEMS) {
      throw new NonRetryableSyncError(
        "This Google Drive folder is too large to browse safely",
      );
    }
    const params = new URLSearchParams({
      q: query,
      spaces: "drive",
      pageSize: "1000",
      orderBy: "folder,name_natural",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleDriveJson(
      connection,
      `files?${params}`,
      fileListSchema,
      {},
      dependencies,
    );
    if (result.incompleteSearch) {
      throw new RetryableSyncError(
        "Google Drive returned an incomplete folder listing",
      );
    }
    rows.push(...result.files);
    if (rows.length > MAX_BROWSE_ITEMS) {
      throw new NonRetryableSyncError(
        "This Google Drive folder is too large to browse safely",
      );
    }
    pageToken = result.nextPageToken ?? null;
    if (!pageToken) return rows;
  }
}

export async function requireGoogleDriveFile(
  connection: ContentConnection,
  fileId: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const params = new URLSearchParams({
    supportsAllDrives: "true",
    fields: FILE_FIELDS,
  });
  return googleDriveJson(
    connection,
    `files/${encodeURIComponent(fileId)}?${params}`,
    googleDriveFileSchema,
    {},
    dependencies,
  );
}

export async function requireGoogleDriveFolder(
  connection: ContentConnection,
  folderId: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  if (folderId === GOOGLE_DRIVE_SHARED_WITH_ME_ROOT) {
    throw new NonRetryableSyncError(
      "Shared with me is a navigation collection, not a selectable folder",
    );
  }
  const item = await requireGoogleDriveFile(connection, folderId, dependencies);
  if (item.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
    throw new NonRetryableSyncError(
      "The selected Google Drive item is not a folder",
    );
  }
  return item;
}

export function googleDriveFileSize(item: GoogleDriveFile) {
  if (item.size === undefined) return null;
  const value = Number(item.size);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export async function listGoogleDriveChildren(
  connection: ContentConnection,
  folderId: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  await requireGoogleDriveFolder(connection, folderId, dependencies);
  return listGoogleDriveFiles(
    connection,
    `'${escapeDriveQueryLiteral(folderId)}' in parents and trashed = false`,
    dependencies,
  );
}

async function listSharedDrives(
  connection: ContentConnection,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const rows: Array<z.infer<typeof sharedDriveSchema>> = [];
  let pageToken: string | null = null;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_BROWSE_PAGES || rows.length >= MAX_BROWSE_ITEMS) {
      throw new NonRetryableSyncError(
        "This Google Drive account has too many shared drives to browse safely",
      );
    }
    const params = new URLSearchParams({
      pageSize: "100",
      fields: "nextPageToken,drives(id,name)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleDriveJson(
      connection,
      `drives?${params}`,
      sharedDriveListSchema,
      {},
      dependencies,
    );
    rows.push(...result.drives);
    pageToken = result.nextPageToken ?? null;
    if (!pageToken) return rows;
  }
}

export interface GoogleDriveBrowseEntry {
  id: string;
  name: string;
  kind: "folder" | "file";
  childCount?: number;
  selectable?: boolean;
}

function browseEntry(item: GoogleDriveFile): GoogleDriveBrowseEntry | null {
  if (item.mimeType === GOOGLE_DRIVE_SHORTCUT_MIME) return null;
  return {
    id: item.id,
    name: item.name,
    kind: item.mimeType === GOOGLE_DRIVE_FOLDER_MIME ? "folder" : "file",
  };
}

export async function browseGoogleDrive(
  connection: ContentConnection,
  remoteFolderId?: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const id = remoteFolderId?.trim();
  if (id === GOOGLE_DRIVE_SHARED_WITH_ME_ROOT) {
    const shared = await listGoogleDriveFiles(
      connection,
      "sharedWithMe = true and trashed = false",
      dependencies,
    );
    return shared.flatMap((item) => {
      const entry = browseEntry(item);
      return entry ? [entry] : [];
    });
  }

  if (id) {
    const children = await listGoogleDriveChildren(
      connection,
      id,
      dependencies,
    );
    return children.flatMap((item) => {
      const entry = browseEntry(item);
      return entry ? [entry] : [];
    });
  }

  const [myDriveChildren, sharedDrives] = await Promise.all([
    listGoogleDriveFiles(
      connection,
      "'root' in parents and trashed = false",
      dependencies,
    ),
    listSharedDrives(connection, dependencies),
  ]);
  return [
    {
      id: GOOGLE_DRIVE_SHARED_WITH_ME_ROOT,
      name: "Shared with me",
      kind: "folder" as const,
      selectable: false,
    },
    ...sharedDrives.map((drive) => ({
      id: drive.id,
      name: drive.name,
      kind: "folder" as const,
      selectable: true,
    })),
    ...myDriveChildren.flatMap((item) => {
      const entry = browseEntry(item);
      return entry ? [entry] : [];
    }),
  ];
}

const MAX_SCOPE_ANCESTOR_HOPS = 256;
const MAX_SCOPE_ANCESTOR_LOOKUPS = 2_000;

/** Collapse selected Google folders to an ancestor-free set. */
export async function normalizeGoogleDriveFolderScope(
  connection: ContentConnection,
  folderIds: readonly string[],
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const unique = [...new Set(folderIds)];
  if (unique.includes(GOOGLE_DRIVE_SHARED_WITH_ME_ROOT)) {
    throw new NonRetryableSyncError(
      "Shared with me is a navigation collection, not a selectable folder",
    );
  }
  const selected = new Set(unique);
  const folders = new Map<string, GoogleDriveFile>();
  let lookups = 0;
  const load = async (folderId: string) => {
    const cached = folders.get(folderId);
    if (cached) return cached;
    lookups += 1;
    if (lookups > MAX_SCOPE_ANCESTOR_LOOKUPS) {
      throw new NonRetryableSyncError(
        "The selected Google Drive folder ancestry is too large to validate safely",
      );
    }
    const folder = await requireGoogleDriveFolder(
      connection,
      folderId,
      dependencies,
    );
    if (folder.id !== folderId) {
      throw new NonRetryableSyncError(
        "Google Drive returned an inconsistent folder identity",
      );
    }
    folders.set(folderId, folder);
    return folder;
  };

  for (const folderId of unique) await load(folderId);
  const descendants = new Set<string>();
  for (const folderId of unique) {
    let cursor = (await load(folderId)).parents?.[0];
    const seen = new Set([folderId]);
    for (let hop = 0; cursor; hop += 1) {
      if (hop >= MAX_SCOPE_ANCESTOR_HOPS || seen.has(cursor)) {
        throw new NonRetryableSyncError(
          "The selected Google Drive folder ancestry is invalid or too deep",
        );
      }
      if (selected.has(cursor)) {
        descendants.add(folderId);
        break;
      }
      seen.add(cursor);
      cursor = (await load(cursor)).parents?.[0];
    }
  }
  return unique.filter((folderId) => !descendants.has(folderId));
}

export async function getGoogleDriveStartPageToken(
  connection: ContentConnection,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  const result = await googleDriveJson(
    connection,
    `changes/startPageToken?${params}`,
    startPageTokenSchema,
    {},
    dependencies,
  );
  return result.startPageToken;
}

export async function readGoogleDriveChangesPage(
  connection: ContentConnection,
  pageToken: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const params = new URLSearchParams({
    pageToken,
    pageSize: "1000",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    includeRemoved: "true",
    fields: `nextPageToken,newStartPageToken,changes(removed,fileId,driveId,changeType,file(${FILE_FIELDS}))`,
  });
  return googleDriveJson(
    connection,
    `changes?${params}`,
    changeListSchema,
    {},
    dependencies,
  );
}

async function streamingGoogleRequest(
  connection: ContentConnection,
  input: string,
  dependencies: GoogleDriveHttpDependencies,
) {
  let accessToken = await googleDriveAccessToken(connection, dependencies);
  const request = (token: string) =>
    fetchPinnedProviderResponse(
      googleApiUrl(input),
      {
        headers: { authorization: `Bearer ${token}` },
        redirect: "manual",
      },
      {
        expectedOrigin: GOOGLE_API_ORIGIN,
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        signal: dependencies.signal,
      },
    );
  let response = await request(accessToken);
  if (response.status === 401) {
    void response.body?.cancel().catch(() => undefined);
    accessToken = await googleDriveAccessToken(connection, dependencies, {
      forceRefresh: true,
    });
    response = await request(accessToken);
  }
  return response;
}

async function finishGoogleDownload(
  response: Response,
  dependencies: GoogleDriveHttpDependencies,
) {
  let current = response;
  for (
    let redirect = 0;
    current.status >= 300 && current.status < 400;
    redirect += 1
  ) {
    const location = current.headers.get("location");
    void current.body?.cancel().catch(() => undefined);
    if (!location || redirect >= 2) {
      throw new NonRetryableSyncError(
        "Google Drive returned an invalid download redirect",
      );
    }
    // A redirect target never receives the Google bearer token.
    current = await fetchPinnedProviderResponse(
      new URL(location),
      { redirect: "manual" },
      {
        fetch: dependencies.fetch,
        lookup: dependencies.lookup,
        signal: dependencies.signal,
      },
    );
  }
  if (current.status < 200 || current.status >= 300 || !current.body) {
    void current.body?.cancel().catch(() => undefined);
    googleResponseError(current.status);
  }
  const declared = Number(current.headers.get("content-length"));
  return {
    body: current.body,
    contentLength: Number.isFinite(declared) && declared >= 0 ? declared : null,
  };
}

export async function downloadGoogleDriveFile(
  connection: ContentConnection,
  fileId: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const params = new URLSearchParams({
    alt: "media",
    supportsAllDrives: "true",
  });
  const response = await streamingGoogleRequest(
    connection,
    `files/${encodeURIComponent(fileId)}?${params}`,
    dependencies,
  );
  return finishGoogleDownload(response, dependencies);
}

export interface GoogleDriveExportTarget {
  mimeType: string;
  extension: ".docx" | ".xlsx" | ".pptx";
}

export function googleDriveExportTarget(
  sourceMimeType: string,
): GoogleDriveExportTarget | null {
  switch (sourceMimeType) {
    case "application/vnd.google-apps.document":
      return {
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: ".docx",
      };
    case "application/vnd.google-apps.spreadsheet":
      return {
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: ".xlsx",
      };
    case "application/vnd.google-apps.presentation":
      return {
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extension: ".pptx",
      };
    default:
      return null;
  }
}

export async function exportGoogleDriveFile(
  connection: ContentConnection,
  fileId: string,
  mimeType: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const params = new URLSearchParams({ mimeType });
  const response = await streamingGoogleRequest(
    connection,
    `files/${encodeURIComponent(fileId)}/export?${params}`,
    dependencies,
  );
  return finishGoogleDownload(response, dependencies);
}

export function newGoogleDriveWebhookToken() {
  return randomBytes(32).toString("base64url");
}

export function googleDriveWebhookTokenHash(token: string) {
  return sha256(token);
}

export function matchesGoogleDriveWebhookToken(
  token: string,
  expectedHash: string,
) {
  const actual = Buffer.from(googleDriveWebhookTokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actual.length === expected.length &&
    actual.length === 32 &&
    timingSafeEqual(actual, expected)
  );
}

export async function createGoogleDriveChannel(
  connection: ContentConnection,
  pageToken: string,
  webhookToken: string,
  dependencies: GoogleDriveHttpDependencies = {},
) {
  const address = googleDriveWebhookUrl();
  if (!address) return null;
  const now = dependencies.now?.() ?? new Date();
  const requestedExpiration = new Date(now.getTime() + CHANNEL_LIFETIME_MS);
  const params = new URLSearchParams({
    pageToken,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    includeRemoved: "true",
  });
  const result = await googleDriveJson(
    connection,
    `changes/watch?${params}`,
    channelSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: randomUUID(),
        type: "web_hook",
        address,
        token: webhookToken,
        expiration: requestedExpiration.getTime().toString(),
      }),
    },
    dependencies,
  );
  const expiration = Number(result.expiration);
  const expiresAt = Number.isFinite(expiration)
    ? new Date(expiration)
    : requestedExpiration;
  if (Number.isNaN(expiresAt.getTime())) {
    throw new NonRetryableSyncError(
      "Google Drive returned an invalid channel expiry",
    );
  }
  return { id: result.id, resourceId: result.resourceId, expiresAt };
}

export async function deleteGoogleDriveChannel(
  connection: ContentConnection,
  channel: { id: string; resourceId: string },
  dependencies: GoogleDriveHttpDependencies = {},
) {
  let accessToken = await googleDriveAccessToken(connection, dependencies);
  const request = (token: string) =>
    googleTextWithToken(
      token,
      "channels/stop",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(channel),
      },
      dependencies,
    );
  let response = await request(accessToken);
  if (response.status === 401) {
    accessToken = await googleDriveAccessToken(connection, dependencies, {
      forceRefresh: true,
    });
    response = await request(accessToken);
  }
  if (
    response.status !== 204 &&
    response.status !== 404 &&
    (response.status < 200 || response.status >= 300)
  ) {
    googleResponseError(response.status);
  }
}
