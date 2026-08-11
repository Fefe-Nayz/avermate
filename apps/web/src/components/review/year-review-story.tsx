"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { useMutation } from "@tanstack/react-query"
import confetti from "canvas-confetti"
import {
  ActivityIcon,
  AwardIcon,
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FlameIcon,
  PauseIcon,
  PlayIcon,
  Share2Icon,
  SparklesIcon,
  TrendingUpIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  ZapIcon,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import {
  heatmapDays,
  type AwardKind,
  type Year,
  type YearReview,
} from "@avermate/core"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useYear } from "@/components/year/year-provider"
import { usePreferences } from "@/hooks/use-preferences"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"

const DEFAULT_SLIDE_MS = 5_800
const STORY_MUSIC_URL = "/recap-music.mp3"

type AwardCopy = Record<
  AwardKind,
  { title: string; body: string; symbol: string }
>

type StorySlide = {
  duration?: number
  key: string
  node: ReactNode
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function monthDate(value: string): Date {
  const [year, month] = value.split("-").map(Number)
  return new Date(year || 2000, Math.max(0, (month || 1) - 1), 12)
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(/\s+/)
  let line = ""
  let cursor = y
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, cursor)
      line = word
      cursor += lineHeight
    } else {
      line = candidate
    }
  }
  if (line) context.fillText(line, x, cursor)
  return cursor
}

async function recapPng(input: {
  award: string
  average: string
  averageLabel: string
  brand: string
  gradeCount: number
  gradesLabel: string
  heatmap: Array<{ count: number; date: string }>
  percentile: string
  percentileLabel: string
  streak: number
  streakLabel: string
  subjects: string[]
  subjectsLabel: string
  title: string
  userName: string
  year: string
}): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = 1_080
  canvas.height = 1_920
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas is unavailable")

  const background = context.createLinearGradient(0, 0, 1_080, 1_920)
  background.addColorStop(0, "#0b1020")
  background.addColorStop(0.46, "#251252")
  background.addColorStop(1, "#071824")
  context.fillStyle = background
  context.fillRect(0, 0, 1_080, 1_920)

  const glow = context.createRadialGradient(810, 260, 20, 810, 260, 620)
  glow.addColorStop(0, "rgba(139,92,246,.55)")
  glow.addColorStop(1, "rgba(139,92,246,0)")
  context.fillStyle = glow
  context.fillRect(0, 0, 1_080, 900)

  context.textAlign = "left"
  context.fillStyle = "rgba(255,255,255,.68)"
  context.font = "600 30px Inter, system-ui, sans-serif"
  context.fillText(input.brand.toUpperCase(), 90, 118)
  context.textAlign = "right"
  context.fillText(input.year.toUpperCase(), 990, 118)

  context.textAlign = "left"
  context.fillStyle = "#ffffff"
  context.font = "750 76px Inter, system-ui, sans-serif"
  wrapCanvasText(context, input.title, 90, 260, 900, 88)
  context.fillStyle = "rgba(255,255,255,.72)"
  context.font = "500 34px Inter, system-ui, sans-serif"
  context.fillText(input.userName, 90, 390)

  context.fillStyle = "rgba(255,255,255,.09)"
  context.beginPath()
  context.roundRect(70, 470, 940, 510, 42)
  context.fill()

  const cards = [
    [input.averageLabel, input.average],
    [input.gradesLabel, String(input.gradeCount)],
    [input.streakLabel, String(input.streak)],
    [input.percentileLabel, input.percentile],
  ] as const
  cards.forEach(([label, value], index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = 120 + column * 455
    const y = 570 + row * 210
    context.fillStyle = "rgba(255,255,255,.58)"
    context.font = "550 27px Inter, system-ui, sans-serif"
    context.fillText(label, x, y)
    context.fillStyle = "#ffffff"
    context.font = "760 65px Inter, system-ui, sans-serif"
    context.fillText(value, x, y + 78)
  })

  context.fillStyle = "rgba(255,255,255,.55)"
  context.font = "550 27px Inter, system-ui, sans-serif"
  context.fillText(input.subjectsLabel, 90, 1_100)
  context.fillStyle = "#ffffff"
  context.font = "680 38px Inter, system-ui, sans-serif"
  wrapCanvasText(
    context,
    input.subjects.join("  ·  ") || "—",
    90,
    1_165,
    900,
    50
  )

  context.fillStyle = "rgba(255,255,255,.08)"
  context.beginPath()
  context.roundRect(70, 1_325, 940, 260, 42)
  context.fill()
  const days = input.heatmap.slice(-140)
  const columns = 20
  const gap = 9
  const cell = 34
  const startX = 116
  const startY = 1_370
  days.forEach((day, index) => {
    const x = startX + Math.floor(index / 7) * (cell + gap)
    const y = startY + (index % 7) * (cell + gap)
    const alpha = day.count === 0 ? 0.11 : Math.min(0.35 + day.count * 0.2, 1)
    context.fillStyle = `rgba(255,255,255,${alpha})`
    context.beginPath()
    context.roundRect(x, y, cell, cell, 7)
    context.fill()
  })
  void columns

  context.textAlign = "center"
  context.fillStyle = "#ffffff"
  context.font = "760 54px Inter, system-ui, sans-serif"
  context.fillText(input.award, 540, 1_730)
  context.fillStyle = "rgba(255,255,255,.58)"
  context.font = "500 25px Inter, system-ui, sans-serif"
  context.fillText("avermate.fr", 540, 1_810)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
      "image/png",
      0.96
    )
  })
}

export function YearReviewStory({
  review,
  reviewKey = "annual",
  year,
  onClose,
}: {
  review: YearReview
  reviewKey?: string
  year: Year
  onClose: () => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const user = useAuthenticatedUser()
  const { preferences } = usePreferences()
  const { scale, yearId } = useYear()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const [muted, setMuted] = useState(false)
  const [exporting, setExporting] = useState<"download" | "share" | null>(null)
  const progressRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pointerRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const celebrated = useRef(false)
  const marked = useRef(false)
  const markSeen = useMutation(orpc.review.markSeen.mutationOptions())

  const mark = useCallback(
    (ratio: number | null) =>
      ratio === null
        ? "—"
        : format.number(ratio * scale, { maximumFractionDigits: 2 }),
    [format, scale]
  )

  const awardCopy = useMemo<AwardCopy>(
    () => ({
      tourist: {
        title: t("The Visitor"),
        body: t("You dropped by. The year is still mostly ahead of you."),
        symbol: "✦",
      },
      tightrope: {
        title: t("The Tightrope Walker"),
        body: t("Right on the line, all year, and you never fell off."),
        symbol: "⌁",
      },
      comeback: {
        title: t("The Comeback"),
        body: t("You started slow and finished somewhere else entirely."),
        symbol: "↗",
      },
      allin: {
        title: t("All In"),
        body: t("Brilliant somewhere, quietly ignoring somewhere else."),
        symbol: "◆",
      },
      masterclass: {
        title: t("Masterclass"),
        body: t("Consistently excellent. Not much more to say."),
        symbol: "★",
      },
      unpredictable: {
        title: t("The Wildcard"),
        body: t("Nobody, including you, could guess the next result."),
        symbol: "✣",
      },
      precision: {
        title: t("The Metronome"),
        body: t("The same mark, over and over. Frighteningly steady."),
        symbol: "◎",
      },
      legend: {
        title: t("The Archivist"),
        body: t("You logged everything. Truly everything."),
        symbol: "♛",
      },
      avermatien: {
        title: t("The Regular"),
        body: t("You kept it up all year without making a thing of it."),
        symbol: "◇",
      },
    }),
    [t]
  )

  const weekdays = useMemo(
    () => [
      t("Sunday"),
      t("Monday"),
      t("Tuesday"),
      t("Wednesday"),
      t("Thursday"),
      t("Friday"),
      t("Saturday"),
    ],
    [t]
  )

  const heatmap = useMemo(
    () =>
      heatmapDays(
        review.heatmap,
        new Date(year.startsAt),
        new Date(Math.min(Date.now(), new Date(year.endsAt).getTime()))
      ),
    [review.heatmap, year.endsAt, year.startsAt]
  )

  const busiestMonth = review.busiestMonth
    ? format.dateTime(monthDate(review.busiestMonth.month), {
        month: "long",
      })
    : null

  const slides = useMemo<StorySlide[]>(() => {
    const items: StorySlide[] = [
      {
        key: "intro",
        duration: 4_800,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_75%_15%,rgba(129,140,248,.55),transparent_38%),radial-gradient(circle_at_10%_85%,rgba(6,182,212,.28),transparent_42%),linear-gradient(150deg,#080b18,#1b1238_55%,#071c25)]">
            <Profile user={user} />
            <div className="mt-auto mb-auto text-center">
              <SparklesIcon className="mx-auto size-9 text-violet-200" />
              <p className="mt-6 text-xs font-semibold tracking-[0.28em] text-white/55 uppercase">
                {year.name}
              </p>
              <h1 className="mt-4 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
                {t("Your year, in numbers.")}
              </h1>
              <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-white/68">
                {t(
                  "Everything you recorded, from the first grade to the last."
                )}
              </p>
            </div>
          </StorySlide>
        ),
      },
      {
        key: "numbers",
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_20%_0%,rgba(14,165,233,.42),transparent_42%),linear-gradient(160deg,#07131e,#0d2440_50%,#13142e)]">
            <SectionLabel icon={<BookOpenIcon />}>
              {t("The year you entered")}
            </SectionLabel>
            <div className="my-auto text-center">
              <p className="numeric text-8xl leading-none font-semibold tracking-tighter">
                {review.gradeCount}
              </p>
              <p className="mt-3 text-xl text-white/72">{t("grades")}</p>
              <div className="mx-auto mt-10 grid max-w-xs grid-cols-2 gap-3 text-left">
                <GlassStat
                  label={t("Final average")}
                  value={mark(review.average)}
                />
                <GlassStat
                  label={t("Points recorded")}
                  value={format.number(review.ratioSum * scale, {
                    maximumFractionDigits: 0,
                  })}
                />
              </div>
              {review.firstGradeAt && review.lastGradeAt ? (
                <p className="mx-auto mt-7 max-w-xs text-xs leading-relaxed text-white/48">
                  {t("From {first} to {last}.", {
                    first: format.dateTime(review.firstGradeAt, {
                      day: "numeric",
                      month: "long",
                    }),
                    last: format.dateTime(review.lastGradeAt, {
                      day: "numeric",
                      month: "long",
                    }),
                  })}
                </p>
              ) : null}
            </div>
          </StorySlide>
        ),
      },
      {
        key: "rhythm",
        duration: 7_000,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_90%_12%,rgba(16,185,129,.38),transparent_40%),linear-gradient(155deg,#071814,#0d2c27_55%,#0c1426)]">
            <SectionLabel icon={<ActivityIcon />}>
              {t("Your rhythm")}
            </SectionLabel>
            <div className="my-auto w-full">
              <div className="mx-auto grid max-w-sm grid-flow-col grid-rows-7 gap-1.5">
                {heatmap.slice(-196).map((day) => (
                  <span
                    key={day.date}
                    title={`${day.date}: ${day.count}`}
                    className={cn(
                      "aspect-square rounded-[3px]",
                      day.count === 0
                        ? "bg-white/8"
                        : day.count === 1
                          ? "bg-emerald-300/40"
                          : day.count === 2
                            ? "bg-emerald-300/70"
                            : "bg-emerald-200"
                    )}
                  />
                ))}
              </div>
              <div className="mx-auto mt-8 grid max-w-sm grid-cols-2 gap-3">
                <GlassStat
                  label={t("Busiest month")}
                  value={busiestMonth ?? "—"}
                />
                <GlassStat
                  label={t("Favourite day")}
                  value={
                    review.busiestWeekday
                      ? (weekdays[review.busiestWeekday.weekday] ?? "—")
                      : "—"
                  }
                />
              </div>
            </div>
          </StorySlide>
        ),
      },
      {
        key: "streak",
        duration: 4_600,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_50%_45%,rgba(249,115,22,.5),transparent_32%),linear-gradient(165deg,#1d0c08,#3a1710_52%,#170d1c)]">
            <SectionLabel icon={<FlameIcon />}>
              {t("Your longest streak")}
            </SectionLabel>
            <div className="my-auto text-center">
              <FlameIcon className="mx-auto size-20 fill-orange-300/20 text-orange-200" />
              <p className="numeric mt-5 text-8xl leading-none font-semibold tracking-tighter">
                {review.longestStreak}
              </p>
              <p className="mt-3 text-xl text-white/72">
                {review.longestStreak === 1
                  ? t("active day in a row")
                  : t("active days in a row")}
              </p>
              <p className="mx-auto mt-5 max-w-xs text-sm text-white/50">
                {t("Small entries, repeated, turned into a complete year.")}
              </p>
            </div>
          </StorySlide>
        ),
      },
    ]

    if (review.primeTime) {
      items.push({
        key: "prime",
        duration: 6_800,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_50%_30%,rgba(59,130,246,.52),transparent_36%),linear-gradient(155deg,#071225,#10275a_58%,#130c2a)]">
            <SectionLabel icon={<ZapIcon />}>{t("Your peak")}</SectionLabel>
            <div className="my-auto text-center">
              <p className="text-sm text-white/58">{t("On")}</p>
              <p className="mt-2 text-3xl font-semibold">
                {format.dateTime(review.primeTime.date, {
                  day: "numeric",
                  month: "long",
                })}
              </p>
              <div className="mx-auto my-8 flex size-52 items-center justify-center rounded-full border border-white/15 bg-white/8 shadow-[0_0_80px_rgba(96,165,250,.25)] backdrop-blur">
                <div>
                  <p className="numeric text-7xl leading-none font-semibold tracking-tighter">
                    {mark(review.primeTime.ratio)}
                  </p>
                  <p className="mt-3 text-xs tracking-[0.2em] text-white/48 uppercase">
                    {t("running average")}
                  </p>
                </div>
              </div>
              <p className="mx-auto max-w-xs text-sm text-white/58">
                {t("That was the highest your average reached all year.")}
              </p>
            </div>
          </StorySlide>
        ),
      })
    }

    if (review.topSubjects.length > 0) {
      items.push({
        key: "subjects",
        duration: 6_200,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_10%_10%,rgba(168,85,247,.42),transparent_38%),linear-gradient(155deg,#150a27,#2c1650_55%,#0d1b31)]">
            <SectionLabel icon={<TrendingUpIcon />}>
              {t("Your strongest subjects")}
            </SectionLabel>
            <ol className="my-auto w-full space-y-3">
              {review.topSubjects.map((subject, position) => (
                <li
                  key={subject.subjectId}
                  className={cn(
                    "flex items-center gap-4 rounded-2xl border border-white/10 bg-white/8 px-4 py-4 text-left backdrop-blur-sm",
                    position === 0 &&
                      "border-violet-300/35 bg-violet-300/12 shadow-[0_18px_60px_rgba(139,92,246,.18)]"
                  )}
                >
                  <span className="numeric flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white/64">
                    {position + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {subject.name}
                  </span>
                  <span className="numeric text-xl font-semibold">
                    {mark(subject.ratio)}
                  </span>
                </li>
              ))}
            </ol>
          </StorySlide>
        ),
      })
    }

    if (review.bestProgression) {
      items.push({
        key: "progression",
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_50%_20%,rgba(34,197,94,.42),transparent_42%),linear-gradient(155deg,#07190f,#123a27_58%,#081626)]">
            <SectionLabel icon={<TrendingUpIcon />}>
              {t("Biggest turnaround")}
            </SectionLabel>
            <div className="my-auto text-center">
              <p className="text-3xl font-semibold text-balance">
                {review.bestProgression.name}
              </p>
              <p className="numeric mt-8 text-8xl leading-none font-semibold tracking-tighter text-emerald-200">
                +{mark(review.bestProgression.delta)}
              </p>
              <p className="mx-auto mt-5 max-w-xs text-sm leading-relaxed text-white/58">
                {t(
                  "Between the first half of your results and the second, this was your clearest step forward."
                )}
              </p>
            </div>
          </StorySlide>
        ),
      })
    }

    items.push(
      {
        key: "award-intro",
        duration: 3_800,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_50%_50%,rgba(234,179,8,.35),transparent_34%),linear-gradient(155deg,#170f05,#35220b_55%,#181022)]">
            <div className="my-auto text-center">
              <AwardIcon className="mx-auto size-12 text-amber-200" />
              <p className="mt-7 text-xs font-semibold tracking-[0.3em] text-white/52 uppercase">
                {t("One last thing")}
              </p>
              <h2 className="mx-auto mt-5 max-w-xs text-4xl leading-tight font-semibold tracking-tight">
                {t("Every year earns a title.")}
              </h2>
            </div>
          </StorySlide>
        ),
      },
      {
        key: "award",
        duration: 7_000,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_50%_38%,rgba(251,191,36,.52),transparent_35%),radial-gradient(circle_at_20%_90%,rgba(168,85,247,.25),transparent_38%),linear-gradient(155deg,#1d1203,#422b0b_50%,#160f2d)]">
            <p className="text-xs font-semibold tracking-[0.28em] text-white/52 uppercase">
              {t("Your title this year")}
            </p>
            <div className="my-auto text-center">
              <div className="mx-auto flex size-32 items-center justify-center rounded-full border border-amber-100/30 bg-amber-200/12 text-6xl shadow-[0_0_90px_rgba(251,191,36,.3)]">
                {awardCopy[review.award].symbol}
              </div>
              <h2 className="mt-8 text-4xl leading-tight font-semibold tracking-tight text-balance">
                {awardCopy[review.award].title}
              </h2>
              <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-white/65">
                {awardCopy[review.award].body}
              </p>
            </div>
          </StorySlide>
        ),
      }
    )

    if (review.topPercentile > 0) {
      items.push({
        key: "percentile",
        duration: 6_200,
        node: (
          <StorySlide className="bg-[radial-gradient(circle_at_50%_28%,rgba(99,102,241,.55),transparent_36%),linear-gradient(155deg,#0d102c,#27275b_55%,#101426)]">
            <SectionLabel icon={<ActivityIcon />}>
              {t("Among the Avermate community")}
            </SectionLabel>
            <div className="my-auto text-center">
              <p className="text-sm text-white/55">{t("You were in the")}</p>
              <p className="numeric mt-4 text-8xl leading-none font-semibold tracking-tighter">
                {t("top {percent}%", {
                  percent: String(review.topPercentile),
                })}
              </p>
              <p className="mx-auto mt-6 max-w-xs text-sm leading-relaxed text-white/58">
                {t(
                  "Ranked by the number of results recorded over the last twelve months — never by the grade itself."
                )}
              </p>
            </div>
          </StorySlide>
        ),
      })
    }

    items.push({
      key: "outro",
      duration: 10_000,
      node: (
        <StorySlide className="bg-[radial-gradient(circle_at_75%_12%,rgba(139,92,246,.48),transparent_38%),radial-gradient(circle_at_8%_78%,rgba(14,165,233,.28),transparent_40%),linear-gradient(150deg,#080b18,#1d143e_55%,#071c25)]">
          <Profile user={user} />
          <div className="my-auto w-full text-center">
            <p className="text-xs font-semibold tracking-[0.28em] text-white/50 uppercase">
              {t("Your {year} recap", { year: year.name })}
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-tight">
              {awardCopy[review.award].title}
            </h2>
            <div className="mx-auto mt-7 grid max-w-sm grid-cols-2 gap-3 text-left">
              <GlassStat label={t("Average")} value={mark(review.average)} />
              <GlassStat
                label={t("Grades")}
                value={String(review.gradeCount)}
              />
              <GlassStat
                label={t("Longest streak")}
                value={String(review.longestStreak)}
              />
              <GlassStat
                label={t("Top percentile")}
                value={
                  review.topPercentile > 0
                    ? t("top {percent}%", {
                        percent: String(review.topPercentile),
                      })
                    : "—"
                }
              />
            </div>
            <div
              data-story-control
              className="mx-auto mt-7 grid max-w-sm grid-cols-2 gap-2"
            >
              <Button
                type="button"
                variant="secondary"
                className="h-11 bg-white text-neutral-950 hover:bg-white/90"
                disabled={exporting !== null}
                onClick={() => void exportRecap("share")}
              >
                <Share2Icon className="size-4" />
                {exporting === "share" ? t("Preparing…") : t("Share")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 border-white/18 bg-white/8 text-white hover:bg-white/14 hover:text-white"
                disabled={exporting !== null}
                onClick={() => void exportRecap("download")}
              >
                <DownloadIcon className="size-4" />
                {exporting === "download" ? t("Preparing…") : t("Save PNG")}
              </Button>
            </div>
          </div>
        </StorySlide>
      ),
    })

    return items
    // `exportRecap` deliberately stays outside the dependency list. It reads
    // the same immutable review that built this slide and is only invoked by
    // a user gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    awardCopy,
    busiestMonth,
    exporting,
    format,
    heatmap,
    mark,
    review,
    scale,
    t,
    user,
    weekdays,
    year,
  ])

  const total = slides.length
  const isLast = index === total - 1

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(total - 1, target))
      if (next === index) return
      haptic("selection")
      progressRef.current = 0
      setProgress(0)
      setIndex(next)
    },
    [index, total]
  )

  const next = useCallback(() => {
    if (!isLast) goTo(index + 1)
  }, [goTo, index, isLast])
  const previous = useCallback(() => goTo(index - 1), [goTo, index])

  const exportRecap = useCallback(
    async (action: "download" | "share") => {
      if (exporting) return
      haptic("medium")
      setExporting(action)
      try {
        const percentile =
          review.topPercentile > 0
            ? t("top {percent}%", {
                percent: String(review.topPercentile),
              })
            : "—"
        const blob = await recapPng({
          award: awardCopy[review.award].title,
          average: mark(review.average),
          averageLabel: t("Final average"),
          brand: "Avermate",
          gradeCount: review.gradeCount,
          gradesLabel: t("Grades"),
          heatmap,
          percentile,
          percentileLabel: t("Activity rank"),
          streak: review.longestStreak,
          streakLabel: t("Longest streak"),
          subjects: review.topSubjects.map((subject) => subject.name),
          subjectsLabel: t("Strongest subjects"),
          title: t("My year, in numbers."),
          userName: user.name,
          year: year.name,
        })
        const safeYear = year.name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()
        const fileName = `avermate-recap-${safeYear || "year"}.png`

        if (action === "share" && navigator.share && navigator.canShare) {
          const file = new File([blob], fileName, { type: "image/png" })
          if (navigator.canShare({ files: [file] })) {
            try {
              await navigator.share({
                files: [file],
                title: t("My Avermate year recap"),
                text: t("Here is my {year} recap on Avermate.", {
                  year: year.name,
                }),
              })
              return
            } catch (error) {
              if (
                error instanceof DOMException &&
                error.name === "AbortError"
              ) {
                return
              }
            }
          }
        }

        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.download = fileName
        link.href = url
        link.style.display = "none"
        document.body.append(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1_000)
      } catch (error) {
        console.error("Unable to export the year recap", error)
        toast.error(t("The recap image could not be created."))
      } finally {
        setExporting(null)
      }
    },
    [awardCopy, exporting, heatmap, mark, review, t, user.name, year.name]
  )

  useEffect(() => {
    if (marked.current || !yearId) return
    marked.current = true
    markSeen.mutate({ yearId, reviewKey })
    // One write per opening. The mutation object's identity is irrelevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewKey, yearId])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    const audio = new Audio(STORY_MUSIC_URL)
    audio.loop = true
    audio.volume = 0.42
    audio.preload = "none"
    audioRef.current = audio
    return () => {
      audio.pause()
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (muted || paused) {
      audio.pause()
      return
    }
    void audio.play().catch(() => setMuted(true))
  }, [muted, paused])

  useEffect(() => {
    if (paused || preferences.reduceMotion || isLast) return
    const duration = slides[index]?.duration ?? DEFAULT_SLIDE_MS
    const startedAt = performance.now() - progressRef.current * duration
    let frame = 0
    const tick = (now: number) => {
      const nextProgress = Math.min(1, (now - startedAt) / duration)
      progressRef.current = nextProgress
      setProgress(nextProgress)
      if (nextProgress >= 1) {
        next()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [index, isLast, next, paused, preferences.reduceMotion, slides])

  useEffect(() => {
    if (slides[index]?.key !== "award" || celebrated.current) return
    celebrated.current = true
    haptic("success")
    if (preferences.reduceMotion) return
    void confetti({
      particleCount: 110,
      spread: 82,
      origin: { y: 0.58 },
      colors: ["#fbbf24", "#fef3c7", "#a78bfa", "#ffffff"],
      disableForReducedMotion: true,
    })
  }, [index, preferences.reduceMotion, slides])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") next()
      if (event.key === "ArrowLeft") previous()
      if (event.key === "Home") goTo(0)
      if (event.key === "End") goTo(total - 1)
      if (event.key === "Escape") onClose()
      if (event.key === " ") {
        event.preventDefault()
        setPaused((value) => !value)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [goTo, next, onClose, previous, total])

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-story-control]")) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerRef.current = { x: event.clientX, y: event.clientY, at: Date.now() }
    setPaused(true)
  }

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current
    pointerRef.current = null
    setPaused(false)
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) next()
      else previous()
      return
    }
    if (Date.now() - start.at > 450) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    if (x < bounds.width * 0.32) previous()
    else if (x > bounds.width * 0.68) next()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Year recap for {year}", { year: year.name })}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#03040a] text-white sm:p-5"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,.2),transparent_46%)]" />

      <Button
        ref={closeRef}
        data-story-control
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label={t("Close")}
        className="absolute top-[calc(env(safe-area-inset-top)+2rem)] left-3 z-30 text-white/70 hover:bg-white/10 hover:text-white sm:top-5 sm:right-5 sm:left-auto"
      >
        <XIcon className="size-5" />
      </Button>

      <button
        data-story-control
        type="button"
        onClick={previous}
        disabled={index === 0}
        aria-label={t("Previous")}
        className="absolute left-3 z-30 hidden size-12 items-center justify-center rounded-full border border-white/10 bg-white/8 text-white/70 backdrop-blur transition-colors hover:bg-white/14 hover:text-white disabled:opacity-25 sm:flex lg:left-[max(2rem,calc(50%-16rem))]"
      >
        <ChevronLeftIcon className="size-6" />
      </button>
      <button
        data-story-control
        type="button"
        onClick={next}
        disabled={isLast}
        aria-label={t("Next")}
        className="absolute right-3 z-30 hidden size-12 items-center justify-center rounded-full border border-white/10 bg-white/8 text-white/70 backdrop-blur transition-colors hover:bg-white/14 hover:text-white disabled:opacity-25 sm:flex lg:right-[max(2rem,calc(50%-16rem))]"
      >
        <ChevronRightIcon className="size-6" />
      </button>

      <div
        className="relative h-full w-full touch-pan-y overflow-hidden bg-black shadow-2xl select-none sm:aspect-[9/16] sm:h-[min(90svh,780px)] sm:w-auto sm:rounded-[2rem] sm:border sm:border-white/10"
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          pointerRef.current = null
          setPaused(false)
        }}
      >
        <div
          data-story-control
          className="pt-safe absolute inset-x-0 top-0 z-20 flex gap-1.5 px-3 pt-3"
        >
          {slides.map((slide, position) => (
            <button
              key={slide.key}
              type="button"
              onClick={() => goTo(position)}
              aria-label={t("Go to slide {number}", {
                number: String(position + 1),
              })}
              aria-current={position === index ? "step" : undefined}
              className="group h-4 flex-1 py-1.5"
            >
              <span className="block h-1 overflow-hidden rounded-full bg-white/24 group-focus-visible:ring-2 group-focus-visible:ring-white">
                <span
                  className="block h-full rounded-full bg-white"
                  style={{
                    width: `${
                      position < index
                        ? 100
                        : position > index
                          ? 0
                          : progress * 100
                    }%`,
                  }}
                />
              </span>
            </button>
          ))}
        </div>

        <div
          data-story-control
          className="pt-safe absolute top-8 right-3 z-30 flex items-center gap-1"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setPaused((value) => !value)}
            aria-label={paused ? t("Resume story") : t("Pause story")}
            className="bg-black/20 text-white/72 backdrop-blur hover:bg-black/35 hover:text-white"
          >
            {paused ? (
              <PlayIcon className="size-4" />
            ) : (
              <PauseIcon className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? t("Turn music on") : t("Mute music")}
            aria-pressed={muted}
            className="bg-black/20 text-white/72 backdrop-blur hover:bg-black/35 hover:text-white"
          >
            {muted ? (
              <VolumeXIcon className="size-4" />
            ) : (
              <Volume2Icon className="size-4" />
            )}
          </Button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={slides[index]?.key}
            initial={
              preferences.reduceMotion ? false : { opacity: 0, scale: 1.025 }
            }
            animate={{ opacity: 1, scale: 1 }}
            exit={
              preferences.reduceMotion ? undefined : { opacity: 0, scale: 0.99 }
            }
            transition={{ duration: preferences.reduceMotion ? 0 : 0.35 }}
            className="absolute inset-0"
          >
            {slides[index]?.node}
          </motion.div>
        </AnimatePresence>

        <p className="sr-only" aria-live="polite">
          {t("Slide {current} of {total}", {
            current: String(index + 1),
            total: String(total),
          })}
        </p>
      </div>
    </div>
  )
}

function StorySlide({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "flex h-full flex-col overflow-hidden px-7 pt-20 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-9",
        className
      )}
    >
      {children}
    </section>
  )
}

function Profile({ user }: { user: { image: string | null; name: string } }) {
  return (
    <div className="flex items-center gap-3 text-left">
      <Avatar className="size-10 border border-white/15">
        <AvatarImage src={user.image ?? undefined} alt="" />
        <AvatarFallback className="bg-white/10 text-xs text-white">
          {initialsOf(user.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="text-[10px] tracking-[0.16em] text-white/42 uppercase">
          Avermate
        </p>
      </div>
    </div>
  )
}

function SectionLabel({
  children,
  icon,
}: {
  children: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.22em] text-white/58 uppercase [&_svg]:size-4">
      {icon}
      <span>{children}</span>
    </div>
  )
}

function GlassStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
      <p className="text-[11px] leading-tight text-white/48">{label}</p>
      <p className="numeric mt-2 truncate text-xl font-semibold">{value}</p>
    </div>
  )
}
