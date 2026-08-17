import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import {
  panDomainBy,
  pinchDomainFromGesture,
  resolveNearestProjectedSeriesPoints,
  type NumericDomain,
  type NumericScaleLike,
} from "@avermate/core/chart-interaction";
import { haptic } from "@/lib/haptics";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { radius, space, type } from "@/lib/theme";
import {
  createTrendChartSeries,
  type SerializableTimeSeriesModel,
} from "./time-series-model";
import {
  GUTTER_RIGHT,
  GUTTER_TOP,
  createXScale,
  createYScale,
  linePath,
  niceTicks,
  plotRect,
  projectSeries,
  sameDomain,
  timeTicks,
  viewportYDomain,
  type LinePathStyle,
} from "./time-series-geometry";

/**
 * The analytics chart, drawn natively.
 *
 * This used to be an Expo DOM component — a WebView running TanStack Charts.
 * That cost a native module the app does not otherwise need (and which Expo Go
 * does not carry at all), a second React tree, and a bridge hop on every
 * gesture, while buying nothing: the chart takes an immutable snapshot and
 * draws lines. `react-native-svg` was already here for the sparklines, so this
 * now renders in the same tree as everything around it.
 *
 * The semantic-domain maths stays in `@avermate/core/chart-interaction`, which
 * is renderer-independent and unit-tested; this file owns only projection,
 * painting and touch.
 */

/**
 * Beyond this many samples the dots merge into a smear and only cost frames.
 * The web multi-series chart draws its optional points up to the same count.
 */
const MAX_VISIBLE_DOTS = 160;

/** The web chart's entrance wipe: 800ms, cubic-bezier(0.25, 1, 0.4, 1). */
const ENTRANCE_DURATION_MS = 800;
const ENTRANCE_EASING = Easing.bezier(0.25, 1, 0.4, 1);

const DAY_IN_MS = 86_400_000;

/**
 * `useId` is not usable here: React 19 returns ids containing guillemets, and
 * they end up inside an SVG `url(#…)` reference.
 */
let clipCounter = 0;

interface Baseline {
  domain: NumericDomain;
  midpoint: number;
  scale: NumericScaleLike;
}

export interface ZoomPresetString {
  /** Number of days the preset shows, or null for the whole domain. */
  days: number | null;
  label: string;
}

export interface TimeSeriesChartProps {
  height: number;
  lineStyle?: LinePathStyle;
  locale: "en" | "fr";
  model: SerializableTimeSeriesModel;
  passingValue?: number;
  showPoints: boolean;
  /** Draw the dashed piecewise trend the web charts derive from the data. */
  showTrend?: boolean;
  trendSubdivisions?: number;
  strings: {
    hideSeries: string;
    reset: string;
    showSeries: string;
    values: string;
    visibleRange: string;
  };
  theme: {
    background: string;
    border: string;
    grid: string;
    muted: string;
    text: string;
    tooltip: string;
  };
  zoomPresets?: readonly ZoomPresetString[];
}

function templateName(template: string, name: string): string {
  return template.replace("{name}", name);
}

export function TimeSeriesChart({
  height,
  lineStyle = "smooth",
  locale,
  model,
  passingValue,
  showPoints,
  showTrend = false,
  trendSubdivisions = 1,
  strings,
  theme,
  zoomPresets,
}: TimeSeriesChartProps) {
  // Lazy, so the counter advances once per chart rather than once per render.
  const [clipId] = useState(() => `chart-plot-${(clipCounter += 1)}`);
  const domain = model.domain;
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState<NumericDomain>(domain);
  const [hiddenIds, setHiddenIds] = useState<readonly string[]>(() =>
    model.series.filter((series) => series.hidden).map((series) => series.id),
  );
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  // Every gesture resolves against the viewport it started from, so a
  // two-finger drag cannot accumulate zoom frame after frame.
  const baselineRef = useRef<Baseline | null>(null);

  useEffect(() => {
    setViewport(domain);
    setPointer(null);
  }, [domain]);

  // The web chart wipes in left to right on mount (clip-path, 800ms); here a
  // surface-coloured curtain slides off the plot once the width is known.
  // Reduced motion skips straight to the settled chart.
  const { reduceMotion } = useInteractionPreferences();
  const [entered, setEntered] = useState(false);
  const entranceProgress = useRef(new Animated.Value(0)).current;
  const entranceStartedRef = useRef(false);
  useEffect(() => {
    if (entranceStartedRef.current || width === 0) return;
    entranceStartedRef.current = true;
    if (reduceMotion) {
      setEntered(true);
      return;
    }
    Animated.timing(entranceProgress, {
      duration: ENTRANCE_DURATION_MS,
      easing: ENTRANCE_EASING,
      toValue: 1,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setEntered(true);
    });
  }, [entranceProgress, reduceMotion, width]);

  // Built once per locale rather than per render: constructing an Intl
  // formatter is expensive, and a scrub re-renders this component on every
  // finger movement.
  const { number, axisNumber, shortDate, longDate } = useMemo(() => {
    const tag = locale === "fr" ? "fr-FR" : "en-GB";
    return {
      number: new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }),
      // The web y-axis rounds harder than the tooltip: one fraction digit.
      axisNumber: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }),
      shortDate: new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "short",
      }),
      longDate: new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "long",
      }),
    };
  }, [locale]);

  const plot = useMemo(() => plotRect(width, height), [width, height]);
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const visibleSeries = useMemo(
    () => model.series.filter((series) => !hidden.has(series.id)),
    [hidden, model.series],
  );

  // The same core segments the web draws, following the primary series (or
  // the pooled grade cloud), recomputed when a legend toggle changes the mix.
  const trendSeries = useMemo(
    () =>
      showTrend
        ? createTrendChartSeries({
            maximumScale: model.maximumScale,
            series: model.series.filter(
              (series) => !hiddenIds.includes(series.id),
            ),
            subdivisions: trendSubdivisions,
          })
        : null,
    [hiddenIds, model, showTrend, trendSubdivisions],
  );

  const zoomed = !sameDomain(viewport, domain);
  // While zoomed, the y-window follows what is visible so a run can leave
  // the frame through the sides but never through the top or bottom. The
  // trend counts too: the web frames its trend rows alongside the data.
  const yDomain = useMemo(() => {
    const framingSeries = trendSeries
      ? [...visibleSeries, trendSeries]
      : visibleSeries;
    return model.autoZoom && (zoomed || trendSeries)
      ? viewportYDomain(
          framingSeries,
          viewport,
          model.maximumScale,
          model.yDomain,
        )
      : model.yDomain;
  }, [
    model.autoZoom,
    model.maximumScale,
    model.yDomain,
    trendSeries,
    viewport,
    visibleSeries,
    zoomed,
  ]);

  /**
   * Scales and path geometry — every input except the pointer.
   *
   * Scrubbing calls `setPointer` on each finger movement, so anything left
   * loose in the render body is recomputed at gesture frequency. Projecting
   * every sample and re-serialising the path strings for a reading that only
   * moves one dot is what makes the dot trail the finger, and it all runs on
   * the JS thread the gesture is already using. Held here, a scrub re-runs
   * only the nearest-point lookup below.
   */
  const geometry = useMemo(() => {
    const scaleX: NumericScaleLike = createXScale(viewport, plot);
    const scaleY = createYScale(yDomain, plot);
    const { paths, points } = projectSeries(
      visibleSeries,
      scaleX,
      scaleY,
      lineStyle,
    );
    // Piecewise-linear like the web's, whatever the line-style preference
    // says, and never part of inspection or dots: it is a reading, not a
    // sample.
    const trendPath = trendSeries
      ? linePath(
          trendSeries.points.map(
            (point) =>
              [scaleX.map(point.timestamp), scaleY(point.value)] as const,
          ),
          "straight",
        )
      : "";
    return { paths, points, scaleX, scaleY, trendPath };
  }, [lineStyle, plot, trendSeries, viewport, visibleSeries, yDomain]);
  const { paths, points: projected, scaleX, scaleY, trendPath } = geometry;

  const inspected =
    pointer && projected.length > 0
      ? resolveNearestProjectedSeriesPoints(projected, pointer, {
          getSeriesId: (point) => point.datum.seriesId,
          getTimestamp: (point) => point.datum.timestamp,
        })
      : [];

  function changeViewport(next: NumericDomain) {
    setViewport(next);
    setPointer(null);
  }

  function captureBaseline(midpoint: number) {
    baselineRef.current = { domain: viewport, midpoint, scale: scaleX };
  }

  function releaseBaseline() {
    baselineRef.current = null;
  }

  // Two fingers resolve zoom and translation together: a pure drag keeps its
  // span, and a pinch keeps whatever sits under the fingers under the fingers.
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart((event) => captureBaseline(event.focalX))
    .onUpdate((event) => {
      const baseline = baselineRef.current;
      if (!baseline) return;
      try {
        changeViewport(
          pinchDomainFromGesture(
            baseline.scale,
            baseline.domain,
            domain,
            baseline.midpoint,
            event.focalX,
            Math.max(0.05, event.scale),
            model.maximumZoom,
          ),
        );
      } catch {
        // A degenerate domain — one sample, or a year with no width — is not
        // zoomable. Dropping the frame beats tearing down the screen.
      }
    })
    .onFinalize(releaseBaseline);

  // Offered only once zoomed in, and only sideways, so the surrounding
  // vertical scroll keeps behaving exactly as it did.
  const drag = Gesture.Pan()
    .runOnJS(true)
    .enabled(zoomed)
    .minPointers(1)
    .maxPointers(1)
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onStart(() => captureBaseline(0))
    .onUpdate((event) => {
      const baseline = baselineRef.current;
      if (!baseline) return;
      try {
        changeViewport(
          panDomainBy(
            baseline.scale,
            baseline.domain,
            domain,
            event.translationX,
            model.maximumZoom,
          ),
        );
      } catch {
        // Same reasoning as the pinch.
      }
    })
    .onFinalize(releaseBaseline);

  // Hold, then slide: the reading gesture cannot start by accident while the
  // page is being scrolled past.
  const scrub = Gesture.Pan()
    .runOnJS(true)
    .minPointers(1)
    .maxPointers(1)
    .activateAfterLongPress(140)
    .onStart((event) => setPointer({ x: event.x, y: event.y }))
    .onUpdate((event) => setPointer({ x: event.x, y: event.y }));

  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(300)
    .onEnd((event, success) => {
      if (success) setPointer({ x: event.x, y: event.y });
    });

  const gesture = Gesture.Simultaneous(pinch, Gesture.Race(drag, scrub, tap));

  // Presets whose span would show the whole domain anyway add nothing.
  const domainSpan = domain[1] - domain[0];
  const presets = (zoomPresets ?? []).filter(
    (preset) => preset.days === null || preset.days * DAY_IN_MS < domainSpan,
  );
  const presetActive = (preset: ZoomPresetString): boolean => {
    if (preset.days === null) return !zoomed;
    const span = preset.days * DAY_IN_MS;
    const start = Math.max(domain[0], domain[1] - span);
    const tolerance = Math.max(domainSpan, 1) * 1e-3;
    return (
      Math.abs(viewport[1] - domain[1]) <= tolerance &&
      Math.abs(viewport[0] - start) <= tolerance
    );
  };
  const applyPreset = (preset: ZoomPresetString) => {
    haptic("selection");
    if (preset.days === null) {
      changeViewport(domain);
      return;
    }
    const span = preset.days * DAY_IN_MS;
    changeViewport([Math.max(domain[0], domain[1] - span), domain[1]]);
  };

  const yTicks = niceTicks(yDomain[0], yDomain[1], 5);
  // The web thins its date labels to a 40px minimum gap, keeping the ends;
  // a width-aware count approximates that on whatever screen this is.
  const xTickCount = Math.max(2, Math.min(7, Math.round(plot.width / 90)));
  const xTicks = width > 0 ? timeTicks(viewport, xTickCount) : [];

  // Grade series keep their dots no matter what: the dots ARE the mark there
  // (the faint connector is a reading aid), not an ornament over a line.
  const gradeStyleSeries = new Set(
    visibleSeries
      .filter((series) => {
        const line = series.line ?? "full";
        return line === "none" || line === "faint";
      })
      .map((series) => series.id),
  );
  const dots = projected.filter(
    (point) =>
      gradeStyleSeries.has(point.datum.seriesId) ||
      (showPoints && projected.length <= MAX_VISIBLE_DOTS),
  );
  const primary = inspected[0];
  const tooltipRight = primary ? primary.x > plot.x + plot.width / 2 : false;

  // One shared day reads once above the rows; mixed days label every row so
  // no value is ever shown against a date that is not its own.
  const sharedDay =
    inspected.length > 0 &&
    inspected.every(
      (point) =>
        new Date(point.datum.timestamp).toDateString() ===
        new Date(inspected[0]!.datum.timestamp).toDateString(),
    );

  return (
    <View>
      {/*
       * Reads like the web legend at rest — a small colour dot beside a
       * muted 12px label — but stays tappable: hiding a series is a mobile
       * extra the web keeps in its header controls. Hidden series dim and
       * strike through instead of losing their place in the list.
       */}
      <View
        style={{
          columnGap: space.md,
          flexDirection: "row",
          flexWrap: "wrap",
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          rowGap: space.xs,
        }}
      >
        {model.series.map((series) => {
          const isHidden = hidden.has(series.id);
          // The last visible series cannot be hidden: an empty plot reads as a
          // bug rather than as a choice.
          const last = !isHidden && visibleSeries.length === 1;
          return (
            <Pressable
              accessibilityLabel={templateName(
                isHidden ? strings.showSeries : strings.hideSeries,
                series.label,
              )}
              accessibilityRole="button"
              accessibilityState={{ disabled: last, selected: !isHidden }}
              disabled={last}
              hitSlop={6}
              key={series.id}
              onPress={() => {
                haptic("selection");
                setPointer(null);
                setHiddenIds((current) =>
                  current.includes(series.id)
                    ? current.filter((id) => id !== series.id)
                    : [...current, series.id],
                );
              }}
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 6,
                maxWidth: "100%",
                minHeight: 28,
                opacity: isHidden ? 0.45 : 1,
              }}
            >
              <View
                style={{
                  backgroundColor: series.color,
                  borderRadius: radius.pill,
                  height: 8,
                  width: 8,
                }}
              />
              <Text
                numberOfLines={1}
                style={[
                  type.caption,
                  {
                    color: theme.muted,
                    flexShrink: 1,
                    textDecorationLine: isHidden ? "line-through" : "none",
                  },
                ]}
              >
                {series.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {presets.length > 1 ? (
        <View
          style={{
            flexDirection: "row",
            gap: space.xs,
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
          }}
        >
          {presets.map((preset) => {
            const active = presetActive(preset);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={preset.label}
                onPress={() => applyPreset(preset)}
                style={{
                  backgroundColor: active ? `${theme.text}14` : "transparent",
                  borderColor: active ? theme.text : theme.border,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  minHeight: 28,
                  justifyContent: "center",
                  paddingHorizontal: 10,
                }}
              >
                <Text
                  style={[
                    type.footnote,
                    { color: active ? theme.text : theme.muted },
                  ]}
                >
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View
          accessibilityLabel={`${strings.values} — ${
            strings.visibleRange
          }: ${shortDate.format(new Date(viewport[0]))} – ${shortDate.format(
            new Date(viewport[1]),
          )}`}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{ height, overflow: "hidden" }}
        >
          {width > 0 ? (
            <Svg height={height} width={width}>
              <Defs>
                <ClipPath id={clipId}>
                  <Rect
                    height={plot.height}
                    width={plot.width}
                    x={plot.x}
                    y={plot.y}
                  />
                </ClipPath>
              </Defs>

              {yTicks.map((tick) => (
                <G key={`y-${tick}`}>
                  <Line
                    stroke={theme.grid}
                    strokeWidth={1}
                    x1={plot.x}
                    x2={plot.x + plot.width}
                    y1={scaleY(tick)}
                    y2={scaleY(tick)}
                  />
                  <SvgText
                    fill={theme.muted}
                    fontSize={11}
                    textAnchor="end"
                    x={plot.x - 8}
                    y={scaleY(tick) + 4}
                  >
                    {axisNumber.format(tick)}
                  </SvgText>
                </G>
              ))}

              {xTicks.map((tick, index) => (
                <SvgText
                  fill={theme.muted}
                  fontSize={11}
                  key={`x-${index}`}
                  textAnchor={
                    index === 0
                      ? "start"
                      : index === xTicks.length - 1
                        ? "end"
                        : "middle"
                  }
                  x={scaleX.map(tick)}
                  y={plot.y + plot.height + 16}
                >
                  {shortDate.format(new Date(tick))}
                </SvgText>
              ))}

              {typeof passingValue === "number" &&
              Number.isFinite(passingValue) ? (
                <Line
                  stroke={theme.muted}
                  strokeDasharray="4 4"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                  x1={plot.x}
                  x2={plot.x + plot.width}
                  y1={scaleY(passingValue)}
                  y2={scaleY(passingValue)}
                />
              ) : null}

              <G clipPath={`url(#${clipId})`}>
                {primary ? (
                  <Line
                    stroke={theme.muted}
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    x1={primary.x}
                    x2={primary.x}
                    y1={plot.y}
                    y2={plot.y + plot.height}
                  />
                ) : null}

                {paths
                  .filter((series) => series.line !== "none")
                  .map((series) => (
                    <Path
                      d={series.path}
                      fill="none"
                      key={series.id}
                      stroke={series.color}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeOpacity={series.line === "faint" ? 0.45 : 1}
                      strokeWidth={series.line === "faint" ? 1.5 : 2.25}
                    />
                  ))}

                {trendPath ? (
                  <Path
                    d={trendPath}
                    fill="none"
                    stroke={theme.muted}
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                  />
                ) : null}

                {dots.map((point) => {
                  const grade = gradeStyleSeries.has(point.datum.seriesId);
                  return (
                    <Circle
                      cx={point.x}
                      cy={point.y}
                      fill={point.datum.color}
                      key={point.datum.id}
                      r={grade ? 4 : 2.5}
                      stroke={theme.background}
                      strokeWidth={grade ? 1.5 : 1}
                    />
                  );
                })}

                {inspected.map((point) => (
                  <Circle
                    cx={point.x}
                    cy={point.y}
                    fill={point.datum.color}
                    key={`active-${point.datum.id}`}
                    r={gradeStyleSeries.has(point.datum.seriesId) ? 6 : 5}
                    stroke={theme.background}
                    strokeWidth={2}
                  />
                ))}
              </G>
            </Svg>
          ) : null}

          {!entered && width > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={{
                backgroundColor: theme.background,
                bottom: 0,
                left: 0,
                position: "absolute",
                top: 0,
                transform: [
                  {
                    translateX: entranceProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, width],
                    }),
                  },
                ],
                width,
              }}
            />
          ) : null}

          {primary ? (
            /*
             * The web tooltip's shape: one quiet date line on top when every
             * row shares the day (long month), otherwise a short date under
             * each row so no value is ever labeled with a wrong date. Rows
             * read muted-label-then-bold-value, dots are the web's little
             * rounded squares.
             */
            <View
              pointerEvents="none"
              style={{
                backgroundColor: theme.tooltip,
                borderColor: theme.border,
                borderRadius: radius.md,
                borderWidth: 1,
                gap: 6,
                left: tooltipRight ? undefined : primary.x + 12,
                maxWidth: Math.max(120, plot.width - 24),
                padding: space.sm,
                position: "absolute",
                right: tooltipRight ? width - primary.x + 12 : undefined,
                top: Math.max(
                  plot.y,
                  Math.min(primary.y - 18, plot.y + plot.height - 72),
                ),
              }}
            >
              {sharedDay ? (
                <Text style={[type.caption, { color: theme.muted }]}>
                  {longDate.format(new Date(primary.datum.timestamp))}
                </Text>
              ) : null}
              {inspected.map((point) => (
                <View key={`tip-${point.datum.id}`} style={{ gap: 2 }}>
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      gap: 6,
                    }}
                  >
                    <View
                      style={{
                        backgroundColor: point.datum.color,
                        borderRadius: 2,
                        height: 8,
                        width: 8,
                      }}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        type.footnote,
                        { color: theme.muted, flexGrow: 1, flexShrink: 1 },
                      ]}
                    >
                      {point.datum.detail ?? point.datum.label}
                    </Text>
                    <Text
                      style={[
                        type.footnote,
                        {
                          color: theme.text,
                          fontVariant: ["tabular-nums"],
                          fontWeight: "700",
                        },
                      ]}
                    >
                      {number.format(point.datum.value)}
                    </Text>
                  </View>
                  {sharedDay ? null : (
                    <Text
                      style={[
                        type.caption,
                        { color: theme.muted, paddingLeft: 14 },
                      ]}
                    >
                      {shortDate.format(new Date(point.datum.timestamp))}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {zoomed ? (
            <Pressable
              accessibilityLabel={strings.reset}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setViewport(domain);
                setPointer(null);
              }}
              style={{
                backgroundColor: theme.tooltip,
                borderColor: theme.border,
                borderRadius: radius.sm,
                borderWidth: 1,
                paddingHorizontal: 9,
                paddingVertical: 4,
                position: "absolute",
                right: GUTTER_RIGHT,
                top: GUTTER_TOP,
              }}
            >
              <Text style={[type.footnote, { color: theme.text }]}>
                {`↺ ${strings.reset}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

export default TimeSeriesChart;
