"use client"

import { EmbeddedDashboardCard } from "@/components/cards/embedded-dashboard-card"
import { FenceFrame, FenceStatus } from "./fence-frame"
import { parseDatacardReference } from "./model"

export function DatacardFence({ source }: { source: string }) {
  const reference = parseDatacardReference(source)
  return (
    <FenceFrame label="Dashboard card">
      {reference.ok ? (
        <EmbeddedDashboardCard cardId={reference.id} />
      ) : (
        <FenceStatus error>{reference.issue}</FenceStatus>
      )}
    </FenceFrame>
  )
}
