import { describe, expect, test } from "bun:test";
import { compareSubjects } from "./friend";

/**
 * Two people's subject lists have nothing in common but their names, so the matching is
 * the whole of this reading — and the two ways it can lie are pairing subjects that are
 * not the same one, and quietly dropping the ones that do not pair.
 */

describe("comparing two subject lists", () => {
  test("pairs the same subject written differently", () => {
    // One person types "Maths", the other "maths " with a stray space. Same subject, and
    // neither knows the other's ids.
    const rows = compareSubjects(
      [{ name: "Maths", average: 0.7 }],
      [{ name: " maths ", average: 0.8, gradeCount: 4 }],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.gap).toBeCloseTo(-0.1, 10);
  });

  test("does not pair subjects that merely look alike", () => {
    // "Physique" and "Physique-Chimie" are different subjects in most timetables, and a
    // fuzzy match would invent a comparison nobody made.
    const rows = compareSubjects(
      [{ name: "Physique", average: 0.7 }],
      [{ name: "Physique-Chimie", average: 0.9, gradeCount: 6 }],
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.gap === null)).toBe(true);
  });

  test("keeps a row only one side has", () => {
    // A subject a friend does not share is a fact about the comparison. Dropping it would
    // shorten the table and make the two lists look more alike than they are.
    const rows = compareSubjects(
      [{ name: "Anglais", average: 0.9 }],
      [{ name: "Philosophie", average: 0.6, gradeCount: 3 }],
    );

    expect(rows.map((row) => row.name).sort()).toEqual([
      "Anglais",
      "Philosophie",
    ]);
    expect(rows.find((row) => row.name === "Anglais")?.theirs).toBeNull();
    expect(rows.find((row) => row.name === "Philosophie")?.mine).toBeNull();
  });

  test("puts the rows both sides have first", () => {
    const rows = compareSubjects(
      [
        { name: "Zoologie", average: 0.5 },
        { name: "Anglais", average: 0.9 },
      ],
      [{ name: "Anglais", average: 0.8, gradeCount: 5 }],
    );

    // A table whose first half is comparable can be read; one interleaved with half-empty
    // rows cannot.
    expect(rows[0]?.name).toBe("Anglais");
    expect(rows[0]?.gap).not.toBeNull();
  });

  test("computes no gap where a side has no average", () => {
    const rows = compareSubjects(
      [{ name: "Sport", average: null }],
      [{ name: "Sport", average: 0.8, gradeCount: 2 }],
    );

    expect(rows[0]?.mine).toBeNull();
    expect(rows[0]?.theirs).toBe(0.8);
    expect(rows[0]?.gap).toBeNull();
  });

  test("has nothing to compare for nothing", () => {
    expect(compareSubjects([], [])).toEqual([]);
  });
});
