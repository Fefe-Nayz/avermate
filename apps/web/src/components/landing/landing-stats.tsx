import { useFormatter, useExtracted } from "next-intl"
import { getPublicStats } from "@/lib/public-data"

type PublicStats = Awaited<ReturnType<typeof getPublicStats>>

function LandingStatsValues({ data }: { data: PublicStats }) {
  const t = useExtracted()
  const format = useFormatter()

  const entries = [
    { label: t("students"), value: data.users },
    { label: t("subjects tracked"), value: data.subjects },
    { label: t("grades recorded"), value: data.grades },
  ]

  return (
    <dl className="flex flex-wrap justify-center gap-x-8 gap-y-3 pt-4">
      {entries.map((entry) => (
        <div key={entry.label} className="text-center">
          <dt className="numeric text-xl font-semibold">
            {format.number(entry.value, { notation: "compact" })}
          </dt>
          <dd className="text-xs text-muted-foreground">{entry.label}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Cached server-rendered counters. Aggregates only — no row reaches the client. */
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
  return <LandingStatsValues data={data} />
}
