import type {
  CollapsePreference,
  CollapseStrategy,
  LayoutNode,
  ResponsiveBreadcrumbProps,
} from "./types"

type Range = { a: number; b: number }
type Grouping = NonNullable<ResponsiveBreadcrumbProps["grouping"]>

export interface SolveBreadcrumbLayoutInput {
  availableWidth: number
  itemWidths: number[]
  separatorWidths: number[]
  ellipsisWidth: number
  nextArrowWidth: number
  titleOnlyWidth?: number
  gapWidth?: number
  includeNextArrow?: boolean
  options: {
    strategy: CollapseStrategy
    preference: CollapsePreference
    canCollapse: boolean[]
    forcedCollapsed?: boolean[]
    itemPriority?: number[]
    alwaysShowHead: number
    alwaysShowTail: number
    allowTitleOnly: boolean
    allowMultipleEllipses?: boolean
    grouping?: Grouping
  }
}

export function getLayoutRange(nodes: LayoutNode[]): Range | null {
  return getLayoutRanges(nodes)[0] ?? null
}

export function getLayoutRanges(nodes: LayoutNode[]): Range[] {
  return nodes
    .filter((node): node is Extract<LayoutNode, { type: "ellipsis" }> => {
      return node.type === "ellipsis"
    })
    .map((node) => ({ a: node.from, b: node.to }))
}

export function getLayoutWidth(nodes: LayoutNode[], gapWidth = 0) {
  if (nodes.length === 0) {
    return 0
  }

  return (
    nodes.reduce((sum, node) => sum + node.width, 0) +
    Math.max(0, nodes.length - 1) * gapWidth
  )
}

export function solveBreadcrumbLayout({
  availableWidth,
  itemWidths,
  separatorWidths,
  ellipsisWidth,
  nextArrowWidth,
  titleOnlyWidth = 0,
  gapWidth = 0,
  includeNextArrow = false,
  options,
}: SolveBreadcrumbLayoutInput): LayoutNode[] {
  const count = itemWidths.length

  if (count === 0) {
    return []
  }

  const normalizedAvailableWidth = Number.isFinite(availableWidth)
    ? Math.max(0, availableWidth)
    : 0
  const alwaysShowHead = clampInteger(options.alwaysShowHead, 0, count)
  const alwaysShowTail = clampInteger(options.alwaysShowTail, 0, count)
  const canCollapse = normalizeCanCollapse(
    options.canCollapse,
    options.forcedCollapsed,
    alwaysShowHead,
    alwaysShowTail,
    count
  )
  const fullLayout = buildNodes({
    count,
    itemWidths,
    separatorWidths,
    ellipsisWidth,
    nextArrowWidth,
    includeNextArrow,
    collapsedRanges: [],
  })
  const fullLayoutWidth = getLayoutWidth(fullLayout, gapWidth)
  const forcedIndices = getForcedIndices(options.forcedCollapsed)
  const allowMultipleEllipses =
    options.allowMultipleEllipses === true && options.grouping !== "contiguous"
  const grouping = options.grouping ?? "contiguous"

  if (
    options.strategy === "none" &&
    forcedIndices.length === 0 &&
    fullLayoutWidth > normalizedAvailableWidth
  ) {
    return options.allowTitleOnly
      ? [{ type: "title-only", width: titleOnlyWidth }]
      : fullLayout
  }

  if (
    forcedIndices.length === 0 &&
    fullLayoutWidth <= normalizedAvailableWidth
  ) {
    return fullLayout
  }

  const candidates = allowMultipleEllipses
    ? getMultiRangeCandidates({
        count,
        canCollapse,
        forcedIndices,
        grouping,
      })
    : getSingleRangeCandidates({
        count,
        canCollapse,
        forcedRange: getForcedRange(options.forcedCollapsed),
      })

  const fittingCandidates = candidates
    .map((ranges) => {
      const nodes = buildNodes({
        count,
        itemWidths,
        separatorWidths,
        ellipsisWidth,
        nextArrowWidth,
        includeNextArrow,
        collapsedRanges: ranges,
      })

      return {
        ranges,
        nodes,
        width: getLayoutWidth(nodes, gapWidth),
        collapsedCount: getCollapsedCount(ranges),
        collapsedWidth: getCollapsedWidth(ranges, itemWidths, separatorWidths),
        priority: getCollapsedPriority(ranges, options.itemPriority),
        strategyScore: getStrategyScore(ranges, count, options.strategy),
        ellipsisCount: ranges.length,
      }
    })
    .filter((candidate) => candidate.width <= normalizedAvailableWidth)

  if (fittingCandidates.length > 0) {
    fittingCandidates.sort((left, right) =>
      compareCandidates(left, right, options.preference, grouping)
    )
    return fittingCandidates[0].nodes
  }

  if (options.allowTitleOnly) {
    return [{ type: "title-only", width: titleOnlyWidth }]
  }

  const smallestCandidate = candidates
    .map((ranges) =>
      buildNodes({
        count,
        itemWidths,
        separatorWidths,
        ellipsisWidth,
        nextArrowWidth,
        includeNextArrow,
        collapsedRanges: ranges,
      })
    )
    .sort(
      (left, right) =>
        getLayoutWidth(left, gapWidth) - getLayoutWidth(right, gapWidth)
    )[0]

  return smallestCandidate ?? fullLayout
}

function buildNodes({
  count,
  itemWidths,
  separatorWidths,
  ellipsisWidth,
  nextArrowWidth,
  includeNextArrow,
  collapsedRanges,
}: {
  count: number
  itemWidths: number[]
  separatorWidths: number[]
  ellipsisWidth: number
  nextArrowWidth: number
  includeNextArrow: boolean
  collapsedRanges: Range[]
}): LayoutNode[] {
  const normalizedRanges = normalizeRanges(collapsedRanges)
  const tokens: Array<
    { type: "item"; index: number } | { type: "ellipsis"; range: Range }
  > = []

  for (let index = 0; index < count; index += 1) {
    const range = normalizedRanges.find((candidate) => candidate.a === index)

    if (range) {
      tokens.push({ type: "ellipsis", range })
      index = range.b
      continue
    }

    tokens.push({ type: "item", index })
  }

  const nodes: LayoutNode[] = []

  tokens.forEach((token, tokenIndex) => {
    if (token.type === "item") {
      nodes.push({
        type: "item",
        index: token.index,
        width: itemWidths[token.index] ?? 0,
      })
    } else {
      nodes.push({
        type: "ellipsis",
        from: token.range.a,
        to: token.range.b,
        width: ellipsisWidth,
      })
    }

    const nextToken = tokens[tokenIndex + 1]
    if (!nextToken) {
      return
    }

    const separatorAfter = getSeparatorAfter(token, nextToken)
    nodes.push({
      type: "separator",
      after: separatorAfter,
      width: separatorWidths[separatorAfter] ?? 0,
    })
  })

  if (includeNextArrow) {
    nodes.push({ type: "next", width: nextArrowWidth })
  }

  return nodes
}

function getSeparatorAfter(
  current: { type: "item"; index: number } | { type: "ellipsis"; range: Range },
  next: { type: "item"; index: number } | { type: "ellipsis"; range: Range }
) {
  if (current.type === "item") {
    return current.index
  }

  if (next.type === "item") {
    return current.range.b
  }

  return current.range.b
}

function normalizeCanCollapse(
  source: boolean[],
  forcedCollapsed: boolean[] | undefined,
  alwaysShowHead: number,
  alwaysShowTail: number,
  count: number
) {
  return Array.from({ length: count }, (_, index) => {
    const forced = forcedCollapsed?.[index] === true
    const pinnedByHead = index < alwaysShowHead
    const pinnedByTail = index >= count - alwaysShowTail

    if (pinnedByHead || pinnedByTail) {
      return false
    }

    return forced || source[index] !== false
  })
}

function getForcedIndices(forcedCollapsed?: boolean[]) {
  if (!forcedCollapsed) {
    return []
  }

  return forcedCollapsed
    .map((forced, index) => (forced ? index : -1))
    .filter((index) => index >= 0)
}

function getForcedRange(forcedCollapsed?: boolean[]): Range | null {
  const forcedIndices = getForcedIndices(forcedCollapsed)

  if (forcedIndices.length === 0) {
    return null
  }

  return {
    a: Math.min(...forcedIndices),
    b: Math.max(...forcedIndices),
  }
}

function getSingleRangeCandidates({
  count,
  canCollapse,
  forcedRange,
}: {
  count: number
  canCollapse: boolean[]
  forcedRange: Range | null
}) {
  const ranges: Range[][] = []

  for (let a = 0; a < count; a += 1) {
    for (let b = a; b < count; b += 1) {
      const range = { a, b }

      if (forcedRange && (range.a > forcedRange.a || range.b < forcedRange.b)) {
        continue
      }

      if (isRangeCollapsible(range, canCollapse)) {
        ranges.push([range])
      }
    }
  }

  return ranges
}

function getMultiRangeCandidates({
  count,
  canCollapse,
  forcedIndices,
  grouping,
}: {
  count: number
  canCollapse: boolean[]
  forcedIndices: number[]
  grouping: Grouping
}) {
  const collapsibleIndices = Array.from(
    { length: count },
    (_, index) => index
  ).filter((index) => canCollapse[index])
  const forcedSet = new Set(forcedIndices)

  if (
    collapsibleIndices.some(
      (index) => forcedSet.has(index) && !canCollapse[index]
    )
  ) {
    return []
  }

  if (collapsibleIndices.length > 16) {
    return getGreedyMultiRangeCandidates({
      collapsibleIndices,
      forcedSet,
      grouping,
    })
  }

  const candidates: Range[][] = []
  const totalMasks = 1 << collapsibleIndices.length

  for (let mask = 1; mask < totalMasks; mask += 1) {
    const collapsed = collapsibleIndices.filter((_, bit) => {
      return (mask & (1 << bit)) !== 0
    })

    if (!containsForced(collapsed, forcedSet)) {
      continue
    }

    const ranges = indicesToRanges(collapsed)
    if (
      grouping === "smart" &&
      ranges.length > Math.max(1, collapsed.length - 1)
    ) {
      continue
    }

    candidates.push(ranges)
  }

  return candidates
}

function getGreedyMultiRangeCandidates({
  collapsibleIndices,
  forcedSet,
  grouping,
}: {
  collapsibleIndices: number[]
  forcedSet: Set<number>
  grouping: Grouping
}) {
  const seed = collapsibleIndices.filter((index) => forcedSet.has(index))
  const candidates: Range[][] = []
  const ordered =
    grouping === "smart"
      ? [...collapsibleIndices].sort(
          (a, b) =>
            Math.abs(a - median(collapsibleIndices)) -
            Math.abs(b - median(collapsibleIndices))
        )
      : collapsibleIndices

  let current = [...seed]
  for (const index of ordered) {
    if (!current.includes(index)) {
      current = [...current, index].sort((a, b) => a - b)
    }
    candidates.push(indicesToRanges(current))
  }

  return candidates
}

function containsForced(collapsed: number[], forcedSet: Set<number>) {
  for (const index of forcedSet) {
    if (!collapsed.includes(index)) {
      return false
    }
  }

  return true
}

function indicesToRanges(indices: number[]) {
  const sorted = [...indices].sort((a, b) => a - b)
  const ranges: Range[] = []

  for (const index of sorted) {
    const last = ranges.at(-1)
    if (last && last.b + 1 === index) {
      last.b = index
    } else {
      ranges.push({ a: index, b: index })
    }
  }

  return ranges
}

function isRangeCollapsible(range: Range, canCollapse: boolean[]) {
  for (let index = range.a; index <= range.b; index += 1) {
    if (!canCollapse[index]) {
      return false
    }
  }

  return true
}

function getCollapsedCount(ranges: Range[]) {
  return ranges.reduce((sum, range) => sum + range.b - range.a + 1, 0)
}

function getCollapsedWidth(
  ranges: Range[],
  itemWidths: number[],
  separatorWidths: number[]
) {
  return ranges.reduce((sum, range) => {
    let width = 0

    for (let index = range.a; index <= range.b; index += 1) {
      width += itemWidths[index] ?? 0
      if (index < range.b) {
        width += separatorWidths[index] ?? 0
      }
    }

    return sum + width
  }, 0)
}

function getCollapsedPriority(ranges: Range[], priorities?: number[]) {
  if (!priorities) {
    return 0
  }

  return ranges.reduce((sum, range) => {
    let priority = 0
    for (let index = range.a; index <= range.b; index += 1) {
      priority += priorities[index] ?? 0
    }

    return sum + priority
  }, 0)
}

function getStrategyScore(
  ranges: Range[],
  count: number,
  strategy: CollapseStrategy
) {
  const first = ranges[0]
  const last = ranges.at(-1)

  if (!first || !last) {
    return 0
  }

  if (strategy === "start") {
    return first.a
  }

  if (strategy === "end") {
    return count - 1 - last.b
  }

  if (strategy === "center") {
    const collapsedCenter = (first.a + last.b) / 2
    return Math.abs(collapsedCenter - (count - 1) / 2)
  }

  return 0
}

function compareCandidates(
  left: {
    collapsedCount: number
    collapsedWidth: number
    priority: number
    strategyScore: number
    ranges: Range[]
    width: number
    ellipsisCount: number
  },
  right: {
    collapsedCount: number
    collapsedWidth: number
    priority: number
    strategyScore: number
    ranges: Range[]
    width: number
    ellipsisCount: number
  },
  preference: CollapsePreference,
  grouping: Grouping
) {
  const ellipsisComparison =
    grouping === "smart" ? left.ellipsisCount - right.ellipsisCount : 0

  if (left.priority !== right.priority) {
    return left.priority - right.priority
  }

  if (preference === "minimize-visibility") {
    return (
      left.collapsedWidth - right.collapsedWidth ||
      left.collapsedCount - right.collapsedCount ||
      ellipsisComparison ||
      left.strategyScore - right.strategyScore ||
      left.ranges[0].a - right.ranges[0].a ||
      right.width - left.width
    )
  }

  if (preference === "minimize-count") {
    return (
      left.collapsedCount - right.collapsedCount ||
      ellipsisComparison ||
      left.strategyScore - right.strategyScore ||
      left.collapsedWidth - right.collapsedWidth ||
      left.ranges[0].a - right.ranges[0].a ||
      right.width - left.width
    )
  }

  return (
    ellipsisComparison ||
    left.strategyScore - right.strategyScore ||
    left.collapsedCount - right.collapsedCount ||
    left.collapsedWidth - right.collapsedWidth ||
    left.ranges[0].a - right.ranges[0].a ||
    right.width - left.width
  )
}

function normalizeRanges(ranges: Range[]) {
  const sorted = [...ranges].sort((left, right) => left.a - right.a)
  const normalized: Range[] = []

  for (const range of sorted) {
    if (range.b < range.a) {
      continue
    }

    const last = normalized.at(-1)
    if (last && last.b + 1 >= range.a) {
      last.b = Math.max(last.b, range.b)
    } else {
      normalized.push({ ...range })
    }
  }

  return normalized
}

function median(values: number[]) {
  return values[Math.floor(values.length / 2)] ?? 0
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(max, Math.max(min, Math.floor(value)))
}
