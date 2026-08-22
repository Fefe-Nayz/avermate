import { describe, expect, test } from "bun:test";
import {
  cohortStanding,
  COHORT_MINIMUM_SHARING,
  type CohortContext,
} from "./cohort";

/**
 * A ranking is the one reading in this package that is about other people, so what is
 * asserted here is mostly what it refuses to say.
 */

const cohort = (
  averages: readonly number[],
  options: { viewer?: number; memberCount?: number } = {},
): CohortContext => ({
  groupId: "class",
  name: "Terminale 2",
  memberCount: options.memberCount ?? averages.length,
  members: averages.map((average, index) => ({
    userId: `u${index}`,
    name: `Member ${index}`,
    average,
  })),
  viewerUserId: `u${options.viewer ?? 0}`,
});

describe("where you stand in a group", () => {
  test("counts everybody strictly above you, plus one", () => {
    const standing = cohortStanding(
      cohort([0.6, 0.9, 0.7, 0.8, 0.5], { viewer: 2 }),
    );

    // 0.9 and 0.8 are ahead of 0.7, so third.
    expect(standing?.rank).toBe(3);
    expect(standing?.of).toBe(5);
  });

  test("lets a tie share the better rank and pushes the next one past both", () => {
    // Competition ranking — 1, 2, 2, 4 — which is what a school report says. Dense
    // ranking would call the fourth member third and quietly promote them.
    const tied = [0.9, 0.8, 0.8, 0.7, 0.6];

    expect(cohortStanding(cohort(tied, { viewer: 1 }))?.rank).toBe(2);
    expect(cohortStanding(cohort(tied, { viewer: 2 }))?.rank).toBe(2);
    expect(cohortStanding(cohort(tied, { viewer: 3 }))?.rank).toBe(4);
  });

  test("says nothing at all about a group too small to hide anybody", () => {
    // "Second of three" identifies the other two. The refusal is the feature.
    const small = cohort([0.9, 0.8, 0.7, 0.6]);

    expect(small.members).toHaveLength(COHORT_MINIMUM_SHARING - 1);
    expect(cohortStanding(small)).toBeNull();
  });

  test("ranks the reader out of those who share, not out of the group", () => {
    // Nine members, five sharing: the rank is out of five and the card is told that four
    // stayed private, because "third of five" in a class of nine is a different claim.
    const standing = cohortStanding(
      cohort([0.9, 0.8, 0.7, 0.6, 0.5], { viewer: 2, memberCount: 9 }),
    );

    expect(standing?.of).toBe(5);
    expect(standing?.hidden).toBe(4);
  });

  test("gives no rank to a reader who is not in the list", () => {
    // Not an error and not an empty group: the reader shares nothing, so there is no place
    // for them in a comparison of those who do. The figures are still theirs to see.
    const standing = cohortStanding({
      ...cohort([0.9, 0.8, 0.7, 0.6, 0.5]),
      viewerUserId: "someone-else",
    });

    expect(standing?.rank).toBeNull();
    expect(standing?.percentile).toBeNull();
    expect(standing?.mine).toBeNull();
    expect(standing?.groupAverage).toBeCloseTo(0.7, 10);
  });

  test("measures the percentile against the others", () => {
    // Above all four of your four peers is the top of the group. Dividing by the whole
    // list instead would cap everybody below one, including the best.
    const top = cohortStanding(cohort([0.9, 0.8, 0.7, 0.6, 0.5], { viewer: 0 }));
    const bottom = cohortStanding(
      cohort([0.9, 0.8, 0.7, 0.6, 0.5], { viewer: 4 }),
    );

    expect(top?.percentile).toBe(1);
    expect(bottom?.percentile).toBe(0);
  });

  test("reports the average of those sharing, and never calls it the class", () => {
    const standing = cohortStanding(
      cohort([1, 0.5, 0.5, 0.5, 0.5], { memberCount: 30 }),
    );

    // Five figures out of thirty members: the mean is of the five, and `hidden` is what
    // stops it being read as the class.
    expect(standing?.groupAverage).toBeCloseTo(0.6, 10);
    expect(standing?.hidden).toBe(25);
  });

  test("gives the middle and the best, which a rank alone does not", () => {
    const standing = cohortStanding(cohort([0.9, 0.8, 0.7, 0.6, 0.5]));

    expect(standing?.best).toBeCloseTo(0.9, 10);
    expect(standing?.median).toBeCloseTo(0.7, 10);
  });

  test("ignores a figure that is not a number", () => {
    const broken = cohort([0.9, 0.8, 0.7, 0.6, 0.5, Number.NaN]);

    expect(cohortStanding(broken)?.of).toBe(5);
  });
});
