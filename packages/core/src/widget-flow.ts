import { WIDGET_FLOW_SCHEMA, WIDGET_FLOW_SECTIONS } from "./widget-flow-schema";
import {
  widgetCapabilitiesForSurface,
  widgetCapability,
  widgetChannelFields,
  widgetChannelMeasure,
  widgetCompatibleRecipes,
  widgetDimensionSplitSupported,
  widgetMeasureCanMaterializeFrameValue,
  widgetMeasureHasIntrinsicDelta,
  widgetMeasureId,
} from "./widget-registry";
import {
  canonicalizeWidgetDefinition,
  compileWidgetDefinition,
} from "./widget-definition";
import { widgetPrimaryMeasure } from "./widget-types";
import type {
  WidgetDefinition,
  WidgetFlow,
  WidgetFlowCondition,
  WidgetFlowContext,
  WidgetFlowField,
  WidgetFlowOption,
  WidgetDimensionKind,
  WidgetMeasure,
  WidgetOptionProvider,
} from "./widget-types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function removeWidgetValueAtPath(
  value: WidgetDefinition,
  path: string,
): WidgetDefinition {
  const segments = path.split(".");
  const remove = (current: unknown, index: number): unknown => {
    const key = segments[index] as string;
    const last = index === segments.length - 1;
    if (Array.isArray(current)) {
      const position = Number.parseInt(key, 10);
      if (!Number.isInteger(position) || position >= current.length) {
        return current;
      }
      const copy = [...current];
      // Removing a whole element rather than leaving a hole: an array with an
      // `undefined` at index one serialises to `null` and parses as a broken measure.
      if (last) copy.splice(position, 1);
      else copy[position] = remove(copy[position], index + 1);
      return copy;
    }
    const object = record(current);
    if (!object) return current;
    if (!(key in object)) return current;
    const copy = { ...object };
    if (last) {
      delete copy[key];
    } else {
      copy[key] = remove(copy[key], index + 1);
    }
    return copy;
  };
  return remove(value, 0) as WidgetDefinition;
}

/**
 * A value at a descriptor path, arrays included.
 *
 * A numeric segment indexes an array — `analysis.measures.0.expression.metric` — which is
 * how the editor addresses one of several measures or dimensions. The web draft helpers
 * already read and wrote paths this way; this is the reader catching up.
 */
export function widgetValueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    const object = record(current);
    if (!object) return undefined;
    current = object[segment];
  }
  return current;
}

function conditionMatches(
  condition: WidgetFlowCondition,
  definition: WidgetDefinition,
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
  definition: WidgetDefinition,
  context: WidgetFlowContext,
): WidgetFlowOption[] {
  const supplied = context.options?.[provider];
  if (supplied) return supplied;
  const capability = widgetCapability(
    widgetMeasureId(widgetPrimaryMeasure(definition.analysis)),
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
    // Recipes, not marks: the document stores a recipe and the editor offers what the
    // document can hold. The provider keeps its name so the schema does not churn.
    return widgetCompatibleRecipes(
      widgetPrimaryMeasure(definition.analysis),
      definition.analysis.dimensions,
    ).map((recipe) => ({
      value: recipe,
      messageKey: `widget.recipe.${recipe}`,
    }));
  }
  if (provider === "encoding-fields") {
    /**
     * What this definition actually produced, by id.
     *
     * The old five fixed names — date, category, value, delta, count — are gone with the
     * single grouping. A channel now names a dimension or a reading of a measure, so the
     * options are built from the analysis and named after *what they are*: a dimension by
     * its kind, a measure by its reading. Where a card carries several measures the
     * measure's own label disambiguates them, which is why a second measure is required
     * to have one.
     */
    return widgetChannelFields(definition.analysis, "x", {
      includeDelta: true,
    }).map((field) => {
      const dimension = definition.analysis.dimensions.find(
        (item) => item.id === field,
      );
      if (dimension) {
        return {
          value: field,
          messageKey: `widget.dimension.${dimension.kind}`,
        };
      }
      const measure = widgetChannelMeasure(definition.analysis, field);
      return {
        value: field,
        messageKey: `widget.encoding.${measure?.reading ?? "value"}`,
        ...(measure?.measure.label ? { label: measure.measure.label } : {}),
      };
    });
  }
  return [];
}

function capabilityOptions(
  fieldId: string,
  options: WidgetFlowOption[],
  definition: WidgetDefinition,
): WidgetFlowOption[] {
  const capability = widgetCapability(
    widgetMeasureId(widgetPrimaryMeasure(definition.analysis)),
  );
  if (fieldId === "scope") {
    return options.filter((option) =>
      capability.scopes.includes(
        option.value as (typeof capability.scopes)[number],
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
  if (fieldId === "second-metric") {
    return options.filter((option) => {
      const measure: WidgetMeasure = {
        kind: "metric",
        metric: option.value as Extract<
          WidgetMeasure,
          { kind: "metric" }
        >["metric"],
        goalId: null,
      };
      const secondary = widgetCapability(widgetMeasureId(measure));
      const groupable =
        definition.analysis.dimensions.length === 0
          ? secondary.groupings.includes("none")
          : definition.analysis.dimensions.every((dimension) =>
              secondary.groupings.includes(dimension.kind),
            );
      return (
        secondary.scopes.includes(definition.query.scope.kind) &&
        groupable &&
        secondary.comparisons.includes(definition.analysis.comparison.kind) &&
        widgetMeasureCanMaterializeFrameValue(
          measure,
          definition.analysis.dimensions,
        )
      );
    });
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
    const allowed = widgetChannelFields(definition.analysis, channel, {
      includeDelta:
        definition.analysis.comparison.kind !== "none" ||
        widgetMeasureHasIntrinsicDelta(
          widgetPrimaryMeasure(definition.analysis),
        ),
    });
    return options.filter((option) =>
      allowed.includes(option.value as (typeof allowed)[number]),
    );
  }
  return options;
}

export function resolveWidgetFlow(
  input: WidgetDefinition,
  context: WidgetFlowContext,
): WidgetFlow {
  const rawCompilation = compileWidgetDefinition(input, {
    surface: context.surface,
  });
  const initialDefinition = canonicalizeWidgetDefinition(input, {
    surface: context.surface,
  });
  const resolveFields = (
    definition: WidgetDefinition,
    issues: ReturnType<typeof compileWidgetDefinition>["issues"],
  ): WidgetFlowField[] => {
    const capability = widgetCapability(
      widgetMeasureId(widgetPrimaryMeasure(definition.analysis)),
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
        ? (() => {
            const variants = schema.collection.variants.filter(
              (variant) =>
                (!variant.visibleWhen ||
                  conditionMatches(
                    variant.visibleWhen,
                    definition,
                    capability,
                  )) &&
                // A grouping the measure cannot use is not offered, the same gate the
                // single `group-by` choice had — a variant's value *is* the dimension
                // kind, which is what `capability.groupings` lists. Without this the
                // editor offers a split the compiler then refuses, which reads as the
                // editor being broken rather than the combination being impossible.
                (schema.id !== "dimensions" ||
                  capability.groupings.includes(
                    variant.value as (typeof capability.groupings)[number],
                  )),
            );
            const outer = definition.analysis.dimensions[0];
            const addVariants =
              schema.id === "dimensions" && outer
                ? variants.filter((variant) =>
                    widgetDimensionSplitSupported(outer, {
                      kind: variant.value as WidgetDimensionKind,
                    }),
                  )
                : variants;
            return {
              ...schema.collection,
              variants,
              ...(schema.id === "dimensions" ? { addVariants } : {}),
            };
          })()
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
  const fieldsClearedDefinition = initialFields
    .filter((field) => !field.active && field.clearWhenHidden)
    .reduce(
      (definition, field) => removeWidgetValueAtPath(definition, field.path),
      initialDefinition,
    );
  const definition = canonicalizeWidgetDefinition(fieldsClearedDefinition, {
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
