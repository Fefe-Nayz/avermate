import { describe, expect, test } from "bun:test";
import {
  assertSchoolProviderContract,
  type SchoolProviderAdapter,
} from "./school-provider";
import {
  developmentSchoolProvidersEnabled,
  publicSchoolProviderCatalog,
  SCHOOL_PROVIDER_CATALOG,
  schoolProviderDescriptorForRuntime,
} from "./school-provider-catalog";

describe("school provider contracts", () => {
  test("keeps GPL adapters blocked until the distribution license is resolved", () => {
    expect(SCHOOL_PROVIDER_CATALOG.pronote).toMatchObject({
      capabilities: [],
      previewCapabilities: [
        "homework",
        "timetable",
        "grades",
        "school-calendar",
      ],
      availability: { status: "blocked", reasons: ["license-unresolved"] },
    });
    expect(SCHOOL_PROVIDER_CATALOG.skolengo).toMatchObject({
      capabilities: [],
      previewCapabilities: [
        "homework",
        "timetable",
        "grades",
        "school-calendar",
      ],
      availability: { status: "blocked", reasons: ["license-unresolved"] },
    });
  });

  test("enables reviewed GPL adapters only in an explicit development runtime", () => {
    expect(
      developmentSchoolProvidersEnabled({
        nodeEnv: "production",
        execArgv: ["--hot"],
      }),
    ).toBeFalse();
    expect(
      developmentSchoolProvidersEnabled({
        nodeEnv: undefined,
        execArgv: [],
      }),
    ).toBeFalse();
    expect(
      developmentSchoolProvidersEnabled({
        nodeEnv: undefined,
        execArgv: ["--hot"],
      }),
    ).toBeTrue();
    expect(schoolProviderDescriptorForRuntime("pronote", true)).toMatchObject({
      capabilities: ["homework", "timetable", "grades", "school-calendar"],
      previewCapabilities: [],
      availability: { status: "ready" },
      developmentOnly: true,
    });
    expect(publicSchoolProviderCatalog(false)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pronote",
          capabilities: [],
          availability: expect.objectContaining({ status: "blocked" }),
        }),
        expect.objectContaining({
          id: "skolengo",
          capabilities: [],
          availability: expect.objectContaining({ status: "blocked" }),
        }),
      ]),
    );
  });

  test("fails closed when a ready descriptor overstates an adapter", () => {
    const adapter = {
      id: "ecoledirecte",
      facets: {},
    } satisfies SchoolProviderAdapter;
    expect(() =>
      assertSchoolProviderContract(
        SCHOOL_PROVIDER_CATALOG.ecoledirecte,
        adapter,
      ),
    ).toThrow("missing its homework facet");
  });

  test("returns detached catalog arrays", () => {
    const first = publicSchoolProviderCatalog();
    const second = publicSchoolProviderCatalog();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]?.capabilities).not.toBe(second[0]?.capabilities);
  });
});
