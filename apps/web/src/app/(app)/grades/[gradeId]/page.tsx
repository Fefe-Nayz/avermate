"use client"

import Link from "next/link"
import { use, useMemo, type ReactNode } from "react"
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import {
  averageEventDates,
  averageOverTime,
  gradeImpact,
  gradeNeighbours,
  gradeRatio,
  gradeStanding,
  gradeWeightShare,
  resolveCustomAverage,
  type Grade,
} from "@avermate/core"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import {
  CoefficientBadge,
  DeltaValue,
  PointsValue,
  ResultBadge,
} from "@/components/data/value"
import { useYear } from "@/components/year/year-provider"
import { ImpactGrid } from "@/components/analytics/impact-grid"
import {
  AVERAGE_SERIES_COLORS,
  MultiSeriesAverageChart,
  type AverageSeries,
} from "@/components/charts/multi-series-average-chart"
import { GradeResultsChart } from "@/components/charts/grade-results-chart"
import { GradeScale } from "@/components/grades/grade-scale"

/**
 * One result, and what it did.
 *
 * The impact figures are the reason this screen exists: a 12/20 means nothing on
 * its own, and everything once you know it pulled the subject down by 0.4 and the
 * year by 0.05.
 *
 * It used to stop there, which left the page answering "what" and "so what" but
 * never the question anybody actually opens it with — *is 14 good?* Three readings
 * answer that, and none of them needs interpreting: where the mark sits on the
 * year's own five bands, where it stands among its peers, and how much of the
 * subject it decides. The rest of the page is the same result seen from further
 * out: the curve it moved, the parts it was made of, and the results either side
 * of it, because a grade is an event in a sequence and a page with no way onward
 * is a dead end.
 */
export default function GradePage({
  params,
}: {
  params: Promise<{ gradeId: string }>
}) {
  const { gradeId } = use(params)
  const t = useExtracted()
  const format = useFormatter()
  const { customAverages, graph, year, period, now, timelineDate, scale } =
    useYear()

  const grade = graph.allGrades().find((item) => item.id === gradeId)
  const subjectId = grade?.subjectId ?? null
  const subject = subjectId ? graph.byId(subjectId) : undefined

  /**
   * The subject's own curve, over exactly the window every other screen uses.
   *
   * Same expression as the subject page's, so the two cannot drift into showing
   * different histories of the same subject.
   */
  const series = useMemo<AverageSeries[]>(() => {
    // Looked up inside rather than taken from above: everything this memo reads
    // has to be something it can be re-run from, and a subject plucked out of a
    // `find` above it is not.
    const found = graph.allGrades().find((item) => item.id === gradeId)
    const target = found ? graph.byId(found.subjectId) : undefined
    if (!year || !target) return []
    const from = new Date(
      Math.max(
        new Date(period.startAt).getTime(),
        new Date(year.startsAt).getTime()
      )
    )
    const timelineEnd = timelineDate
      ? new Date(`${timelineDate}T23:59:59`).getTime()
      : now
    const to = new Date(Math.min(timelineEnd, new Date(period.endAt).getTime()))
    if (to <= from) return []
    return [
      {
        id: target.id,
        label: target.name,
        color: AVERAGE_SERIES_COLORS[0],
        points: averageOverTime(
          graph.subjects,
          averageEventDates(graph.subjects, from, to, target.id),
          target.id
        ),
        primary: true,
      },
    ]
  }, [graph, gradeId, now, period.endAt, period.startAt, timelineDate, year])

  if (!grade) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Grade not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it sits outside this period.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/grades" />}>
          {t("Back to grades")}
        </Button>
      </Empty>
    )
  }

  const ratio = gradeRatio(grade)
  const subjectRatio = subject ? graph.ratio(subject.id) : null
  const generalRatio = graph.ratio(null)
  const inSubject = subject ? gradeStanding(graph, gradeId, subject.id) : null
  const inYear = gradeStanding(graph, gradeId)
  const share = gradeWeightShare(graph, gradeId)
  // The subject and everything under it, which is the field the standing above is
  // measured against — so the cloud and the rank cannot disagree about what "the
  // other results" means.
  const subjectGrades = subject ? graph.allGrades(subject.id) : []
  const neighbours = gradeNeighbours(graph, gradeId)

  const impacts = [
    {
      id: `subject:${grade.subjectId}`,
      label: subject?.name ?? t("Subject"),
      href: subject ? `/subjects/${subject.id}` : undefined,
      impact: gradeImpact(graph, gradeId, grade.subjectId),
    },
    ...graph.ancestorsOf(grade.subjectId).map((ancestor) => ({
      id: `subject:${ancestor.id}`,
      label: ancestor.name,
      href: `/subjects/${ancestor.id}`,
      impact: gradeImpact(graph, gradeId, ancestor.id),
    })),
    {
      id: "general",
      label: t("General average"),
      href: "/averages/general",
      impact: gradeImpact(graph, gradeId, null),
    },
    ...customAverages.flatMap((average) => {
      const resolved = resolveCustomAverage(graph, average)
      if (!resolved.graph.has(grade.subjectId)) return []
      return [
        {
          id: `custom:${average.id}`,
          label: average.name,
          href: `/averages/${average.id}`,
          impact: gradeImpact(resolved.graph, gradeId, null, resolved.scope),
        },
      ]
    }),
  ]

  const markers = [
    ...(subjectRatio !== null && subject
      ? [{ id: "subject", label: subject.name, ratio: subjectRatio }]
      : []),
    ...(generalRatio !== null
      ? [{ id: "general", label: t("General average"), ratio: generalRatio }]
      : []),
  ]

  /**
   * How far the reading moved since the last time this subject was assessed.
   *
   * The one thing the rest of the page never says. The rank compares this result
   * to every other without regard to order; the impact compares it to its own
   * absence. Neither answers "which way am I going", which is the reading a
   * student is actually looking for — and the only one here that is about the
   * sequence rather than about the set.
   *
   * Against the previous *day* rather than the previous element, which is what
   * `gradeNeighbours` already means: two results sat the same morning are
   * companions, and a delta between them describes the paper, not the progress.
   */
  const previousRatio = neighbours.previous
    ? gradeRatio(neighbours.previous)
    : null
  const progress =
    ratio !== null && previousRatio !== null ? ratio - previousRatio : null

  /** The stored coefficient is not a reading; its share of the subject is. */
  const standing: Array<{ id: string; label: string; value: ReactNode }> = [
    ...(inSubject && subject
      ? [
          {
            id: "subject",
            label: subject.name,
            value: t("{rank} of {total}", {
              rank: format.number(inSubject.rank),
              total: format.number(inSubject.total),
            }),
          },
        ]
      : []),
    ...(inYear
      ? [
          {
            id: "year",
            label: t("This year"),
            value: t("{rank} of {total}", {
              rank: format.number(inYear.rank),
              total: format.number(inYear.total),
            }),
          },
        ]
      : []),
    ...(share !== null
      ? [
          {
            id: "share",
            label: t("Of the subject's weight"),
            value: format.number(share, {
              style: "percent",
              maximumFractionDigits: 0,
            }),
          },
        ]
      : []),
    ...(progress !== null && neighbours.previous
      ? [
          {
            id: "progress",
            label: t("Since {name}", { name: neighbours.previous.name }),
            // `DeltaValue`, so it is signed, scaled and coloured the way every
            // other change in the app is — including `±` when it is a draw.
            value: (
              <DeltaValue delta={progress} className="text-lg font-semibold" />
            ),
          },
        ]
      : []),
  ]

  return (
    <>
      <PageMeta title={grade.name} subtitle={subject?.name} />
      <PageActions>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Edit")}
          render={<Link href={`/grades/${gradeId}/edit`} />}
        >
          <PencilIcon className="size-4" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-4">
        <div className="hidden items-center justify-between md:flex">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {grade.name}
            </h1>
            {subject ? (
              <Link
                href={`/subjects/${subject.id}`}
                className="text-sm text-muted-foreground hover:underline"
              >
                {subject.name}
              </Link>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/grades/${gradeId}/edit`} />}
          >
            <PencilIcon className="size-4" />
            {t("Edit")}
          </Button>
        </div>

        {/* The mark, then immediately what it is worth against — one card, because
            a result and its position are one thought. */}
        <Card className="gap-4 py-6">
          <CardContent className="flex flex-col gap-4 px-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <ResultBadge
                ratio={ratio}
                className="px-3 py-1.5 text-3xl"
                animate
                animateFromZero
              />
              {/* The weight, always — and the raw points only when they are not
                  the badge above said a second time. A grade entered out of the
                  year's own scale makes `PointsValue` render the very same
                  numerals as `ResultBadge`, one line apart, which is how "14 / 20"
                  came to be on this card twice. Out of anything else it is a
                  genuine second reading: 29 / 40 is not 14,5 / 20 to look at,
                  and the mark as it was written on the paper is worth keeping.
                  The weight took the opposite treatment: it was hidden at ×1,
                  which is exactly when a reader wonders whether it is missing. */}
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {grade.outOf !== scale ? (
                  <>
                    <PointsValue value={grade.value} outOf={grade.outOf} />
                    <span aria-hidden>·</span>
                  </>
                ) : null}
                {/* Labelled, because `×1,5` on its own is a convention this page
                    has no room to teach — in the lists where the bare badge
                    appears, the row it sits on supplies the meaning. The colon is
                    inside the message so a translator can set it the way their
                    language does; French puts a space before it. */}
                <span>{t("Weight:")}</span>
                <CoefficientBadge coefficient={grade.coefficient} showWhenOne />
              </div>
              <p className="text-xs text-muted-foreground">
                {format.dateTime(grade.passedAt, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>

            {ratio !== null ? (
              <GradeScale ratio={ratio} markers={markers} />
            ) : null}
          </CardContent>
        </Card>

        {/* What it is made of, before anything about what it did.
            A composite grade's parts are not an aside, they are the mark: 14/20
            averaged out of three papers is a different fact from 14/20 on one, and
            a reader who has just looked at the scale above wants that next — not
            after two charts about how the number compares to others. Everything
            below this point interprets the result; this still describes it. */}
        {grade.components.length > 0 ? (
          // The heading sits outside the card, the way "Where it stands" does. It
          // names a section rather than labelling a panel, and a card that carries
          // its own title was the odd one out on this page.
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-medium">
              {t("What it is made of")}
            </h2>
            <Card className="py-4">
              <CardContent className="px-4">
                <ul className="flex flex-col gap-2">
                  {grade.components.map((component) => (
                    <li
                      key={component.id}
                      className="flex items-center gap-3 border-b pb-2 last:border-0 last:pb-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {component.name}
                      </span>
                      <CoefficientBadge coefficient={component.coefficient} />
                      {/* The badge already says the mark on the year's scale, so
                          the points as entered are only worth a column when they
                          are a different reading: a part out of 20 in a year out of
                          20 printed the same numerals twice on one row. Out of
                          anything else — 29 / 40 — they say what was on the paper,
                          which the normalised mark cannot. Same rule as the header
                          above, for the same reason. */}
                      {component.outOf !== scale ? (
                        <span className="numeric w-20 text-right text-xs text-muted-foreground">
                          <PointsValue
                            value={component.value}
                            outOf={component.outOf}
                          />
                        </span>
                      ) : null}
                      <ResultBadge
                        ratio={gradeRatio(component)}
                        showScale={false}
                        className="text-sm"
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {standing.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-medium">{t("Where it stands")}</h2>
            {/* The same tiles the subject page sets its figures in, so a reading
                looks the same wherever the app reports one. */}
            {/* Four across on a wide pane and two-by-two on a narrow one, which
                is why the fourth reading is worth having beyond what it says:
                three tiles left a hole on every phone. */}
            <div className="grid grid-cols-2 gap-3 @2xl/main:grid-cols-4">
              {standing.map((reading) => (
                <div
                  key={reading.id}
                  className="flex flex-col justify-center rounded-xl border bg-card px-3 py-2.5 text-center"
                >
                  <p className="numeric text-lg font-semibold">
                    {reading.value}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
                    {reading.label}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <ImpactGrid readings={impacts} title={t("Impact on averages")} />

        {/* Two charts, because they answer different questions and the page is
            about one result. The curve says what this did to where the reader
            stands — so the day is ruled, and the step the line takes across it is
            the answer. The cloud says how it compares to the reader's other
            results — so the mark is haloed among them, and the counting of dots
            above and below is left to the eye rather than to a second rule
            competing with the passing mark. Both are the same pair the subject
            page carries, which is why neither needs explaining here. */}
        {series[0] && series[0].points.length > 1 ? (
          <MultiSeriesAverageChart
            title={t("The subject around it")}
            series={series}
            height={260}
            moment={grade.passedAt}
            emptyHint={t("Record a few grades and the curve will appear here.")}
          />
        ) : null}

        {subject && subjectGrades.length > 1 ? (
          <GradeResultsChart
            grades={subjectGrades}
            subjects={graph.subjects}
            title={t("Against the other results")}
            height={240}
            highlight={gradeId}
          />
        ) : null}

        {grade.note ? (
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">{t("Note")}</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {grade.note}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {neighbours.sameDay.length > 0 ? (
          <Card className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-medium">
                {t("Also that day")}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="flex flex-col gap-2">
                {neighbours.sameDay.map((other) => (
                  <li key={other.id}>
                    <Link
                      href={`/grades/${other.id}`}
                      className="flex items-center gap-3 rounded-md py-1 hover:underline"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {other.name}
                      </span>
                      <ResultBadge
                        ratio={gradeRatio(other)}
                        showScale={false}
                        className="text-sm"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {neighbours.previous || neighbours.next ? (
          // A result is one of a sequence, and the sequence is the story. Ending
          // the page on a dead end made every reading above it feel like a
          // one-off.
          <nav className="grid gap-3 @xl/main:grid-cols-2">
            <NeighbourLink
              grade={neighbours.previous}
              direction="previous"
              label={t("Previous in {subject}", {
                subject: subject?.name ?? "",
              })}
              scale={scale}
            />
            <NeighbourLink
              grade={neighbours.next}
              direction="next"
              label={t("Next in {subject}", { subject: subject?.name ?? "" })}
              scale={scale}
            />
          </nav>
        ) : null}
      </div>
    </>
  )
}

function NeighbourLink({
  grade,
  direction,
  label,
}: {
  grade: Grade | null
  direction: "previous" | "next"
  label: string
  /** Unused, but kept in the signature so both cells align on one call shape. */
  scale?: number
}) {
  // An empty cell rather than nothing: the pair keeps its grid, so "there is no
  // next one" reads as the end of the sequence instead of a missing element.
  if (!grade) return <span aria-hidden className="hidden @xl/main:block" />
  const next = direction === "next"
  return (
    <Link
      href={`/grades/${grade.id}`}
      className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:bg-accent"
    >
      {next ? null : (
        <ChevronLeftIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
      <span className={next ? "min-w-0 flex-1 text-right" : "min-w-0 flex-1"}>
        <span className="block truncate text-[11px] text-muted-foreground">
          {label}
        </span>
        <span className="block truncate text-sm font-medium">{grade.name}</span>
      </span>
      <ResultBadge
        ratio={gradeRatio(grade)}
        showScale={false}
        className="shrink-0 text-sm"
      />
      {next ? (
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : null}
    </Link>
  )
}
