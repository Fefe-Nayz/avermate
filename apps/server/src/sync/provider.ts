import type { SyncCapability, SyncProviderId } from "../db/schema";
import { ecoledirecteProvider } from "./ecoledirecte";
import { moodleProvider } from "./moodle";
import {
  assertSchoolProviderContract,
  type SchoolProviderAdapter,
} from "./school-provider";
import {
  developmentSchoolProvidersEnabled,
  SCHOOL_PROVIDER_CATALOG,
  schoolProviderDescriptorForRuntime,
} from "./school-provider-catalog";

export interface ProviderFile {
  externalId: string;
  fileName: string;
  folderPath: string[];
  mimeType: string | null;
  byteSize: number | null;
  modifiedAt: Date | null;
  courseRef: { externalId: string; name: string };
}

export interface OpenConnection {
  id: string;
  userId: string;
  yearId: string;
  baseUrl: string;
  credentials: string;
  /** Opaque ciphertext used only as a compare-and-swap revision for token rotation. */
  credentialRevision?: string;
  caCertPem: string | null;
}

/** A single-use, provider-owned response stream. The caller must consume or cancel it. */
export interface ProviderDownload {
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
}

export interface ProviderRequestOptions {
  signal?: AbortSignal;
}

export interface ProviderCredentialChallenge {
  status: "challenge";
  challengeId: string;
  kind: "totp" | "question";
  question: string | null;
  choices: string[];
  expiresAt: Date;
}

export interface ProviderCredentialSuccess {
  status: "connected";
  credentials: string;
  accountLabel: string;
  /** Stable provider identity for the selected student/resource. */
  remoteStudentId?: string;
  /** Stable provider identity for the selected academic year, when exposed. */
  remoteAcademicYearId?: string;
}

export interface SyncProvider {
  id: SyncProviderId;
  capabilities: SyncCapability[];
  school?: SchoolProviderAdapter;
  normalizeBaseUrl?(input: string): string;
  /** Drop any in-memory SDK state after a connection is deleted. */
  forgetConnection?(connectionId: string): void;
  /** Release per-run SDK state after every success or failure. */
  releaseConnection?(connection: OpenConnection): void | Promise<void>;
  beginCredentialInput?(
    owner: { userId: string; yearId: string },
    baseUrl: string,
    input: string,
    options?: { caCertPem?: string | null; signal?: AbortSignal },
  ): Promise<ProviderCredentialSuccess | ProviderCredentialChallenge>;
  completeCredentialChallenge?(
    owner: { userId: string; yearId: string },
    challengeId: string,
    response: string,
    options?: ProviderRequestOptions,
  ): Promise<ProviderCredentialSuccess>;
  parseCredentialInput(
    baseUrl: string,
    input: string,
    options?: { caCertPem?: string | null; signal?: AbortSignal },
  ): Promise<{
    credentials: string;
    accountLabel: string;
    remoteStudentId?: string;
    remoteAcademicYearId?: string;
  }>;
  listCourses(
    connection: OpenConnection,
    options?: ProviderRequestOptions,
  ): Promise<{ externalId: string; name: string }[]>;
  listFiles(
    connection: OpenConnection,
    courseExternalId: string,
    options?: ProviderRequestOptions,
  ): Promise<ProviderFile[]>;
  download(
    connection: OpenConnection,
    file: ProviderFile,
    options?: ProviderRequestOptions,
  ): Promise<ProviderDownload>;
}

interface DevelopmentProviderLoaders {
  pronote: () => Promise<{ pronoteProvider: SyncProvider }>;
  skolengo: () => Promise<{ skolengoProvider: SyncProvider }>;
}

// Keep GPL modules invisible to the production bundler as well as the
// production runtime. Development executes TypeScript source, where this
// relative import resolves beside this file; the release registry never calls
// it.
function importDevelopmentProvider(specifier: string) {
  return import(specifier);
}

const DEVELOPMENT_PROVIDER_LOADERS: DevelopmentProviderLoaders = {
  pronote: () =>
    importDevelopmentProvider("./pronote") as Promise<{
      pronoteProvider: SyncProvider;
    }>,
  skolengo: () =>
    importDevelopmentProvider("./skolengo") as Promise<{
      skolengoProvider: SyncProvider;
    }>,
};

export async function createSyncProviderRegistry(options?: {
  enableDevelopmentProviders?: boolean;
  loaders?: DevelopmentProviderLoaders;
}) {
  const registry: Partial<Record<SyncProviderId, SyncProvider>> = {
    moodle: moodleProvider,
    ecoledirecte: ecoledirecteProvider,
  };
  if (
    options?.enableDevelopmentProviders ??
    developmentSchoolProvidersEnabled()
  ) {
    const loaders = options?.loaders ?? DEVELOPMENT_PROVIDER_LOADERS;
    const [{ pronoteProvider }, { skolengoProvider }] = await Promise.all([
      loaders.pronote(),
      loaders.skolengo(),
    ]);
    assertSchoolProviderContract(
      schoolProviderDescriptorForRuntime("pronote", true),
      pronoteProvider.school!,
    );
    assertSchoolProviderContract(
      schoolProviderDescriptorForRuntime("skolengo", true),
      skolengoProvider.school!,
    );
    registry.pronote = pronoteProvider;
    registry.skolengo = skolengoProvider;
  }
  return registry;
}

/** Mutable by design so isolated tests can replace a provider without network. */
export const SYNC_PROVIDERS = await createSyncProviderRegistry();

assertSchoolProviderContract(
  SCHOOL_PROVIDER_CATALOG.ecoledirecte,
  ecoledirecteProvider.school,
);
