"use client"

import { useState } from "react"
import { useReducedMotion } from "motion/react"
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Stationery, in the register the reference actually sets.
 *
 * The earlier attempts aimed at a French school notebook — blue rules, red
 * margin, coloured dividers — which is a loud object. The reference is the
 * opposite and the difference is the whole design:
 *
 * - **Near-white on near-white.** The sheet is barely lighter than the surface
 *   it rests on. Nothing separates them but a very soft, very wide shadow, so
 *   the object reads by its edge and its lift rather than by contrast.
 * - **One accent, muted.** A single sage green for the tab, the ribbon and the
 *   selected day. No second colour anywhere.
 * - **Serif display, spaced small caps for labels.** "May 2024" in a serif over
 *   `SUN MON TUE` letterspaced is most of what makes it read as printed.
 * - **The wire is real.** Black double loops straddling the edge, not grey
 *   capsules beside it. Drawn as two offset ellipse rings per loop, which is
 *   what gives twisted wire its shape.
 * - **Air.** The reference is mostly empty. Every earlier version was packed.
 *
 * The palette is declared once, as tokens on the frame, with a dark set beside
 * it — a dark object in a dark room rather than a white one dimmed.
 */

const SHEET = [
  "[--paper:oklch(0.985_0.002_106)]",
  "[--paper-edge:oklch(0.94_0.003_106)]",
  "[--ink:oklch(0.24_0.004_106)]",
  "[--ink-soft:oklch(0.58_0.004_106)]",
  "[--ink-faint:oklch(0.78_0.003_106)]",
  "[--hair:oklch(0.24_0.004_106/0.09)]",
  "[--sage:oklch(0.74_0.033_155)]",
  "[--sage-ink:oklch(0.32_0.02_155)]",
  "[--wire:oklch(0.22_0.004_106)]",
  "dark:[--paper:oklch(0.225_0.004_106)]",
  "dark:[--paper-edge:oklch(0.28_0.005_106)]",
  "dark:[--ink:oklch(0.95_0.002_106)]",
  "dark:[--ink-soft:oklch(0.70_0.004_106)]",
  "dark:[--ink-faint:oklch(0.45_0.004_106)]",
  "dark:[--hair:oklch(1_0_0/0.10)]",
  "dark:[--sage:oklch(0.62_0.04_155)]",
  "dark:[--sage-ink:oklch(0.95_0.01_155)]",
  "dark:[--wire:oklch(0.12_0.004_106)]",
].join(" ")

/** The lift. Two shadows: one hairline of contact, one wide and very soft. */
const LIFT =
  "0 1px 2px oklch(0.24 0.004 106 / 0.05), 0 18px 40px -12px oklch(0.24 0.004 106 / 0.16)"

/* ------------------------------------------------------------------ pieces */

/**
 * One loop of twisted wire, straddling an edge.
 *
 * Two ellipse rings a few pixels apart: a single ring reads as a paperclip, and
 * the pair is what makes it read as wire that continues behind the sheet. The
 * near one is drawn over the paper, the far one behind it, so the loop passes
 * through the edge instead of sitting on it.
 */
function Loop({ edge, offset }: { edge: "top" | "left"; offset: number }) {
  const top = edge === "top"
  const ring = (near: boolean) => (
    <span
      className={cn(
        "absolute rounded-full border-[2.5px]",
        near ? "z-30" : "z-0"
      )}
      style={{
        borderColor: "var(--wire)",
        opacity: near ? 1 : 0.55,
        ...(top
          ? {
              left: offset + (near ? 0 : 5),
              top: -30,
              width: 17,
              height: 52,
            }
          : {
              top: offset + (near ? 0 : 5),
              left: -30,
              width: 52,
              height: 17,
            }),
      }}
    />
  )
  return (
    <>
      {ring(false)}
      {ring(true)}
    </>
  )
}

/** A tab on the fore-edge: rounded outward, one of them the accent. */
function Tab({
  label,
  active,
  offset,
  onClick,
}: {
  label: string
  active?: boolean
  offset: number
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className="absolute -right-8 z-0 flex h-[74px] w-9 items-center justify-center rounded-r-[10px] text-[0.6rem] font-medium tracking-[0.18em] transition-transform hover:translate-x-0.5"
      style={{
        top: offset,
        writingMode: "vertical-rl",
        background: active ? "var(--paper)" : "var(--sage)",
        color: active ? "var(--ink-soft)" : "var(--sage-ink)",
        boxShadow: "2px 2px 6px -2px oklch(0.24 0.004 106 / 0.18)",
      }}
    >
      {label}
    </button>
  )
}

/** The bookmark, hanging below the block with a flag notch. */
function Ribbon({ left = 96 }: { left?: number }) {
  return (
    <span
      aria-hidden
      className="absolute -bottom-12 z-0 block h-14 w-9"
      style={{
        left,
        background: "var(--sage)",
        clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)",
      }}
    />
  )
}

/** The block of pages showing under the top sheet. */
function Block({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute inset-x-2 top-2 bottom-[-5px] rounded-[20px]"
        style={{ background: "var(--paper-edge)" }}
      />
      <span
        aria-hidden
        className="absolute inset-x-1 top-1 bottom-[-2px] rounded-[20px]"
        style={{ background: "var(--paper-edge)" }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}

/* --------------------------------------------------------------- variant A */

/** A — the month, as the reference sets it. */
function MonthPad() {
  const [lift, setLift] = useState(false)
  const still = useReducedMotion()
  const cells = Array.from({ length: 35 }, (_, index) => index - 2)

  return (
    <Concept
      title="A · Calendrier du mois"
      note="Le registre de la référence : papier presque blanc sur fond presque blanc, ombre large, sérif pour le mois, capitales espacées pour les jours, un seul sauge."
    >
      <div className={cn(SHEET, "pr-10")} style={{ perspective: 1800 }}>
        <div className="relative">
          {/* the two wire mounts */}
          <Loop edge="top" offset={92} />
          <Loop edge="top" offset={124} />
          <Loop edge="top" offset={392} />
          <Loop edge="top" offset={424} />
          <Ribbon left={104} />

          <Block>
            <div
              className="relative z-10 overflow-visible rounded-[20px] px-8 pt-9 pb-8"
              style={{
                background: "var(--paper)",
                color: "var(--ink)",
                boxShadow: LIFT,
                transformOrigin: "top center",
                transform: lift ? "rotateX(8deg)" : "rotateX(0deg)",
                transition: still
                  ? "none"
                  : "transform 480ms cubic-bezier(.2,.7,.3,1)",
              }}
            >
              <Tab label="MAI" active offset={128} />
              <Tab label="JUIN" offset={206} />

              <header className="mb-7 flex items-start justify-between">
                <h3 className="font-serif text-[1.7rem] leading-none">
                  Mai{" "}
                  <span
                    className="font-sans text-[1.35rem] font-light"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    2026
                  </span>
                </h3>
                <div className="flex gap-1.5">
                  <Round
                    label="Mois précédent"
                    onClick={() => {
                      if (still) return
                      setLift(true)
                      setTimeout(() => setLift(false), 480)
                    }}
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </Round>
                  <Round
                    label="Mois suivant"
                    onClick={() => {
                      if (still) return
                      setLift(true)
                      setTimeout(() => setLift(false), 480)
                    }}
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </Round>
                </div>
              </header>

              <div
                className="mb-3 grid grid-cols-7 text-center text-[0.62rem] font-medium tracking-[0.2em]"
                style={{ color: "var(--ink-soft)" }}
              >
                {["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"].map(
                  (day, index) => (
                    <span key={`${day}-${index}`}>{day}</span>
                  )
                )}
              </div>

              <div
                className="grid grid-cols-7 overflow-hidden rounded-[10px]"
                style={{ border: "1px solid var(--hair)" }}
              >
                {cells.map((cell, index) => {
                  const outside = cell < 1 || cell > 31
                  const number =
                    cell < 1 ? 30 + cell : cell > 31 ? cell - 31 : cell
                  const today = cell === 12
                  return (
                    <div
                      key={cell}
                      className="grid min-h-[74px] place-items-start justify-center pt-4"
                      style={{
                        borderRight:
                          (index + 1) % 7 === 0
                            ? undefined
                            : "1px solid var(--hair)",
                        borderBottom:
                          index >= 28 ? undefined : "1px solid var(--hair)",
                      }}
                    >
                      <span
                        className={cn(
                          "numeric grid size-8 place-items-center rounded-full text-[0.9rem]"
                        )}
                        style={
                          today
                            ? {
                                background: "var(--sage)",
                                color: "var(--sage-ink)",
                              }
                            : {
                                color: outside
                                  ? "var(--ink-faint)"
                                  : "var(--ink)",
                              }
                        }
                      >
                        {number}
                      </span>
                      {cell === 18 || cell === 27 ? (
                        <span
                          aria-hidden
                          className="mx-auto mt-1 block size-1 rounded-full"
                          style={{ background: "var(--sage)" }}
                        />
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </Block>
        </div>
      </div>
    </Concept>
  )
}

/* --------------------------------------------------------------- variant B */

/** B — the day, rings down the spine. */
function DayPad() {
  const hours = [
    "8 h",
    "9 h",
    "10 h",
    "11 h",
    "12 h",
    "14 h",
    "15 h",
    "16 h",
    "17 h",
  ]
  const filled: Record<string, string> = {
    "8 h": "Mathématiques — DS chapitre 4",
    "10 h": "Physique-Chimie — TP dosage",
    "14 h": "Anglais — oral blanc",
  }

  return (
    <Concept
      title="B · Journée"
      note="Les anneaux le long de la reliure, en boucles doubles qui traversent le bord. Des filets d'heures, presque rien d'autre : la référence est surtout vide."
    >
      <div className={cn(SHEET, "pr-10 pl-10")}>
        <div className="relative">
          {Array.from({ length: 11 }, (_, index) => (
            <Loop key={index} edge="left" offset={40 + index * 46} />
          ))}
          <Ribbon left={54} />

          <Block>
            <div
              className="relative z-10 rounded-[20px] px-9 pt-8 pb-9"
              style={{
                background: "var(--paper)",
                color: "var(--ink)",
                boxShadow: LIFT,
              }}
            >
              <Tab label="MAI" active offset={72} />
              <Tab label="NOTES" offset={150} />

              <header className="mb-8 flex items-start justify-between">
                <div>
                  <h3 className="font-serif text-[1.9rem] leading-none">
                    Agenda
                  </h3>
                  <p
                    className="mt-2 text-[0.66rem] font-medium tracking-[0.2em]"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    LUNDI 12 MAI 2026
                  </p>
                </div>
                <span
                  className="grid size-9 place-items-center rounded-[10px]"
                  style={{ border: "1px solid var(--hair)" }}
                >
                  <CalendarDaysIcon
                    className="size-4"
                    style={{ color: "var(--ink-soft)" }}
                  />
                </span>
              </header>

              <ul>
                {hours.map((hour) => (
                  <li
                    key={hour}
                    className="flex items-center gap-4 py-3"
                    style={{ borderTop: "1px solid var(--hair)" }}
                  >
                    <span
                      className="numeric w-10 shrink-0 text-right text-[0.7rem]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      {hour}
                    </span>
                    <span className="truncate text-[0.9rem]">
                      {filled[hour] ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Block>
        </div>
      </div>
    </Concept>
  )
}

/* --------------------------------------------------------------- variant C */

/**
 * C — the week, which is the one this app actually needs.
 *
 * Same language, no wire: a card with a soft lift, the week set in the serif,
 * days as spaced small caps, and the sage reserved for what is due. The one to
 * ship if the object should stay quiet on a screen full of other things.
 */
function WeekCard() {
  const week = [
    { day: "LUN", date: 24, items: ["Mathématiques — DS", "Physique — TP"] },
    { day: "MAR", date: 25, items: ["Anglais — oral blanc"] },
    { day: "MER", date: 26, items: ["Sciences de l'ingénieur"] },
    { day: "JEU", date: 27, items: ["Mathématiques — colle"], due: true },
    { day: "VEN", date: 28, items: [] },
  ]

  return (
    <Concept
      title="C · Semaine"
      note="La même langue sans reliure : c'est la vue dont l'app a besoin. Le sauge est réservé à ce qui est à rendre, et rien d'autre n'est coloré."
    >
      <div className={SHEET}>
        <div
          className="rounded-[20px] px-8 py-8"
          style={{
            background: "var(--paper)",
            color: "var(--ink)",
            boxShadow: LIFT,
          }}
        >
          <header className="mb-8 flex items-end justify-between">
            <h3 className="font-serif text-[1.7rem] leading-none">
              24 — 28 février
            </h3>
            <p
              className="text-[0.62rem] font-medium tracking-[0.22em]"
              style={{ color: "var(--ink-soft)" }}
            >
              SEMAINE 9
            </p>
          </header>

          <ul className="space-y-0">
            {week.map((day) => (
              <li
                key={day.day}
                className="flex gap-6 py-4"
                style={{ borderTop: "1px solid var(--hair)" }}
              >
                <div className="w-14 shrink-0 text-center">
                  <p
                    className="text-[0.58rem] font-medium tracking-[0.2em]"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    {day.day}
                  </p>
                  <p className="numeric mt-1 font-serif text-xl leading-none">
                    {day.date}
                  </p>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5 pt-1">
                  {day.items.length === 0 ? (
                    <p
                      className="text-[0.85rem]"
                      style={{ color: "var(--ink-faint)" }}
                    >
                      —
                    </p>
                  ) : (
                    day.items.map((item) => (
                      <p key={item} className="truncate text-[0.9rem]">
                        {item}
                      </p>
                    ))
                  )}
                  {day.due ? (
                    <p
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.66rem] font-medium"
                      style={{
                        background: "var(--sage)",
                        color: "var(--sage-ink)",
                      }}
                    >
                      À rendre
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Concept>
  )
}

/* ------------------------------------------------------------------- shell */

function Round({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-[9px] transition-colors"
      style={{ border: "1px solid var(--hair)", color: "var(--ink-soft)" }}
    >
      {children}
    </button>
  )
}

function Concept({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-5">
      <header>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
          {note}
        </p>
      </header>
      {children}
    </section>
  )
}

export function AgendaConcepts() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-20 px-6 py-12 pb-32">
      <header>
        <h1 className="font-serif text-3xl tracking-tight">
          Agenda — concepts
        </h1>
        <p className="mt-2 text-sm text-pretty text-muted-foreground">
          Papeterie calme : blanc cassé sur blanc cassé, une ombre large pour
          tout séparer, un sérif pour les dates, des capitales espacées pour les
          libellés, et un seul vert sauge. Les anneaux sont de vraies boucles
          doubles qui traversent le bord — pas des gélules posées à côté.
        </p>
      </header>

      <MonthPad />
      <DayPad />
      <WeekCard />
    </div>
  )
}
