/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PartialGrade } from "../types/grade";
import type { Subject } from "../types/subject";
import type { Period } from "../types/period";
import type { Year } from "../types/year";
import type { Average } from "../types/average";
import { addGeneralAverageToSubjects, average } from "./average";
import { calendarDay, createYearComparison, getComparisonRange, sanitizeComparisonMap, suggestCustomAverageMap, suggestPeriodMap, suggestSubjectMap } from "./year-comparison";

function grade(value: number, passedAt: string, extra: Partial<PartialGrade> = {}): PartialGrade {
  return { id: `${passedAt}-${value}`, name: "Grade", value, outOf: 2000, coefficient: 100,
    passedAt, subjectId: "r-maths", periodId: "r1", yearId: "reference", createdAt: passedAt, userId: "user", ...extra };
}
function subject(id: string, name = id, extra: Partial<Subject> = {}): Subject {
  return { id, name, parentId: null, coefficient: 100, createdAt: new Date("2024-09-01"),
    depth: 0, userId: "user", yearId: "reference", isDisplaySubject: false, isMainSubject: false, grades: [], ...extra };
}
function period(id: string, startAt: string, endAt: string, extra: Partial<Period> = {}): Period {
  return { id, name: id, startAt, endAt, yearId: "reference", userId: "user", createdAt: startAt, isCumulative: false, ...extra };
}
function customAverage(id: string, subjects: Average["subjects"], extra: Partial<Average> = {}): Average {
  return { id, name: id, subjects, yearId: "reference", userId: "user", createdAt: 0, isMainAverage: false, ...extra };
}
const currentYear: Year = { id: "current", name: "2025-26", startDate: "2025-09-01", endDate: "2026-06-30", defaultOutOf: 2000 };
const referenceYear: Year = { id: "reference", name: "2024-25", startDate: "2024-09-01", endDate: "2025-06-30", defaultOutOf: 2000 };
const sourcePeriods = [period("s1", "2025-09-01", "2025-12-31"), period("s2", "2026-01-01", "2026-06-30")];
const referencePeriods = [period("r1", "2024-09-01", "2024-12-31"), period("r2", "2025-01-01", "2025-06-30")];
const defaults = { currentYear, referenceYear, sourcePeriods, referencePeriods,
  subjectMap: { maths: "r-maths" }, periodMap: { s1: "r1", s2: "r2" }, now: new Date("2025-09-10T12:00:00") };

describe("year comparison matching", () => {
  it("matches unique normalized hierarchy paths and names without guessing duplicate subjects", () => {
    const source = [subject("a", "Mathématiques", { isDisplaySubject: true }), subject("b", "Physique", { isDisplaySubject: true }),
      subject("a-o", "Oral", { parentId: "a" }), subject("b-o", "Oral", { parentId: "b" }), subject("unique", " ÉLECTRONIQUE ")];
    const ref = [subject("ra", "mathematiques", { isDisplaySubject: true }), subject("rb", "Physique", { isDisplaySubject: true }),
      subject("ra-o", "ORAL", { parentId: "ra" }), subject("rb-o", "Oral", { parentId: "rb" }), subject("u", "Electronique")];
    assert.deepEqual(suggestSubjectMap(source, ref), { a: "ra", b: "rb", "a-o": "ra-o", "b-o": "rb-o", unique: "u" });
    assert.deepEqual(suggestSubjectMap([subject("x", "Oral")], [subject("u", "Oral"), subject("v", "Oral")]), {});
  });

  it("keeps subject type semantics when suggesting a match", () => {
    assert.deepEqual(suggestSubjectMap([subject("x", "Maths")], [subject("y", "Maths", { isDisplaySubject: true })]), {});
  });

  it("uses period order only for equally sized structures with matching cumulative semantics", () => {
    assert.deepEqual(suggestPeriodMap(sourcePeriods, referencePeriods), { s1: "r1", s2: "r2" });
    assert.deepEqual(suggestPeriodMap(sourcePeriods, referencePeriods.slice(0, 1)), {});
    assert.deepEqual(suggestPeriodMap(sourcePeriods, referencePeriods.map((p) => ({ ...p, isCumulative: true }))), {});
  });

  it("sanitizes deleted IDs without rematching an explicit exclusion", () => {
    const saved = { valid: "reference", removedSource: "reference", removedTarget: "deleted", excluded: null };
    assert.deepEqual(sanitizeComparisonMap(saved, [{ id: "valid" }, { id: "removedTarget" }, { id: "excluded" }], [{ id: "reference" }]),
      { valid: "reference", removedTarget: null, excluded: null });
    assert.equal(saved.removedTarget, "deleted");
  });
});

describe("year comparison calculation", () => {
  it("uses production hierarchical weighting and preserves grades out of arbitrary scales", () => {
    const subjects = [subject("group", "Science", { isDisplaySubject: true }),
      subject("r-maths", "Maths", { parentId: "group", coefficient: 200, grades: [grade(5, "2024-09-02", { outOf: 10, coefficient: 100 }), grade(20, "2024-09-04", { outOf: 20, coefficient: 300 })] }),
      subject("r-physics", "Physics", { parentId: "group", coefficient: 100, grades: [grade(1000, "2024-09-03")] })];
    const model = createYearComparison({ ...defaults, referenceSubjects: subjects });
    assert.equal(model.getReferenceAverage(), average(undefined, subjects));
    assert.equal(model.getReferenceAverage("maths"), 17.5);
    assert.ok(Math.abs(model.getReferenceAverage()! - 15) < 0.00001);
  });

  it("distinguishes zero from no grades, invalid scales and unmapped subjects", () => {
    const model = createYearComparison({ ...defaults, referenceSubjects: [subject("r-maths", "Maths", { grades: [grade(0, "2024-09-02"), grade(400, "2024-09-03", { outOf: 0 })] })] });
    assert.equal(model.getReferenceAverage("maths"), 0);
    assert.equal(model.getReferenceAverage("unmapped"), null);
    assert.equal(createYearComparison({ ...defaults, referenceSubjects: [] }).getReferenceAverage(), null);
    const excluded = createYearComparison({ ...defaults, subjectMap: { maths: null }, referenceSubjects: model.referenceSubjects });
    assert.equal(excluded.getReferenceAverage("maths"), null);
    assert.equal(createYearComparison({ ...defaults, periodId: "s1", periodMap: { s1: null }, referenceSubjects: [] }).ready, false);
  });

  it("compares the same elapsed days by default and never uses later reference grades", () => {
    const subjects = [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-03"), grade(2000, "2024-09-20")] })];
    const model = createYearComparison({ ...defaults, referenceSubjects: subjects });
    assert.equal(model.referenceCutoff, "2024-09-10");
    assert.equal(model.getReferenceAverage(), 10);
    assert.deepEqual(model.getReferenceSeries(["2025-09-02", "2025-09-03", "2025-09-06", "2025-09-11"]).map((p) => p.value), [null, 10, 10, null]);
    assert.equal(createYearComparison({ ...defaults, referenceSubjects: subjects, scope: "full-period" }).getReferenceAverage(), 15);
  });

  it("filters references with mapped periods and respects cumulative periods", () => {
    const subjects = [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-03"), grade(2000, "2025-01-03", { periodId: "r2" })] })];
    const model = createYearComparison({ ...defaults, now: new Date("2026-02-01"), referenceSubjects: subjects, periodId: "s2" });
    assert.equal(model.getReferenceAverage(), 20);
    assert.equal(model.referenceCutoff, "2025-02-01");
    const cumulative = createYearComparison({ ...defaults, now: new Date("2026-02-01"), referenceSubjects: subjects, periodId: "s2",
      sourcePeriods: sourcePeriods.map((p) => ({ ...p, isCumulative: true })), referencePeriods: referencePeriods.map((p) => ({ ...p, isCumulative: true })) });
    assert.equal(cumulative.getReferenceAverage(), 15);
    assert.equal(getComparisonRange(referenceYear, referencePeriods, "unknown"), null);
    assert.equal(createYearComparison({ ...defaults, referenceSubjects: subjects, periodId: "unmapped" }).ready, false);
  });

  it("honors a timeline snapshot using relative days instead of its absolute calendar year", () => {
    const model = createYearComparison({ ...defaults, now: new Date("2026-04-01"), snapshotDate: "2025-09-04",
      referenceSubjects: [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-02"), grade(2000, "2024-09-06")] })] });
    assert.equal(model.getReferenceAverage(), 10);
    assert.equal(model.referenceCutoff, "2024-09-04");
    assert.deepEqual(model.getReferenceSeries(["2025-09-04", "2025-09-06"]).map((p) => p.value), [10, null]);
  });

  it("aligns leap-day and DST boundaries by elapsed calendar days", () => {
    const model = createYearComparison({ ...defaults,
      currentYear: { ...currentYear, startDate: "2024-02-28", endDate: "2024-04-01" },
      referenceYear: { ...referenceYear, startDate: "2023-02-28", endDate: "2023-04-01" },
      now: new Date("2024-03-02T12:00:00"), referenceSubjects: [subject("r-maths", "Maths", { grades: [grade(1000, "2023-03-01")] })] });
    assert.deepEqual(model.getReferenceSeries(["2024-02-28", "2024-02-29", "2024-03-01"]).map((p) => [p.referenceDate, p.value]),
      [["2023-02-28", null], ["2023-03-01", 10], ["2023-03-02", 10]]);
    assert.equal(calendarDay("2026-03-30") - calendarDay("2026-03-28"), 2);
  });

  it("carries the final reference value when the reference period ends earlier", () => {
    const model = createYearComparison({ ...defaults, now: new Date("2026-04-01"), periodId: "s1", scope: "full-period",
      referencePeriods: [period("r1", "2024-09-01", "2024-09-04")],
      referenceSubjects: [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-03"), grade(2000, "2024-09-05")] })] });
    assert.deepEqual(model.getReferenceSeries(["2025-09-04", "2025-09-05"]).map((p) => [p.referenceDate, p.value]), [["2024-09-04", 10], ["2024-09-04", 10]]);
  });

  it("does not mutate source subjects while filtering", () => {
    const subjects = [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-03"), grade(2000, "2024-09-20")] })];
    const original = JSON.stringify(subjects);
    const model = createYearComparison({ ...defaults, referenceSubjects: subjects });
    model.getReferenceSeries(["2025-09-04", "2025-09-08"]);
    assert.equal(JSON.stringify(subjects), original);
  });

  it("caps a future snapshot at today and leaves a not-yet-started year empty", () => {
    const subjects = [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-03"), grade(2000, "2024-09-20")] })];
    const model = createYearComparison({ ...defaults, snapshotDate: "2025-10-01", referenceSubjects: subjects });
    assert.equal(model.sourceCutoff, "2025-09-10");
    assert.equal(model.getReferenceAverage(), 10);
    const upcoming = createYearComparison({ ...defaults, now: new Date("2025-08-31"), referenceSubjects: subjects });
    assert.equal(upcoming.getReferenceAverage(), null);
    assert.deepEqual(upcoming.referenceSubjects, []);
  });

  it("advances both comparison cutoffs on a new day while keeping an explicit snapshot fixed", () => {
    const referenceSubjects = [subject("r-maths", "Maths", { grades: [
      grade(1000, "2024-09-10"), grade(2000, "2024-09-11"),
    ] })];
    const sourceSubjects = [subject("maths", "Maths", { grades: [
      grade(1000, "2025-09-10"), grade(2000, "2025-09-11"),
    ] })];
    const dayOne = createYearComparison({ ...defaults, referenceSubjects });
    const dayTwo = createYearComparison({ ...defaults, referenceSubjects, now: new Date("2025-09-11T12:00:00") });
    const snapshot = createYearComparison({ ...defaults, referenceSubjects, now: new Date("2025-09-11T12:00:00"), snapshotDate: "2025-09-10" });
    assert.equal(dayOne.getReferenceAverage("maths"), 10);
    assert.equal(dayTwo.getReferenceAverage("maths"), 15);
    assert.equal(snapshot.getReferenceAverage("maths"), 10);
    assert.equal(average("maths", dayOne.scopeCurrentSubjects(sourceSubjects)), 10);
    assert.equal(average("maths", dayTwo.scopeCurrentSubjects(sourceSubjects)), 15);
    assert.equal(average("maths", snapshot.scopeCurrentSubjects(sourceSubjects)), 10);
  });

  it("scopes current subjects at the same progress while preserving virtual hierarchy nodes", () => {
    const source = [subject("general-average", "General", { isDisplaySubject: true }),
      subject("maths", "Maths", { parentId: "general-average", grades: [
        grade(1000, "2025-09-04", { periodId: "s1" }), grade(2000, "2025-09-20", { periodId: "s1" }),
      ] })];
    const model = createYearComparison({ ...defaults, periodId: "s1", referenceSubjects: [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-04")] })] });
    const scoped = model.scopeCurrentSubjects(source);
    assert.equal(scoped.length, 2);
    assert.equal(scoped[1].parentId, "general-average");
    assert.equal(average("general-average", scoped), model.getReferenceAverage("maths"));
    assert.equal(source[1].grades.length, 2);
    const missingPeriod = createYearComparison({ ...defaults, periodId: "unmapped", referenceSubjects: [] });
    assert.equal(missingPeriod.scopeCurrentSubjects(source), source);
  });
});

describe("custom-average year comparison", () => {
  const sourceConfig = customAverage("ca-source", [
    { id: "maths", customCoefficient: 9, includeChildren: false },
    { id: "english", customCoefficient: 1, includeChildren: false },
  ], { yearId: "current", name: "Sciences" });
  const referenceConfig = customAverage("ca-reference", [
    { id: "r-maths", customCoefficient: 1, includeChildren: false },
    { id: "r-english", customCoefficient: 3, includeChildren: false },
  ], { name: "Sciences" });
  const customInput = {
    ...defaults,
    subjectMap: {},
    customAverageMap: { "ca-source": "ca-reference" },
    sourceCustomAverages: [sourceConfig],
    referenceCustomAverages: [referenceConfig],
  };

  it("suggests only unique normalized custom-average names", () => {
    const source = [customAverage("a", [], { name: " Sciences générales " }), customAverage("b", [], { name: "Oral" })];
    const reference = [customAverage("r", [], { name: "Sciences GENERALES" }),
      customAverage("r2", [], { name: "Oral" }), customAverage("r3", [], { name: "oral" })];
    assert.deepEqual(suggestCustomAverageMap(source, reference), { a: "r" });
    assert.deepEqual(suggestCustomAverageMap([customAverage("a", [], { name: "Sciences" }), customAverage("b", [], { name: "sciences" })],
      [customAverage("r", [], { name: "Sciences" })]), {});
  });

  it("compares each year's own formula and coefficients without subject mappings", () => {
    const referenceSubjects = [
      subject("r-maths", "Maths", { coefficient: 900, grades: [grade(5, "2024-09-03", { outOf: 10 })] }),
      subject("r-english", "English", { coefficient: 100, grades: [grade(40, "2024-09-03", { outOf: 40 })] }),
      subject("not-selected", "Unrelated", { grades: [grade(0, "2024-09-03")] }),
    ];
    const sourceSubjects = [subject("maths", "Maths", { grades: [grade(2000, "2025-09-03")] }),
      subject("english", "English", { grades: [grade(1000, "2025-09-03")] })];
    const model = createYearComparison({ ...customInput, referenceSubjects });
    const scopedSource = model.scopeCurrentSubjects(addGeneralAverageToSubjects(sourceSubjects, sourceConfig));
    assert.equal(average(sourceConfig.id, scopedSource), 19);
    assert.equal(model.getReferenceAverage(sourceConfig.id), 17.5);
    assert.equal(model.getReferenceAverage(sourceConfig.id), average(referenceConfig.id, addGeneralAverageToSubjects(referenceSubjects, referenceConfig)));
    assert.equal(model.getReferenceAverage(), average(undefined, referenceSubjects));
  });

  it("honors hierarchy, includeChildren, and zero custom coefficients using existing custom semantics", () => {
    const referenceSubjects = [subject("group", "Sciences", { isDisplaySubject: true }),
      subject("parent", "Maths", { parentId: "group", grades: [grade(1000, "2024-09-03")] }),
      subject("child", "Oral", { parentId: "parent", coefficient: 300, grades: [grade(2000, "2024-09-03")] }),
      subject("outside", "Unrelated", { grades: [grade(0, "2024-09-03")] })];
    const calculate = (entry: Average["subjects"][number]) => createYearComparison({ ...customInput,
      referenceSubjects, referenceCustomAverages: [customAverage("ca-reference", [entry])],
    }).getReferenceAverage("ca-source");
    assert.equal(calculate({ id: "parent", customCoefficient: null, includeChildren: false }), 10);
    assert.equal(calculate({ id: "parent", customCoefficient: null, includeChildren: true }), 17.5);
    assert.equal(calculate({ id: "group", customCoefficient: null, includeChildren: true }), 17.5);
    assert.equal(calculate({ id: "parent", customCoefficient: 0, includeChildren: true }), 20);
    assert.equal(calculate({ id: "group", customCoefficient: null, includeChildren: false }), null);
  });

  it("filters custom grades before applying the formula and aligns snapshot series without future leakage", () => {
    const referenceSubjects = [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-03"), grade(2000, "2024-09-06")] })];
    const input = { ...customInput, referenceSubjects, snapshotDate: "2025-09-04" };
    const model = createYearComparison(input);
    assert.equal(model.getReferenceAverage("ca-source"), 10);
    assert.deepEqual(model.getReferenceSeries(["2025-09-02", "2025-09-03", "2025-09-04", "2025-09-06"], "ca-source")
      .map((point) => [point.referenceDate, point.value]),
      [["2024-09-02", null], ["2024-09-03", 10], ["2024-09-04", 10], ["2024-09-04", null]]);
    assert.equal(createYearComparison({ ...input, scope: "full-period" }).getReferenceAverage("ca-source"), 15);
    assert.equal(referenceSubjects[0].grades.length, 2);
  });

  it("uses mapped noncumulative and cumulative periods for custom averages", () => {
    const referenceSubjects = [subject("r-maths", "Maths", { grades: [grade(1000, "2024-09-03"),
      grade(2000, "2025-01-03", { periodId: "r2" }), grade(0, "2025-04-03", { periodId: "r2" })] })];
    const input = { ...customInput, referenceSubjects, periodId: "s2", now: new Date("2026-02-01") };
    assert.equal(createYearComparison(input).getReferenceAverage("ca-source"), 20);
    assert.equal(createYearComparison({ ...input,
      sourcePeriods: sourcePeriods.map((entry) => ({ ...entry, isCumulative: true })),
      referencePeriods: referencePeriods.map((entry) => ({ ...entry, isCumulative: true })),
    }).getReferenceAverage("ca-source"), 15);
  });

  it("preserves valid zero and returns null for unmapped, deleted, empty, and excluded custom averages", () => {
    const referenceSubjects = [subject("r-maths", "Maths", { grades: [grade(0, "2024-09-03")] })];
    const input = { ...customInput, referenceSubjects };
    assert.equal(createYearComparison(input).getReferenceAverage("ca-source"), 0);
    assert.equal(createYearComparison({ ...input, customAverageMap: {} }).getReferenceAverage("ca-source"), null);
    assert.equal(createYearComparison({ ...input, customAverageMap: { "ca-source": null } }).getReferenceAverage("ca-source"), null);
    assert.equal(createYearComparison({ ...input, sourceCustomAverages: [] }).getReferenceAverage("ca-source"), null);
    assert.equal(createYearComparison({ ...input, referenceCustomAverages: [] }).getReferenceAverage("ca-source"), null);
    assert.equal(createYearComparison({ ...input, referenceCustomAverages: [customAverage("ca-reference", [])] }).getReferenceAverage("ca-source"), null);
    assert.equal(createYearComparison({ ...input, customAverageMap: {} }).getReferenceSeries(["2025-09-04"], "ca-source")[0].value, null);
  });
});
