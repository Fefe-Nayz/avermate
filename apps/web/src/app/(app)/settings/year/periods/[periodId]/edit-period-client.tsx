"use client"

import { useExtracted } from "next-intl"
import Link from "next/link"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { PeriodForm } from "@/components/year/period-form"
import { useYear } from "@/components/year/year-provider"

/**
 * The period this route is about, out of the snapshot the app already holds.
 *
 * No fetch of its own: periods arrive with the year, so a form that refetched one would
 * be a second source for something already in hand — and would flash a spinner over
 * data the page beside it is rendering. A period that is not in the snapshot is one
 * that has been deleted, which is a thing to say rather than a thing to load.
 */
export function EditPeriodClient({
  periodId,
  returnTo,
}: {
  periodId: string
  returnTo: string
}) {
  const t = useExtracted()
  const { periods } = useYear()
  const period = periods.find((item) => item.id === periodId)

  if (!period) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Period not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href={returnTo} />}>
          {t("Back")}
        </Button>
      </Empty>
    )
  }

  const day = (value: Date | string) =>
    new Date(value).toISOString().slice(0, 10)

  return (
    <PeriodForm
      mode="edit"
      returnTo={returnTo}
      initial={{
        id: period.id,
        name: period.name,
        startAt: day(period.startAt),
        endAt: day(period.endAt),
        isCumulative: period.isCumulative,
      }}
    />
  )
}
