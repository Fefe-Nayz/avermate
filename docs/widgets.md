# Widget and Insights architecture

This document describes the versioned analytics engine used by Dashboard
DataCards and Insights. The implementation deliberately separates the
analytics question from its visual presentation and from the card's layout.

## Design goals

- One definition is evaluated identically on web and native.
- The editor is generated from a shared flow schema. Clients render controls;
  they do not branch on metric names.
- Definitions are inert data. They cannot contain executable code, arbitrary
  property access, CSS, or unbounded expressions.
- Existing dashboard cards keep their exact legacy appearance until their
  definition is explicitly edited.
- An empty Insights surface stays empty. Recommended widgets are restored only
  through the explicit reset action.

## Stored model

`dashboard_cards` remains the layout envelope:

- owner, year, surface, order and visibility;
- title, accent and responsive span;
- legacy projection columns for backwards compatibility;
- `definitionVersion` and `definitionJson` for the semantic definition.

The JSON document is a `WidgetDefinitionV1` with three sections:

1. `query`: source, academic scope, time window and filters;
2. `analysis`: metric or bounded formula, grouping, comparison and transforms;
3. `visualization`: mark, encodings, mark options, scales, axes, legend,
   formatting and thresholds.

References inside JSON are mirrored into `dashboard_card_references`. This
keeps ownership and deletion checks relational: subjects, custom averages,
goals and periods can be found without scanning JSON. The reference rows are
derived and replaced atomically whenever a definition changes.

Deleting a subject through the application also updates dependent definitions
atomically. Multi-subject widgets keep their remaining subjects and their
reference rows are rebuilt; a widget is removed only when its required target
has disappeared. Database triggers remain a last-resort cleanup for writes
that bypass the application service.

## Definition pipeline

Every write and evaluation follows the same core pipeline:

```text
untrusted definition
        |
        v
normalize + canonicalize
        |
        v
validate capabilities, limits and references
        |
        v
compile deterministic execution plan
        |
        v
evaluate query -> analysis -> transforms
        |
        v
typed result -> platform renderer
```

The compiler rejects unsupported combinations instead of storing a setting
that has no implementation. Examples include a histogram for a single record,
stacking without categorical series, a legend without a color/series encoding,
or transforms without grouped data.

The evaluator returns bounded typed results: scalar, temporal/categorical
series, distribution with five-number summary and outliers, or structured
record/streak/goal results. It never returns renderer-specific components.

## Supported analysis grammar

V1 supports:

- general, one-or-more subjects, or a custom-average scope;
- active period, whole year, named period, rolling days, last grades, or an
  explicit date range;
- ratio/coefficient/note/name/pass filters;
- the 21 built-in metrics or a bounded formula tree;
- no grouping, calendar time grouping, or subject grouping;
- a fixed baseline or the corresponding previous window;
- sort and limit transforms for grouped results, plus moving-average and
  cumulative transforms for chronological series;
- value, gauge, line, area, bar, dot, histogram, box plot, heatmap, table and
  list marks;
- channel encodings, scale bounds/direction, axes/grid/labels, legends,
  units/precision/compact formatting, and semantic thresholds.

Formulas are a discriminated AST of literals, parameters, aggregates, unary
and binary operations, comparisons and conditionals. Depth, node count and
collection sizes are capped by `WIDGET_LIMITS`. Division by zero and other
non-finite results become an empty result rather than entering storage or UI.

## Declarative editors

`WIDGET_FLOW_SCHEMA` describes every field with:

- editor tab and section;
- stable path into `WidgetDefinitionV1`;
- generic control type;
- literal message key;
- options or an option provider;
- numeric constraints;
- visibility condition and hidden-field pruning behavior;
- an optional recursive collection schema.

`resolveWidgetFlow()` combines this schema with the current definition and the
selected metric's capability. It returns active sections, available choices,
field errors and a canonical pruned definition. Web and native only map generic
controls such as choice, reference, number, date, toggle, filters, transforms,
thresholds and recursive formula. Metric-specific JSX is not permitted.

Changing a discriminant also replaces incompatible subtrees with canonical
defaults. For example, changing a line to a bar cannot leave line-only curve
options in the document.

## Surfaces and rendering

The same engine serves `overview`, `subject`, `grade` and `insights` surfaces.
Capabilities decide which metrics and marks each surface can use.

Dashboard remains optimized for compact readings. Insights uses the same
definitions but gives analytical charts more room. Recommended Insights are an
explicit set of four V1 presets; they are not an implicit client fallback.

Web uses TanStack Charts where appropriate and dedicated semantic renderers for
values, gauges, tables, box plots and heatmaps. Native uses React Native/SVG
renderers with the same encodings and formatting contract. Both preserve a
legacy `CardResult` renderer only for rows that have no V1 definition.

## Compatibility and migration

Migration `0017_widget_definitions` is additive. Legacy semantic columns remain
readable and are adapted to V1 for editing, while the original legacy renderer
is used for display. Presentation-only updates (title, accent, span or hidden)
do not promote a legacy row. Writes through the legacy API remain legacy and
lossless; the declarative editor promotes a row only by sending an explicit V1
definition. A legacy semantic patch against an existing V1 widget is rejected
because its flat projection cannot preserve the richer definition.

Preset reapplication preserves stable subject/custom-average identifiers so it
does not trigger reference cleanup for resources that still exist.

## Extending the engine

To add a metric or visualization:

1. Add or update its capability in `widget-registry.ts`.
2. Implement the calculation in the shared evaluator and return an existing
   result shape, or introduce a new typed result deliberately.
3. Add declarative fields to `widget-flow-schema.ts` only when the option has a
   real compiler and renderer effect.
4. Implement the result/mark on both web and native.
5. Add core characterization tests, server ownership/persistence tests, and
   renderer/flow tests on both clients.

Do not add metric-specific branches to the form, persist arbitrary chart JSON,
evaluate JavaScript formulas, or infer references by parsing JSON in routers.
