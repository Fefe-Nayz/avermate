"use client"

import { useMemo } from "react"
import {
  widgetCapability,
  widgetMeasureId,
  widgetPrimaryMeasure,
  widgetRecipeLayout,
  type WidgetSurface,
} from "@avermate/core"
import { useExtracted } from "next-intl"
import { useMaybeYear } from "@/components/year/year-provider"
import { CardShell, cardSurface } from "./card-shell"
import { resolveWidgetRow } from "./widget-row"
import { useWidgetMessages } from "./use-widget-messages"
import { useWidgetResult } from "./use-widget-result"
import { WidgetBody } from "./widget-view"
import type { DashboardCardRow } from "@/components/year/year-provider"
import type { WidgetGridColumns } from "./widget-responsive"

function EmbeddedCardBody({ row }: { row: DashboardCardRow }) {
  const t = useExtracted()
  const message = useWidgetMessages()
  const { definition } = useMemo(() => resolveWidgetRow(row), [row])
  const surface: WidgetSurface =
    row.surface === "insights" ? "insights" : "overview"
  const result = useWidgetResult(definition, surface)
  const columns = Math.min(4, Math.max(1, row.span)) as WidgetGridColumns
  const defaultTitle = definition
    ? message(
        widgetCapability(
          widgetMeasureId(widgetPrimaryMeasure(definition.analysis))
        ).messageKey
      )
    : t("Unavailable card")

  return (
    <CardShell
      accent={row.accent}
      surface={cardSurface(result)}
      heightTier={
        definition
          ? widgetRecipeLayout(definition.visualization.recipe).minHeightTier
          : "short"
      }
      title={row.title ?? defaultTitle}
    >
      {definition ? (
        <WidgetBody
          definition={definition}
          result={result}
          expanded={surface === "insights"}
          columns={columns}
          gridColumns={4}
        />
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("This card could not be read.")}
        </p>
      )}
    </CardShell>
  )
}

/** A dashboard card resolved strictly from the currently active year's snapshot. */
export function EmbeddedDashboardCard({ cardId }: { cardId: string }) {
  const t = useExtracted()
  const year = useMaybeYear()
  if (!year) {
    return (
      <p role="alert" className="py-6 text-center text-sm text-destructive">
        {t("Dashboard cards are unavailable outside an active year.")}
      </p>
    )
  }
  if (year.isLoading) {
    return (
      <p
        role="status"
        className="py-6 text-center text-sm text-muted-foreground"
      >
        {t("Loading dashboard card…")}
      </p>
    )
  }
  const row = year.cards.find((card) => card.id === cardId)
  if (!row) {
    return (
      <p role="alert" className="py-6 text-center text-sm text-destructive">
        {t("This dashboard card does not exist in the active year.")}
      </p>
    )
  }
  return <EmbeddedCardBody row={row} />
}
