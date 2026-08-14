import { WIDGET_FLOW_SCHEMA, WIDGET_FLOW_SECTIONS } from "./widget-flow-schema";
import {
  widgetCapabilitiesForSurface,
  widgetCapability,
  widgetCompatibleMarks,
  widgetEncodingFields,
  widgetMeasureHasIntrinsicDelta,
  widgetMeasureId,
} from "./widget-registry";
import {
  canonicalizeWidgetDefinition,
  compileWidgetDefinition,
} from "./widget-definition";
import type {
  WidgetDefinitionV1,
  WidgetFlow,
  WidgetFlowCondition,
  WidgetFlowContext,
  WidgetFlowField,
  WidgetFlowOption,
  WidgetOptionProvider,
} from "./widget-types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function removeWidgetValueAtPath(
  value: WidgetDefinitionV1,
  path: string,
): WidgetDefinitionV1 {
  const segments = path.split(".");
  const remove = (current: unknown, index: number): unknown => {
    const object = record(current);
    if (!object) return current;
    const key = segments[index];
    if (!(key in object)) return current;
    const copy = { ...object };
    if (index === segments.length - 1) {
      delete copy[key];
    } else {
      copy[key] = remove(copy[key], index + 1);
    }
    return copy;
  };
  return remove(value, 0) as WidgetDefinitionV1;
}

export function widgetValueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    const object = record(current);
    if (!object) return undefined;
    current = object[segment];
  }
  return current;
}

function conditionMatches(
  condition: WidgetFlowCondition,
  definition: WidgetDefinitionV1,
  capability: ReturnType<typeof widgetCapability>,
): boolean {
  switch (condition.kind) {
    case "always":
      return true;
    case "equals":
      return widgetValueAtPath(definition, condition.path) === condition.value;
    case "one-of":
      return condition.values.includes(
        widgetValueAtPath(definition, condition.path) as
          string | number | boolean,
      );
    case "exists": {
      const value = widgetValueAtPath(definition, condition.path);
      return value !== undefined && value !== null && value !== "";
    }
    case "capability": {
      const candidate = widgetValueAtPath(definition, condition.path);
      return (capability[condition.property] as readonly unknown[]).includes(
        candidate,
      );
    }
    case "and":
      return condition.conditions.every((item) =>
        conditionMatches(item, definition, capability),
      );
    case "or":
      return condition.conditions.some((item) =>
        conditionMatches(item, definition, capability),
      );
    case "not":
      return !conditionMatches(condition.condition, definition, capability);
  }
}

function generatedOptions(
  provider: WidgetOptionProvider,
  definition: WidgetDefinitionV1,
  context: WidgetFlowContext,
): WidgetFlowOption[] {
  const supplied = context.options?.[provider];
  if (supplied) return supplied;
  const capability = widgetCapability(
    widgetMeasureId(definition.analysis.measure),
  );
  if (provider === "metrics") {
    return widgetCapabilitiesForSurface(context.surface)
      .filter((item) => item.id !== "formula")
      .map((item) => ({
        value: item.id,
        messageKey: item.messageKey,
      }));
  }
  if (provider === "marks") {
    return widgetCompatibleMarks(
      definition.analysis.measure,
      definition.analysis.groupBy,
    ).map((mark) => ({ value: mark, messageKey: `widget.mark.${mark}` }));
  }
  if (provider === "encoding-fields") {
    const fields = ["date", "category", "value", "delta", "count"];
    return fields.map((field) => ({
      value: field,
      messageKey: `widget.encoding.${field}`,
    }));
  }
  return [];
}

function capabilityOptions(
  fieldId: string,
  options: WidgetFlowOption[],
  definition: WidgetDefinitionV1,
): WidgetFlowOption[] {
  const capability = widgetCapability(
    widgetMeasureId(definition.analysis.measure),
  );
  if (fieldId === "scope") {
    return options.filter((option) =>
      capability.scopes.includes(
        option.value as (typeof capability.scopes)[number],
      ),
    );
  }
  if (fieldId === "group-by") {
    return options.filter((option) =>
      capability.groupings.includes(
        option.value as (typeof capability.groupings)[number],
      ),
    );
  }
  if (fieldId === "comparison") {
    return options.filter(
      (option) =>
        !(
          option.value === "previous-window" &&
          definition.query.window.kind === "whole-year"
        ) &&
        capability.comparisons.includes(
          option.value as (typeof capability.comparisons)[number],
        ),
    );
  }
  const channel =
    fieldId === "encoding-x"
      ? "x"
      : fieldId === "encoding-y"
        ? "y"
        : fieldId === "encoding-color"
          ? "color"
          : fieldId === "encoding-series"
            ? "series"
            : null;
  if (channel) {
    const allowed = widgetEncodingFields(
      capability,
      definition.analysis.groupBy,
      channel,
      definition.analysis.comparison.kind !== "none" ||
        widgetMeasureHasIntrinsicDelta(definition.analysis.measure),
    );
    return options.filter((option) =>
      allowed.includes(option.value as (typeof allowed)[number]),
    );
  }
  return options;
}

export function resolveWidgetFlow(
  input: WidgetDefinitionV1,
  context: WidgetFlowContext,
): WidgetFlow {
  const rawCompilation = compileWidgetDefinition(input, {
    surface: context.surface,
  });
  const initialDefinition = canonicalizeWidgetDefinition(input, {
    surface: context.surface,
  });
  const resolveFields = (
    definition: WidgetDefinitionV1,
    issues: ReturnType<typeof compileWidgetDefinition>["issues"],
  ): WidgetFlowField[] => {
    const capability = widgetCapability(
      widgetMeasureId(definition.analysis.measure),
    );
    return WIDGET_FLOW_SCHEMA.map((schema) => {
      const conditionActive = conditionMatches(
        schema.visibleWhen,
        definition,
        capability,
      );
      const sourceOptions = schema.optionProvider
        ? generatedOptions(schema.optionProvider, definition, context)
        : (schema.options ?? []);
      const options = capabilityOptions(schema.id, sourceOptions, definition);
      const collection = schema.collection
        ? {
            ...schema.collection,
            variants: schema.collection.variants.filter(
              (variant) =>
                !variant.visibleWhen ||
                conditionMatches(variant.visibleWhen, definition, capability),
            ),
          }
        : undefined;
      const hasChoice = schema.control !== "choice" || options.length > 1;
      const active =
        conditionActive &&
        hasChoice &&
        !(schema.id === "encoding-series" && options.length === 0);
      const fieldIssue = issues.find(
        (item) =>
          item.path === schema.path || item.path.startsWith(`${schema.path}.`),
      );
      return {
        ...schema,
        active,
        options,
        collection,
        error: fieldIssue?.messageKey ?? null,
      };
    });
  };

  const initialFields = resolveFields(initialDefinition, rawCompilation.issues);
  const clearedDefinition = initialFields
    .filter((field) => !field.active && field.clearWhenHidden)
    .reduce(
      (definition, field) => removeWidgetValueAtPath(definition, field.path),
      initialDefinition,
    );
  const definition = canonicalizeWidgetDefinition(clearedDefinition, {
    surface: context.surface,
  });
  const fields = resolveFields(definition, rawCompilation.issues);

  const sections = WIDGET_FLOW_SECTIONS.map(([editor, id, order]) => ({
    id,
    editor,
    order,
    messageKey: `widget.section.${id}`,
    descriptionKey: `widget.section.${id}.description`,
    fields: fields
      .filter((field) => field.editor === editor && field.section === id)
      .sort((a, b) => a.order - b.order),
  })).filter((section) => section.fields.some((field) => field.active));

  return {
    definition: sections.filter((section) => section.editor === "definition"),
    visualization: sections.filter(
      (section) => section.editor === "visualization",
    ),
    activePaths: fields
      .filter((field) => field.active)
      .map((field) => field.path),
    prunedDefinition: definition,
    issues: rawCompilation.issues,
  };
}
