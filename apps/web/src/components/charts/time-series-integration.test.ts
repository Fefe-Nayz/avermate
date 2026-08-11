import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import {
  createChartScene,
  defineChart,
  dot,
  lineY,
  renderChartSvg,
  viewportInteractionPoints,
} from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import {
  createIndependentSeriesFocus,
  panDomainBy,
  type NumericDomain,
  zoomDomainAt,
} from "./time-series-interaction"

interface SeriesDatum {
  id: string
  interactive: boolean
  seriesId: "alpha" | "beta"
  timestamp: number
  value: number
}

const SERIES_MARK_ID = "series-lines"
const ACTIVE_MARK_ID = "active-markers"
const FULL_DOMAIN = [0, 100] as const
const ROWS: readonly SeriesDatum[] = [
  {
    id: "alpha:10",
    interactive: true,
    seriesId: "alpha",
    timestamp: 10,
    value: 4,
  },
  {
    id: "alpha:34",
    interactive: true,
    seriesId: "alpha",
    timestamp: 34,
    value: 7,
  },
  {
    id: "alpha:64",
    interactive: true,
    seriesId: "alpha",
    timestamp: 64,
    value: 12,
  },
  {
    id: "alpha:90",
    interactive: true,
    seriesId: "alpha",
    timestamp: 90,
    value: 16,
  },
  {
    id: "beta:20",
    interactive: true,
    seriesId: "beta",
    timestamp: 20,
    value: 15,
  },
  {
    id: "beta:47",
    interactive: true,
    seriesId: "beta",
    timestamp: 47,
    value: 11,
  },
  {
    id: "beta:73",
    interactive: true,
    seriesId: "beta",
    timestamp: 73,
    value: 6,
  },
  {
    id: "beta:95",
    interactive: true,
    seriesId: "beta",
    timestamp: 95,
    value: 3,
  },
]

const focus = createIndependentSeriesFocus<SeriesDatum>({
  getSeriesId: (datum) => datum.seriesId,
  getTimestamp: (datum) => datum.timestamp,
  isEnabled: (point) =>
    point.markId === SERIES_MARK_ID && point.datum.interactive,
})

function definitionFor(viewport: NumericDomain) {
  return defineChart({
    marks: [
      lineY(ROWS, {
        id: SERIES_MARK_ID,
        x: "timestamp",
        y: "value",
        z: "seriesId",
        color: "seriesId",
        key: "id",
        strokeWidth: 2,
      }),
      dot(ROWS, {
        id: ACTIVE_MARK_ID,
        x: "timestamp",
        y: "value",
        z: "seriesId",
        color: "seriesId",
        key: "id",
        r: 0,
        fillOpacity: 0,
        states: [
          {
            when: { focus: "key" },
            style: { r: 5, fillOpacity: 1 },
          },
        ],
      }),
    ],
    x: {
      scale: scaleLinear().domain(FULL_DOMAIN),
      viewport: { domain: viewport },
    },
    y: { scale: scaleLinear().domain([0, 20]) },
    color: {
      domain: ["alpha", "beta"],
      range: ["#2563eb", "#f97316"],
    },
    margin: { top: 12, right: 12, bottom: 12, left: 12 },
    clip: true,
    focus,
    focusRing: false,
    guides: false,
    maxFocusDistance: Number.POSITIVE_INFINITY,
    pointer: false,
  })
}

function sceneFor(viewport: NumericDomain) {
  return createChartScene(definitionFor(viewport), {
    width: 640,
    height: 320,
  })
}

function assertClose(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    `expected ${actual} to be close to ${expected}`
  )
}

describe("TanStack time-series consumer integration", () => {
  it("clips candidates and preserves independent active markers after zoom and pan", () => {
    const initial = sceneFor(FULL_DOMAIN)
    const zoomed = zoomDomainAt(
      initial.scales.x,
      FULL_DOMAIN,
      FULL_DOMAIN,
      initial.scales.x.map(50),
      2,
      8
    )
    assert.deepEqual(zoomed, [25, 75])

    const zoomedScene = sceneFor(zoomed)
    const panned = panDomainBy(
      zoomedScene.scales.x,
      zoomed,
      FULL_DOMAIN,
      -zoomedScene.chart.width * 0.1,
      8
    )
    assertClose(panned[0], 30)
    assertClose(panned[1], 80)

    const scene = sceneFor(panned)
    const visible = viewportInteractionPoints(scene)
    const seriesPoints = visible.filter(
      (point) => point.markId === SERIES_MARK_ID
    )
    assert.deepEqual(
      seriesPoints
        .map((point) => point.datum.timestamp)
        .toSorted((left, right) => left - right),
      [34, 47, 64, 73]
    )
    assert.ok(visible.length < scene.points.length)

    const selected = focus.resolve(visible, {
      x: scene.scales.x.map(62),
      y: scene.scales.y.map(10),
      maxDistance: Number.POSITIVE_INFINITY,
    })
    assert.deepEqual(
      Object.fromEntries(
        selected.map((point) => [point.datum.seriesId, point.datum.timestamp])
      ),
      { alpha: 64, beta: 73 }
    )

    for (const point of selected) {
      assertClose(point.x, scene.scales.x.map(point.datum.timestamp))
      assertClose(point.y, scene.scales.y.map(point.datum.value))
      const marker = visible.find(
        (candidate) =>
          candidate.markId === ACTIVE_MARK_ID && candidate.datum === point.datum
      )
      assert.ok(marker, `missing marker candidate for ${point.key}`)
      assertClose(marker.x, point.x)
      assertClose(marker.y, point.y)
    }

    assert.notEqual(selected[0]?.x, selected[1]?.x)
  })

  it("renders deterministic accessible SVG for server output", () => {
    const options = {
      ariaDescription: "Two irregularly sampled average series.",
      ariaLabel: "Avermate average history",
      idPrefix: "avermate-integration",
    }
    const first = renderChartSvg(sceneFor([30, 80]), options)
    const second = renderChartSvg(sceneFor([30, 80]), options)

    assert.equal(first, second)
    assert.match(first, /^<svg/)
    assert.match(first, /role="img"/)
    assert.match(first, /aria-label="Avermate average history"/)
    assert.match(first, /<clipPath/)
    assert.match(first, /class="ts-chart__viewport-clip"/)
  })
})
