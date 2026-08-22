import type * as React from "react"

export type CollapseStrategy = "center" | "start" | "end" | "none"
export type CollapsePreference =
  "minimize-count" | "minimize-visibility" | "none"

export type MeasurementMode = "visible" | "measure" | "menu"
export type BreadcrumbFocusRing = "inset" | "outer" | "clip-margin" | "none"

export interface BreadcrumbData {
  key: string
  label: React.ReactNode
  href?: string
  clickable?: boolean
  disabled?: boolean
  canCollapse?: boolean
  canTruncate?: boolean
  icon?: React.ReactNode
  /**
   * Visible custom content for the item. Prefer renderItem for new code so the
   * component can render a lighter measurement variant when needed.
   */
  customElement?: React.ReactNode
  /**
   * Optional lightweight content used only by the hidden measurement tree when
   * customElement is too expensive or has side effects.
   */
  measureElement?: React.ReactNode
}

export interface SeparatorNavItem {
  key: string
  label: React.ReactNode
  href?: string
  icon?: React.ReactNode
  clickable?: boolean
  disabled?: boolean
}

export interface BreadcrumbDebugState {
  containerWidth: number
  availableWidth: number
  usedWidth: number
  remainingSpace: number
  itemWidths: number[]
  separatorWidths: number[]
  ellipsisWidth: number
  nextArrowWidth: number
  titleOnlyWidth: number
  gap: number
  collapsedRange: { a: number; b: number } | null
  collapsedGroups?: { a: number; b: number }[]
  showTitleOnly: boolean
  strategy: CollapseStrategy
  preference: CollapsePreference
  totalItemsCount: number
  visibleItemsCount: number
  collapsedItemsCount: number
  measurementLocked: boolean
  truncatedItems: Record<number, number>
  truncationEnabled: boolean
}

export type LayoutNode =
  | { type: "item"; index: number; width: number }
  | { type: "separator"; after: number; width: number }
  | { type: "ellipsis"; from: number; to: number; width: number }
  | { type: "next"; width: number }
  | { type: "title-only"; width: number }

export interface BreadcrumbMeasurements {
  containerWidth: number
  itemWidths: number[]
  separatorWidths: number[]
  ellipsisWidth: number
  nextArrowWidth: number
  titleOnlyWidth: number
  gap: number
  ready: boolean
  signature: string
}

export type ResponsiveBreadcrumbLabel<TArgs extends unknown[] = []> =
  string | ((...args: TArgs) => string)

export interface ResponsiveBreadcrumbStrings {
  navigateTo: ResponsiveBreadcrumbLabel<[label: string]>
  showCollapsedItems: ResponsiveBreadcrumbLabel<[count: number]>
  moreOptions: ResponsiveBreadcrumbLabel
  nextItems: ResponsiveBreadcrumbLabel
  showSiblingItems: ResponsiveBreadcrumbLabel<[label: string]>
  noItemsAvailable: ResponsiveBreadcrumbLabel
  itemLabelFallback: ResponsiveBreadcrumbLabel
  truncatedItemTooltip: ResponsiveBreadcrumbLabel<[label: string]>
  measureEllipsis: ResponsiveBreadcrumbLabel
  measureNextItems: ResponsiveBreadcrumbLabel
}

export interface ResponsiveBreadcrumbProps {
  /** Ordered breadcrumb items from root to current page. */
  items: BreadcrumbData[]
  /** Custom separator renderer. Keep its DOM close to the visible separator width. */
  renderSeparator?: (prevKey: string, nextKey: string) => React.ReactNode
  /** Item render prop used for visible and measurement contexts. */
  renderItem?: (ctx: {
    item: BreadcrumbData
    index: number
    mode: MeasurementMode
    current: boolean
  }) => React.ReactNode
  /** Ellipsis trigger render prop. */
  renderEllipsis?: (ctx: {
    hiddenItems: BreadcrumbData[]
    mode: MeasurementMode
  }) => React.ReactNode
  /** Title-only fallback render prop. */
  renderTitleOnly?: (ctx: {
    item: BreadcrumbData | undefined
    fallback: React.ReactNode
    mode: MeasurementMode
  }) => React.ReactNode
  /** Menu item renderer for collapsed, separator, and next-item overlays. */
  renderMenuItem?: (ctx: {
    item: BreadcrumbData | SeparatorNavItem
    mode: "menu"
    disabled: boolean
  }) => React.ReactNode
  /** Link wrapper renderer for framework routers. */
  renderItemLink?: (ctx: {
    item: BreadcrumbData
    index: number
    mode: MeasurementMode
    current: boolean
    href: string
    children: React.ReactNode
    onClick: () => void
    ariaDisabled?: boolean
    itemProp?: string
  }) => React.ReactElement
  /** Menu link wrapper renderer for collapsed and separator navigation menus. */
  renderMenuLink?: (ctx: {
    item: BreadcrumbData | SeparatorNavItem
    mode: MeasurementMode
    href: string
    children: React.ReactNode
    ariaLabel: string
    onClick: () => void
  }) => React.ReactElement
  /** Where the collapsed range should be biased when several layouts fit. */
  strategy?: CollapseStrategy
  /** Tie-breaker for fitting layouts. */
  preference?: CollapsePreference
  showHomeIcon?: boolean
  showNextArrow?: boolean
  nextItems?: SeparatorNavItem[]
  /** Navigation menus keyed by next item key, previous:next pair, or separatorNavSide key. */
  separatorNavItems?: Record<string, SeparatorNavItem[]>
  onItemClick?: (item: BreadcrumbData | SeparatorNavItem) => void
  className?: string
  /** Fallback content when the breadcrumb cannot fit even after collapse. */
  titleOnlyFallback?: React.ReactNode
  titleOnlyIcon?: React.ReactNode
  titleOnlyCustomElement?: React.ReactNode
  debug?: boolean
  onDebugStateChange?: (state: BreadcrumbDebugState) => void
  /** Allows long labels to shrink before the final title-only fallback. */
  enableTruncation?: boolean
  truncateMinWidth?: number
  truncateMaxWidth?: number
  truncateThreshold?: number
  truncateOrder?: "biggest-first" | "smallest-first"
  showTooltipOnTruncate?: boolean
  /** Enables separated collapsed groups. Prefer false unless fixed middle items require it. */
  allowMultipleEllipses?: boolean
  grouping?: "contiguous" | "free" | "smart"
  showCurrentInNav?: "never" | "with-others" | "always"
  loadingFallback?: "title" | "custom" | "none"
  customLoadingFallback?: React.ReactNode
  customEllipsisElement?: React.ReactNode
  isLoading?: boolean
  /** Freezes measurement while popovers/drawers are open to avoid mobile animation jitter. */
  lockOnOverlayOpen?: boolean
  /** Collapse by default, or render all items with native scroll/wrap behavior. */
  overflowBehavior?: "collapse" | "scroll" | "wrap"
  /** Focus ring style for breadcrumb focusable elements. Defaults to inset in collapse mode. */
  focusRing?: BreadcrumbFocusRing
  /** Forces title-only rendering at or below this measured container width. */
  fallbackAtWidth?: number
  lastItemClickable?: boolean
  schema?: "json-ld" | "microdata" | "none"
  showCollapsedCount?: boolean
  /** Localized visible text and aria labels. */
  strings?: Partial<ResponsiveBreadcrumbStrings>
  /** Allows the separator directly before an ellipsis to open its navigation menu. */
  clickableLeftOfEllipsis?: boolean
  /** Binds interactive separator menus to the item on the right or left side. */
  separatorNavSide?: "right" | "left"
  /** Pre-collapses matching items, then lets the solver collapse more if needed. */
  forceCollapse?: (item: BreadcrumbData, index: number) => boolean
  /** Lower values collapse earlier when multiple fitting layouts are possible. */
  itemPriority?: (item: BreadcrumbData, index: number) => number
  direction?: "ltr" | "rtl" | "auto"
  /** Pins a number of items at the head and tail. Defaults to one each. */
  alwaysShow?: { head?: number; tail?: number }
}
