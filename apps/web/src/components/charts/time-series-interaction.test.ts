import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import type { ChartPoint } from "@tanstack/charts"
import {
  createIndependentSeriesFocus,
  createPointerInspectionController,
  installNonPassiveWheelListener,
  normalizeWheelDelta,
  panDomainBy,
  panLinearDomainByPixels,
  pinchDomainFromGesture,
  resolveChartDragIntent,
  resolveChartKeyboardCommand,
  resolveNearestSeriesPoints,
  shouldHandleChartWheel,
  shouldPinChartInspection,
  viewportValues,
  zoomDomainAt,
} from "./time-series-interaction"

interface Datum {
  enabled?: boolean
  seriesId: string
  timestamp: number
}

function point(
  seriesId: string,
  timestamp: number,
  x = timestamp,
  y = 0,
  datumIndex = timestamp
): ChartPoint<Datum, number, number> {
  const datum = { seriesId, timestamp }
  return {
    key: `${seriesId}:${timestamp}`,
    markId: "series-lines",
    group: seriesId,
    groupLabel: seriesId,
    datum,
    datumIndex,
    xValue: timestamp,
    yValue: y,
    x,
    y,
    color: seriesId,
  }
}

const options = {
  getSeriesId: (datum: Datum) => datum.seriesId,
  getTimestamp: (datum: Datum) => datum.timestamp,
  isEnabled: (candidate: ChartPoint<Datum, number, number>) =>
    candidate.datum.enabled !== false,
}

function selected(
  points: readonly ChartPoint<Datum, number, number>[],
  x: number,
  y = 0
) {
  return Object.fromEntries(
    resolveNearestSeriesPoints(points, { x, y }, options).map((candidate) => [
      candidate.datum.seriesId,
      candidate.datum.timestamp,
    ])
  )
}

describe("independent multi-series focus", () => {
  it("selects aligned timestamps independently", () => {
    assert.deepEqual(
      selected(
        [point("a", 0), point("a", 10), point("b", 0), point("b", 10)],
        9
      ),
      { a: 10, b: 10 }
    )
  })

  it("handles partially aligned and irregular timestamps", () => {
    assert.deepEqual(
      selected(
        [
          point("a", 0),
          point("a", 8),
          point("a", 25),
          point("b", 0),
          point("b", 13),
          point("b", 31),
        ],
        11
      ),
      { a: 8, b: 13 }
    )
  })

  it("keeps sparse and missing series independent", () => {
    assert.deepEqual(
      selected([point("dense", 2), point("dense", 9), point("sparse", 40)], 8),
      { dense: 9, sparse: 40 }
    )
    assert.deepEqual(
      selected([point("available", 12), point("available", 24)], 18),
      { available: 12 }
    )
  })

  it("selects boundary points and uses earlier timestamps for ties", () => {
    const points = [point("a", 10), point("a", 20), point("b", 12)]
    assert.deepEqual(selected(points, -100), { a: 10, b: 12 })
    assert.deepEqual(selected(points, 100), { a: 20, b: 12 })
    assert.deepEqual(selected([point("a", 10), point("a", 20)], 15), {
      a: 10,
    })
  })

  it("uses transformed coordinates and retains exact marker positions", () => {
    const sparse = point("sparse", 40, 72, 133)
    const result = resolveNearestSeriesPoints(
      [point("dense", 10, 20, 80), sparse],
      { x: 65, y: 100 },
      options
    )
    assert.equal(
      result.find(({ datum }) => datum.seriesId === "sparse"),
      sparse
    )
    assert.deepEqual(selected([point("a", 0, -100), point("a", 10, 20)], 18), {
      a: 10,
    })
  })

  it("excludes hidden series and groups keyboard focus independently", () => {
    const hidden = point("hidden", 5)
    hidden.datum.enabled = false
    assert.deepEqual(selected([point("visible", 4), hidden], 5), { visible: 4 })

    const points = [point("a", 10), point("a", 30), point("b", 19)]
    const group = createIndependentSeriesFocus(options).group(points, {
      point: points[2],
    })
    assert.deepEqual(
      Object.fromEntries(
        group.map((candidate) => [
          candidate.datum.seriesId,
          candidate.datum.timestamp,
        ])
      ),
      { b: 19, a: 10 }
    )
  })
})

describe("semantic viewport", () => {
  const scaleFor = (domain: readonly [number, number]) => ({
    map(value: unknown) {
      return ((Number(value) - domain[0]) / (domain[1] - domain[0])) * 100
    },
    invert(position: number) {
      return domain[0] + (position / 100) * (domain[1] - domain[0])
    },
  })

  it("zooms around the pointer and enforces the maximum zoom", () => {
    assert.deepEqual(
      zoomDomainAt(scaleFor([0, 100]), [0, 100], [0, 100], 25, 2, 10),
      [12.5, 62.5]
    )
    assert.deepEqual(
      zoomDomainAt(scaleFor([45, 55]), [45, 55], [0, 100], 50, 99, 10),
      [45, 55]
    )
  })

  it("pans within the full semantic extent", () => {
    assert.deepEqual(
      panDomainBy(scaleFor([20, 60]), [20, 60], [0, 100], -25),
      [30, 70]
    )
    assert.deepEqual(
      panDomainBy(scaleFor([0, 40]), [0, 40], [0, 100], 50),
      [0, 40]
    )
  })

  it("pans touch gestures from one fixed pixel baseline", () => {
    assert.deepEqual(
      panLinearDomainByPixels([20, 60], [0, 100], -25, 100),
      [30, 70]
    )
    assert.deepEqual(
      panLinearDomainByPixels([20, 60], [0, 100], -50, 100),
      [40, 80]
    )
    assert.deepEqual(
      panLinearDomainByPixels([0, 40], [0, 100], 50, 100),
      [0, 40]
    )
  })

  it("resolves pinch zoom and translation from one fixed baseline", () => {
    const scale = scaleFor([20, 80])
    assert.deepEqual(
      pinchDomainFromGesture(scale, [20, 80], [0, 100], 50, 60, 1),
      [14, 74]
    )
    assert.deepEqual(
      pinchDomainFromGesture(scale, [20, 80], [0, 100], 50, 50, 2),
      [35, 65]
    )
  })
})

describe("interaction event arbitration", () => {
  it("locks touch drags to an axis after a short hysteresis", () => {
    assert.equal(resolveChartDragIntent(6, 4), null)
    assert.equal(resolveChartDragIntent(9, 3), "horizontal")
    assert.equal(resolveChartDragIntent(3, 9), "vertical")
    assert.equal(resolveChartDragIntent(8, 8), "vertical")
  })

  it("pins taps and inspection drags, but not pans or cancelled gestures", () => {
    const gesture = {
      activePointers: 0,
      cancelled: false,
      dragged: false,
      inspecting: false,
      wasTracked: true,
    }
    assert.equal(shouldPinChartInspection(gesture), true)
    assert.equal(
      shouldPinChartInspection({ ...gesture, dragged: true, inspecting: true }),
      true
    )
    assert.equal(shouldPinChartInspection({ ...gesture, dragged: true }), false)
    assert.equal(
      shouldPinChartInspection({ ...gesture, cancelled: true }),
      false
    )
    assert.equal(
      shouldPinChartInspection({ ...gesture, activePointers: 1 }),
      false
    )
  })

  it("routes rapid pointer movement and clears on leave", () => {
    const moves: Array<readonly [number, number]> = []
    let clearCount = 0
    const controller = createPointerInspectionController({
      clear: () => {
        clearCount += 1
      },
      inspect: (x, y) => moves.push([x, y]),
    })

    for (let index = 0; index < 100; index += 1) {
      controller.move(index, index * 2)
    }
    controller.leave()

    assert.equal(moves.length, 100)
    assert.deepEqual(moves.at(-1), [99, 198])
    assert.equal(clearCount, 1)
  })

  it("installs wheel zoom as a non-passive listener", () => {
    let installedOptions: AddEventListenerOptions | boolean | undefined
    let installedListener: EventListenerOrEventListenerObject | undefined
    let removedListener: EventListenerOrEventListenerObject | undefined
    const target = {
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean
      ) {
        assert.equal(type, "wheel")
        installedListener = listener
        installedOptions = options
      },
      removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject
      ) {
        assert.equal(type, "wheel")
        removedListener = listener
      },
    } as unknown as HTMLElement

    const cleanup = installNonPassiveWheelListener(target, () => undefined)
    assert.deepEqual(installedOptions, { passive: false })
    cleanup()
    assert.equal(removedListener, installedListener)
  })

  it("normalizes wheel pixel, line, and page delta modes", () => {
    const page = { height: 300, width: 600 }
    assert.deepEqual(
      normalizeWheelDelta({ deltaMode: 0, deltaX: 2, deltaY: -3 }, page),
      { x: 2, y: -3 }
    )
    assert.deepEqual(
      normalizeWheelDelta({ deltaMode: 1, deltaX: 2, deltaY: -3 }, page),
      { x: 32, y: -48 }
    )
    assert.deepEqual(
      normalizeWheelDelta({ deltaMode: 2, deltaX: 2, deltaY: -3 }, page),
      { x: 1200, y: -900 }
    )
  })

  it("leaves page scrolling and browser zoom alone until the plot is engaged", () => {
    assert.equal(
      shouldHandleChartWheel({
        armedByPointer: false,
        ctrlKey: false,
        focusedWithin: false,
      }),
      false
    )
    assert.equal(
      shouldHandleChartWheel({
        armedByPointer: true,
        ctrlKey: false,
        focusedWithin: false,
      }),
      true
    )
    assert.equal(
      shouldHandleChartWheel({
        armedByPointer: false,
        ctrlKey: true,
        focusedWithin: false,
      }),
      false
    )
    assert.equal(
      shouldHandleChartWheel({
        armedByPointer: false,
        ctrlKey: false,
        focusedWithin: true,
      }),
      true
    )
  })

  it("frames the visible window plus each series' crossing endpoints", () => {
    const rows = [
      { seriesId: "a", timestamp: 0, value: 2 },
      { seriesId: "a", timestamp: 40, value: 8 },
      { seriesId: "a", timestamp: 60, value: 9 },
      { seriesId: "a", timestamp: 100, value: 30 },
      { seriesId: "b", timestamp: 10, value: 1 },
      { seriesId: "b", timestamp: 90, value: 20 },
    ]

    // In-window samples plus, per series, the off-screen endpoints of the
    // segments that cross the edges — never the far tails beyond those.
    const framed = viewportValues(rows, [35, 65]).toSorted((l, r) => l - r)
    assert.deepEqual(framed, [1, 2, 8, 9, 20, 30])

    // A window between two samples still frames the crossing segment.
    const between = viewportValues(
      [
        { seriesId: "a", timestamp: 0, value: 5 },
        { seriesId: "a", timestamp: 100, value: 15 },
      ],
      [40, 60]
    ).toSorted((l, r) => l - r)
    assert.deepEqual(between, [5, 15])

    // A window entirely past a series' data frames nothing from it: there is
    // no crossing segment, so the caller falls back to the full domain.
    assert.deepEqual(
      viewportValues([{ seriesId: "a", timestamp: 0, value: 5 }], [40, 60]),
      []
    )
  })

  it("reserves plain datum-navigation keys for TanStack focus", () => {
    assert.equal(
      resolveChartKeyboardCommand({ altKey: false, key: "Home" }),
      null
    )
    assert.equal(
      resolveChartKeyboardCommand({ altKey: false, key: "ArrowLeft" }),
      null
    )
    assert.equal(
      resolveChartKeyboardCommand({ altKey: true, key: "ArrowLeft" }),
      "pan-left"
    )
    assert.equal(
      resolveChartKeyboardCommand({ altKey: false, key: "0" }),
      "reset"
    )
  })
})
