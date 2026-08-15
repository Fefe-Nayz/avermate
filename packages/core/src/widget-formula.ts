import { median, standardDeviation } from "./analytics";
import type {
  WidgetFormula,
  WidgetFormulaContext,
  WidgetFormulaField,
  WidgetScope,
  WidgetValidationIssue,
  WidgetWindow,
} from "./widget-types";
import { WIDGET_FORMULA_METRICS, WIDGET_LIMITS } from "./widget-types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function issue(path: string, messageKey: string): WidgetValidationIssue {
  return { path, code: "invalid-value", messageKey };
}

const FORMULA_FIELDS = ["ratio", "value", "outOf", "coefficient"] as const;
const AGGREGATES = [
  "count",
  "sum",
  "mean",
  "median",
  "min",
  "max",
  "standard-deviation",
] as const;
const UNARY = ["absolute", "negate", "round", "floor", "ceil"] as const;
const BINARY = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "minimum",
  "maximum",
] as const;
const COMPARE = ["gt", "gte", "lt", "lte", "eq"] as const;

function member<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

interface FormulaParseState {
  nodes: number;
  metricNodes: number;
  issues: WidgetValidationIssue[];
}

/**
 * The scope/window overrides a metric operand may carry. Same rules as the
 * card-level validator in widget-definition, restated here because that
 * module already depends on this one.
 */
function parseNodeScope(
  value: unknown,
  path: string,
  state: FormulaParseState,
): WidgetScope | null | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  // The editor writes an explicit "inherit" choice; the stored node simply
  // omits the override.
  if (raw?.kind === "inherit") return undefined;
  if (raw?.kind === "general") return { kind: "general" };
  if (raw?.kind === "subjects") {
    const subjectIds = Array.isArray(raw.subjectIds)
      ? [
          ...new Set(
            raw.subjectIds.filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            ),
          ),
        ].slice(0, WIDGET_LIMITS.subjectReferences)
      : [];
    if (subjectIds.length === 0) {
      state.issues.push(
        issue(`${path}.subjectIds`, "widget.error.subject-required"),
      );
      return null;
    }
    return {
      kind: "subjects",
      subjectIds,
      includeDescendants:
        typeof raw.includeDescendants === "boolean"
          ? raw.includeDescendants
          : true,
    };
  }
  if (raw?.kind === "custom-average") {
    if (typeof raw.averageId !== "string" || raw.averageId.length === 0) {
      state.issues.push(
        issue(`${path}.averageId`, "widget.error.average-required"),
      );
      return null;
    }
    return { kind: "custom-average", averageId: raw.averageId };
  }
  state.issues.push(issue(`${path}.kind`, "widget.error.scope-kind"));
  return null;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseNodeWindow(
  value: unknown,
  path: string,
  state: FormulaParseState,
): WidgetWindow | null | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  if (raw?.kind === "inherit") return undefined;
  if (raw?.kind === "active-period" || raw?.kind === "whole-year") {
    return { kind: raw.kind };
  }
  if (raw?.kind === "period") {
    if (typeof raw.periodId !== "string" || raw.periodId.length === 0) {
      state.issues.push(
        issue(`${path}.periodId`, "widget.error.period-required"),
      );
      return null;
    }
    return { kind: "period", periodId: raw.periodId };
  }
  if (raw?.kind === "rolling-days") {
    return {
      kind: "rolling-days",
      days: boundedInteger(raw.days, 30, 1, 3_650),
    };
  }
  if (raw?.kind === "last-grades") {
    return {
      kind: "last-grades",
      count: boundedInteger(raw.count, 10, 1, 500),
    };
  }
  if (raw?.kind === "date-range") {
    const from = typeof raw.from === "string" ? raw.from : "";
    const to = typeof raw.to === "string" ? raw.to : "";
    const fromTime = Date.parse(from);
    const toTime = Date.parse(to);
    if (
      !Number.isFinite(fromTime) ||
      !Number.isFinite(toTime) ||
      fromTime > toTime
    ) {
      state.issues.push(issue(path, "widget.error.date-range"));
      return null;
    }
    return { kind: "date-range", from, to };
  }
  state.issues.push(issue(`${path}.kind`, "widget.error.window-kind"));
  return null;
}

function parseNode(
  value: unknown,
  path: string,
  depth: number,
  state: FormulaParseState,
): WidgetFormula | null {
  state.nodes += 1;
  if (
    depth > WIDGET_LIMITS.formulaDepth ||
    state.nodes > WIDGET_LIMITS.formulaNodes
  ) {
    state.issues.push({
      path,
      code: "complexity-limit",
      messageKey: "widget.error.formula-complexity",
    });
    return null;
  }
  const node = record(value);
  if (!node || typeof node.kind !== "string") {
    state.issues.push(issue(path, "widget.error.formula-node"));
    return null;
  }
  switch (node.kind) {
    case "literal":
      if (typeof node.value !== "number" || !Number.isFinite(node.value)) {
        state.issues.push(issue(`${path}.value`, "widget.error.finite-number"));
        return null;
      }
      return { kind: "literal", value: node.value };
    case "parameter":
      if (node.name !== "passingRatio" && node.name !== "yearScale") {
        state.issues.push(
          issue(`${path}.name`, "widget.error.formula-parameter"),
        );
        return null;
      }
      return { kind: "parameter", name: node.name };
    case "aggregate":
      if (!member(AGGREGATES, node.operation)) {
        state.issues.push(
          issue(`${path}.operation`, "widget.error.formula-aggregate"),
        );
        return null;
      }
      if (!member(FORMULA_FIELDS, node.field)) {
        state.issues.push(issue(`${path}.field`, "widget.error.formula-field"));
        return null;
      }
      return {
        kind: "aggregate",
        operation: node.operation,
        field: node.field,
      };
    case "metric": {
      state.metricNodes += 1;
      if (state.metricNodes > WIDGET_LIMITS.formulaMetricNodes) {
        state.issues.push({
          path,
          code: "complexity-limit",
          messageKey: "widget.error.formula-complexity",
        });
        return null;
      }
      if (!member(WIDGET_FORMULA_METRICS, node.metric)) {
        state.issues.push(
          issue(`${path}.metric`, "widget.error.formula-metric"),
        );
        return null;
      }
      const scope = parseNodeScope(node.scope, `${path}.scope`, state);
      if (scope === null) return null;
      const window = parseNodeWindow(node.window, `${path}.window`, state);
      if (window === null) return null;
      return {
        kind: "metric",
        metric: node.metric,
        ...(scope !== undefined ? { scope } : {}),
        ...(window !== undefined ? { window } : {}),
      };
    }
    case "unary": {
      if (!member(UNARY, node.operation)) {
        state.issues.push(
          issue(`${path}.operation`, "widget.error.formula-unary"),
        );
        return null;
      }
      const operand = parseNode(
        node.operand,
        `${path}.operand`,
        depth + 1,
        state,
      );
      return operand
        ? { kind: "unary", operation: node.operation, operand }
        : null;
    }
    case "binary": {
      if (!member(BINARY, node.operation)) {
        state.issues.push(
          issue(`${path}.operation`, "widget.error.formula-binary"),
        );
        return null;
      }
      const left = parseNode(node.left, `${path}.left`, depth + 1, state);
      const right = parseNode(node.right, `${path}.right`, depth + 1, state);
      return left && right
        ? { kind: "binary", operation: node.operation, left, right }
        : null;
    }
    case "compare": {
      if (!member(COMPARE, node.operation)) {
        state.issues.push(
          issue(`${path}.operation`, "widget.error.formula-compare"),
        );
        return null;
      }
      const left = parseNode(node.left, `${path}.left`, depth + 1, state);
      const right = parseNode(node.right, `${path}.right`, depth + 1, state);
      return left && right
        ? { kind: "compare", operation: node.operation, left, right }
        : null;
    }
    case "conditional": {
      const condition = parseNode(
        node.condition,
        `${path}.condition`,
        depth + 1,
        state,
      );
      const whenTrue = parseNode(
        node.whenTrue,
        `${path}.whenTrue`,
        depth + 1,
        state,
      );
      const whenFalse = parseNode(
        node.whenFalse,
        `${path}.whenFalse`,
        depth + 1,
        state,
      );
      return condition && whenTrue && whenFalse
        ? { kind: "conditional", condition, whenTrue, whenFalse }
        : null;
    }
    default:
      state.issues.push(issue(`${path}.kind`, "widget.error.formula-kind"));
      return null;
  }
}

export function parseWidgetFormula(value: unknown): {
  formula: WidgetFormula | null;
  issues: WidgetValidationIssue[];
} {
  const state: FormulaParseState = { nodes: 0, metricNodes: 0, issues: [] };
  const formula = parseNode(value, "analysis.measure.formula", 1, state);
  return { formula, issues: state.issues };
}

function valuesFor(
  field: WidgetFormulaField,
  context: WidgetFormulaContext,
): number[] {
  return context.grades.map((grade) => grade[field]).filter(Number.isFinite);
}

function aggregate(
  operation: Extract<WidgetFormula, { kind: "aggregate" }>["operation"],
  values: number[],
): number {
  if (operation === "count") return values.length;
  if (values.length === 0) return Number.NaN;
  if (operation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (operation === "mean") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (operation === "median") return median(values) ?? Number.NaN;
  if (operation === "min") return Math.min(...values);
  if (operation === "max") return Math.max(...values);
  return standardDeviation(values) ?? Number.NaN;
}

export function evaluateWidgetFormula(
  formula: WidgetFormula,
  context: WidgetFormulaContext,
): number | null {
  const evaluate = (node: WidgetFormula, depth: number): number => {
    if (depth > WIDGET_LIMITS.formulaDepth) return Number.NaN;
    switch (node.kind) {
      case "literal":
        return node.value;
      case "parameter":
        return node.name === "passingRatio"
          ? context.passingRatio
          : context.yearScale;
      case "aggregate":
        return aggregate(node.operation, valuesFor(node.field, context));
      case "metric":
        return context.resolveMetric?.(node) ?? Number.NaN;
      case "unary": {
        const value = evaluate(node.operand, depth + 1);
        if (node.operation === "absolute") return Math.abs(value);
        if (node.operation === "negate") return -value;
        if (node.operation === "round") return Math.round(value);
        if (node.operation === "floor") return Math.floor(value);
        return Math.ceil(value);
      }
      case "binary": {
        const left = evaluate(node.left, depth + 1);
        const right = evaluate(node.right, depth + 1);
        if (node.operation === "add") return left + right;
        if (node.operation === "subtract") return left - right;
        if (node.operation === "multiply") return left * right;
        if (node.operation === "divide")
          return right === 0 ? Number.NaN : left / right;
        if (node.operation === "minimum") return Math.min(left, right);
        return Math.max(left, right);
      }
      case "compare": {
        const left = evaluate(node.left, depth + 1);
        const right = evaluate(node.right, depth + 1);
        if (!Number.isFinite(left) || !Number.isFinite(right)) {
          return Number.NaN;
        }
        if (node.operation === "gt") return left > right ? 1 : 0;
        if (node.operation === "gte") return left >= right ? 1 : 0;
        if (node.operation === "lt") return left < right ? 1 : 0;
        if (node.operation === "lte") return left <= right ? 1 : 0;
        return left === right ? 1 : 0;
      }
      case "conditional": {
        const condition = evaluate(node.condition, depth + 1);
        if (!Number.isFinite(condition)) return Number.NaN;
        return condition !== 0
          ? evaluate(node.whenTrue, depth + 1)
          : evaluate(node.whenFalse, depth + 1);
      }
    }
  };
  const result = evaluate(formula, 1);
  return Number.isFinite(result) ? result : null;
}
