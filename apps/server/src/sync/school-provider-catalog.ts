import type { SchoolProviderDescriptor } from "./school-provider";

const DEVELOPMENT_CAPABILITIES = [
  "homework",
  "timetable",
  "grades",
  "school-calendar",
] as const;

export interface SchoolProviderRuntime {
  nodeEnv?: string;
  execArgv?: readonly string[];
}

/**
 * Development adapters fail closed: a plain `start` without NODE_ENV does not
 * load GPL dependencies. The server's hot dev command and Bun tests are the
 * only implicit local opt-ins; production is always disabled.
 */
export function developmentSchoolProvidersEnabled(
  runtime: SchoolProviderRuntime = {
    nodeEnv: process.env.NODE_ENV,
    execArgv: process.execArgv,
  },
) {
  if (runtime.nodeEnv === "production") return false;
  return (
    runtime.nodeEnv === "development" ||
    runtime.nodeEnv === "test" ||
    (runtime.nodeEnv === undefined && runtime.execArgv?.includes("--hot"))
  );
}

export const SCHOOL_PROVIDER_CATALOG = {
  ecoledirecte: {
    id: "ecoledirecte",
    label: "ÉcoleDirecte",
    capabilities: ["homework", "timetable", "grades", "school-calendar"],
    previewCapabilities: ["attachments"],
    availability: { status: "ready" },
  },
  pronote: {
    id: "pronote",
    label: "PRONOTE",
    capabilities: [],
    previewCapabilities: ["homework", "timetable", "grades", "school-calendar"],
    availability: {
      status: "blocked",
      reasons: ["license-unresolved"],
    },
    developmentOnly: true,
  },
  skolengo: {
    id: "skolengo",
    label: "Skolengo",
    capabilities: [],
    previewCapabilities: ["homework", "timetable", "grades", "school-calendar"],
    availability: {
      status: "blocked",
      reasons: ["license-unresolved"],
    },
    developmentOnly: true,
  },
} as const satisfies Record<
  "ecoledirecte" | "pronote" | "skolengo",
  SchoolProviderDescriptor
>;

export function schoolProviderDescriptorForRuntime(
  id: keyof typeof SCHOOL_PROVIDER_CATALOG,
  enableDevelopmentProviders = developmentSchoolProvidersEnabled(),
): SchoolProviderDescriptor {
  const provider: SchoolProviderDescriptor = SCHOOL_PROVIDER_CATALOG[id];
  if (!enableDevelopmentProviders || !provider.developmentOnly) return provider;
  return {
    ...provider,
    capabilities: DEVELOPMENT_CAPABILITIES,
    previewCapabilities: [],
    availability: { status: "ready" },
    developmentOnly: true,
  };
}

export function publicSchoolProviderCatalog(
  enableDevelopmentProviders = developmentSchoolProvidersEnabled(),
) {
  return (
    Object.keys(SCHOOL_PROVIDER_CATALOG) as (
      "ecoledirecte" | "pronote" | "skolengo"
    )[]
  )
    .map((id) =>
      schoolProviderDescriptorForRuntime(id, enableDevelopmentProviders),
    )
    .map((provider) => ({
      ...provider,
      capabilities: [...provider.capabilities],
      ...(provider.previewCapabilities
        ? { previewCapabilities: [...provider.previewCapabilities] }
        : {}),
      availability:
        provider.availability.status === "ready"
          ? provider.availability
          : {
              ...provider.availability,
              reasons: [...provider.availability.reasons],
            },
    }));
}
