import { LandingStatsStrip } from "@/components/landing/landing-stats-strip"
import { getPublicStats } from "@/lib/public-data"

type PublicStats = Awaited<ReturnType<typeof getPublicStats>>

/**
 * Cached server-rendered counters. Aggregates only — no row reaches the client,
 * and the strip disappears entirely rather than advertising a near-empty
 * database.
 */
export async function LandingStats() {
  let data: PublicStats
  try {
    data = await getPublicStats()
  } catch (error) {
    // These counters are supporting evidence, not a reason to fail the page.
    console.error("Unable to load public landing statistics", error)
    return null
  }

  if (data.grades < 50) return null

  return (
    <LandingStatsStrip
      users={data.users}
      subjects={data.subjects}
      grades={data.grades}
    />
  )
}
