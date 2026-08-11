"use dom";

import {
  createPointerInspectionController,
  normalizeWheelDelta,
  panDomainBy,
  pinchDomainFromGesture,
  resolveChartKeyboardCommand,
  resolveNearestProjectedSeriesPoints,
  shouldHandleChartWheel,
  zoomDomainAt,
  type NumericDomain,
  type NumericScaleLike,
} from "@avermate/core/chart-interaction";
import {
  defineChart,
  dot,
  lineY,
  ruleY,
  type ChartFocusStrategy,
  type ChartPoint,
  type ChartRenderContext,
  type ResolvedScale,
} from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react/tooltip";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SerializableTimeSeriesModel } from "./time-series-model";

const SERIES_MARK_ID = "mobile-time-series";

interface Datum {
  color: string;
  detail?: string;
  id: string;
  label: string;
  seriesId: string;
  timestamp: number;
  value: number;
}

interface PointerPosition {
  clientX: number;
  clientY: number;
  sceneX: number;
  sceneY: number;
}

interface PinchBaseline {
  distance: number;
  domain: NumericDomain;
  midpoint: number;
  pointerIds: readonly [number, number];
  scale: Pick<ResolvedScale, "invert" | "map">;
}

interface TimeSeriesChartDomProps {
  dom?: import("expo/dom").DOMProps;
  locale: "en" | "fr";
  model: SerializableTimeSeriesModel;
  passingValue?: number;
  reducedMotion: boolean;
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

function sameDomain(left: NumericDomain, right: NumericDomain): boolean {
  const extent = Math.max(Math.abs(right[1] - right[0]), 1);
  const tolerance = extent * 1e-9;
  return (
    Math.abs(left[0] - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance
  );
}

function asNumericScale(
  scale: Pick<ResolvedScale, "invert" | "map">,
): NumericScaleLike {
  return {
    invert: (position) => scale.invert?.(position),
    map: (value) => scale.map(value),
  };
}

function isInsidePlot(
  context: ChartRenderContext<Datum, number, number>,
  position: { x: number; y: number },
): boolean {
  const { chart } = context.scene;
  return (
    position.x >= chart.x &&
    position.x <= chart.x + chart.width &&
    position.y >= chart.y &&
    position.y <= chart.y + chart.height
  );
}

function independentSeriesFocus(
  hidden: ReadonlySet<string>,
): ChartFocusStrategy<Datum, number, number> {
  const resolve = (
    points: readonly ChartPoint<Datum, number, number>[],
    point: { x: number; y: number },
  ) =>
    resolveNearestProjectedSeriesPoints(points, point, {
      getSeriesId: (candidate) => candidate.datum.seriesId,
      getTimestamp: (candidate) => candidate.datum.timestamp,
      isEnabled: (candidate) =>
        candidate.markId === SERIES_MARK_ID &&
        !hidden.has(candidate.datum.seriesId),
    });

  return {
    resolve: (points, context) => resolve(points, context),
    group: (points, context) => resolve(points, context.point),
    navigation: (points) =>
      points
        .filter(
          (point) =>
            point.markId === SERIES_MARK_ID &&
            !hidden.has(point.datum.seriesId),
        )
        .toSorted(
          (left, right) =>
            left.datum.timestamp - right.datum.timestamp ||
            left.datum.seriesId.localeCompare(right.datum.seriesId) ||
            left.datumIndex - right.datumIndex,
        ),
  };
}

function templateName(template: string, name: string): string {
  return template.replace("{name}", name);
}

/**
 * The only web island in the native analytics UI. It receives an immutable,
 * JSON-safe snapshot and never owns data fetching. TanStack Charts remains in
 * charge of scales, marks, focus, tooltip and SVG rendering; this consumer
 * owns only semantic-domain gestures and series visibility.
 */
export default function TimeSeriesChartDom({
  locale,
  model,
  passingValue,
  reducedMotion,
  showPoints,
  strings,
  theme,
}: TimeSeriesChartDomProps) {
  const domain = model.domain;
  const [viewport, setViewport] = useState<NumericDomain>(domain);
  const [hiddenIds, setHiddenIds] = useState<string[]>(
    model.series.filter((series) => series.hidden).map((series) => series.id),
  );
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const viewportRef = useRef<NumericDomain>(viewport);
  const renderContextRef = useRef<
    ChartRenderContext<Datum, number, number> | undefined
  >(undefined);
  const hostRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, PointerPosition>());
  const pinchBaselineRef = useRef<PinchBaseline | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const wheelArmedRef = useRef(false);
  const frameRef = useRef<number | undefined>(undefined);
  const pendingViewportRef = useRef<NumericDomain | undefined>(undefined);

  const number = useMemo(
    () =>
      new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
        maximumFractionDigits: 2,
      }),
    [locale],
  );
  const shortDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
        day: "numeric",
        month: "short",
      }),
    [locale],
  );

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
    pendingViewportRef.current = undefined;
    pointersRef.current.clear();
    pinchBaselineRef.current = null;
    dragOriginRef.current = null;
    draggedRef.current = false;
    renderContextRef.current?.interaction.setControlledFocus(null);
    viewportRef.current = domain;
    setViewport(domain);
  }, [domain]);

  useEffect(
    () => () => {
      if (frameRef.current !== undefined)
        cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const commitViewport = useCallback((next: NumericDomain) => {
    viewportRef.current = next;
    pendingViewportRef.current = next;
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      const pending = pendingViewportRef.current;
      pendingViewportRef.current = undefined;
      if (pending) setViewport(pending);
    });
  }, []);

  const reset = useCallback(() => {
    renderContextRef.current?.interaction.setControlledFocus(null);
    commitViewport(domain);
  }, [commitViewport, domain]);

  const rows = useMemo(
    () =>
      model.series.flatMap((series) =>
        hidden.has(series.id)
          ? []
          : series.points.map((point): Datum => ({
              color: series.color,
              detail: point.detail,
              id: point.id,
              label: series.label,
              seriesId: series.id,
              timestamp: point.timestamp,
              value: point.value,
            })),
      ),
    [hidden, model.series],
  );
  const focus = useMemo(() => independentSeriesFocus(hidden), [hidden]);

  const definition = useMemo(() => {
    const threshold: Datum[] =
      typeof passingValue === "number" && Number.isFinite(passingValue)
        ? [
            {
              color: theme.muted,
              id: "passing-threshold",
              label: "",
              seriesId: "__threshold__",
              timestamp: domain[0],
              value: passingValue,
            },
          ]
        : [];

    return defineChart({
      marks: [
        ruleY(threshold, {
          id: "passing-threshold",
          y: "value",
          stroke: theme.muted,
          strokeDasharray: "4 4",
          strokeOpacity: 0.45,
        }),
        lineY(rows, {
          id: SERIES_MARK_ID,
          x: "timestamp",
          y: "value",
          z: "seriesId",
          color: "seriesId",
          key: "id",
          strokeWidth: 2.25,
        }),
        dot(rows, {
          id: "mobile-series-points",
          x: "timestamp",
          y: "value",
          z: "seriesId",
          color: "seriesId",
          key: "id",
          r: showPoints && rows.length <= 140 ? 2.5 : 0,
          stroke: theme.background,
          strokeWidth: showPoints && rows.length <= 140 ? 1 : 0,
        }),
        dot(rows, {
          id: "mobile-active-points",
          x: "timestamp",
          y: "value",
          z: "seriesId",
          color: "seriesId",
          key: "id",
          r: 0,
          fillOpacity: 0,
          stroke: theme.background,
          strokeWidth: 2,
          states: [
            {
              when: { focus: "key" },
              style: { r: 5, fillOpacity: 1 },
              transition: reducedMotion
                ? undefined
                : {
                    type: "tween",
                    duration: 90,
                    easing: "ease-out",
                    respectReducedMotion: true,
                  },
            },
          ],
        }),
      ],
      x: {
        scale: scaleLinear().domain(domain),
        viewport: { domain: viewport },
        grid: false,
        axis: {
          line: false,
          ticks: {
            padding: 7,
            format: (value) => shortDate.format(new Date(value)),
          },
          tickLabels: { thin: { minGap: 36, priority: "ends" } },
        },
      },
      y: {
        scale: scaleLinear().domain(model.yDomain),
        grid: true,
        axis: {
          line: false,
          ticks: {
            count: 5,
            padding: 7,
            format: (value) => number.format(value),
          },
        },
      },
      color: {
        domain: model.series.map((series) => series.id),
        range: model.series.map((series) => series.color),
      },
      margin: { top: 8, right: 8, bottom: 0, left: 8 },
      clip: true,
      focus,
      focusRing: false,
      maxFocusDistance: Number.POSITIVE_INFINITY,
      pointer: false,
      tooltip: {
        use: tooltip,
        anchor: "pointer",
        placement: ["top", "right", "left", "bottom"],
        content: (points) => ({
          title: strings.values,
          rows: points.map((point) => ({
            color: point.datum.color,
            label: point.datum.label,
            value: `${number.format(point.datum.value)} · ${shortDate.format(
              new Date(point.datum.timestamp),
            )}${point.datum.detail ? ` · ${point.datum.detail}` : ""}`,
          })),
        }),
      },
    });
  }, [
    domain,
    focus,
    model.series,
    model.yDomain,
    number,
    passingValue,
    reducedMotion,
    rows,
    showPoints,
    shortDate,
    strings.values,
    theme,
    viewport,
  ]);

  const resolvePosition = useCallback(
    (clientX: number, clientY: number, requireInside = true) => {
      const context = renderContextRef.current;
      const scene = context?.interaction.clientToScene(clientX, clientY);
      if (
        !context ||
        !scene ||
        (requireInside && !isInsidePlot(context, scene))
      ) {
        return null;
      }
      return {
        clientX,
        clientY,
        sceneX: scene.x,
        sceneY: scene.y,
      };
    },
    [],
  );

  const inspect = useCallback((clientX: number, clientY: number) => {
    const context = renderContextRef.current;
    const scene = context?.interaction.clientToScene(clientX, clientY);
    if (!context || !scene || !isInsidePlot(context, scene)) {
      context?.interaction.setControlledFocus(null);
      return;
    }
    context.interaction.setControlledFocus(
      context.interaction.resolvePointer(clientX, clientY),
      { source: "pointer" },
    );
  }, []);
  const inspection = useMemo(
    () =>
      createPointerInspectionController({
        clear: () =>
          renderContextRef.current?.interaction.setControlledFocus(null),
        inspect,
      }),
    [inspect],
  );

  const startPinch = useCallback(() => {
    const scale = renderContextRef.current?.scene.scales.x;
    const entries = [...pointersRef.current.entries()];
    pinchBaselineRef.current = null;
    if (!scale || entries.length < 2) return;
    const [[firstId, first], [secondId, second]] = entries;
    const distance = Math.hypot(
      first.sceneX - second.sceneX,
      first.sceneY - second.sceneY,
    );
    if (distance <= 0) return;
    pinchBaselineRef.current = {
      distance,
      domain: viewportRef.current,
      midpoint: (first.sceneX + second.sceneX) / 2,
      pointerIds: [firstId, secondId],
      scale,
    };
  }, []);

  const pointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const position = resolvePosition(event.clientX, event.clientY);
      if (!position) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      wheelArmedRef.current = true;
      pointersRef.current.set(event.pointerId, position);
      if (pointersRef.current.size === 2) startPinch();
      dragOriginRef.current ??= { x: event.clientX, y: event.clientY };
      draggedRef.current = false;
    },
    [resolvePosition, startPinch],
  );

  const pointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const context = renderContextRef.current;
      const previous = pointersRef.current.get(event.pointerId);
      if (!context || !previous) {
        if (event.pointerType === "mouse") {
          wheelArmedRef.current = true;
          inspection.move(event.clientX, event.clientY);
        }
        return;
      }

      const current = resolvePosition(event.clientX, event.clientY, false);
      if (!current) return;
      const origin = dragOriginRef.current;
      if (
        origin &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4
      ) {
        draggedRef.current = true;
      }
      const scale = context.scene.scales.x;
      if (!scale) return;
      pointersRef.current.set(event.pointerId, current);
      context.interaction.setControlledFocus(null);

      if (pointersRef.current.size >= 2) {
        const baseline = pinchBaselineRef.current;
        if (!baseline) {
          startPinch();
          return;
        }
        const first = pointersRef.current.get(baseline.pointerIds[0]);
        const second = pointersRef.current.get(baseline.pointerIds[1]);
        if (first && second) {
          const currentDistance = Math.hypot(
            first.sceneX - second.sceneX,
            first.sceneY - second.sceneY,
          );
          const currentMidpoint = (first.sceneX + second.sceneX) / 2;
          commitViewport(
            pinchDomainFromGesture(
              asNumericScale(baseline.scale),
              baseline.domain,
              domain,
              baseline.midpoint,
              currentMidpoint,
              currentDistance / baseline.distance,
              model.maximumZoom,
            ),
          );
        }
        return;
      }

      const delta = current.sceneX - previous.sceneX;
      if (delta !== 0) {
        commitViewport(
          panDomainBy(
            asNumericScale(scale),
            viewportRef.current,
            domain,
            delta,
            model.maximumZoom,
          ),
        );
      }
    },
    [
      commitViewport,
      domain,
      inspection,
      model.maximumZoom,
      resolvePosition,
      startPinch,
    ],
  );

  const finishPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      const tracked = pointersRef.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (
        tracked &&
        !cancelled &&
        !draggedRef.current &&
        pointersRef.current.size === 0
      ) {
        const resolution = renderContextRef.current?.interaction.resolvePointer(
          event.clientX,
          event.clientY,
        );
        renderContextRef.current?.interaction.setControlledFocus(
          resolution ?? null,
          { pinned: true, source: "pointer" },
        );
      }
      if (pointersRef.current.size === 0) {
        pinchBaselineRef.current = null;
        dragOriginRef.current = null;
        draggedRef.current = false;
      } else if (pointersRef.current.size >= 2) {
        startPinch();
      } else {
        pinchBaselineRef.current = null;
      }
    },
    [startPinch],
  );

  const wheel = useCallback(
    (event: WheelEvent) => {
      if (
        event
          .composedPath()
          .some(
            (entry) =>
              entry instanceof HTMLElement &&
              entry.hasAttribute("data-chart-control"),
          )
      ) {
        return;
      }
      const context = renderContextRef.current;
      const host = hostRef.current;
      if (
        !shouldHandleChartWheel({
          armedByPointer: wheelArmedRef.current,
          ctrlKey: event.ctrlKey,
          focusedWithin: Boolean(
            host &&
            document.activeElement &&
            host.contains(document.activeElement),
          ),
        })
      ) {
        return;
      }
      const position = context?.interaction.clientToScene(
        event.clientX,
        event.clientY,
      );
      const scale = context?.scene.scales.x;
      if (!context || !position || !scale || !isInsidePlot(context, position)) {
        return;
      }
      event.preventDefault();
      context.interaction.setControlledFocus(null);
      const delta = normalizeWheelDelta(event, {
        height: context.scene.chart.height,
        width: context.scene.chart.width,
      });
      if (!event.ctrlKey && Math.abs(delta.x) > Math.abs(delta.y)) {
        commitViewport(
          panDomainBy(
            asNumericScale(scale),
            viewportRef.current,
            domain,
            -delta.x,
            model.maximumZoom,
          ),
        );
        return;
      }
      commitViewport(
        zoomDomainAt(
          asNumericScale(scale),
          viewportRef.current,
          domain,
          position.x,
          Math.min(2, Math.max(0.5, Math.exp(-delta.y * 0.002))),
          model.maximumZoom,
        ),
      );
    },
    [commitViewport, domain, model.maximumZoom],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.addEventListener("wheel", wheel, { passive: false });
    return () => host.removeEventListener("wheel", wheel);
  }, [wheel]);

  const keyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest("[data-chart-control]")) return;
      const context = renderContextRef.current;
      const scale = context?.scene.scales.x;
      if (!context || !scale) return;
      const command = resolveChartKeyboardCommand(event);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      if (command === "reset") {
        reset();
        return;
      }
      if (command === "zoom-in" || command === "zoom-out") {
        commitViewport(
          zoomDomainAt(
            asNumericScale(scale),
            viewportRef.current,
            domain,
            context.scene.chart.x + context.scene.chart.width / 2,
            command === "zoom-out" ? 0.8 : 1.25,
            model.maximumZoom,
          ),
        );
        return;
      }
      commitViewport(
        panDomainBy(
          asNumericScale(scale),
          viewportRef.current,
          domain,
          context.scene.chart.width * 0.1 * (command === "pan-left" ? 1 : -1),
          model.maximumZoom,
        ),
      );
    },
    [commitViewport, domain, model.maximumZoom, reset],
  );

  const enabledCount = model.series.length - hidden.size;
  const zoomed = !sameDomain(viewport, domain);

  return (
    <div
      style={{
        background: theme.background,
        color: theme.text,
        fontFamily:
          "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        html, body, #root { margin: 0; min-height: 100%; background: ${theme.background}; }
        button { font: inherit; }
        [role="tooltip"] { background: ${theme.tooltip} !important; color: ${theme.text} !important; border: 1px solid ${theme.border} !important; }
        svg text { fill: ${theme.muted}; font-size: 11px; }
        svg [data-grid] { stroke: ${theme.grid}; }
      `}</style>
      <div
        aria-label={strings.visibleRange}
        onKeyDownCapture={keyDown}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onPointerDown={pointerDown}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) {
            wheelArmedRef.current = false;
            inspection.leave();
          }
        }}
        onPointerMove={pointerMove}
        onPointerUp={finishPointer}
        ref={hostRef}
        style={{
          position: "relative",
          touchAction: "none",
          userSelect: "none",
        }}
        tabIndex={0}
      >
        <div
          aria-label="Series"
          data-chart-control
          role="group"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            minHeight: 38,
            padding: "8px 12px 0",
          }}
        >
          {model.series.map((series) => {
            const isHidden = hidden.has(series.id);
            return (
              <button
                aria-label={templateName(
                  isHidden ? strings.showSeries : strings.hideSeries,
                  series.label,
                )}
                aria-pressed={!isHidden}
                disabled={!isHidden && enabledCount === 1}
                key={series.id}
                onClick={() => {
                  renderContextRef.current?.interaction.setControlledFocus(
                    null,
                  );
                  setHiddenIds((current) =>
                    current.includes(series.id)
                      ? current.filter((id) => id !== series.id)
                      : [...current, series.id],
                  );
                }}
                type="button"
                style={{
                  alignItems: "center",
                  background: isHidden ? "transparent" : `${series.color}18`,
                  border: `1px solid ${isHidden ? theme.border : series.color}`,
                  borderRadius: 999,
                  color: isHidden ? theme.muted : theme.text,
                  display: "inline-flex",
                  gap: 5,
                  minHeight: 28,
                  opacity: isHidden ? 0.62 : 1,
                  padding: "3px 9px",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    background: series.color,
                    borderRadius: 999,
                    height: 7,
                    width: 7,
                  }}
                />
                {series.label}
              </button>
            );
          })}
        </div>
        <Chart
          ariaDescription={strings.visibleRange}
          ariaLabel={strings.values}
          definition={definition}
          height={220}
          initialWidth={640}
          onRender={(context) => {
            renderContextRef.current = context;
          }}
        />
        {zoomed ? (
          <button
            aria-label={strings.reset}
            data-chart-control
            onClick={reset}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
            style={{
              background: theme.tooltip,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              color: theme.text,
              minHeight: 32,
              padding: "4px 9px",
              position: "absolute",
              right: 10,
              top: 46,
            }}
          >
            ↺ {strings.reset}
          </button>
        ) : null}
      </div>
      <p
        aria-live="polite"
        style={{
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          height: 1,
          overflow: "hidden",
          position: "absolute",
          whiteSpace: "nowrap",
          width: 1,
        }}
      >
        {`${strings.visibleRange}: ${shortDate.format(
          new Date(viewport[0]),
        )} – ${shortDate.format(new Date(viewport[1]))}`}
      </p>
    </div>
  );
}
