import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { createChartScene, defineChart, lineY } from "@tanstack/charts"
import { scaleLinear } from "@tanstack/charts/scales/linear"
import { renderToStaticMarkup } from "react-dom/server"
import { ResponsiveChart } from "./responsive-chart"

const points = [
  { id: "first", timestamp: 0, value: 2 },
  { id: "last", timestamp: 1, value: 8 },
]

function chartDefinition() {
  return defineChart({
    marks: [
      lineY(points, {
        id: "average",
        key: "id",
        x: "timestamp",
        y: "value",
      }),
    ],
    x: {
      scale: scaleLinear().domain([0, 1]),
      axis: { ticks: { count: 3, padding: 8 } },
    },
    y: {
      scale: scaleLinear().domain([0, 10]),
      axis: { ticks: { count: 3, padding: 8 } },
    },
    focus: false,
    keyboard: false,
    pointer: false,
  })
}

describe("responsive TanStack chart layout", () => {
  it("server-renders a height-stable placeholder without hydrating SVG bytes", () => {
    const html = renderToStaticMarkup(
      <ResponsiveChart
        ariaLabel="Average history"
        definition={chartDefinition()}
        height={240}
        initialWidth={640}
      />
    )

    assert.match(html, /data-chart-layout="pending"/)
    assert.match(html, /aria-busy="true"/)
    assert.match(html, /data-chart-placeholder="true"/)
    assert.match(html, /data-chart-surface="true"/)
    assert.match(html, /pointer-events-none opacity-0/)
    assert.match(html, /style="height:240px"/)
    assert.doesNotMatch(html, /<svg/)
    assert.doesNotMatch(html, /dangerouslySetInnerHTML/)
  })

  it("leaves guide margins automatic instead of locking axes into tiny insets", () => {
    const definition = chartDefinition()
    const automatic = createChartScene(definition, {
      width: 640,
      height: 240,
    })
    const locked = createChartScene(
      {
        ...definition,
        margin: { top: 4, right: 4, bottom: 4, left: 4 },
      },
      { width: 640, height: 240 }
    )

    assert.ok(automatic.margin.left > locked.margin.left)
    assert.ok(automatic.margin.right > locked.margin.right)
    assert.ok(automatic.margin.bottom > locked.margin.bottom)
    assert.equal(locked.margin.left, 4)
    assert.equal(locked.margin.right, 4)
    assert.equal(locked.margin.bottom, 4)
  })
})
