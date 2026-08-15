"use client"

import { useCallback, useMemo } from "react"
import { useExtracted } from "next-intl"
import type { WidgetMessage } from "./widget-field-renderer"

/**
 * Translation boundary for core-owned descriptors.
 *
 * `useExtracted` can only discover literal source messages. Keeping the stable
 * core keys on the left and literal English on the right gives the shared
 * grammar proper web translations without putting product copy in core.
 * Unknown keys are user-provided reference labels and pass through unchanged.
 */
export function useWidgetMessages(): WidgetMessage {
  const t = useExtracted()
  const messages = useMemo<Record<string, string>>(
    () => ({
      "widget.section.data": t("Data source"),
      "widget.section.window": t("Time window"),
      "widget.section.filters": t("Filters"),
      "widget.section.measure": t("Measure"),
      "widget.section.grouping": t("Grouping"),
      "widget.section.comparison": t("Comparison"),
      "widget.section.transforms": t("Transforms"),
      "widget.section.chart": t("Chart"),
      "widget.section.encoding": t("Encodings"),
      "widget.section.appearance": t("Appearance"),
      "widget.section.scale": t("Scale"),
      "widget.section.axes": t("Axes and grid"),
      "widget.section.legend": t("Legend"),
      "widget.section.format": t("Number format"),
      "widget.section.thresholds": t("Thresholds"),
      "widget.section.data.description": t(
        "Choose which grades and subjects this analysis can use."
      ),
      "widget.section.window.description": t(
        "Limit the analysis to a period or a rolling window."
      ),
      "widget.section.filters.description": t(
        "Keep only grades that match your conditions."
      ),
      "widget.section.measure.description": t(
        "Choose the statistic or build a bounded formula."
      ),
      "widget.section.grouping.description": t(
        "Split the result over time or by subject."
      ),
      "widget.section.comparison.description": t(
        "Compare the result with another window or a fixed value."
      ),
      "widget.section.transforms.description": t(
        "Order, limit or smooth the resulting values."
      ),
      "widget.section.chart.description": t(
        "Choose the visual form that best answers the question."
      ),
      "widget.section.encoding.description": t(
        "Assign the available data fields to the chart."
      ),
      "widget.section.appearance.description": t(
        "Adjust the selected visualisation."
      ),
      "widget.section.scale.description": t(
        "Control the numeric range used by the chart."
      ),
      "widget.section.axes.description": t(
        "Choose which guides and labels are visible."
      ),
      "widget.section.legend.description": t(
        "Control how multiple series are identified."
      ),
      "widget.section.format.description": t(
        "Format the values without changing the calculation."
      ),
      "widget.section.thresholds.description": t(
        "Add reference levels to make important values visible."
      ),

      "widget.field.scope": t("Scope"),
      "widget.field.subjects": t("Subjects"),
      "widget.field.include-descendants": t("Include child subjects"),
      "widget.field.custom-average": t("Custom average"),
      "widget.field.window": t("Window"),
      "widget.field.period": t("Period"),
      "widget.field.rolling-days": t("Number of days"),
      "widget.field.last-grades": t("Number of grades"),
      "widget.field.from": t("From"),
      "widget.field.to": t("To"),
      "widget.field.filters": t("Filters"),
      "widget.field.measure-kind": t("Measure type"),
      "widget.field.metric": t("Metric"),
      "widget.field.goal": t("Goal"),
      "widget.field.formula-output": t("Formula result"),
      "widget.field.formula": t("Formula"),
      "widget.field.group-by": t("Group by"),
      "widget.field.time-interval": t("Time interval"),
      "widget.field.time-accumulation": t("Time calculation"),
      "widget.field.subject-limit": t("Maximum subjects"),
      "widget.field.include-categories": t("Include categories"),
      "widget.field.comparison": t("Compare with"),
      "widget.field.baseline": t("Baseline"),
      "widget.field.transforms": t("Transforms"),
      "widget.field.mark": t("Visualisation"),
      "widget.field.encoding-x": t("Horizontal axis"),
      "widget.field.encoding-y": t("Vertical axis"),
      "widget.field.encoding-color": t("Colour"),
      "widget.field.encoding-series": t("Series"),
      "widget.field.curve": t("Curve"),
      "widget.field.value-delta": t("Show comparison"),
      "widget.field.value-trend": t("Show trend indicator"),
      "widget.field.points": t("Show points"),
      "widget.field.stroke-width": t("Line width"),
      "widget.field.area-opacity": t("Fill opacity"),
      "widget.field.bar-orientation": t("Orientation"),
      "widget.field.bar-stacked": t("Stack bars"),
      "widget.field.bar-radius": t("Corner radius"),
      "widget.field.gauge-thickness": t("Gauge thickness"),
      "widget.field.gauge-value": t("Show value"),
      "widget.field.dot-size": t("Point size"),
      "widget.field.histogram-bins": t("Number of bins"),
      "widget.field.heatmap-colors": t("Colour scale"),
      "widget.field.boxplot-outliers": t("Show outliers"),
      "widget.field.rows": t("Rows"),
      "widget.field.list-values": t("Show values"),
      "widget.field.scale-zero": t("Start at zero"),
      "widget.field.scale-min": t("Minimum"),
      "widget.field.scale-max": t("Maximum"),
      "widget.field.scale-reverse-y": t("Reverse vertical scale"),
      "widget.field.scale-reverse-x": t("Reverse horizontal scale"),
      "widget.field.axis-x": t("Show horizontal axis"),
      "widget.field.axis-y": t("Show vertical axis"),
      "widget.field.grid": t("Show grid"),
      "widget.field.grid-x": t("Show vertical grid"),
      "widget.field.axis-x-label": t("Horizontal axis label"),
      "widget.field.axis-y-label": t("Vertical axis label"),
      "widget.field.legend": t("Show legend"),
      "widget.field.legend-position": t("Legend position"),
      "widget.field.unit": t("Unit"),
      "widget.field.decimals": t("Decimal places"),
      "widget.field.compact": t("Use compact numbers"),
      "widget.field.thresholds": t("Thresholds"),
      "widget.field.variant": t("Type"),
      "widget.field.filter-operator": t("Operator"),
      "widget.field.filter-ratio": t("Grade ratio"),
      "widget.field.filter-coefficient": t("Coefficient"),
      "widget.field.filter-has-note": t("Has a numeric result"),
      "widget.field.filter-text-operator": t("Text operator"),
      "widget.field.filter-text": t("Grade name"),
      "widget.field.filter-passed": t("Passing result"),
      "widget.field.transform-direction": t("Direction"),
      "widget.field.transform-limit": t("Maximum values"),
      "widget.field.transform-points": t("Moving window"),
      "widget.field.threshold-value": t("Threshold value"),
      "widget.field.threshold-color": t("Threshold colour"),
      "widget.field.threshold-label": t("Threshold label"),
      "widget.field.formula-value": t("Value"),
      "widget.field.formula-parameter": t("Parameter"),
      "widget.field.formula-aggregate": t("Aggregation"),
      "widget.field.formula-field": t("Data field"),
      "widget.field.formula-unary-operation": t("Operation"),
      "widget.field.formula-operand": t("Operand"),
      "widget.field.formula-binary-operation": t("Operation"),
      "widget.field.formula-compare-operation": t("Comparison"),
      "widget.field.formula-left": t("Left value"),
      "widget.field.formula-right": t("Right value"),
      "widget.field.formula-condition": t("Condition"),
      "widget.field.formula-when-true": t("When true"),
      "widget.field.formula-when-false": t("When false"),

      "widget.action.add-filter": t("Add filter"),
      "widget.action.add-transform": t("Add transform"),
      "widget.action.add-threshold": t("Add threshold"),
      "widget.action.choose-formula-node": t("Choose formula block"),
      "widget.action.remove-item": t("Remove item"),
      "widget.action.clear-color": t("Clear colour"),

      "widget.filter.grade-ratio": t("Grade value"),
      "widget.filter.coefficient": t("Coefficient"),
      "widget.filter.has-note": t("Numeric result"),
      "widget.filter.grade-name": t("Grade name"),
      "widget.filter.passed": t("Pass status"),
      "widget.transform.sort": t("Sort"),
      "widget.transform.limit": t("Limit"),
      "widget.transform.moving-average": t("Moving average"),
      "widget.transform.cumulative": t("Cumulative total"),
      "widget.threshold": t("Threshold"),
      "widget.formula.literal": t("Number"),
      "widget.formula.parameter": t("Year parameter"),
      "widget.formula.aggregate": t("Aggregate grades"),
      "widget.formula.metric": t("Built-in metric"),
      "widget.formula.unary": t("Transform one value"),
      "widget.formula.binary": t("Combine two values"),
      "widget.formula.compare": t("Compare two values"),
      "widget.formula.conditional": t("Conditional value"),
      "widget.field.formula-metric": t("Metric"),
      "widget.field.formula-metric-scope": t("Scope"),
      "widget.field.formula-metric-subjects": t("Selected subjects"),
      "widget.field.formula-metric-average": t("Custom average"),
      "widget.field.formula-metric-window": t("Window"),
      "widget.option.inherit": t("Same as the card"),

      "widget.option.general": t("Whole selection"),
      "widget.option.subjects": t("Selected subjects"),
      "widget.option.custom-average": t("Custom average"),
      "widget.option.active-period": t("Active period"),
      "widget.option.whole-year": t("Whole year"),
      "widget.option.period": t("A specific period"),
      "widget.option.rolling-days": t("Rolling days"),
      "widget.option.last-grades": t("Latest grades"),
      "widget.option.date-range": t("Custom date range"),
      "widget.option.metric": t("Built-in metric"),
      "widget.option.formula": t("Custom formula"),
      "widget.option.none": t("None"),
      "widget.option.time": t("Time"),
      "widget.option.subject": t("Subject"),
      "widget.option.day": t("Day"),
      "widget.option.week": t("Week"),
      "widget.option.month": t("Month"),
      "widget.option.bucket": t("Each interval"),
      "widget.option.running": t("Running total"),
      "widget.option.previous-window": t("Previous window"),
      "widget.option.baseline": t("Fixed baseline"),
      "widget.option.value": t("Value"),
      "widget.option.gauge": t("Gauge"),
      "widget.option.line": t("Line"),
      "widget.option.area": t("Area"),
      "widget.option.bar": t("Bars"),
      "widget.option.dot": t("Dots"),
      "widget.option.histogram": t("Histogram"),
      "widget.option.boxplot": t("Box plot"),
      "widget.option.heatmap": t("Heatmap"),
      "widget.option.table": t("Table"),
      "widget.option.list": t("List"),
      "widget.option.date": t("Date"),
      "widget.option.category": t("Category"),
      "widget.option.delta": t("Change"),
      "widget.option.count": t("Count"),
      "widget.option.linear": t("Linear"),
      "widget.option.monotone": t("Smooth"),
      "widget.option.step": t("Steps"),
      "widget.option.vertical": t("Vertical"),
      "widget.option.horizontal": t("Horizontal"),
      "widget.option.semantic": t("Semantic"),
      "widget.option.sequential": t("Sequential"),
      "widget.option.diverging": t("Diverging"),
      "widget.option.top": t("Top"),
      "widget.option.right": t("Right"),
      "widget.option.bottom": t("Bottom"),
      "widget.option.auto": t("Automatic"),
      "widget.option.ratio": t("Grade scale"),
      "widget.option.percent": t("Percentage"),
      "widget.option.days": t("Days"),
      "widget.option.number": t("Number"),
      "widget.option.gt": t("Greater than"),
      "widget.option.gte": t("At least"),
      "widget.option.lt": t("Less than"),
      "widget.option.lte": t("At most"),
      "widget.option.eq": t("Equals"),
      "widget.option.contains": t("Contains"),
      "widget.option.not-contains": t("Does not contain"),
      "widget.option.ascending": t("Ascending"),
      "widget.option.descending": t("Descending"),
      "widget.option.passingRatio": t("Passing threshold"),
      "widget.option.yearScale": t("Year scale"),
      "widget.option.sum": t("Sum"),
      "widget.option.mean": t("Mean"),
      "widget.option.median": t("Median"),
      "widget.option.min": t("Minimum"),
      "widget.option.max": t("Maximum"),
      "widget.option.standard-deviation": t("Standard deviation"),
      "widget.option.outOf": t("Maximum grade"),
      "widget.option.coefficient": t("Coefficient"),
      "widget.option.absolute": t("Absolute value"),
      "widget.option.negate": t("Negate"),
      "widget.option.round": t("Round"),
      "widget.option.floor": t("Round down"),
      "widget.option.ceil": t("Round up"),
      "widget.option.add": t("Add"),
      "widget.option.subtract": t("Subtract"),
      "widget.option.multiply": t("Multiply"),
      "widget.option.divide": t("Divide"),
      "widget.option.minimum": t("Minimum"),
      "widget.option.maximum": t("Maximum"),

      "widget.mark.value": t("Value"),
      "widget.mark.gauge": t("Gauge"),
      "widget.mark.line": t("Line"),
      "widget.mark.area": t("Area"),
      "widget.mark.bar": t("Bars"),
      "widget.mark.dot": t("Dots"),
      "widget.mark.histogram": t("Histogram"),
      "widget.mark.boxplot": t("Box plot"),
      "widget.mark.heatmap": t("Heatmap"),
      "widget.mark.table": t("Table"),
      "widget.mark.list": t("List"),
      "widget.encoding.date": t("Date"),
      "widget.encoding.category": t("Category"),
      "widget.encoding.value": t("Value"),
      "widget.encoding.delta": t("Change"),
      "widget.encoding.count": t("Count"),

      "widget.measure.average": t("Average"),
      "widget.measure.averageTrend": t("Average trend"),
      "widget.measure.projection": t("Projection"),
      "widget.measure.gradeCount": t("Grade count"),
      "widget.measure.lastGrade": t("Latest grade"),
      "widget.measure.bestGrade": t("Best grade"),
      "widget.measure.worstGrade": t("Lowest grade"),
      "widget.measure.bestSubject": t("Strongest subject"),
      "widget.measure.worstSubject": t("Weakest subject"),
      "widget.measure.subjectRanking": t("Subject ranking"),
      "widget.measure.passRate": t("Pass rate"),
      "widget.measure.median": t("Median"),
      "widget.measure.spread": t("Spread"),
      "widget.measure.consistency": t("Consistency"),
      "widget.measure.improvement": t("Improvement"),
      "widget.measure.mostImproved": t("Most improved subjects"),
      "widget.measure.steadiest": t("Steadiest subjects"),
      "widget.measure.passStreak": t("Passing streak"),
      "widget.measure.activityStreak": t("Activity streak"),
      "widget.measure.distribution": t("Grade distribution"),
      "widget.measure.goalProgress": t("Goal progress"),
      "widget.measure.formula": t("Custom formula"),

      "widget.error.required": t("This value is required."),
      "widget.error.invalid-value": t("This value is not valid."),
      "widget.error.unsupported": t("This combination is not supported."),
      "widget.error.finite-number": t("Enter a finite number."),
      "widget.error.formula-complexity": t("This formula is too complex."),
      "widget.error.formula-node": t("Choose a valid formula block."),
      "widget.error.formula-kind": t("Choose a valid formula type."),
      "widget.error.formula-metric": t("Choose a valid metric."),
      "widget.error.formula-parameter": t("Choose a valid parameter."),
      "widget.error.formula-aggregate": t("Choose a valid aggregation."),
      "widget.error.formula-field": t("Choose a valid data field."),
      "widget.error.formula-unary": t("Choose a valid unary operation."),
      "widget.error.formula-binary": t("Choose a valid binary operation."),
      "widget.error.formula-compare": t("Choose a valid comparison."),
      "widget.error.definition-object": t("The widget definition is invalid."),
      "widget.error.definition-version": t(
        "This widget version is not supported."
      ),
      "widget.error.definition-sections": t(
        "The widget definition is incomplete."
      ),
      "widget.error.filters-array": t("The filters are invalid."),
      "widget.error.filters-limit": t("There are too many filters."),
      "widget.error.filter": t("This filter is invalid."),
      "widget.error.numeric-filter": t("Enter a valid numeric filter."),
      "widget.error.boolean": t("Choose yes or no."),
      "widget.error.text-filter": t("Enter a valid text filter."),
      "widget.error.filter-kind": t("Choose a valid filter type."),
      "widget.error.transforms-array": t("The transforms are invalid."),
      "widget.error.transforms-limit": t("There are too many transforms."),
      "widget.error.transform": t("This transform is invalid."),
      "widget.error.transform-kind": t("Choose a valid transform type."),
      "widget.error.subject-required": t("Choose at least one subject."),
      "widget.error.average-required": t("Choose a custom average."),
      "widget.error.scope-kind": t("Choose a valid scope."),
      "widget.error.period-required": t("Choose a period."),
      "widget.error.date-range": t("Enter a valid date range."),
      "widget.error.window-kind": t("Choose a valid time window."),
      "widget.error.goal-required": t("Choose a goal."),
      "widget.error.measure": t("Choose a valid measure."),
      "widget.error.measure-surface": t("This measure is not available here."),
      "widget.error.measure-scope": t("This measure cannot use that scope."),
      "widget.error.grouping": t("Choose a valid grouping."),
      "widget.error.measure-grouping": t(
        "This measure cannot use that grouping."
      ),
      "widget.error.comparison": t("Choose a valid comparison."),
      "widget.error.measure-comparison": t(
        "This measure cannot use that comparison."
      ),
      "widget.error.mark-incompatible": t(
        "This chart cannot display the selected result."
      ),
      "widget.error.encoding": t("Choose a valid encoding."),
      "widget.error.encoding-channel": t(
        "This field cannot be used on that visual channel."
      ),
      "widget.error.previous-window-whole-year": t(
        "A whole-year view has no previous window to compare."
      ),
      "widget.error.color": t("Enter a valid colour."),
      "widget.error.transforms-grouping": t("Transforms require grouped data."),
      "widget.error.stacked-series": t(
        "Stacked bars require a time series split by category."
      ),
      "widget.error.legend-encoding": t(
        "Choose a colour or series encoding before showing a legend."
      ),
      "widget.error.goal-owns-window": t("This goal uses its own time period."),
      "widget.error.goal-owns-filters": t("This goal uses its own data scope."),
      "widget.error.scale-order": t(
        "The minimum must be less than or equal to the maximum."
      ),
      "widget.error.thresholds-limit": t("There are too many thresholds."),
      "widget.error.reference.subjects": t(
        "One or more subjects no longer exist."
      ),
      "widget.error.reference.custom-averages": t(
        "This custom average no longer exists."
      ),
      "widget.error.reference.goals": t("This goal no longer exists."),
      "widget.error.reference.periods": t("This period no longer exists."),
    }),
    [t]
  )

  return useCallback((key: string) => messages[key] ?? key, [messages])
}
