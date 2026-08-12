import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
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
import { radius, space, type } from "@/lib/theme";
import type { SerializableTimeSeriesModel } from "./time-series-model";
import {
  GUTTER_RIGHT,
  GUTTER_TOP,
  createXScale,
  createYScale,
  niceTicks,
  plotRect,
  projectSeries,
  sameDomain,
  timeTicks,
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

/** Beyond this many samples the dots merge into a smear and only cost frames. */
const MAX_VISIBLE_DOTS = 140;

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

export interface TimeSeriesChartProps {
  height: number;
  locale: "en" | "fr";
  model: SerializableTimeSeriesModel;
  passingValue?: number;
  showPoints: boolean;
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
}

function templateName(template: string, name: string): string {
  return template.replace("{name}", name);
}

export function TimeSeriesChart({
  height,
  locale,
  model,
  passingValue,
  showPoints,
  strings,
  theme,
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

  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    maximumFractionDigits: 2,
  });
  const shortDate = new Intl.DateTimeFormat(
    locale === "fr" ? "fr-FR" : "en-GB",
    { day: "numeric", month: "short" },
  );

  const plot = plotRect(width, height);
  const hidden = new Set(hiddenIds);
  const visibleSeries = model.series.filter((series) => !hidden.has(series.id));

  const scaleX: NumericScaleLike = createXScale(viewport, plot);
  const scaleY = createYScale(model.yDomain, plot);
  const { paths, points: projected } = projectSeries(
    visibleSeries,
    scaleX,
    scaleY,
  );

  const inspected =
    pointer && projected.length > 0
      ? resolveNearestProjectedSeriesPoints(projected, pointer, {
          getSeriesId: (point) => point.datum.seriesId,
          getTimestamp: (point) => point.datum.timestamp,
        })
      : [];

  const zoomed = !sameDomain(viewport, domain);

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

  const yTicks = niceTicks(model.yDomain[0], model.yDomain[1], 5);
  const xTicks = width > 0 ? timeTicks(viewport, 4) : [];

  const dots =
    showPoints && projected.length <= MAX_VISIBLE_DOTS ? projected : [];
  const primary = inspected[0];
  const tooltipRight = primary ? primary.x > plot.x + plot.width / 2 : false;

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: space.xs,
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
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
              key={series.id}
              onPress={() => {
                setPointer(null);
                setHiddenIds((current) =>
                  current.includes(series.id)
                    ? current.filter((id) => id !== series.id)
                    : [...current, series.id],
                );
              }}
              style={{
                alignItems: "center",
                backgroundColor: isHidden ? "transparent" : `${series.color}1F`,
                borderColor: isHidden ? theme.border : series.color,
                borderRadius: radius.pill,
                borderWidth: 1,
                flexDirection: "row",
                gap: 5,
                maxWidth: "100%",
                minHeight: 28,
                opacity: isHidden ? 0.6 : 1,
                paddingHorizontal: 9,
                paddingVertical: 3,
              }}
            >
              <View
                style={{
                  backgroundColor: series.color,
                  borderRadius: radius.pill,
                  height: 7,
                  width: 7,
                }}
              />
              <Text
                numberOfLines={1}
                style={[
                  type.footnote,
                  { color: isHidden ? theme.muted : theme.text, flexShrink: 1 },
                ]}
              >
                {series.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <GestureDetector gesture={gesture}>
        <View
          accessibilityLabel={`${strings.values} — ${
            strings.visibleRange
          }: ${shortDate.format(new Date(viewport[0]))} – ${shortDate.format(
            new Date(viewport[1]),
          )}`}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{ height }}
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
                    x={plot.x - 7}
                    y={scaleY(tick) + 4}
                  >
                    {number.format(tick)}
                  </SvgText>
                </G>
              ))}

              {xTicks.map((tick, index) => (
                <SvgText
                  fill={theme.muted}
                  fontSize={11}
                  key={`x-${index}`}
                  textAnchor={
                    index === 0 ? "start" : index === 3 ? "end" : "middle"
                  }
                  x={scaleX.map(tick)}
                  y={plot.y + plot.height + 15}
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

                {paths.map((series) => (
                  <Path
                    d={series.path}
                    fill="none"
                    key={series.id}
                    stroke={series.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.25}
                  />
                ))}

                {dots.map((point) => (
                  <Circle
                    cx={point.x}
                    cy={point.y}
                    fill={point.datum.color}
                    key={point.datum.id}
                    r={2.5}
                    stroke={theme.background}
                    strokeWidth={1}
                  />
                ))}

                {inspected.map((point) => (
                  <Circle
                    cx={point.x}
                    cy={point.y}
                    fill={point.datum.color}
                    key={`active-${point.datum.id}`}
                    r={5}
                    stroke={theme.background}
                    strokeWidth={2}
                  />
                ))}
              </G>
            </Svg>
          ) : null}

          {primary ? (
            <View
              pointerEvents="none"
              style={{
                backgroundColor: theme.tooltip,
                borderColor: theme.border,
                borderRadius: radius.md,
                borderWidth: 1,
                gap: 3,
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
              {inspected.map((point) => (
                <View
                  key={`tip-${point.datum.id}`}
                  style={{ alignItems: "center", flexDirection: "row", gap: 6 }}
                >
                  <View
                    style={{
                      backgroundColor: point.datum.color,
                      borderRadius: radius.pill,
                      height: 7,
                      width: 7,
                    }}
                  />
                  <Text
                    numberOfLines={1}
                    style={[type.footnote, { color: theme.text, flexShrink: 1 }]}
                  >
                    {point.datum.detail
                      ? `${number.format(point.datum.value)} · ${point.datum.detail}`
                      : `${point.datum.label} · ${number.format(point.datum.value)}`}
                  </Text>
                </View>
              ))}
              <Text style={[type.footnote, { color: theme.muted }]}>
                {shortDate.format(new Date(primary.datum.timestamp))}
              </Text>
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
