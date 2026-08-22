import { Client, Require2FA } from "@blockshub/blocksdirecte";
import {
  addIsoDays,
  isoDateInTimeZone,
  zonedDateTimeToDate,
} from "@avermate/core/planning";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { syncConnections } from "../db/schema";
import { open, seal } from "../lib/crypto";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "./errors";
import type {
  OpenConnection,
  ProviderCredentialChallenge,
  ProviderCredentialSuccess,
  ProviderRequestOptions,
  SyncProvider,
} from "./provider";
import {
  assertSchoolSyncWindow,
  normalizeSchoolTimezone,
  type ProviderAttachment,
  type ProviderGrade,
  type ProviderHomework,
  type ProviderListOptions,
  type ProviderSchoolCalendarEvent,
  type ProviderSubjectRef,
  type ProviderTimetableLesson,
  type SchoolProviderAdapter,
} from "./school-provider";

const ECOLEDIRECTE_API_URL = "https://api.ecoledirecte.com";
const CREDENTIAL_CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_PENDING_CREDENTIAL_CHALLENGES = 1_000;

const credentialInputSchema = z
  .object({
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1_024),
    accountIndex: z.number().int().min(0).max(100).default(0),
    deviceUuid: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    twoFactor: z
      .object({
        cn: z.string().min(1).max(2_048),
        cv: z.string().min(1).max(2_048),
      })
      .optional(),
    refresh: z
      .object({
        accountKind: z.string().trim().min(1).max(10),
        accessToken: z.string().min(1).max(16_384),
      })
      .optional(),
  })
  .strict();

type EcoleDirecteCredentialInput = z.infer<typeof credentialInputSchema> & {
  version: 1;
};

const storedCredentialV1Schema = credentialInputSchema.extend({
  version: z.literal(1),
});

const storedCredentialV2Schema = credentialInputSchema.extend({
  version: z.literal(2),
  accountId: z.number().int().nonnegative(),
});

const storedCredentialsSchema = z.union([
  storedCredentialV2Schema,
  storedCredentialV1Schema,
]);

type EcoleDirecteCredentials = z.infer<typeof storedCredentialsSchema>;

interface BlocksDirecteAccount {
  id: number;
  typeCompte: string;
  accessToken?: string;
  prenom?: string;
  nom?: string;
  nomEtablissement?: string;
}

interface BlocksDirecteAuthentication {
  token: string;
  accounts: BlocksDirecteAccount[];
}

interface BlocksDirecteCloudFile {
  id: number;
  libelle: string;
  taille: number;
  type: string;
}

interface BlocksDirecteHomework {
  idDevoir: number;
  contenu?: string;
  rendreEnLigne?: boolean;
  donneLe?: string;
  effectue?: boolean;
  ressource?: string;
  ressourceDocuments?: BlocksDirecteCloudFile[];
  documents?: BlocksDirecteCloudFile[];
  contenuDeSeance?: { documents?: BlocksDirecteCloudFile[] };
}

interface BlocksDirecteHomeworkSubject {
  matiere: string;
  codeMatiere: string;
  id: number;
  aFaire?: BlocksDirecteHomework;
}

interface BlocksDirecteHomeworkDate {
  date: string;
  matieres: BlocksDirecteHomeworkSubject[];
}

type BlocksDirecteUpcomingHomework = Record<string, unknown>;

interface BlocksDirecteTimetableCourse {
  id: number;
  text?: string;
  matiere?: string;
  codeMatiere?: string;
  start_date: string;
  end_date: string;
  salle?: string;
  isAnnule?: boolean;
  isModifie?: boolean;
}

interface BlocksDirecteMark {
  id: number;
  devoir: string;
  codePeriode?: string;
  codeMatiere: string;
  libelleMatiere: string;
  date: string;
  coef?: string;
  noteSur?: string;
  valeur?: string;
  nonSignificatif?: boolean;
  dateSaisie?: string;
}

interface BlocksDirecteMarks {
  periodes?: {
    idPeriode: string;
    codePeriode: string;
    periode: string;
  }[];
  notes?: BlocksDirecteMark[];
}

interface BlocksDirecteTimelineEvent {
  id: number;
  dateDebut: string;
  dateFin?: string;
  heureDebut?: string;
  heureFin?: string;
  libelle: string;
  description?: string;
  theme?: string;
}

interface BlocksDirecteClient {
  setAbortSignal(signal?: AbortSignal): void;
  dispose(): void;
  auth: {
    loginUsername(
      username: string,
      password: string,
      cn?: string,
      cv?: string,
      keepSessionOpen?: boolean,
      deviceUuid?: string,
    ): Promise<BlocksDirecteAuthentication>;
    refreshToken(
      username: string,
      accountKind: string,
      accessToken: string,
      cn?: string,
      cv?: string,
      deviceUuid?: string,
    ): Promise<BlocksDirecteAuthentication>;
    get2FAQuestion(token: string): Promise<{
      question: string;
      propositions: string[];
    }>;
    send2FAQuestion(
      response: string,
      token: string,
    ): Promise<{ cn: string; cv: string }>;
    setAccount(index: number): void;
    getAccount(): BlocksDirecteAccount;
  };
  homework: {
    getUpcomingHomework(): Promise<BlocksDirecteUpcomingHomework>;
    getHomeworksForDate(date: string): Promise<BlocksDirecteHomeworkDate>;
  };
  timetable: {
    getTimetableBetweenDates(
      from: Date,
      to: Date,
      includeBreak?: boolean,
    ): Promise<BlocksDirecteTimetableCourse[]>;
  };
  marks: { getMark(schoolYear?: string): Promise<BlocksDirecteMarks> };
  timeline: {
    getPublicTimeline(): Promise<{
      evenements?: BlocksDirecteTimelineEvent[];
    }>;
  };
  downloader: {
    getStream(
      fileId: number,
      fileType: string,
    ): Promise<ReadableStream<Uint8Array> | null>;
  };
}

export interface EcoleDirecteDependencies {
  createClient?: () => BlocksDirecteClient;
  persistCredentials?: (
    connection: OpenConnection,
    credentials: string,
  ) => Promise<void>;
}

function defaultClientFactory() {
  return new Client() as unknown as BlocksDirecteClient;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("The ÉcoleDirecte synchronization was aborted");
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  operation: string,
) {
  throwIfAborted(signal);
  let onAbort: (() => void) | undefined;
  try {
    return await (signal
      ? Promise.race([
          promise,
          new Promise<never>((_resolve, reject) => {
            onAbort = () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("The ÉcoleDirecte synchronization was aborted"),
              );
            signal.addEventListener("abort", onAbort, { once: true });
          }),
        ])
      : promise);
  } catch (error) {
    throwIfAborted(signal);
    if (
      (error as { name?: string }).name === "Require2FA" ||
      (error as { name?: string }).name === "InvalidCredentials" ||
      (error as { name?: string }).name === "Invalid2FAKey"
    ) {
      throw error;
    }
    if (error instanceof NonRetryableSyncError) throw error;
    throw new RetryableSyncError(`ÉcoleDirecte ${operation} failed`, {
      cause: error,
    });
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

function parseCredentialInput(input: string): EcoleDirecteCredentialInput {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("ÉcoleDirecte credentials must be valid JSON");
  }
  const parsed = credentialInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("The ÉcoleDirecte credential payload is invalid");
  }
  return {
    version: 1,
    ...parsed.data,
    ...(parsed.data.timezone
      ? { timezone: normalizeSchoolTimezone(parsed.data.timezone) }
      : {}),
  };
}

function openCredentials(connection: OpenConnection) {
  let value: unknown;
  try {
    value = JSON.parse(connection.credentials);
  } catch {
    throw new NonRetryableSyncError(
      "The sealed ÉcoleDirecte credentials are invalid",
    );
  }
  const parsed = storedCredentialsSchema.safeParse(value);
  if (!parsed.success) {
    throw new NonRetryableSyncError(
      "The sealed ÉcoleDirecte credentials are invalid",
    );
  }
  return parsed.data;
}

function accountLabel(account: BlocksDirecteAccount) {
  return (
    [account.prenom, account.nom].filter(Boolean).join(" ").trim() ||
    account.nomEtablissement?.trim() ||
    "ÉcoleDirecte"
  ).slice(0, 160);
}

interface PendingEcoleDirecteChallenge {
  client: BlocksDirecteClient;
  credentials: EcoleDirecteCredentials;
  token: string;
  kind: "totp" | "question";
  question: string | null;
  choices: string[];
}

class EcoleDirecteChallengeSignal extends Error {
  constructor(readonly pending: PendingEcoleDirecteChallenge) {
    super("ÉcoleDirecte requires a second authentication factor");
    this.name = "EcoleDirecteChallengeSignal";
  }
}

interface SelectedEcoleDirecteAccount {
  account: BlocksDirecteAccount;
  index: number;
}

function credentialsWithRefresh(
  credentials: EcoleDirecteCredentials,
  selection: SelectedEcoleDirecteAccount,
): EcoleDirecteCredentials {
  const { account, index } = selection;
  return {
    ...credentials,
    version: 2,
    accountId: account.id,
    accountIndex: index,
    refresh:
      account.accessToken && account.typeCompte
        ? { accountKind: account.typeCompte, accessToken: account.accessToken }
        : credentials.refresh,
  };
}

export async function persistEcoleDirecteCredentials(
  connection: OpenConnection,
  credentials: string,
) {
  if (!connection.credentialRevision) {
    throw new NonRetryableSyncError(
      "The ÉcoleDirecte credential revision is unavailable",
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
        eq(syncConnections.provider, "ecoledirecte"),
        eq(syncConnections.sealedCredentials, connection.credentialRevision),
        ne(syncConnections.status, "revoked"),
      ),
    )
    .returning({ id: syncConnections.id });
  if (!updated) {
    throw new RetryableSyncError(
      "The ÉcoleDirecte credentials changed concurrently; retry synchronization",
    );
  }
  connection.credentialRevision = nextRevision;
  connection.credentials = credentials;
}

function prepareSecondFactorReplay(client: BlocksDirecteClient) {
  // Current ÉcoleDirecte login replays keep GTK/cookies but deliberately omit
  // the transient 2FA-Token header. BlocksDirecte does not expose that switch,
  // so clear only this pinned SDK transport field before the final login POST.
  const transport = (
    client as unknown as {
      restManager?: { twoFaToken?: string };
    }
  ).restManager;
  if (transport) transport.twoFaToken = undefined;
}

async function authenticate(
  client: BlocksDirecteClient,
  credentials: EcoleDirecteCredentials,
  signal?: AbortSignal,
  allowChallenge = false,
) {
  throwIfAborted(signal);
  client.setAbortSignal(signal);
  let authentication: BlocksDirecteAuthentication;
  try {
    const passwordLogin = () =>
      awaitWithSignal(
        client.auth.loginUsername(
          credentials.username,
          credentials.password,
          credentials.twoFactor?.cn,
          credentials.twoFactor?.cv,
          true,
          credentials.deviceUuid,
        ),
        signal,
        "authentication",
      );
    if (credentials.refresh) {
      try {
        authentication = await awaitWithSignal(
          client.auth.refreshToken(
            credentials.username,
            credentials.refresh.accountKind,
            credentials.refresh.accessToken,
            credentials.twoFactor?.cn,
            credentials.twoFactor?.cv,
            credentials.deviceUuid,
          ),
          signal,
          "token refresh",
        );
      } catch (error) {
        if ((error as { name?: string }).name !== "InvalidCredentials") {
          throw error;
        }
        authentication = await passwordLogin();
      }
    } else {
      authentication = await passwordLogin();
    }
  } catch (error) {
    if (
      error instanceof Require2FA ||
      (error as { name?: string }).name === "Require2FA"
    ) {
      const challenge = error as {
        token?: unknown;
        kind?: unknown;
      };
      const token =
        typeof challenge.token === "string" ? challenge.token.trim() : "";
      const kind = challenge.kind === "totp" ? "totp" : "question";
      if (allowChallenge && token) {
        let question: string | null = null;
        let choices: string[] = [];
        if (kind === "question") {
          const remote = await awaitWithSignal(
            client.auth.get2FAQuestion(token),
            signal,
            "identity challenge",
          );
          question = remote.question.trim().slice(0, 500) || null;
          choices = remote.propositions
            .map((choice) => choice.trim().slice(0, 500))
            .filter(Boolean)
            .slice(0, 20);
          if (!question || choices.length === 0) {
            throw new NonRetryableSyncError(
              "ÉcoleDirecte returned an invalid identity challenge",
            );
          }
        }
        throw new EcoleDirecteChallengeSignal({
          client,
          credentials,
          token,
          kind,
          question,
          choices,
        });
      }
      throw new CredentialsRevokedSyncError(
        "ÉcoleDirecte requires a new second-factor verification",
      );
    }
    if ((error as { name?: string }).name === "InvalidCredentials") {
      throw new CredentialsRevokedSyncError(
        "ÉcoleDirecte rejected the username or password",
      );
    }
    if ((error as { name?: string }).name === "Invalid2FAKey") {
      throw new CredentialsRevokedSyncError(
        "ÉcoleDirecte rejected the stored second-factor proof",
      );
    }
    if (
      error instanceof RetryableSyncError ||
      error instanceof NonRetryableSyncError
    ) {
      throw error;
    }
    throw new RetryableSyncError("ÉcoleDirecte authentication failed", {
      cause: error,
    });
  }
  throwIfAborted(signal);
  let accountIndex = credentials.accountIndex;
  if (credentials.version === 2) {
    const matches = authentication.accounts.flatMap((account, index) =>
      account.id === credentials.accountId ? [{ account, index }] : [],
    );
    if (matches.length === 0) {
      throw new CredentialsRevokedSyncError(
        "The selected ÉcoleDirecte account no longer exists",
      );
    }
    if (matches.length > 1) {
      throw new CredentialsRevokedSyncError(
        "ÉcoleDirecte returned an ambiguous selected account; reconnect the account",
      );
    }
    accountIndex = matches[0]!.index;
  } else if (accountIndex >= authentication.accounts.length) {
    throw new CredentialsRevokedSyncError(
      "The selected ÉcoleDirecte account no longer exists",
    );
  }
  const advertisedAccount = authentication.accounts[accountIndex];
  if (!advertisedAccount) {
    throw new CredentialsRevokedSyncError(
      "The selected ÉcoleDirecte account no longer exists",
    );
  }
  client.auth.setAccount(accountIndex);
  const account = client.auth.getAccount();
  if (account.id !== advertisedAccount.id) {
    throw new CredentialsRevokedSyncError(
      "ÉcoleDirecte could not revalidate the selected account identity",
    );
  }
  return { account, index: accountIndex };
}

export function normalizeEcoleDirecteBaseUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid ÉcoleDirecte URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.hostname === "ecoledirecte.com" ||
      url.hostname.endsWith(".ecoledirecte.com")
    )
  ) {
    throw new Error("Enter an official HTTPS ÉcoleDirecte URL");
  }
  return ECOLEDIRECTE_API_URL;
}

function isoDate(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

function parseLocalDateTime(
  value: string,
  timezone: string,
  fallbackMinutes = 0,
) {
  const trimmed = value.trim();
  const explicitInstant = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
    ? new Date(trimmed)
    : null;
  if (explicitInstant && Number.isFinite(explicitInstant.getTime())) {
    return explicitInstant;
  }
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(trimmed);
  if (!match) return null;
  const minutes = match[2]
    ? Number(match[2]) * 60 + Number(match[3])
    : fallbackMinutes;
  try {
    return zonedDateTimeToDate(match[1]!, minutes, timezone);
  } catch {
    return null;
  }
}

function dateAtEndOfDay(value: string, timezone: string) {
  const date = isoDate(value);
  if (!date) return null;
  try {
    return new Date(
      zonedDateTimeToDate(addIsoDays(date, 1), 0, timezone).getTime() - 1,
    );
  } catch {
    return null;
  }
}

function plainText(value: string | null | undefined) {
  const text = (value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function subjectRef(code: string | null | undefined, name: string) {
  const normalizedName = name.trim();
  if (!normalizedName) return null;
  return {
    externalId: code?.trim() || normalizedName,
    name: normalizedName,
  } satisfies ProviderSubjectRef;
}

function numberFromProvider(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function attachmentFromCloudFile(
  homeworkId: number,
  subject: ProviderSubjectRef | null,
  file: BlocksDirecteCloudFile,
): ProviderAttachment | null {
  if (!Number.isSafeInteger(file.id) || file.id < 0) return null;
  const fileName = file.libelle?.trim();
  const fileType = file.type?.trim();
  if (!fileName || !fileType) return null;
  return {
    externalId: `homework:${homeworkId}:file:${file.id}:${fileType}`,
    fileName: fileName.slice(0, 240),
    mimeType: null,
    byteSize:
      Number.isSafeInteger(file.taille) && file.taille >= 0
        ? file.taille
        : null,
    subject,
    modifiedAt: null,
    downloadRef: JSON.stringify({ version: 1, id: file.id, type: fileType }),
  };
}

function homeworkAttachments(
  subject: ProviderSubjectRef | null,
  homework: BlocksDirecteHomework,
) {
  const candidates = [
    ...(homework.documents ?? []),
    ...(homework.ressourceDocuments ?? []),
    ...(homework.contenuDeSeance?.documents ?? []),
  ];
  const seen = new Set<string>();
  return candidates.flatMap((file) => {
    const attachment = attachmentFromCloudFile(
      homework.idDevoir,
      subject,
      file,
    );
    if (!attachment || seen.has(attachment.externalId)) return [];
    seen.add(attachment.externalId);
    return [attachment];
  });
}

function normalizeHomework(
  dueDate: string,
  value: BlocksDirecteHomeworkSubject,
  timezone: string,
): ProviderHomework | null {
  const homework = value.aFaire;
  if (!homework || !Number.isSafeInteger(homework.idDevoir)) return null;
  const subject = subjectRef(value.codeMatiere, value.matiere);
  const instructions = plainText(homework.contenu ?? homework.ressource);
  return {
    externalId: String(homework.idDevoir),
    title: `Travail à faire — ${subject?.name ?? "ÉcoleDirecte"}`,
    instructions,
    assignedAt: homework.donneLe
      ? parseLocalDateTime(homework.donneLe, timezone)
      : null,
    dueAt: dateAtEndOfDay(dueDate, timezone),
    subject,
    completedUpstream:
      typeof homework.effectue === "boolean" ? homework.effectue : null,
    attachments: homeworkAttachments(subject, homework),
    modifiedAt: homework.donneLe
      ? parseLocalDateTime(homework.donneLe, timezone)
      : null,
  };
}

function sdkDate(value: string) {
  // BlocksDirecte 0.0.8 formats dates with getFullYear/getMonth/getDate.
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12);
}

const attachmentDownloadRefSchema = z
  .object({
    version: z.literal(1),
    id: z.number().int().nonnegative(),
    type: z.string().trim().min(1).max(200),
  })
  .strict();

export function createEcoleDirecteProvider(
  dependencies: EcoleDirecteDependencies = {},
): SyncProvider & { school: SchoolProviderAdapter } {
  const createClient = dependencies.createClient ?? defaultClientFactory;
  const persistCredentials =
    dependencies.persistCredentials ?? persistEcoleDirecteCredentials;
  // The pinned BlocksDirecte patch gives each client an owned, disposable
  // rate-limit timer. Reuse one instance per immutable connection id so a
  // connected service also keeps its authenticated upstream session.
  const clientInstances = new Map<string, BlocksDirecteClient>();
  const connectedClients = new WeakMap<
    OpenConnection,
    Promise<BlocksDirecteClient>
  >();
  const homeworkCache = new WeakMap<
    OpenConnection,
    Map<string, Promise<ProviderHomework[]>>
  >();
  const timetableCache = new WeakMap<
    OpenConnection,
    Map<string, Promise<ProviderTimetableLesson[]>>
  >();
  const pendingChallenges = new Map<
    string,
    {
      userId: string;
      yearId: string;
      expiresAt: Date;
      client: BlocksDirecteClient;
      sealedState: string;
      expiryTimer: ReturnType<typeof setTimeout>;
    }
  >();

  function prunePendingChallenges(now = new Date()) {
    for (const [challengeId, challenge] of pendingChallenges) {
      if (challenge.expiresAt > now) continue;
      clearTimeout(challenge.expiryTimer);
      challenge.client.dispose();
      pendingChallenges.delete(challengeId);
    }
  }

  async function beginCredentialInput(
    owner: { userId: string; yearId: string },
    baseUrl: string,
    input: string,
    options?: { caCertPem?: string | null; signal?: AbortSignal },
  ): Promise<ProviderCredentialSuccess | ProviderCredentialChallenge> {
    normalizeEcoleDirecteBaseUrl(baseUrl);
    if (options?.caCertPem) {
      throw new Error("ÉcoleDirecte does not support a custom CA certificate");
    }
    const credentials = parseCredentialInput(input);
    const client = createClient();
    try {
      const selection = await authenticate(
        client,
        credentials,
        options?.signal,
        true,
      );
      return {
        status: "connected",
        credentials: JSON.stringify(
          credentialsWithRefresh(credentials, selection),
        ),
        accountLabel: accountLabel(selection.account),
        remoteStudentId: String(selection.account.id),
      };
    } catch (error) {
      if (!(error instanceof EcoleDirecteChallengeSignal)) {
        throw error;
      }
      prunePendingChallenges();
      if (pendingChallenges.size >= MAX_PENDING_CREDENTIAL_CHALLENGES) {
        client.dispose();
        throw new RetryableSyncError(
          "ÉcoleDirecte verification is temporarily unavailable",
        );
      }
      const challengeId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + CREDENTIAL_CHALLENGE_TTL_MS);
      const expiryTimer = setTimeout(() => {
        const challenge = pendingChallenges.get(challengeId);
        if (!challenge || challenge.client !== client) return;
        pendingChallenges.delete(challengeId);
        client.dispose();
      }, CREDENTIAL_CHALLENGE_TTL_MS);
      expiryTimer.unref?.();
      pendingChallenges.set(challengeId, {
        ...owner,
        expiresAt,
        client,
        expiryTimer,
        sealedState: seal(
          JSON.stringify({
            version: 1,
            credentials: error.pending.credentials,
            token: error.pending.token,
            kind: error.pending.kind,
            choices: error.pending.choices,
          }),
        ),
      });
      return {
        status: "challenge",
        challengeId,
        kind: error.pending.kind,
        question: error.pending.question,
        choices: [...error.pending.choices],
        expiresAt,
      };
    } finally {
      // A challenged client is owned by pendingChallenges until confirmation
      // or expiry. Every other validation client is single-use.
      if (
        ![...pendingChallenges.values()].some(
          (challenge) => challenge.client === client,
        )
      ) {
        client.dispose();
      }
    }
  }

  async function completeCredentialChallenge(
    owner: { userId: string; yearId: string },
    challengeId: string,
    response: string,
    options?: ProviderRequestOptions,
  ): Promise<ProviderCredentialSuccess> {
    prunePendingChallenges();
    const challenge = pendingChallenges.get(challengeId);
    if (
      !challenge ||
      challenge.userId !== owner.userId ||
      challenge.yearId !== owner.yearId ||
      challenge.expiresAt <= new Date()
    ) {
      throw new NonRetryableSyncError(
        "The ÉcoleDirecte verification challenge expired",
      );
    }
    pendingChallenges.delete(challengeId);
    clearTimeout(challenge.expiryTimer);
    try {
      const decoded = JSON.parse(open(challenge.sealedState)) as {
        version?: unknown;
        credentials?: unknown;
        token?: unknown;
        kind?: unknown;
        choices?: unknown;
      };
      const credentials = credentialInputSchema
        .extend({ version: z.literal(1) })
        .parse(decoded.credentials);
      if (
        decoded.version !== 1 ||
        typeof decoded.token !== "string" ||
        (decoded.kind !== "totp" && decoded.kind !== "question") ||
        !Array.isArray(decoded.choices) ||
        !decoded.choices.every((choice) => typeof choice === "string")
      ) {
        throw new NonRetryableSyncError(
          "The ÉcoleDirecte verification challenge is invalid",
        );
      }
      let authenticationCredentials: EcoleDirecteCredentials;
      let persistentCredentials = credentials;
      if (decoded.kind === "totp") {
        const code = response.trim();
        if (!/^\d{6,8}$/.test(code)) {
          throw new NonRetryableSyncError(
            "Enter the valid ÉcoleDirecte verification code",
          );
        }
        authenticationCredentials = {
          ...credentials,
          twoFactor: { cn: "", cv: code },
        };
      } else {
        const choiceIndex = Number(response);
        const choice = decoded.choices[choiceIndex];
        if (!Number.isInteger(choiceIndex) || !choice) {
          throw new NonRetryableSyncError(
            "Choose a valid ÉcoleDirecte verification answer",
          );
        }
        challenge.client.setAbortSignal(options?.signal);
        const proof = await awaitWithSignal(
          challenge.client.auth.send2FAQuestion(choice, decoded.token),
          options?.signal,
          "identity verification",
        );
        authenticationCredentials = {
          ...credentials,
          twoFactor: { cn: proof.cn, cv: proof.cv },
        };
        persistentCredentials = authenticationCredentials;
      }
      prepareSecondFactorReplay(challenge.client);
      const selection = await authenticate(
        challenge.client,
        authenticationCredentials,
        options?.signal,
      );
      return {
        status: "connected",
        credentials: JSON.stringify(
          credentialsWithRefresh(persistentCredentials, selection),
        ),
        accountLabel: accountLabel(selection.account),
        remoteStudentId: String(selection.account.id),
      };
    } catch (error) {
      if (
        error instanceof NonRetryableSyncError ||
        error instanceof RetryableSyncError
      ) {
        throw error;
      }
      throw new NonRetryableSyncError(
        "ÉcoleDirecte rejected the verification response",
        { cause: error },
      );
    } finally {
      challenge.client.dispose();
    }
  }

  function connectedClient(
    connection: OpenConnection,
    options?: ProviderRequestOptions,
  ) {
    const existing = connectedClients.get(connection);
    if (existing) {
      return existing.then((client) => {
        client.setAbortSignal(options?.signal);
        return client;
      });
    }
    const pending = (async () => {
      const client =
        clientInstances.get(connection.id) ??
        (() => {
          const created = createClient();
          clientInstances.set(connection.id, created);
          return created;
        })();
      const credentials = openCredentials(connection);
      const selection = await authenticate(
        client,
        credentials,
        options?.signal,
      );
      const refreshed = credentialsWithRefresh(credentials, selection);
      const serialized = JSON.stringify(refreshed);
      if (serialized !== JSON.stringify(credentials)) {
        await persistCredentials(connection, serialized);
      }
      return client;
    })();
    connectedClients.set(connection, pending);
    pending.catch(() => {
      connectedClients.delete(connection);
      if (clientInstances.get(connection.id)) {
        clientInstances.get(connection.id)?.dispose();
        clientInstances.delete(connection.id);
      }
    });
    return pending;
  }

  async function listHomework(
    connection: OpenConnection,
    options: ProviderListOptions,
  ): Promise<ProviderHomework[]> {
    assertSchoolSyncWindow(options.window);
    const from = isoDateInTimeZone(
      options.window.from,
      options.window.timezone,
    );
    const to = isoDateInTimeZone(options.window.to, options.window.timezone);
    const cacheKey = `${from}:${to}:${options.window.timezone}`;
    const cache = homeworkCache.get(connection) ?? new Map();
    homeworkCache.set(connection, cache);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      const client = await connectedClient(connection, options);
      throwIfAborted(options.signal);
      const upcoming = await awaitWithSignal(
        client.homework.getUpcomingHomework(),
        options.signal,
        "homework discovery",
      );
      throwIfAborted(options.signal);
      const dates = Object.keys(upcoming)
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .filter((date) => date >= from && date <= to)
        .sort();
      const result: ProviderHomework[] = [];
      for (const date of dates) {
        throwIfAborted(options.signal);
        const details = await awaitWithSignal(
          client.homework.getHomeworksForDate(date),
          options.signal,
          "homework discovery",
        );
        throwIfAborted(options.signal);
        for (const subject of details.matieres ?? []) {
          const normalized = normalizeHomework(
            details.date || date,
            subject,
            options.window.timezone,
          );
          if (normalized) result.push(normalized);
        }
      }
      return result;
    })();
    cache.set(cacheKey, pending);
    pending.catch(() => cache.delete(cacheKey));
    return pending;
  }

  async function listTimetable(
    connection: OpenConnection,
    options: ProviderListOptions,
  ): Promise<ProviderTimetableLesson[]> {
    assertSchoolSyncWindow(options.window);
    const from = isoDateInTimeZone(
      options.window.from,
      options.window.timezone,
    );
    const to = isoDateInTimeZone(options.window.to, options.window.timezone);
    const cacheKey = `${from}:${to}:${options.window.timezone}`;
    const cache = timetableCache.get(connection) ?? new Map();
    timetableCache.set(connection, cache);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const pending = (async () => {
      const client = await connectedClient(connection, options);
      const rows = await awaitWithSignal(
        client.timetable.getTimetableBetweenDates(
          sdkDate(from),
          sdkDate(to),
          false,
        ),
        options.signal,
        "timetable discovery",
      );
      throwIfAborted(options.signal);
      return rows.flatMap((row): ProviderTimetableLesson[] => {
        const startsAt = parseLocalDateTime(
          row.start_date,
          options.window.timezone,
        );
        const endsAt = parseLocalDateTime(
          row.end_date,
          options.window.timezone,
        );
        if (!startsAt || !endsAt || endsAt <= startsAt) return [];
        const subject = subjectRef(
          row.codeMatiere,
          row.matiere ?? row.text ?? "",
        );
        return [
          {
            // The upstream row id identifies the occurrence. Keeping the start
            // time out of the key lets a reschedule update the same managed row
            // and preserves its local note/completion overlay.
            externalId: String(row.id),
            title: (row.matiere || row.text || "Cours ÉcoleDirecte")
              .trim()
              .slice(0, 160),
            notes: row.isModifie ? "Cours modifié par ÉcoleDirecte" : null,
            startsAt,
            endsAt,
            timezone: options.window.timezone,
            location: row.salle?.trim().slice(0, 300) || null,
            subject,
            cancelled: Boolean(row.isAnnule),
            modifiedAt: null,
          },
        ];
      });
    })();
    cache.set(cacheKey, pending);
    pending.catch(() => cache.delete(cacheKey));
    return pending;
  }

  const school: SchoolProviderAdapter = {
    id: "ecoledirecte",
    timezone(connection) {
      return normalizeSchoolTimezone(openCredentials(connection).timezone);
    },
    // BlocksDirecte does not document response completeness or range caps.
    // Absence from any current facet is therefore never deletion evidence.
    completeWindowFacets: [],
    facets: {
      homework: { list: listHomework },
      timetable: { list: listTimetable },
      grades: {
        async list(connection, options) {
          assertSchoolSyncWindow(options.window);
          const client = await connectedClient(connection, options);
          const marks = await awaitWithSignal(
            client.marks.getMark(),
            options.signal,
            "grade discovery",
          );
          throwIfAborted(options.signal);
          const periods = new Map(
            (marks.periodes ?? []).map((period) => [
              period.codePeriode,
              {
                externalId: period.idPeriode,
                name: period.periode,
              },
            ]),
          );
          return (marks.notes ?? []).flatMap((mark): ProviderGrade[] => {
            const passedAt = parseLocalDateTime(
              mark.date,
              options.window.timezone,
              12 * 60,
            );
            const subject = subjectRef(mark.codeMatiere, mark.libelleMatiere);
            if (
              !passedAt ||
              !subject ||
              passedAt < options.window.from ||
              passedAt > options.window.to
            ) {
              return [];
            }
            const period = mark.codePeriode
              ? periods.get(mark.codePeriode)
              : undefined;
            return [
              {
                externalId: String(mark.id),
                title: mark.devoir.trim().slice(0, 160) || "Note ÉcoleDirecte",
                subject,
                periodExternalId:
                  period?.externalId ?? mark.codePeriode ?? null,
                periodName: period?.name ?? null,
                passedAt,
                value: numberFromProvider(mark.valeur),
                outOf: numberFromProvider(mark.noteSur),
                coefficient: numberFromProvider(mark.coef) ?? 1,
                significant: !mark.nonSignificatif,
                modifiedAt: mark.dateSaisie
                  ? parseLocalDateTime(
                      mark.dateSaisie,
                      options.window.timezone,
                      12 * 60,
                    )
                  : null,
              },
            ];
          });
        },
      },
      attachments: {
        async list(connection, options) {
          const homework = await listHomework(connection, options);
          return homework.flatMap((item) => item.attachments);
        },
        async download(connection, attachment, options) {
          let decoded: unknown;
          try {
            decoded = JSON.parse(attachment.downloadRef);
          } catch {
            throw new NonRetryableSyncError(
              "ÉcoleDirecte returned an invalid attachment reference",
            );
          }
          const reference = attachmentDownloadRefSchema.safeParse(decoded);
          if (!reference.success) {
            throw new NonRetryableSyncError(
              "ÉcoleDirecte returned an invalid attachment reference",
            );
          }
          const client = await connectedClient(connection, options);
          throwIfAborted(options?.signal);
          const body = await awaitWithSignal(
            client.downloader.getStream(reference.data.id, reference.data.type),
            options?.signal,
            "attachment download",
          );
          throwIfAborted(options?.signal);
          if (!body) {
            throw new NonRetryableSyncError(
              "ÉcoleDirecte returned an empty attachment",
            );
          }
          return { body, contentLength: attachment.byteSize };
        },
      },
      "school-calendar": {
        async list(connection, options) {
          assertSchoolSyncWindow(options.window);
          const client = await connectedClient(connection, options);
          const [timeline, timetable] = await Promise.all([
            awaitWithSignal(
              client.timeline.getPublicTimeline(),
              options.signal,
              "school calendar discovery",
            ),
            listTimetable(connection, options),
          ]);
          throwIfAborted(options.signal);
          const events = (timeline.evenements ?? []).flatMap(
            (event): ProviderSchoolCalendarEvent[] => {
              const startValue = [event.dateDebut, event.heureDebut]
                .filter(Boolean)
                .join(" ");
              const endValue = [
                event.dateFin || event.dateDebut,
                event.heureFin,
              ]
                .filter(Boolean)
                .join(" ");
              const startsAt = parseLocalDateTime(
                startValue,
                options.window.timezone,
              );
              const endsAt = parseLocalDateTime(
                endValue,
                options.window.timezone,
              );
              if (
                !startsAt ||
                startsAt > options.window.to ||
                (endsAt ?? startsAt) < options.window.from
              ) {
                return [];
              }
              return [
                {
                  externalId: String(event.id),
                  kind: "event",
                  title: event.libelle.trim().slice(0, 160) || "ÉcoleDirecte",
                  description:
                    plainText(event.description ?? event.theme) ?? null,
                  startsAt,
                  endsAt: endsAt && endsAt >= startsAt ? endsAt : null,
                  allDay: !event.heureDebut,
                  timezone: options.window.timezone,
                  location: null,
                  modifiedAt: null,
                },
              ];
            },
          );
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
    id: "ecoledirecte",
    capabilities: ["homework", "timetable", "grades", "school-calendar"],
    school,
    normalizeBaseUrl: normalizeEcoleDirecteBaseUrl,
    beginCredentialInput,
    completeCredentialChallenge,
    forgetConnection(connectionId) {
      clientInstances.get(connectionId)?.dispose();
      clientInstances.delete(connectionId);
    },
    releaseConnection(connection) {
      clientInstances.get(connection.id)?.dispose();
      clientInstances.delete(connection.id);
    },
    async parseCredentialInput(baseUrl, input, options) {
      normalizeEcoleDirecteBaseUrl(baseUrl);
      if (options?.caCertPem) {
        throw new Error(
          "ÉcoleDirecte does not support a custom CA certificate",
        );
      }
      const credentials = parseCredentialInput(input);
      const client = createClient();
      try {
        const selection = await authenticate(
          client,
          credentials,
          options?.signal,
        );
        return {
          credentials: JSON.stringify(
            credentialsWithRefresh(credentials, selection),
          ),
          accountLabel: accountLabel(selection.account),
          remoteStudentId: String(selection.account.id),
        };
      } finally {
        client.dispose();
      }
    },
    async listCourses() {
      return [];
    },
    async listFiles() {
      return [];
    },
    async download() {
      throw new NonRetryableSyncError(
        "ÉcoleDirecte files are exposed through the attachment facet",
      );
    },
  };
}

export const ecoledirecteProvider = createEcoleDirecteProvider();
