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
      // Which comparison a cohort reading is measured against, and whose average it is.
      "widget.field.cohort-group": t("Compare with"),
      "widget.field.cohort-member": t("Whose average"),
      // The same question of the definition asked of a friendship rather than a group.
      "widget.field.friend": t("Which friend"),
      // A pair of readings needs both named, or the legend says "average" twice.
      "widget.field.measure-label": t("Name for the first reading"),
      "widget.field.second-measure-kind": t("Second reading"),
      "widget.field.second-metric": t("Second measure"),
      "widget.field.second-measure-label": t("Name for the second reading"),
      "widget.field.dispersion": t("Measured as"),
      "widget.field.time-fill": t("Buckets"),
      "widget.field.formula-output": t("Formula result"),
      "widget.field.formula": t("Formula"),
      "widget.field.second-formula-output": t("Second formula result"),
      "widget.field.second-formula": t("Second formula"),
      /**
       * The groupings, as a list.
       *
       * `group-by` was one choice over one path and is gone with it: the model carries a
       * list, and the control is now the same collection editor the filters and transforms
       * use. Its variants are named after the *question* — "over time", "by subject" —
       * rather than after the dimension kind, because that is what a reader is choosing.
       */
      /**
       * The two windows of a pair, named for what they *do*: the right-hand side is the
       * reading and the left is what it is held against. "First" and "second" would leave
       * a reader to guess which one the card shows.
       */
      "widget.field.pair-left-window": t("Compare against"),
      "widget.field.pair-left-period": t("Period compared against"),
      "widget.field.pair-left-rolling-days": t("Days compared against"),
      "widget.field.pair-left-last-grades": t("Grades compared against"),
      "widget.field.pair-left-from": t("Compared from"),
      "widget.field.pair-left-to": t("Compared to"),
      "widget.field.pair-right-window": t("Window shown"),
      "widget.field.pair-right-period": t("Period shown"),
      "widget.field.pair-right-rolling-days": t("Days shown"),
      "widget.field.pair-right-last-grades": t("Grades shown"),
      "widget.field.pair-right-from": t("Shown from"),
      "widget.field.pair-right-to": t("Shown to"),
      "widget.field.pair-alignment": t("How the two line up"),
      "widget.option.window-pair": t("Two windows"),
      // Their own keys, because `calendar` and `period` already name a window's fill and a
      // window's kind — see `namedOptions`.
      "widget.alignment.relative": t("By position"),
      "widget.alignment.calendar": t("By the calendar"),
      "widget.alignment.period": t("By period"),
      "widget.option.event": t("Each result"),
      "widget.option.leaf": t("Subjects only"),
      "widget.option.root": t("Top-level subjects"),
      "widget.option.all": t("Every subject"),
      "widget.option.passed": t("Passed"),
      "widget.option.failed": t("Failed"),
      "widget.option.missing": t("Not assessed"),
      "widget.field.dimensions": t("Grouping"),
      "widget.field.dimensions.description": t(
        "Split the result over time, by subject, or by both."
      ),
      "widget.action.add-dimension": t("Add grouping"),
      "widget.dimension.time": t("Over time"),
      "widget.dimension.subject": t("By subject"),
      "widget.dimension.period": t("By period"),
      "widget.dimension.assessment-type": t("By kind of assessment"),
      "widget.field.include-untyped": t("Include results with no type"),
      "widget.dimension.grade-band": t("By grade band"),
      "widget.dimension.status": t("By result"),
      "widget.field.subject-level": t("Which subjects"),
      "widget.field.status-values": t("Results shown"),
      // The appearance controls of the recipes added since: each of these has a control in
      // the editor and had no name, so the field rendered its own key.
      "widget.field.waffle-cells": t("Number of cells"),
      "widget.field.strip-tick": t("Tick height"),
      "widget.field.strip-median": t("Show the median"),
      "widget.field.lollipop-size": t("Point size"),
      "widget.field.dumbbell-size": t("Point size"),
      "widget.field.dumbbell-labels": t("Label both ends"),
      "widget.field.slope-labels": t("Label the values"),
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
      // Three of the four dispersion estimators, named as what they measure rather
      // than by their statistics — a card that offers "MAD" has offered nothing.
      // The fourth, the standard deviation, is already named below as a formula
      // aggregate and is the same words for the same thing.
      "widget.option.range": t("Full range"),
      "widget.option.interquartile-range": t("Middle half"),
      "widget.option.median-absolute-deviation": t(
        "Typical distance from the middle"
      ),
      // Whether a time grouping reports the buckets that happened or every one in
      // the window — a gap on a line, a square on a calendar.
      "widget.option.observed": t("Only when something happened"),
      "widget.option.calendar": t("Every day in the window"),
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

      /**
       * The chart picker, named by *recipe*.
       *
       * These were `widget.mark.*` and the flow now offers recipes — so every entry in the
       * editor's chart list was rendering its own key, `widget.recipe.sparkline` and the
       * rest, because an unknown key passes through unchanged. Fourteen marks became thirty
       * recipes, and the names distinguish the ones that share a mark: a sparkline and a
       * line chart are both lines, and the difference is exactly what the reader is
       * choosing between here.
       */
      "widget.recipe.value": t("Value"),
      "widget.recipe.gauge": t("Gauge"),
      "widget.recipe.bullet": t("Gauge with targets"),
      "widget.recipe.sparkline": t("Value with a trend line"),
      "widget.recipe.line": t("Line chart"),
      "widget.recipe.area": t("Area chart"),
      "widget.recipe.bar": t("Bars"),
      "widget.recipe.dot": t("Dots"),
      "widget.recipe.regression": t("Trend line"),
      "widget.recipe.difference-area": t("Gap between two measures"),
      "widget.recipe.scatter": t("One measure against another"),
      "widget.recipe.projection-band": t("Projection range"),
      "widget.recipe.control-chart": t("Usual range of your marks"),
      "widget.recipe.ranking": t("Ranking"),
      "widget.recipe.lollipop": t("Lollipops"),
      "widget.recipe.slope-arrow": t("Arrows"),
      "widget.recipe.dumbbell": t("Before and after"),
      "widget.recipe.waterfall": t("Contributions"),
      "widget.recipe.histogram": t("Histogram"),
      "widget.recipe.strip": t("Every mark as a tick"),
      "widget.recipe.boxplot": t("Box plot"),
      "widget.recipe.violin": t("Distribution shape"),
      "widget.recipe.ridgeline": t("Stacked distribution shapes"),
      "widget.recipe.waffle": t("Waffle"),
      "widget.recipe.heatmap": t("Heatmap"),
      "widget.recipe.calendar": t("Calendar"),
      "widget.recipe.treemap": t("Nested areas"),
      "widget.recipe.sunburst": t("Nested rings"),
      "widget.recipe.radar": t("Radar"),
      "widget.recipe.table": t("Table"),
      "widget.recipe.list": t("List"),
      "widget.recipe.facets": t("One chart per group"),
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
      // A share of the average, which is what the number is: "Mathematics
      // carries 18% of your average".
      // The run of marks against its own spread — descriptive, and it says so.
      "widget.measure.controlBand": t("Your usual range of marks"),
      // Arithmetic, not prediction: the average with one mark removed.
      "widget.measure.markImpact": t("What one mark is worth"),
      // Where effort pays, without a goal — the question `requiredResult` cannot answer.
      "widget.measure.nextBestAction": t("Where to work next"),
      // Descriptive, and named as such: it reports a distance, not a diagnosis.
      "widget.measure.anomaly": t("A result that stands out"),
      // The risk reading of the same weights: how few subjects carry the average.
      "widget.measure.concentration": t("How concentrated your average is"),
      "widget.measure.leverage": t("Weight in your average"),
      // The other leverage: what one further mark can move, rather than what the
      // subject as a whole carries. Named for the decision it informs.
      "widget.measure.nextLeverage": t("Where the next mark counts most"),
      "widget.measure.requiredResult": t("What you need next"),
      // Which subjects have been assessed and which have not — the one reading
      // that lists what is *missing*.
      "widget.measure.coverage": t("Assessment coverage"),
      // The mirror of "what you need next", and the more useful one once a goal
      // is being met: what would lose it.
      "widget.measure.safetyMargin": t("Room left on a goal"),
      // The same weights as "Weight in your average", as the tree they live in:
      // this one answers which *branch* carries the average.
      "widget.measure.weightBreakdown": t("Where your average comes from"),
      // The change decomposed into the subjects that caused it.
      "widget.measure.contributions": t("Why your average moved"),
      // Scenarios, not a forecast — the card's own caption says which scenarios.
      "widget.measure.projectionBand": t("Where your average could end up"),
      /**
       * The readings about other people.
       *
       * Named for what they answer rather than for the table they come from: a reader
       * picking a card wants "Your place in the class", not "cohortRank". Every one of
       * these is empty until somebody opened something, and the card says so itself.
       */
      "widget.measure.cohortRank": t("Your place in the class"),
      "widget.measure.cohortAverage": t("The class average"),
      "widget.measure.cohortGap": t("Your gap to the class"),
      "widget.measure.memberAverage": t("A classmate's average"),
      "widget.measure.friendAverage": t("A friend's average"),
      "widget.measure.friendCurves": t("Your average against a friend's"),
      "widget.measure.friendSubjects": t("Subject by subject with a friend"),
      "widget.measure.formula": t("Custom formula"),

      "widget.error.required": t("This value is required."),
      "widget.error.invalid-value": t("This value is not valid."),
      "widget.error.unsupported": t("This combination is not supported."),
      "widget.error.split-unsupported": t(
        "This axis cannot be split by subject. Group by time instead, or split by something the marks carry."
      ),
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
      "widget.error.source-kind": t("Choose a valid data source."),
      "widget.error.source-unavailable": t(
        "This data source is not available yet."
      ),
      "widget.error.period-required": t("Choose a period."),
      "widget.error.date-range": t("Enter a valid date range."),
      "widget.error.window-kind": t("Choose a valid time window."),
      "widget.error.goal-required": t("Choose a goal."),
      // A comparison a card is read against, and the member it is about.
      "widget.error.group-required": t("Choose a class to compare with."),
      "widget.error.member-required": t("Choose whose average to show."),
      "widget.error.measure": t("Choose a valid measure."),
      "widget.error.measure-surface": t("This measure is not available here."),
      "widget.error.measure-scope": t("This measure cannot use that scope."),
      "widget.error.measure-shape": t(
        "The two readings must produce compatible shapes."
      ),
      "widget.error.missing-status-measure": t(
        "Missing results can only be shown by subject with the coverage measure."
      ),
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
      // A slope arrow and a dumbbell draw two ends, and the second one is the
      // previous value: without a comparison there is nothing to draw against.
      "widget.error.mark-needs-comparison": t(
        "This chart compares two values, so it needs a comparison."
      ),
      // The refusals that come with the charts that need more than one column or
      // more than one row. Each says what to add, not that something is wrong:
      // the reader is mid-way through building a card, and "not supported" sends
      // them back to the chart list when the chart was the right choice.
      "widget.error.difference-needs-one-unit": t(
        "Both measures must be in the same units to draw the gap between them."
      ),
      "widget.error.scatter-needs-two": t(
        "Both axes of this chart are measures, so it needs a second one."
      ),
      "widget.error.difference-needs-two": t(
        "This chart draws the gap between two measures, so it needs a second one."
      ),
      "widget.error.facets-need-a-split": t(
        "This chart draws one panel per group, so it needs a second grouping."
      ),
      "widget.error.ridgeline-needs-groups": t(
        "This chart stacks one shape per group, so it needs a grouping."
      ),
      "widget.error.recipe-result-shape": t(
        "This visualisation cannot display the result produced by these choices."
      ),
      "widget.error.multiple-measures-need-dimension": t(
        "Several measures need a grouping that can keep their readings separate."
      ),
      "widget.error.recipe-single-measure": t(
        "This visualisation can display only one measure at a time."
      ),
      "widget.error.radar-cardinality": t(
        "A radar needs between three and eight axes."
      ),
      "widget.error.dimension-unavailable": t(
        "This grouping is not available yet."
      ),
      // The model's own bounds, in words. Four measures and two groupings are the
      // ceilings — a third grouping is a cube, and a cube has no honest flat drawing —
      // and a reader who hits one needs to know it is a limit rather than a failure.
      "widget.error.measure-required": t("Choose at least one measure."),
      "widget.error.too-many-measures": t(
        "A card can hold up to four measures."
      ),
      "widget.error.too-many-dimensions": t(
        "A card can be grouped in two ways at most."
      ),
      "widget.error.grouping-required": t("This measure has to be grouped."),
      "widget.error.measure-label": t(
        "Name this measure, so the chart can tell the two apart."
      ),
      "widget.error.duplicate-id": t("Two groupings cannot share a name."),
      // A bullet is a gauge *against* something: with no threshold it is a gauge.
      "widget.error.bands-required": t("Add at least one threshold."),
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
