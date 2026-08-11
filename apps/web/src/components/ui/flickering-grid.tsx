"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useContinuousAnimationActivity } from "@/hooks/use-continuous-animation"
import {
  createContinuousFrameLoop,
  stableUnitValue,
} from "@/lib/continuous-animation"
import { cn } from "@/lib/utils"

interface FlickeringGridProps extends React.HTMLAttributes<HTMLDivElement> {
  squareSize?: number
  gridGap?: number
  flickerChance?: number
  color?: string
  width?: number
  height?: number
  className?: string
  maxOpacity?: number
  active?: boolean
}

interface GridParameters {
  cols: number
  rows: number
  squares: Float32Array
  dpr: number
}

export const FlickeringGrid: React.FC<FlickeringGridProps> = ({
  squareSize = 4,
  gridGap = 6,
  flickerChance = 0.3,
  color = "rgb(0, 0, 0)",
  width,
  height,
  className,
  maxOpacity = 0.3,
  active = true,
  ...props
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const gridParametersRef = useRef<GridParameters | null>(null)
  const activity = useContinuousAnimationActivity(containerRef, active)

  const memoizedColor = useMemo(() => {
    const toRGBA = (color: string) => {
      if (typeof window === "undefined") {
        return `rgba(0, 0, 0,`
      }
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext("2d")
      if (!ctx) return "rgba(255, 0, 0,"
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data)
      return `rgba(${r}, ${g}, ${b},`
    }
    return toRGBA(color)
  }, [color])

  const setupCanvas = useCallback(
    (canvas: HTMLCanvasElement, width: number, height: number) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const cols = Math.ceil(width / (squareSize + gridGap))
      const rows = Math.ceil(height / (squareSize + gridGap))

      const squares = new Float32Array(cols * rows)
      for (let i = 0; i < squares.length; i++) {
        squares[i] = stableUnitValue(i, cols * 31 + rows) * maxOpacity
      }

      return { cols, rows, squares, dpr }
    },
    [squareSize, gridGap, maxOpacity]
  )

  const updateSquares = useCallback(
    (squares: Float32Array, deltaTime: number) => {
      for (let i = 0; i < squares.length; i++) {
        if (Math.random() < flickerChance * deltaTime) {
          squares[i] = Math.random() * maxOpacity
        }
      }
    },
    [flickerChance, maxOpacity]
  )

  const drawGrid = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      cols: number,
      rows: number,
      squares: Float32Array,
      dpr: number
    ) => {
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = "transparent"
      ctx.fillRect(0, 0, width, height)

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const opacity = squares[i * rows + j]
          ctx.fillStyle = `${memoizedColor}${opacity})`
          ctx.fillRect(
            i * (squareSize + gridGap) * dpr,
            j * (squareSize + gridGap) * dpr,
            squareSize * dpr,
            squareSize * dpr
          )
        }
      }
    },
    [memoizedColor, squareSize, gridGap]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const ctx = canvas?.getContext("2d") ?? null
    let resizeObserver: ResizeObserver | null = null

    if (canvas && container && ctx) {
      const updateCanvasSize = () => {
        const newWidth = width || container.clientWidth
        const newHeight = height || container.clientHeight
        setCanvasSize({ width: newWidth, height: newHeight })
        const gridParameters = setupCanvas(canvas, newWidth, newHeight)
        gridParametersRef.current = gridParameters
        drawGrid(
          ctx,
          canvas.width,
          canvas.height,
          gridParameters.cols,
          gridParameters.rows,
          gridParameters.squares,
          gridParameters.dpr
        )
      }

      updateCanvasSize()

      resizeObserver = new ResizeObserver(() => {
        updateCanvasSize()
      })
      resizeObserver.observe(container)
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      gridParametersRef.current = null
    }
  }, [setupCanvas, drawGrid, width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d") ?? null
    let lastTime: number | null = null
    if (!canvas || !ctx) return

    const loop = createContinuousFrameLoop({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      onFrame: (time) => {
        const gridParameters = gridParametersRef.current
        if (!gridParameters) return
        const deltaTime =
          lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.1)
        lastTime = time
        updateSquares(gridParameters.squares, deltaTime)
        drawGrid(
          ctx,
          canvas.width,
          canvas.height,
          gridParameters.cols,
          gridParameters.rows,
          gridParameters.squares,
          gridParameters.dpr
        )
      },
    })

    if (activity.animationActive) loop.setAnimating(true)
    else if (activity.renderActive) loop.renderOnce(0)

    return () => loop.dispose()
  }, [activity.animationActive, activity.renderActive, drawGrid, updateSquares])

  return (
    <div
      ref={containerRef}
      data-animation-active={activity.animationActive}
      className={cn(`h-full w-full ${className}`)}
      {...props}
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none"
        style={{
          width: canvasSize.width,
          height: canvasSize.height,
        }}
      />
    </div>
  )
}
