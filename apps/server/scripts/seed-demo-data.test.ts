import { describe, expect, test } from "bun:test";
import { buildDemoCohort } from "./seed-demo-data";

const NOW = new Date("2026-08-11T12:00:00.000Z");

describe("buildDemoCohort", () => {
  test("is deterministic for a fixed size, seed and clock", () => {
    const options = { size: 8, seed: 12_345, now: NOW };

    expect(buildDemoCohort(options)).toEqual(buildDemoCohort(options));
    expect(buildDemoCohort({ ...options, seed: 12_346 })).not.toEqual(
      buildDemoCohort(options),
    );
  });

  test("builds dense multi-year CPGE histories", () => {
    const cohort = buildDemoCohort({ size: 12, seed: 77, now: NOW });

    expect(cohort).toHaveLength(12);
    expect(new Set(cohort.map((user) => user.years.length))).toEqual(
      new Set([1, 2, 3]),
    );

    for (const user of cohort) {
      if (user.profile.academicData === "none") {
        expect(user.years).toHaveLength(0);
        continue;
      }

      expect(user.years.length).toBeGreaterThanOrEqual(1);
      expect(user.years.length).toBeLessThanOrEqual(3);

      for (const year of user.years) {
        expect(year.subjects.length).toBeGreaterThanOrEqual(20);
        expect(year.subjects.length).toBeLessThanOrEqual(25);
        expect(year.grades.length).toBeGreaterThanOrEqual(82);
        expect(year.grades.length).toBeLessThanOrEqual(97);
        expect(year.periods).toHaveLength(3);
        expect(year.customAverages.length).toBeGreaterThanOrEqual(3);
        expect(year.goals.length).toBeGreaterThanOrEqual(3);

        const subjectNames = year.subjects.map((subject) => subject.name);
        expect(subjectNames.some((name) => name.endsWith("— Écrit"))).toBe(
          true,
        );
        expect(subjectNames.some((name) => name.endsWith("— Oral"))).toBe(true);
        expect(subjectNames.some((name) => name.endsWith("— TP"))).toBe(true);

        expect(new Set(year.grades.map((grade) => grade.outOf))).toEqual(
          new Set([20, 50, 60]),
        );
        expect(new Set(year.grades.map((grade) => grade.coefficient))).toEqual(
          new Set([1, 2, 3, 4]),
        );
        expect(year.grades.some((grade) => grade.isComposite)).toBe(true);
        expect(
          year.grades
            .filter((grade) => grade.isComposite)
            .every((grade) => grade.components.length >= 2),
        ).toBe(true);
      }
    }
  });

  test("provides varied but controlled admin-panel profile ratios", () => {
    const cohort = buildDemoCohort({ size: 120, seed: 9, now: NOW });
    const profiles = cohort.map((user) => user.profile);
    const ratio = (
      predicate: (profile: (typeof profiles)[number]) => boolean,
    ) => profiles.filter(predicate).length / profiles.length;

    expect(ratio((profile) => profile.emailVerified)).toBeGreaterThan(0.85);
    expect(ratio((profile) => profile.emailVerified)).toBeLessThan(0.98);
    expect(ratio((profile) => profile.banned)).toBeGreaterThan(0.02);
    expect(ratio((profile) => profile.banned)).toBeLessThan(0.08);
    expect(ratio((profile) => profile.role === "admin")).toBeGreaterThan(0.03);
    expect(ratio((profile) => profile.role === "admin")).toBeLessThan(0.08);
    expect(new Set(profiles.map((profile) => profile.provider))).toEqual(
      new Set(["credential", "google", "microsoft"]),
    );
    expect(ratio((profile) => profile.academicData === "none")).toBeGreaterThan(
      0.04,
    );
    expect(ratio((profile) => profile.academicData === "none")).toBeLessThan(
      0.1,
    );
    expect(
      cohort.filter((user) => user.profile.academicData === "none").length,
    ).toBeGreaterThan(0);
    expect(
      cohort
        .filter((user) => user.profile.academicData === "none")
        .every((user) => user.profile.activity.gradeEvents30 === 0),
    ).toBe(true);
    expect(
      profiles.filter(
        (profile) =>
          NOW.getTime() - profile.activity.createdAt.getTime() <=
          30 * 86_400_000,
      ).length,
    ).toBeGreaterThanOrEqual(10);

    const activeDays = profiles.map((profile) => profile.activity.activeDays30);
    expect(Math.min(...activeDays)).toBe(0);
    expect(Math.max(...activeDays)).toBeGreaterThanOrEqual(23);
    expect(
      profiles.some(
        (profile) =>
          NOW.getTime() - profile.activity.lastActiveAt.getTime() >
          30 * 86_400_000,
      ),
    ).toBe(true);
  });

  test("keeps all generated dates coherent and at or before the frozen clock", () => {
    const cohort = buildDemoCohort({ size: 15, seed: 2026, now: NOW });

    for (const user of cohort) {
      const { activity } = user.profile;
      expect(activity.createdAt.getTime()).toBeLessThanOrEqual(
        activity.lastActiveAt.getTime(),
      );
      expect(activity.lastActiveAt.getTime()).toBeLessThanOrEqual(
        NOW.getTime(),
      );

      for (const year of user.years) {
        expect(year.startsAt.getTime()).toBeLessThan(year.endsAt.getTime());

        for (const period of year.periods) {
          expect(period.startAt.getTime()).toBeGreaterThanOrEqual(
            year.startsAt.getTime(),
          );
          expect(period.endAt.getTime()).toBeLessThanOrEqual(
            year.endsAt.getTime(),
          );
          expect(period.startAt.getTime()).toBeLessThan(period.endAt.getTime());
        }

        for (const grade of year.grades) {
          expect(grade.passedAt.getTime()).toBeGreaterThanOrEqual(
            year.startsAt.getTime(),
          );
          expect(grade.passedAt.getTime()).toBeLessThanOrEqual(
            year.endsAt.getTime(),
          );
          expect(grade.passedAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
          expect(grade.passedAt.getTime()).toBeLessThanOrEqual(
            activity.lastActiveAt.getTime(),
          );
        }

        for (const goal of year.goals) {
          if (goal.dueAt) {
            expect(goal.dueAt.getTime()).toBeGreaterThanOrEqual(
              year.startsAt.getTime(),
            );
            expect(goal.dueAt.getTime()).toBeLessThanOrEqual(
              year.endsAt.getTime(),
            );
          }
          if (goal.achievedAt) {
            expect(goal.achievedAt.getTime()).toBeLessThanOrEqual(
              activity.lastActiveAt.getTime(),
            );
          }
        }
      }
    }
  });

  test("never fabricates academic activity before a user reaches that year", () => {
    for (const now of [
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-09-01T00:00:00.000Z"),
    ]) {
      const cohort = buildDemoCohort({ size: 120, seed: 808, now });

      for (const user of cohort) {
        for (const year of user.years) {
          expect(year.startsAt.getTime()).toBeLessThanOrEqual(
            user.profile.activity.lastActiveAt.getTime(),
          );
          for (const grade of year.grades) {
            expect(grade.passedAt.getTime()).toBeLessThanOrEqual(
              user.profile.activity.lastActiveAt.getTime(),
            );
          }
        }
      }
    }
  });

  test("contains only explicit synthetic identities and reserved email domains", () => {
    const cohort = buildDemoCohort({ size: 50, seed: 4, now: NOW });
    const serialized = JSON.stringify(cohort);

    for (const { profile } of cohort) {
      expect(profile.isSynthetic).toBe(true);
      expect(profile.id).toMatch(/^synthetic_user\d{3}$/);
      expect(profile.name).toMatch(/^Élève synthétique \d{3}$/);
      expect(profile.email).toMatch(
        /^eleve-synthetique-\d{3}@seed\.avermate\.example$/,
      );
    }

    expect(serialized).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    );
    expect(serialized).not.toContain("Bearer ");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");
  });

  test("validates options instead of producing surprising partial cohorts", () => {
    expect(buildDemoCohort({ size: 0, now: NOW })).toEqual([]);
    expect(() => buildDemoCohort({ size: -1, now: NOW })).toThrow(RangeError);
    expect(() => buildDemoCohort({ size: 1.5, now: NOW })).toThrow(RangeError);
    expect(() => buildDemoCohort({ size: 501, now: NOW })).toThrow(RangeError);
    expect(() => buildDemoCohort({ seed: Number.NaN, now: NOW })).toThrow(
      RangeError,
    );
    expect(() => buildDemoCohort({ now: new Date("invalid") })).toThrow(
      RangeError,
    );
  });
});
