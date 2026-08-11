import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { segmentedTrendLine, type SeriesPoint } from "./analytics";

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
