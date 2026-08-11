import { beforeAll, describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "file::memory:";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??=
  "social-policy-test-secret-at-least-32-characters";
process.env.CLIENT_URL ??= "http://localhost:3001";
process.env.NODE_ENV = "test";

let policy: typeof import("./social-policy");

beforeAll(async () => {
  policy = await import("./social-policy");
});

function evidence(
  overrides: Partial<import("./social-policy").EligibilityEvidence> = {},
): import("./social-policy").EligibilityEvidence {
  return {
    enabled: true,
    ageBand: "adult",
    assuranceLevel: "self_declared",
    providerRef: null,
    expiresAt: null,
    profileStatus: "off",
    revision: 1,
    consents: [
      {
        actorType: "user",
        event: "granted",
        occurredAt: new Date("2026-08-01T00:00:00.000Z"),
        guardianProviderRef: null,
      },
    ],
    ...overrides,
  };
}

describe("social eligibility fail-closed rules", () => {
  test("distinguishes feature, age, consent, expiry and frozen states", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    expect(
      policy.resolveEligibility(evidence({ enabled: false }), now).status,
    ).toBe("feature_disabled");
    expect(
      policy.resolveEligibility(
        evidence({ ageBand: "unknown", consents: [] }),
        now,
      ).status,
    ).toBe("age_unknown");
    expect(
      policy.resolveEligibility(evidence({ consents: [] }), now).status,
    ).toBe("consent_required");
    expect(
      policy.resolveEligibility(
        evidence({ expiresAt: new Date("2026-08-11T11:59:59.000Z") }),
        now,
      ).status,
    ).toBe("verification_expired");
    expect(
      policy.resolveEligibility(evidence({ profileStatus: "frozen" }), now)
        .status,
    ).toBe("frozen");
  });

  test("requires separate current child and verified guardian grants under 15", () => {
    const occurredAt = new Date("2026-08-01T00:00:00.000Z");
    const childOnly = evidence({
      ageBand: "under15",
      assuranceLevel: "self_declared",
      consents: [
        {
          actorType: "child",
          event: "granted",
          occurredAt,
          guardianProviderRef: null,
        },
      ],
    });
    expect(policy.resolveEligibility(childOnly).status).toBe(
      "guardian_required",
    );

    const active = evidence({
      ...childOnly,
      assuranceLevel: "guardian_verified",
      providerRef: "opaque-guardian-proof",
      consents: [
        ...childOnly.consents,
        {
          actorType: "guardian",
          event: "granted",
          occurredAt,
          guardianProviderRef: "opaque-guardian-proof",
        },
      ],
    });
    expect(policy.resolveEligibility(active)).toMatchObject({
      status: "active",
      guardianRequired: true,
      guardianVerified: true,
      canUseSocial: true,
    });

    expect(
      policy.resolveEligibility({
        ...active,
        consents: [
          ...active.consents,
          {
            actorType: "guardian",
            event: "withdrawn",
            occurredAt: new Date("2026-08-02T00:00:00.000Z"),
            guardianProviderRef: "opaque-guardian-proof",
          },
        ],
      }).status,
    ).toBe("guardian_required");
  });
});

describe("privacy-preserving social analytics", () => {
  test("uses Avermate's hierarchical SubjectGraph instead of a flat grade mean", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const metrics = policy.deriveAcademicMetrics({
      window: "current_academic_year",
      yearStartsAt: new Date("2025-09-01T00:00:00.000Z"),
      yearEndsAt: new Date("2026-07-01T00:00:00.000Z"),
      passingRatio: 0.5,
      now,
      subjects: [
        {
          id: "math",
          name: "Math",
          shortName: null,
          parentId: null,
          coefficient: 1,
          kind: "subject",
          isMain: true,
          sortOrder: 0,
        },
        {
          id: "art",
          name: "Art",
          shortName: null,
          parentId: null,
          coefficient: 1,
          kind: "subject",
          isMain: false,
          sortOrder: 1,
        },
      ],
      grades: [
        {
          id: "math-grade",
          name: "Math grade",
          value: 10,
          outOf: 20,
          coefficient: 100,
          passedAt: new Date("2026-01-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          subjectId: "math",
          periodId: null,
          note: null,
        },
        {
          id: "art-grade",
          name: "Art grade",
          value: 20,
          outOf: 20,
          coefficient: 1,
          passedAt: new Date("2026-02-01T00:00:00.000Z"),
          createdAt: new Date("2026-02-01T00:00:00.000Z"),
          subjectId: "art",
          periodId: null,
          note: null,
        },
      ],
      goals: [],
    });

    // Hierarchy: (50% + 100%) / 2 = 75%. A flat grade-weighted mean is ~50.5%.
    expect(metrics.normalizedAverage.numeric).toBe(75);
  });

  test("applies complementary suppression and competition ranking ties", () => {
    expect(
      policy.suppressSmallBuckets([
        { key: "small", count: 2 },
        { key: "next", count: 4 },
        { key: "large", count: 10 },
      ]),
    ).toEqual([
      { key: "small", count: 0, suppressed: true },
      { key: "next", count: 0, suppressed: true },
      { key: "large", count: 10, suppressed: false },
    ]);
    expect(
      policy.tiedRanks([
        { alias: "A", score: 90 },
        { alias: "B", score: 90 },
        { alias: "C", score: 80 },
      ]),
    ).toEqual([
      { alias: "A", score: 90, rank: 1 },
      { alias: "B", score: 90, rank: 1 },
      { alias: "C", score: 80, rank: 3 },
    ]);
  });
});
