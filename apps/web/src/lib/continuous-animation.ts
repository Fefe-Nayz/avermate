export interface ContinuousActivityInput {
  requested: boolean
  intersecting: boolean
  documentVisible: boolean
  reducedMotion: boolean
  mounted?: boolean
}

export interface ContinuousActivityState {
  /** The component may draw or expose its stable frame. */
  renderActive: boolean
  /** The component may schedule repeating work. */
  animationActive: boolean
}

export function resolveContinuousActivity({
  requested,
  intersecting,
  documentVisible,
  reducedMotion,
  mounted = true,
}: ContinuousActivityInput): ContinuousActivityState {
  const renderActive = mounted && requested && intersecting && documentVisible

  return {
    renderActive,
    animationActive: renderActive && !reducedMotion,
  }
}

export interface ContinuousRendererMotionInput {
  renderActive: boolean
  paused: boolean
  controlledTime: boolean
  respectReducedMotion: boolean
  policyReducedMotion: boolean
  mediaReducedMotion: boolean
  interactionRequested?: boolean
}

export interface ContinuousRendererMotionState {
  reducedMotion: boolean
  clockRuns: boolean
  interactionRuns: boolean
}

export function resolveContinuousRendererMotion({
  renderActive,
  paused,
  controlledTime,
  respectReducedMotion,
  policyReducedMotion,
  mediaReducedMotion,
  interactionRequested = false,
}: ContinuousRendererMotionInput): ContinuousRendererMotionState {
  const reducedMotion =
    respectReducedMotion && (policyReducedMotion || mediaReducedMotion)
  const mayAnimate = renderActive && !paused && !reducedMotion

  return {
    reducedMotion,
    clockRuns: mayAnimate && !controlledTime,
    interactionRuns: mayAnimate && interactionRequested,
  }
}

export interface ContinuousFrameLoop {
  setAnimating(active: boolean): void
  renderOnce(timestamp?: number): void
  dispose(): void
  isScheduled(): boolean
}

export function createContinuousFrameLoop({
  requestFrame,
  cancelFrame,
  onFrame,
}: {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  onFrame: (timestamp: number) => void
}): ContinuousFrameLoop {
  let frame: number | null = null
  let animating = false
  let disposed = false

  const cancelPendingFrame = () => {
    if (frame === null) return
    cancelFrame(frame)
    frame = null
  }

  const schedule = () => {
    if (disposed || !animating || frame !== null) return
    frame = requestFrame(tick)
  }

  function tick(timestamp: number) {
    frame = null
    if (disposed || !animating) return
    onFrame(timestamp)
    schedule()
  }

  return {
    setAnimating(active) {
      if (disposed || animating === active) return
      animating = active
      if (active) schedule()
      else cancelPendingFrame()
    },
    renderOnce(timestamp = 0) {
      if (!disposed) onFrame(timestamp)
    },
    dispose() {
      if (disposed) return
      disposed = true
      animating = false
      cancelPendingFrame()
    },
    isScheduled() {
      return frame !== null
    },
  }
}

export const MAX_AUTH_GRID_ANIMATED_CELLS = 24
export const MAX_INTERACTIVE_GRID_HOVER_CELLS = 8

export interface GridHoverCellPosition {
  column: number
  row: number
}

export interface GridHoverCell extends GridHoverCellPosition {
  id: number
}

export interface GridHoverPool {
  current: GridHoverCell | null
  fading: readonly GridHoverCell[]
  nextId: number
}

export function createGridHoverPool(): GridHoverPool {
  return { current: null, fading: [], nextId: 0 }
}

function isSameGridCell(
  left: GridHoverCellPosition,
  right: GridHoverCellPosition
) {
  return left.column === right.column && left.row === right.row
}

export function advanceBoundedGridHoverPool(
  pool: GridHoverPool,
  position: GridHoverCellPosition,
  maximum = MAX_INTERACTIVE_GRID_HOVER_CELLS
): GridHoverPool {
  const ceiling = Math.max(0, Math.floor(maximum))
  if (ceiling === 0) return clearGridHoverPool(pool)
  if (pool.current && isSameGridCell(pool.current, position)) return pool

  const fadingLimit = Math.max(0, ceiling - 1)
  const fading = pool.fading.filter((cell) => !isSameGridCell(cell, position))
  if (pool.current) fading.push(pool.current)

  return {
    current: { ...position, id: pool.nextId },
    fading: fading.slice(-fadingLimit),
    nextId: pool.nextId + 1,
  }
}

export function releaseGridHoverCell(
  pool: GridHoverPool,
  maximum = MAX_INTERACTIVE_GRID_HOVER_CELLS
): GridHoverPool {
  if (!pool.current) return pool
  const ceiling = Math.max(0, Math.floor(maximum))
  return {
    current: null,
    fading: ceiling === 0 ? [] : [...pool.fading, pool.current].slice(-ceiling),
    nextId: pool.nextId,
  }
}

export function removeFadedGridHoverCell(
  pool: GridHoverPool,
  id: number
): GridHoverPool {
  const fading = pool.fading.filter((cell) => cell.id !== id)
  return fading.length === pool.fading.length ? pool : { ...pool, fading }
}

export function clearGridHoverPool(pool: GridHoverPool): GridHoverPool {
  if (!pool.current && pool.fading.length === 0) return pool
  return { current: null, fading: [], nextId: pool.nextId }
}

export function getGridHoverPoolSize(pool: GridHoverPool) {
  return pool.fading.length + (pool.current ? 1 : 0)
}

export function getBoundedAnimatedCellCount(
  totalCells: number,
  percentage: number,
  maximum = MAX_AUTH_GRID_ANIMATED_CELLS
) {
  const safeTotal = Math.max(0, Math.floor(totalCells))
  const safeMaximum = Math.max(0, Math.floor(maximum))
  if (safeTotal === 0 || safeMaximum === 0) return 0

  const requested = Math.max(
    1,
    Math.floor(safeTotal * Math.min(1, Math.max(0, percentage)))
  )
  return Math.min(safeTotal, safeMaximum, requested)
}

export function stableUnitValue(index: number, seed = 0) {
  let value = (Math.trunc(index) + Math.trunc(seed) * 0x9e3779b1) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x7feb352d)
  value ^= value >>> 15
  value = Math.imul(value, 0x846ca68b)
  value ^= value >>> 16
  return (value >>> 0) / 0x1_0000_0000
}

export function getStableGridPosition(
  index: number,
  columns: number,
  rows: number,
  iteration = 0
): [number, number] {
  if (columns <= 0 || rows <= 0) return [0, 0]
  const seed = iteration * 131 + 17
  return [
    Math.floor(stableUnitValue(index * 2, seed) * columns),
    Math.floor(stableUnitValue(index * 2 + 1, seed) * rows),
  ]
}
