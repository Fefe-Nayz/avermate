import { CARD_METRICS, type CardMetric } from "./cards";
import {
  createWidgetDefinition,
  createWidgetVisualization,
} from "./widget-defaults";
import { parseWidgetFormula } from "./widget-formula";
import {
  widgetCapability,
  widgetCompatibleMarks,
  widgetEncodingFields,
  widgetMeasureHasIntrinsicDelta,
  widgetMeasureId,
} from "./widget-registry";
import type {
  WidgetChartMark,
  WidgetCompileOptions,
  WidgetCompileResult,
  WidgetDefinitionV1,
  WidgetEncoding,
  WidgetFilter,
  WidgetMarkOptions,
  WidgetNumericOperator,
  WidgetReferences,
  WidgetTransform,
  WidgetValidationIssue,
  WidgetValidationResult,
} from "./widget-types";
import { WIDGET_DEFINITION_VERSION, WIDGET_LIMITS } from "./widget-types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function issue(
  issues: WidgetValidationIssue[],
  path: string,
  code: WidgetValidationIssue["code"],
  messageKey: string,
): void {
  issues.push({ path, code, messageKey });
}

function finite(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function integer(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.round(finite(value, fallback, min, max));
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 80)
    : null;
}

function thresholdColor(
  value: unknown,
  path: string,
  issues: WidgetValidationIssue[],
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase();
  }
  issue(issues, path, "invalid-value", "widget.error.color");
  return null;
}

function uniqueStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ].slice(0, limit);
}

const NUMERIC_OPERATORS: WidgetNumericOperator[] = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
];

function normalizeFilters(
  value: unknown,
  issues: WidgetValidationIssue[],
): WidgetFilter[] {
  if (!Array.isArray(value)) {
    issue(
      issues,
      "query.filters",
      "invalid-type",
      "widget.error.filters-array",
    );
    return [];
  }
  if (value.length > WIDGET_LIMITS.filters) {
    issue(
      issues,
      "query.filters",
      "complexity-limit",
      "widget.error.filters-limit",
    );
  }
  const filters: WidgetFilter[] = [];
  for (const [index, raw] of value.slice(0, WIDGET_LIMITS.filters).entries()) {
    const item = record(raw);
    const path = `query.filters.${index}`;
    if (!item || typeof item.kind !== "string") {
      issue(issues, path, "invalid-type", "widget.error.filter");
      continue;
    }
    if (item.kind === "grade-ratio" || item.kind === "coefficient") {
      if (
        !NUMERIC_OPERATORS.includes(item.operator as WidgetNumericOperator) ||
        typeof item.value !== "number" ||
        !Number.isFinite(item.value)
      ) {
        issue(issues, path, "invalid-value", "widget.error.numeric-filter");
        continue;
      }
      filters.push({
        kind: item.kind,
        operator: item.operator as WidgetNumericOperator,
        value:
          item.kind === "grade-ratio"
            ? finite(item.value, 0, -10, 10)
            : finite(item.value, 0, 0, 1_000),
      });
    } else if (item.kind === "has-note" || item.kind === "passed") {
      if (typeof item.value !== "boolean") {
        issue(issues, `${path}.value`, "invalid-type", "widget.error.boolean");
        continue;
      }
      filters.push({ kind: item.kind, value: item.value });
    } else if (item.kind === "grade-name") {
      if (
        (item.operator !== "contains" && item.operator !== "not-contains") ||
        typeof item.value !== "string" ||
        item.value.trim().length === 0
      ) {
        issue(issues, path, "invalid-value", "widget.error.text-filter");
        continue;
      }
      filters.push({
        kind: "grade-name",
        operator: item.operator,
        value: item.value.trim().slice(0, 80),
      });
    } else {
      issue(issues, `${path}.kind`, "unsupported", "widget.error.filter-kind");
    }
  }
  return filters;
}

function normalizeTransforms(
  value: unknown,
  issues: WidgetValidationIssue[],
): WidgetTransform[] {
  if (!Array.isArray(value)) {
    issue(
      issues,
      "analysis.transforms",
      "invalid-type",
      "widget.error.transforms-array",
    );
    return [];
  }
  if (value.length > WIDGET_LIMITS.transforms) {
    issue(
      issues,
      "analysis.transforms",
      "complexity-limit",
      "widget.error.transforms-limit",
    );
  }
  const transforms: WidgetTransform[] = [];
  for (const [index, raw] of value
    .slice(0, WIDGET_LIMITS.transforms)
    .entries()) {
    const item = record(raw);
    const path = `analysis.transforms.${index}`;
    if (!item || typeof item.kind !== "string") {
      issue(issues, path, "invalid-type", "widget.error.transform");
      continue;
    }
    if (
      item.kind === "sort" &&
      (item.direction === "ascending" || item.direction === "descending")
    ) {
      transforms.push({ kind: "sort", direction: item.direction });
    } else if (item.kind === "limit") {
      transforms.push({
        kind: "limit",
        count: integer(item.count, 10, 1, WIDGET_LIMITS.resultPoints),
      });
    } else if (item.kind === "moving-average") {
      transforms.push({
        kind: "moving-average",
        points: integer(item.points, 3, 2, 100),
      });
    } else if (item.kind === "cumulative") {
      transforms.push({ kind: "cumulative" });
    } else {
      issue(issues, path, "invalid-value", "widget.error.transform-kind");
    }
  }
  return transforms;
}

const MARKS: WidgetChartMark[] = [
  "value",
  "gauge",
  "line",
  "area",
  "bar",
  "dot",
  "histogram",
  "boxplot",
  "heatmap",
  "table",
  "list",
];

function markOptions(mark: WidgetChartMark, value: unknown): WidgetMarkOptions {
  const raw = record(value);
  const defaults = createWidgetVisualization(mark).options;
  if (!raw || raw.kind !== mark) return defaults;
  switch (mark) {
    case "value":
      return {
        kind: "value",
        showDelta: bool(raw.showDelta, true),
        trendIndicator: bool(raw.trendIndicator, true),
      };
    case "gauge":
      return {
        kind: "gauge",
        showValue: bool(raw.showValue, true),
        thickness: finite(raw.thickness, 10, 2, 32),
      };
    case "line":
      return {
        kind: "line",
        curve:
          raw.curve === "linear" || raw.curve === "step"
            ? raw.curve
            : "monotone",
        points: bool(raw.points, false),
        strokeWidth: finite(raw.strokeWidth, 2, 1, 8),
      };
    case "area":
      return {
        kind: "area",
        curve:
          raw.curve === "linear" || raw.curve === "step"
            ? raw.curve
            : "monotone",
        points: bool(raw.points, false),
        opacity: finite(raw.opacity, 0.22, 0, 1),
      };
    case "bar":
      return {
        kind: "bar",
        orientation:
          raw.orientation === "horizontal" ? "horizontal" : "vertical",
        stacked: bool(raw.stacked, false),
        cornerRadius: finite(raw.cornerRadius, 4, 0, 20),
      };
    case "dot":
      return { kind: "dot", size: finite(raw.size, 6, 1, 24) };
    case "histogram":
      return { kind: "histogram", bins: integer(raw.bins, 10, 3, 40) };
    case "boxplot":
      return { kind: "boxplot", showOutliers: bool(raw.showOutliers, true) };
    case "heatmap":
      return {
        kind: "heatmap",
        colorScheme:
          raw.colorScheme === "sequential" || raw.colorScheme === "diverging"
            ? raw.colorScheme
            : "semantic",
      };
    case "table":
      return { kind: "table", rows: integer(raw.rows, 10, 1, 100) };
    case "list":
      return {
        kind: "list",
        rows: integer(raw.rows, 8, 1, 100),
        showValues: bool(raw.showValues, true),
      };
  }
}

function encoding(value: unknown) {
  const raw = record(value);
  const fields = ["date", "category", "value", "delta", "count"];
  if (!raw || !fields.includes(String(raw.field))) return null;
  const field = raw.field as "date" | "category" | "value" | "delta" | "count";
  return {
    field,
    type:
      field === "date"
        ? ("temporal" as const)
        : field === "category"
          ? ("nominal" as const)
          : ("quantitative" as const),
  };
}

function normalizeEncoding(
  channel: "x" | "y" | "color" | "series",
  value: unknown,
  fallback: WidgetEncoding | null,
  allowed: readonly WidgetEncoding["field"][],
  issues: WidgetValidationIssue[],
): WidgetEncoding | null {
  if (value === undefined) {
    return fallback && allowed.includes(fallback.field) ? fallback : null;
  }
  if (value === null) return null;
  const parsed = encoding(value);
  if (!parsed) {
    issue(
      issues,
      `visualization.encoding.${channel}`,
      "invalid-value",
      "widget.error.encoding",
    );
    return null;
  }
  if (!allowed.includes(parsed.field)) {
    issue(
      issues,
      `visualization.encoding.${channel}`,
      "unsupported",
      "widget.error.encoding-channel",
    );
    return null;
  }
  return parsed;
}

function normalizeDefinition(
  input: unknown,
  options: WidgetCompileOptions,
): { definition: WidgetDefinitionV1; issues: WidgetValidationIssue[] } {
  const issues: WidgetValidationIssue[] = [];
  const fallback = createWidgetDefinition(options.surface);
  const root = record(input);
  if (!root) {
    issue(issues, "", "invalid-type", "widget.error.definition-object");
    return { definition: fallback, issues };
  }
  if (root.apiVersion !== WIDGET_DEFINITION_VERSION) {
    issue(
      issues,
      "apiVersion",
      "unsupported",
      "widget.error.definition-version",
    );
  }
  const query = record(root.query);
  const analysis = record(root.analysis);
  const visualization = record(root.visualization);
  if (!query || !analysis || !visualization) {
    issue(issues, "", "required", "widget.error.definition-sections");
    return { definition: fallback, issues };
  }

  const scopeRaw = record(query.scope);
  let scope = fallback.query.scope;
  if (scopeRaw?.kind === "subjects") {
    const subjectIds = uniqueStrings(
      scopeRaw.subjectIds,
      WIDGET_LIMITS.subjectReferences,
    );
    if (subjectIds.length === 0)
      issue(
        issues,
        "query.scope.subjectIds",
        "required",
        "widget.error.subject-required",
      );
    scope = {
      kind: "subjects",
      subjectIds,
      includeDescendants: bool(scopeRaw.includeDescendants, true),
    };
  } else if (scopeRaw?.kind === "custom-average") {
    const averageId = text(scopeRaw.averageId);
    if (!averageId)
      issue(
        issues,
        "query.scope.averageId",
        "required",
        "widget.error.average-required",
      );
    scope = { kind: "custom-average", averageId };
  } else if (scopeRaw?.kind !== "general") {
    issue(
      issues,
      "query.scope.kind",
      "invalid-value",
      "widget.error.scope-kind",
    );
  }

  const windowRaw = record(query.window);
  let window = fallback.query.window;
  if (windowRaw?.kind === "whole-year" || windowRaw?.kind === "active-period") {
    window = { kind: windowRaw.kind };
  } else if (windowRaw?.kind === "period") {
    window = { kind: "period", periodId: text(windowRaw.periodId) };
    if (!window.periodId)
      issue(
        issues,
        "query.window.periodId",
        "required",
        "widget.error.period-required",
      );
  } else if (windowRaw?.kind === "rolling-days") {
    window = {
      kind: "rolling-days",
      days: integer(windowRaw.days, 30, 1, 3_650),
    };
  } else if (windowRaw?.kind === "last-grades") {
    window = {
      kind: "last-grades",
      count: integer(windowRaw.count, 10, 1, 500),
    };
  } else if (windowRaw?.kind === "date-range") {
    window = {
      kind: "date-range",
      from: text(windowRaw.from),
      to: text(windowRaw.to),
    };
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      issue(issues, "query.window", "invalid-value", "widget.error.date-range");
    }
  } else {
    issue(
      issues,
      "query.window.kind",
      "invalid-value",
      "widget.error.window-kind",
    );
  }

  const measureRaw = record(analysis.measure);
  let measure = fallback.analysis.measure;
  if (measureRaw?.kind === "formula") {
    const parsed = parseWidgetFormula(measureRaw.formula);
    issues.push(...parsed.issues);
    measure = {
      kind: "formula",
      formula: parsed.formula ?? { kind: "literal", value: 0 },
      valueType:
        measureRaw.valueType === "ratio" ||
        measureRaw.valueType === "count" ||
        measureRaw.valueType === "percent"
          ? measureRaw.valueType
          : "number",
    };
  } else if (
    measureRaw?.kind === "metric" &&
    CARD_METRICS.includes(measureRaw.metric as CardMetric)
  ) {
    measure = {
      kind: "metric",
      metric: measureRaw.metric as CardMetric,
      goalId:
        measureRaw.metric === "goalProgress" &&
        typeof measureRaw.goalId === "string"
          ? measureRaw.goalId
          : null,
    };
    if (measure.metric === "goalProgress" && !measure.goalId) {
      issue(
        issues,
        "analysis.measure.goalId",
        "required",
        "widget.error.goal-required",
      );
    }
  } else {
    issue(issues, "analysis.measure", "invalid-value", "widget.error.measure");
  }

  const capability = widgetCapability(widgetMeasureId(measure));
  if (!capability.surfaces.includes(options.surface)) {
    issue(
      issues,
      "analysis.measure",
      "unsupported",
      "widget.error.measure-surface",
    );
  }
  if (!capability.scopes.includes(scope.kind)) {
    issue(issues, "query.scope", "unsupported", "widget.error.measure-scope");
    scope = { kind: "general" };
  }
  if (measure.kind === "metric" && measure.metric === "goalProgress") {
    if (window.kind !== "active-period") {
      issue(
        issues,
        "query.window",
        "unsupported",
        "widget.error.goal-owns-window",
      );
      window = { kind: "active-period" };
    }
    if (Array.isArray(query.filters) && query.filters.length > 0) {
      issue(
        issues,
        "query.filters",
        "unsupported",
        "widget.error.goal-owns-filters",
      );
    }
  }

  const groupRaw = record(analysis.groupBy);
  let groupBy = fallback.analysis.groupBy;
  if (groupRaw?.kind === "time") {
    groupBy = {
      kind: "time",
      interval:
        groupRaw.interval === "day" || groupRaw.interval === "month"
          ? groupRaw.interval
          : "week",
      accumulation: groupRaw.accumulation === "bucket" ? "bucket" : "running",
    };
  } else if (groupRaw?.kind === "subject") {
    groupBy = {
      kind: "subject",
      limit: integer(groupRaw.limit, 10, 1, 100),
      includeCategories: bool(groupRaw.includeCategories, false),
    };
  } else if (groupRaw?.kind === "none") {
    groupBy = { kind: "none" };
  } else {
    issue(issues, "analysis.groupBy", "invalid-value", "widget.error.grouping");
  }
  if (!capability.groupings.includes(groupBy.kind)) {
    issue(
      issues,
      "analysis.groupBy",
      "unsupported",
      "widget.error.measure-grouping",
    );
    const kind = capability.groupings[0] ?? "none";
    groupBy =
      kind === "time"
        ? { kind: "time", interval: "week", accumulation: "running" }
        : kind === "subject"
          ? { kind: "subject", limit: 10, includeCategories: false }
          : { kind: "none" };
  }

  let transforms = normalizeTransforms(analysis.transforms, issues);
  if (groupBy.kind === "none" && transforms.length > 0) {
    issue(
      issues,
      "analysis.transforms",
      "unsupported",
      "widget.error.transforms-grouping",
    );
    transforms = [];
  } else if (groupBy.kind === "subject") {
    const temporalTransforms = transforms.filter(
      (transform) =>
        transform.kind === "moving-average" || transform.kind === "cumulative",
    );
    if (temporalTransforms.length > 0) {
      issue(
        issues,
        "analysis.transforms",
        "unsupported",
        "widget.error.transforms-grouping",
      );
      transforms = transforms.filter(
        (transform) =>
          transform.kind !== "moving-average" &&
          transform.kind !== "cumulative",
      );
    }
  }

  const comparisonRaw = record(analysis.comparison);
  let comparison = fallback.analysis.comparison;
  if (comparisonRaw?.kind === "previous-window")
    comparison = { kind: "previous-window" };
  else if (comparisonRaw?.kind === "baseline")
    comparison = {
      kind: "baseline",
      value: finite(comparisonRaw.value, 0, -1_000_000, 1_000_000),
    };
  else if (comparisonRaw?.kind === "none") comparison = { kind: "none" };
  else
    issue(
      issues,
      "analysis.comparison",
      "invalid-value",
      "widget.error.comparison",
    );
  if (!capability.comparisons.includes(comparison.kind)) {
    issue(
      issues,
      "analysis.comparison",
      "unsupported",
      "widget.error.measure-comparison",
    );
    comparison = { kind: "none" };
  }
  if (comparison.kind === "previous-window" && window.kind === "whole-year") {
    issue(
      issues,
      "analysis.comparison",
      "unsupported",
      "widget.error.previous-window-whole-year",
    );
    comparison = { kind: "none" };
  }

  const requestedMark = MARKS.includes(visualization.mark as WidgetChartMark)
    ? (visualization.mark as WidgetChartMark)
    : fallback.visualization.mark;
  const compatibleMarks = widgetCompatibleMarks(measure, groupBy);
  const mark = compatibleMarks.includes(requestedMark)
    ? requestedMark
    : (compatibleMarks[0] ?? "value");
  if (mark !== requestedMark) {
    issue(
      issues,
      "visualization.mark",
      "unsupported",
      "widget.error.mark-incompatible",
    );
  }
  const visualDefault = createWidgetVisualization(mark);
  const encodingRaw = record(visualization.encoding);
  const activeEncodingChannels = {
    x: ["line", "area", "bar", "dot", "heatmap"].includes(mark),
    y:
      [
        "line",
        "area",
        "bar",
        "dot",
        "histogram",
        "heatmap",
        "boxplot",
      ].includes(mark) &&
      !(
        capability.resultShape === "distribution" &&
        (mark === "histogram" || mark === "boxplot")
      ),
    color: ["line", "area", "bar", "dot", "heatmap"].includes(mark),
    series: ["line", "area", "bar", "dot"].includes(mark),
  } as const;
  const normalizedEncodings = Object.fromEntries(
    (["x", "y", "color", "series"] as const).map((channel) => [
      channel,
      activeEncodingChannels[channel]
        ? normalizeEncoding(
            channel,
            encodingRaw?.[channel],
            visualDefault.encoding[channel],
            widgetEncodingFields(
              capability,
              groupBy,
              channel,
              comparison.kind !== "none" ||
                widgetMeasureHasIntrinsicDelta(measure),
            ),
            issues,
          )
        : null,
    ]),
  ) as WidgetDefinitionV1["visualization"]["encoding"];
  let normalizedOptions = markOptions(mark, visualization.options);
  const supportsValueAdornments =
    capability.resultShape === "scalar" && comparison.kind !== "none";
  if (normalizedOptions.kind === "value" && !supportsValueAdornments) {
    normalizedOptions = {
      ...normalizedOptions,
      showDelta: false,
      trendIndicator: false,
    };
  }
  const hasStackableSeries =
    groupBy.kind === "time" &&
    (normalizedEncodings.color?.field === "category" ||
      normalizedEncodings.series?.field === "category");
  if (
    normalizedOptions.kind === "bar" &&
    normalizedOptions.stacked &&
    !hasStackableSeries
  ) {
    issue(
      issues,
      "visualization.options.stacked",
      "unsupported",
      "widget.error.stacked-series",
    );
    normalizedOptions = { ...normalizedOptions, stacked: false };
  }
  const scaleRaw = record(visualization.scale);
  const scaleX = record(scaleRaw?.x);
  const scaleY = record(scaleRaw?.y);
  let scaleYMin = nullableNumber(scaleY?.min);
  let scaleYMax = nullableNumber(scaleY?.max);
  if (scaleYMin !== null && scaleYMax !== null && scaleYMin > scaleYMax) {
    issue(
      issues,
      "visualization.scale.y.min",
      "invalid-value",
      "widget.error.scale-order",
    );
    issue(
      issues,
      "visualization.scale.y.max",
      "invalid-value",
      "widget.error.scale-order",
    );
    [scaleYMin, scaleYMax] = [scaleYMax, scaleYMin];
  }
  const axesRaw = record(visualization.axes);
  const axisX = record(axesRaw?.x);
  const axisY = record(axesRaw?.y);
  const legendRaw = record(visualization.legend);
  const hasLegendEncoding = Boolean(
    normalizedEncodings.color || normalizedEncodings.series,
  );
  const requestedLegend = bool(legendRaw?.visible, false);
  if (requestedLegend && !hasLegendEncoding) {
    issue(
      issues,
      "visualization.legend.visible",
      "unsupported",
      "widget.error.legend-encoding",
    );
  }
  const formatRaw = record(visualization.format);
  const thresholdsRaw = Array.isArray(visualization.thresholds)
    ? visualization.thresholds
    : [];
  if (thresholdsRaw.length > WIDGET_LIMITS.thresholds) {
    issue(
      issues,
      "visualization.thresholds",
      "complexity-limit",
      "widget.error.thresholds-limit",
    );
  }
  const thresholds = thresholdsRaw
    .slice(0, WIDGET_LIMITS.thresholds)
    .flatMap((raw, index) => {
      const item = record(raw);
      if (
        !item ||
        typeof item.value !== "number" ||
        !Number.isFinite(item.value)
      ) {
        issue(
          issues,
          `visualization.thresholds.${index}.value`,
          "invalid-value",
          "widget.error.finite-number",
        );
        return [];
      }
      return [
        {
          value: item.value,
          color: thresholdColor(
            item.color,
            `visualization.thresholds.${index}.color`,
            issues,
          ),
          label: optionalText(item.label),
        },
      ];
    });

  const definition: WidgetDefinitionV1 = {
    apiVersion: WIDGET_DEFINITION_VERSION,
    query: {
      source: "grades",
      scope,
      window,
      filters:
        measure.kind === "metric" && measure.metric === "goalProgress"
          ? []
          : normalizeFilters(query.filters, issues),
    },
    analysis: { measure, groupBy, comparison, transforms },
    visualization: {
      mark,
      encoding: normalizedEncodings,
      options: normalizedOptions,
      scale: {
        x: {
          reverse: bool(scaleX?.reverse, false),
        },
        y: {
          zero: bool(scaleY?.zero, visualDefault.scale.y.zero),
          min: scaleYMin,
          max: scaleYMax,
          reverse: bool(scaleY?.reverse, false),
        },
      },
      axes: {
        x: {
          visible: bool(axisX?.visible, visualDefault.axes.x.visible),
          grid: bool(axisX?.grid, visualDefault.axes.x.grid),
          label: optionalText(axisX?.label),
        },
        y: {
          visible: bool(axisY?.visible, visualDefault.axes.y.visible),
          grid: bool(axisY?.grid, visualDefault.axes.y.grid),
          label: optionalText(axisY?.label),
        },
      },
      legend: {
        visible: requestedLegend && hasLegendEncoding,
        position:
          legendRaw?.position === "top" || legendRaw?.position === "right"
            ? legendRaw.position
            : "bottom",
      },
      format: {
        decimals:
          formatRaw?.decimals === null
            ? null
            : integer(formatRaw?.decimals, 2, 0, 6),
        unit:
          formatRaw?.unit === "ratio" ||
          formatRaw?.unit === "percent" ||
          formatRaw?.unit === "count" ||
          formatRaw?.unit === "days"
            ? formatRaw.unit
            : "auto",
        compact: bool(formatRaw?.compact, false),
      },
      thresholds,
    },
  };
  return { definition, issues };
}

export function validateWidgetDefinition(
  input: unknown,
  options: WidgetCompileOptions,
): WidgetValidationResult {
  const normalized = normalizeDefinition(input, options);
  const references = collectWidgetReferences(normalized.definition);
  const pools = options.references;
  const checks: Array<
    [string[], ReadonlySet<string> | undefined, string, string]
  > = [
    [
      references.subjectIds,
      pools?.subjectIds,
      "subject",
      "query.scope.subjectIds",
    ],
    [
      references.customAverageIds,
      pools?.customAverageIds,
      "custom-average",
      "query.scope.averageId",
    ],
    [references.goalIds, pools?.goalIds, "goal", "analysis.measure.goalId"],
    [references.periodIds, pools?.periodIds, "period", "query.window.periodId"],
  ];
  for (const [ids, allowed, kind, path] of checks) {
    if (!allowed) continue;
    for (const id of ids) {
      if (!allowed.has(id))
        issue(
          normalized.issues,
          path,
          "invalid-reference",
          `widget.error.reference.${kind}`,
        );
    }
  }
  return {
    valid: normalized.issues.length === 0,
    issues: normalized.issues,
    definition: normalized.issues.length === 0 ? normalized.definition : null,
  };
}

export function canonicalizeWidgetDefinition(
  input: unknown,
  options: Pick<WidgetCompileOptions, "surface">,
): WidgetDefinitionV1 {
  return normalizeDefinition(input, options).definition;
}

export function collectWidgetReferences(
  definition: WidgetDefinitionV1,
): WidgetReferences {
  const scope = definition.query.scope;
  const measure = definition.analysis.measure;
  const window = definition.query.window;
  return {
    subjectIds: scope.kind === "subjects" ? [...new Set(scope.subjectIds)] : [],
    customAverageIds: scope.kind === "custom-average" ? [scope.averageId] : [],
    goalIds:
      measure.kind === "metric" && measure.goalId ? [measure.goalId] : [],
    periodIds: window.kind === "period" ? [window.periodId] : [],
  };
}

export function compileWidgetDefinition(
  input: unknown,
  options: WidgetCompileOptions,
): WidgetCompileResult {
  const validation = validateWidgetDefinition(input, options);
  if (!validation.valid || !validation.definition) {
    return { valid: false, issues: validation.issues, plan: null };
  }
  const definition = validation.definition;
  const capability = widgetCapability(
    widgetMeasureId(definition.analysis.measure),
  );
  return {
    valid: true,
    issues: [],
    plan: {
      version: WIDGET_DEFINITION_VERSION,
      definition,
      capability,
      resultShape:
        definition.analysis.groupBy.kind === "time"
          ? "temporal-series"
          : definition.analysis.groupBy.kind === "subject"
            ? "categorical-series"
            : capability.resultShape,
      valueType:
        definition.analysis.measure.kind === "formula"
          ? definition.analysis.measure.valueType
          : capability.valueType,
      references: collectWidgetReferences(definition),
    },
  };
}
