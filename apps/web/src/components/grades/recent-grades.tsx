"use client"

import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { GradeList } from "@/components/grades/grade-list"
import { useYear } from "@/components/year/year-provider"

/** The last few results, newest first — the app's most-checked list. */
export function RecentGrades({ limit = 6 }: { limit?: number }) {
  const t = useExtracted()
  const { graph } = useYear()

  const grades = graph.allGrades().slice(-limit).reverse()
  if (grades.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("Latest results")}</h2>
        <Link
          href="/grades"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("See all")}
          <ArrowRightIcon className="size-3" />
        </Link>
      </div>

      <GradeList grades={grades} />
    </section>
  )
}
