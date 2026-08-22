import type { SyncProviderId } from "../db/schema";
import type {
  OpenConnection,
  ProviderDownload,
  ProviderRequestOptions,
} from "./provider";

export const SCHOOL_SYNC_CAPABILITIES = [
  "homework",
  "timetable",
  "grades",
  "attachments",
  "school-calendar",
] as const;

export type SchoolSyncCapability = (typeof SCHOOL_SYNC_CAPABILITIES)[number];

export interface SchoolSyncWindow {
  from: Date;
  to: Date;
  /** IANA zone used when a provider returns local wall-clock values. */
  timezone: string;
}

export interface ProviderSubjectRef {
  externalId: string;
  name: string;
}

interface ProviderResourceIdentity {
  /** Stable inside one provider connection and one facet. */
  externalId: string;
  modifiedAt: Date | null;
}

export interface ProviderAttachment extends ProviderResourceIdentity {
  fileName: string;
  mimeType: string | null;
  byteSize: number | null;
  subject: ProviderSubjectRef | null;
  /** Provider-private, opaque reference interpreted only by its downloader. */
  downloadRef: string;
}

export interface ProviderHomework extends ProviderResourceIdentity {
  title: string;
  instructions: string | null;
  assignedAt: Date | null;
  dueAt: Date | null;
  subject: ProviderSubjectRef | null;
  completedUpstream: boolean | null;
  attachments: ProviderAttachment[];
}

export interface ProviderTimetableLesson extends ProviderResourceIdentity {
  title: string;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location: string | null;
  subject: ProviderSubjectRef | null;
  cancelled: boolean;
}

export interface ProviderGrade extends ProviderResourceIdentity {
  title: string;
  subject: ProviderSubjectRef;
  periodExternalId: string | null;
  periodName: string | null;
  passedAt: Date;
  value: number | null;
  outOf: number | null;
  coefficient: number;
  significant: boolean;
}

export type ProviderSchoolCalendarKind = "event" | "holiday" | "workday";

export interface ProviderSchoolCalendarEvent extends ProviderResourceIdentity {
  kind: ProviderSchoolCalendarKind;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  timezone: string;
  location: string | null;
}

export interface ProviderListOptions extends ProviderRequestOptions {
  window: SchoolSyncWindow;
}

export interface HomeworkFacet {
  list(
    connection: OpenConnection,
    options: ProviderListOptions,
  ): Promise<ProviderHomework[]>;
}

export interface TimetableFacet {
  list(
    connection: OpenConnection,
    options: ProviderListOptions,
  ): Promise<ProviderTimetableLesson[]>;
}

export interface GradesFacet {
  list(
    connection: OpenConnection,
    options: ProviderListOptions,
  ): Promise<ProviderGrade[]>;
}

export interface AttachmentsFacet {
  list(
    connection: OpenConnection,
    options: ProviderListOptions,
  ): Promise<ProviderAttachment[]>;
  download(
    connection: OpenConnection,
    attachment: ProviderAttachment,
    options?: ProviderRequestOptions,
  ): Promise<ProviderDownload>;
}

export interface SchoolCalendarFacet {
  list(
    connection: OpenConnection,
    options: ProviderListOptions,
  ): Promise<ProviderSchoolCalendarEvent[]>;
}

export interface SchoolProviderFacets {
  homework?: HomeworkFacet;
  timetable?: TimetableFacet;
  grades?: GradesFacet;
  attachments?: AttachmentsFacet;
  "school-calendar"?: SchoolCalendarFacet;
}

export interface SchoolProviderAdapter {
  id: Exclude<SyncProviderId, "moodle">;
  facets: SchoolProviderFacets;
  /** Time zone used to derive the provider's date window and wall times. */
  timezone?(connection: OpenConnection): string;
  /** Facets whose `list` result proves the entire requested window. */
  completeWindowFacets?: readonly Extract<
    SchoolSyncCapability,
    "homework" | "timetable" | "grades" | "school-calendar"
  >[];
}

export function normalizeSchoolTimezone(
  value: string | null | undefined,
  fallback = "Europe/Paris",
) {
  const timezone = value?.trim() || fallback;
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: timezone,
    }).resolvedOptions().timeZone;
  } catch {
    throw new Error("The school time zone must be a valid IANA identifier");
  }
}

export type SchoolProviderAvailability =
  | { status: "ready" }
  | {
      status: "blocked";
      reasons: readonly (
        "package-unpublished" | "license-unresolved" | "no-reviewed-adapter"
      )[];
    };

export interface SchoolProviderDescriptor {
  id: Exclude<SyncProviderId, "moodle">;
  label: string;
  /** End-to-end capabilities that are safe to persist today. */
  capabilities: readonly SchoolSyncCapability[];
  /** Adapter facets present but not advertised until managed storage exists. */
  previewCapabilities?: readonly SchoolSyncCapability[];
  availability: SchoolProviderAvailability;
  /** True when the adapter is executable only from the local hot/test runtime. */
  developmentOnly?: boolean;
}

/**
 * Fail closed if a descriptor claims a facet that its adapter does not expose.
 * This is used at registry construction and in contract tests.
 */
export function assertSchoolProviderContract(
  descriptor: SchoolProviderDescriptor,
  adapter: SchoolProviderAdapter,
) {
  if (descriptor.id !== adapter.id) {
    throw new Error(
      `School provider descriptor ${descriptor.id} does not match adapter ${adapter.id}`,
    );
  }
  if (descriptor.availability.status !== "ready") {
    throw new Error(
      `Blocked school provider ${descriptor.id} cannot be enabled`,
    );
  }
  const claimedCapabilities = [
    ...descriptor.capabilities,
    ...(descriptor.previewCapabilities ?? []),
  ];
  for (const capability of claimedCapabilities) {
    if (!adapter.facets[capability]) {
      throw new Error(
        `School provider ${descriptor.id} is missing its ${capability} facet`,
      );
    }
  }
  const declared = new Set(claimedCapabilities);
  for (const capability of SCHOOL_SYNC_CAPABILITIES) {
    if (adapter.facets[capability] && !declared.has(capability)) {
      throw new Error(
        `School provider ${descriptor.id} exposes undeclared ${capability} facet`,
      );
    }
  }
  for (const capability of adapter.completeWindowFacets ?? []) {
    if (!adapter.facets[capability]) {
      throw new Error(
        `School provider ${descriptor.id} marks missing ${capability} facet as complete`,
      );
    }
  }
}

export function assertSchoolSyncWindow(window: SchoolSyncWindow) {
  if (
    !Number.isFinite(window.from.getTime()) ||
    !Number.isFinite(window.to.getTime()) ||
    window.from > window.to
  ) {
    throw new Error("The school synchronization window is invalid");
  }
}
