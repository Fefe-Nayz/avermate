"use client"

import Link from "next/link"
import type { Impact } from "@avermate/core"
import { useExtracted } from "next-intl"
import { AverageValue, DeltaValue } from "@/components/data/value"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface ImpactReading {
  href?: string
  id: string
  impact: Impact
  label: string
}

/** A compact, comparable view of one value's effect on every relevant scope. */
export function ImpactGrid({
  readings,
  title,
}: {
  readings: readonly ImpactReading[]
  title: string
}) {
  const t = useExtracted()
  const available = readings.filter(
    (reading) =>
      reading.impact.withValue !== null || reading.impact.withoutValue !== null
  )
  if (available.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium">{title}</h2>
      <div className="grid grid-cols-2 gap-3 @3xl/main:grid-cols-3">
        {available.map((reading) => {
          const heading = reading.href ? (
            <Link href={reading.href} className="hover:underline">
              {reading.label}
            </Link>
          ) : (
            reading.label
          )
          return (
            <Card key={reading.id} className="gap-1 py-4">
              <CardHeader className="px-4">
                <CardTitle className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {heading}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <DeltaValue
                  delta={reading.impact.delta}
                  className="text-2xl font-semibold"
                />
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  aria-label={t("Average without and with this value")}
                >
                  <AverageValue
                    ratio={reading.impact.withoutValue}
                    animate={false}
                    decimals={2}
                  />
                  {" → "}
                  <AverageValue
                    ratio={reading.impact.withValue}
                    animate={false}
                    decimals={2}
                  />
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
