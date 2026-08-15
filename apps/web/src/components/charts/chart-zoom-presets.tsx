"use client"

import { useCallback, useMemo, useState } from "react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { haptic } from "@/lib/haptics"
import type { NumericDomain } from "./time-series-interaction"

const DAY_IN_MS = 86_400_000

export interface ViewportPresetControl {
  /** Imperative jump the chart applies once per stamp. */
  request: { domain: NumericDomain; stamp: number } | null
  /** The chart reports every viewport move back here. */
  onViewportChange: (viewport: NumericDomain) => void
  viewport: NumericDomain
  select: (days: number | null) => void
}

function closeEnough(left: NumericDomain, right: NumericDomain) {
  const extent = Math.max(Math.abs(right[1] - right[0]), 1)
  return (
    Math.abs(left[0] - right[0]) <= extent * 1e-6 &&
    Math.abs(left[1] - right[1]) <= extent * 1e-6
  )
}

function presetDomain(
  domain: NumericDomain,
  days: number | null
): NumericDomain {
  if (days === null) return domain
  const start = Math.max(domain[0], domain[1] - days * DAY_IN_MS)
  return start <= domain[0] ? domain : [start, domain[1]]
}

/**
 * Named zoom windows over a chart that stays freely zoomable: the presets
 * jump, the wheel and the fingers refine, and whichever preset matches the
 * live viewport lights up — including after a manual gesture lands on one.
 */
export function useViewportPresets(
  domain: NumericDomain
): ViewportPresetControl {
  const [request, setRequest] = useState<ViewportPresetControl["request"]>(null)
  const [viewport, setViewport] = useState<NumericDomain>(domain)

  const select = useCallback(
    (days: number | null) => {
      haptic("selection")
      setRequest((current) => ({
        domain: presetDomain(domain, days),
        stamp: (current?.stamp ?? 0) + 1,
      }))
    },
    [domain]
  )

  return useMemo(
    () => ({ request, onViewportChange: setViewport, viewport, select }),
    [request, select, viewport]
  )
}

export function ZoomPresetGroup({
  control,
  domain,
}: {
  control: ViewportPresetControl
  domain: NumericDomain
}) {
  const t = useExtracted()
  const spanDays = (domain[1] - domain[0]) / DAY_IN_MS
  const presets: { id: string; label: string; days: number | null }[] = [
    { id: "all", label: t("All"), days: null },
    { id: "90", label: t("3 months"), days: 90 },
    { id: "30", label: t("30 days"), days: 30 },
    { id: "7", label: t("7 days"), days: 7 },
  ].filter((preset) => preset.days === null || preset.days < spanDays)

  if (presets.length < 2) return null

  return (
    <ButtonGroup aria-label={t("Zoom window")}>
      {presets.map((preset) => {
        const active = closeEnough(
          control.viewport,
          presetDomain(domain, preset.days)
        )
        return (
          <Button
            aria-pressed={active}
            key={preset.id}
            onClick={() => control.select(preset.days)}
            size="sm"
            type="button"
            variant={active ? "secondary" : "ghost"}
          >
            {preset.label}
          </Button>
        )
      })}
    </ButtonGroup>
  )
}
