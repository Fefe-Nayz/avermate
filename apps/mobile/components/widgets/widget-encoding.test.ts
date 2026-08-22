import { describe, expect, test } from "bun:test";
import {
  createWidgetVisualization,
  type WidgetSeriesDatum,
} from "@avermate/core";
import {
  encodeWidgetSeries,
  widgetColorIndex,
  widgetDatumLabel,
  widgetDatumNumber,
  widgetNumericDomain,
} from "./widget-encoding";

const row: WidgetSeriesDatum = {
  key: "math:2026-01-01",
  label: "2026-01-01",
  date: new Date("2026-01-01T00:00:00Z"),
  value: 0.75,
  delta: 0.1,
  count: 4,
  series: "Mathematics",
};

describe("widget encodings", () => {
  test("reads every quantitative evaluator field", () => {
    expect(widgetDatumNumber(row, "value")).toBe(0.75);
    expect(widgetDatumNumber(row, "delta")).toBe(0.1);
    expect(widgetDatumNumber(row, "count")).toBe(4);
    expect(widgetDatumNumber(row, "date")).toBe(row.date?.getTime() ?? null);
  });

  test("uses the evaluator series for the category channel", () => {
    expect(widgetDatumLabel(row, "category")).toBe("Mathematics");
  });

  test("applies y and series descriptors without losing source values", () => {
    const visualization = createWidgetVisualization("line");
    // The channels name ids in the document; what this encoder needs is the slot each
    // one resolved to, which its caller works out from the analysis.
    const [encoded] = encodeWidgetSeries([row], visualization, {
      x: "date",
      y: "count",
      color: null,
      series: "category",
      facet: null,
    });

    expect(encoded?.value).toBe(4);
    expect(encoded?.series).toBe("Mathematics");
    expect(encoded?.source.value).toBe(0.75);
  });

  test("uses configured scale bounds for quantitative colors", () => {
    const domain = widgetNumericDomain([0.4, 0.8], {
      zero: false,
      min: 0.2,
      max: 1,
      reverse: false,
    });

    expect(domain).toEqual({ minimum: 0.2, maximum: 1 });
    expect(widgetColorIndex(0.2, domain, false, 6)).toBe(0);
    expect(widgetColorIndex(1, domain, false, 6)).toBe(5);
    expect(widgetColorIndex(0.2, domain, true, 6)).toBe(5);
    expect(widgetColorIndex(2, domain, false, 6)).toBe(5);
  });

  test("keeps a constant color domain stable", () => {
    const domain = widgetNumericDomain([0.7], {
      zero: false,
      min: null,
      max: null,
      reverse: false,
    });

    expect(domain).toEqual({ minimum: 0.7, maximum: 0.7 });
    expect(widgetColorIndex(0.7, domain, false, 6)).toBe(2);
  });
});
