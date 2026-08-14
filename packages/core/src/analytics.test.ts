import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  averageEventDates,
  segmentedTrendLine,
  type SeriesPoint,
} from "./analytics";

const DAY = 86_400_000;

function points(values: Array<number | null>, gaps?: number[]): SeriesPoint[] {
  let timestamp = Date.UTC(2026, 0, 1);
  return values.map((ratio, index) => {
    if (index > 0) timestamp += (gaps?.[index - 1] ?? 1) * DAY;
    return { date: new Date(timestamp), ratio };
  });
}

describe("segmented trend line", () => {
  it("fits against real irregular timestamps rather than array positions", () => {
    const source = points([0, null, 1], [5, 5]);
    const trend = segmentedTrendLine(source);
    assert.equal(trend.length, 3);
    assert.equal(trend[0]?.ratio, 0);
    assert.equal(trend[1]?.ratio, 0.5);
    assert.equal(trend[2]?.ratio, 1);
  });

  it("uses subdivisions to preserve local changes in direction", () => {
    const trend = segmentedTrendLine(points([0.2, 0.4, 0.8, 0.6]), 2);
    assert.ok((trend[1]?.ratio ?? 0) > (trend[0]?.ratio ?? 0));
    assert.ok((trend[3]?.ratio ?? 0) < (trend[2]?.ratio ?? 0));
  });

  it("keeps the line inside the first and last observation", () => {
    const trend = segmentedTrendLine(points([null, 0.3, 0.5, null]), 1);
    assert.equal(trend[0]?.ratio, null);
    assert.notEqual(trend[1]?.ratio, null);
    assert.notEqual(trend[2]?.ratio, null);
    assert.equal(trend[3]?.ratio, null);
  });

  it("returns no fitted line with fewer than two readings", () => {
    assert.deepEqual(segmentedTrendLine(points([null, 0.4, null]), 4), []);
  });
});

describe("average event dates", () => {
  let counter = 0;
  const grade = (subjectId: string, passedAt: Date) => {
    counter += 1;
    return {
      id: `g${counter}`,
      name: `grade ${counter}`,
      value: 12,
      outOf: 20,
      coefficient: 1,
      passedAt,
      createdAt: passedAt,
      subjectId,
      periodId: null,
      components: [],
    };
  };
  const subject = (id: string, parentId: string | null, dates: Date[]) => ({
    id,
    name: id,
    shortName: null,
    parentId,
    coefficient: 1,
    kind: "subject" as const,
    isMain: false,
    sortOrder: 0,
    grades: dates.map((at) => grade(id, at)),
  });

  const from = new Date("2026-01-01T00:00:00");
  const to = new Date("2026-03-01T12:00:00");

  it("puts one event per graded day, none in between, plus both ends", () => {
    const subjects = [
      subject("maths", null, [
        new Date("2026-01-10T09:00:00"),
        new Date("2026-01-10T15:00:00"), // same day: one event
        new Date("2026-02-02T08:00:00"),
      ]),
    ];
    const dates = averageEventDates(subjects, from, to);
    assert.equal(dates.length, 4); // start, two graded days, end
    assert.equal(dates[0]?.getTime(), from.getTime());
    assert.equal(dates[dates.length - 1]?.getTime(), to.getTime());
    // The event sits at the end of its day so both grades count into it.
    assert.equal(dates[1]?.getHours(), 23);
    assert.equal(dates[1]?.getDate(), 10);
    assert.equal(dates[2]?.getDate(), 2);
  });

  it("clamps grades outside the window onto its edges", () => {
    const subjects = [
      subject("maths", null, [
        new Date("2025-12-01"), // before: clamped to start
        new Date("2026-04-01"), // after: clamped to end
      ]),
    ];
    const dates = averageEventDates(subjects, from, to);
    assert.equal(dates.length, 2);
    assert.equal(dates[0]?.getTime(), from.getTime());
    assert.equal(dates[1]?.getTime(), to.getTime());
  });

  it("scopes events to the target's own subtree", () => {
    const subjects = [
      subject("sciences", null, []),
      subject("maths", "sciences", [new Date("2026-01-20T10:00:00")]),
      subject("anglais", null, [new Date("2026-02-15T10:00:00")]),
    ];
    // Maths only moves on its own grade day…
    const maths = averageEventDates(subjects, from, to, "maths");
    assert.equal(maths.length, 3);
    assert.equal(maths[1]?.getDate(), 20);
    // …the parent inherits it, and everything moves for the general average.
    assert.equal(averageEventDates(subjects, from, to, "sciences").length, 3);
    assert.equal(averageEventDates(subjects, from, to).length, 4);
  });
});
