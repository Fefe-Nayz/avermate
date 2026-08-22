import {
  widgetContainerProfile,
  widgetRecipeAtWidth,
  widgetRecipeLayout,
  widgetSeriesBudget,
  type WidgetChartRecipe,
  type WidgetContainerProfile,
  type WidgetPresentation,
  type WidgetResultShape,
  type WidgetSeriesDatum,
} from "@avermate/core"

export type WidgetGridColumns = 1 | 2 | 3 | 4

export interface WidgetResponsivePresentation {
  profile: WidgetContainerProfile
  recipe: WidgetChartRecipe
  seriesBudget: number
  preferredAspectRatio: number | null
}

/**
 * The recipe the grid should use when it decides how narrow a card may be.
 *
 * An adaptive card may occupy one column because its renderer can follow the
 * recipe's compact-fallback chain there. A preserving card must still reserve
 * the requested recipe's minimum width. This only changes layout policy: the
 * stored definition remains the source of the analytical question and of the
 * recipe the renderer starts from.
 */
export function widgetRecipeForLayout(
  recipe: WidgetChartRecipe,
  behavior: WidgetPresentation["responsiveBehavior"],
  resultShape: WidgetResultShape
): WidgetChartRecipe {
  return behavior === "adapt"
    ? widgetRecipeAtWidth(recipe, 1, 4, resultShape)
    : recipe
}

const PROFILE_COLUMNS: Readonly<
  Record<
    WidgetContainerProfile,
    { columns: WidgetGridColumns; gridColumns: WidgetGridColumns }
  >
> = {
  micro: { columns: 1, gridColumns: 4 },
  compact: { columns: 1, gridColumns: 4 },
  standard: { columns: 2, gridColumns: 4 },
  wide: { columns: 3, gridColumns: 4 },
  hero: { columns: 4, gridColumns: 4 },
}

function gridColumns(value: number | undefined, fallback: WidgetGridColumns) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(4, Math.max(1, Math.round(value))) as WidgetGridColumns
}

/**
 * Resolve presentation only: the stored definition and its analysis never change.
 *
 * Before the card has a measured width, this deliberately returns the requested recipe.
 * Server render and the first client render therefore agree; the ResizeObserver may adapt
 * the drawing afterwards without turning a presentation choice into a hydration mismatch.
 */
export function resolveWidgetResponsivePresentation({
  recipe,
  behavior,
  resultShape,
  width,
  columns,
  grid,
}: {
  recipe: WidgetChartRecipe
  behavior: WidgetPresentation["responsiveBehavior"]
  resultShape: WidgetResultShape
  width: number | null
  columns?: number
  grid?: number
}): WidgetResponsivePresentation {
  const profile =
    width === null ? "standard" : widgetContainerProfile(Math.max(0, width))
  let renderedRecipe = recipe

  if (width !== null && behavior === "adapt") {
    const inferred = PROFILE_COLUMNS[profile]
    // A physically micro card is one logical column even when CSS has stretched its grid
    // cell. This is the last guard against drawing a recipe with a compatible compact
    // alternative into a postage stamp; wider cards use the grid's real drawn span when
    // the caller has it. Shape-incompatible recipes stay unchanged in core.
    const drawn = gridColumns(
      profile === "micro" ? 1 : columns,
      inferred.columns
    )
    const gridWidth = gridColumns(
      profile === "micro" ? 4 : grid,
      inferred.gridColumns
    )
    renderedRecipe = widgetRecipeAtWidth(
      recipe,
      Math.min(drawn, gridWidth) as WidgetGridColumns,
      gridWidth,
      resultShape
    )
  }

  const layout = widgetRecipeLayout(renderedRecipe)
  return {
    profile,
    recipe: renderedRecipe,
    seriesBudget: widgetSeriesBudget(renderedRecipe, profile),
    preferredAspectRatio: layout.preferredAspectRatio ?? null,
  }
}

/** Largest box of `ratio = width / height` that fits the measured card body. */
export function fitWidgetAspect(
  width: number,
  height: number,
  ratio: number | null
): { width: number; height: number } | null {
  if (
    ratio === null ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }
  const fromWidth = width / ratio
  if (fromWidth <= height) return { width, height: fromWidth }
  return { width: height * ratio, height }
}

/**
 * Spend a recipe's series budget without changing the evaluated result.
 *
 * Series keep their first-seen order, which is the evaluator's stable order. Unseriesed
 * rows remain because they are the primary reading rather than an extra line. The caller
 * says how many named series were left out instead of silently pretending they did not
 * exist.
 */
export function limitWidgetSeries<T extends Pick<WidgetSeriesDatum, "series">>(
  values: readonly T[],
  budget: number
): { values: T[]; hiddenSeries: string[] } {
  const named = [
    ...new Set(
      values.flatMap((value) => (value.series === null ? [] : [value.series]))
    ),
  ]
  const kept = new Set(named.slice(0, Math.max(1, Math.floor(budget))))
  const hiddenSeries = named.filter((series) => !kept.has(series))
  if (hiddenSeries.length === 0) return { values: [...values], hiddenSeries }
  return {
    values: values.filter(
      (value) => value.series === null || kept.has(value.series)
    ),
    hiddenSeries,
  }
}
