"use client"

import type { ComponentType, ReactNode } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  Link2OffIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * The preset vocabulary.
 *
 * Two screens describe the same four things — a preset, a version, a
 * difference between two versions, and whether a year still follows one — and
 * each had invented its own spelling. The settings page painted its states in
 * hardcoded emerald and amber, so the one screen whose job is to say "you are
 * up to date" ignored whichever palette the reader had chosen.
 *
 * The rule that shapes the rest: **a difference of nothing is not a
 * difference.** Both screens rendered a fixed grid of counters that read
 * `+0 / 0 / −0 / 0` on arrival — four boxes of nothing, one of them signed
 * minus zero. A change summary now appears when there is a change in it.
 */

export function VersionBadge({
  version,
  className,
}: {
  version: number | string
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn("numeric shrink-0", className)}>
      v{version}
    </Badge>
  )
}

/**
 * Whether a year still follows its preset.
 *
 * Four states, on theme tokens rather than fixed hues, each with a colour and
 * an icon and a sentence — the same rule the social screens follow, for the
 * same reason: this is the line that tells someone whether their subjects are
 * about to change.
 */
export type PresetLinkState =
  "none" | "current" | "update_available" | "customized" | "action_required"

const STATE_STYLE: Record<
  PresetLinkState,
  { shell: string; mark: string; icon: ComponentType<{ className?: string }> }
> = {
  // A year that follows nothing is a state too. The page used to render no
  // panel at all for it, so the one screen that answers "is anything about to
  // change under me" said nothing whatsoever to the people most likely to ask.
  none: {
    shell: "border-border bg-muted/40",
    mark: "text-muted-foreground",
    icon: CircleDashedIcon,
  },
  current: {
    shell: "border-positive/30 bg-positive/8",
    mark: "text-positive",
    icon: CheckCircle2Icon,
  },
  update_available: {
    shell: "border-primary/30 bg-primary/6",
    mark: "text-primary",
    icon: RefreshCwIcon,
  },
  customized: {
    shell: "border-caution/30 bg-caution/8",
    mark: "text-caution",
    icon: Link2OffIcon,
  },
  action_required: {
    shell: "border-destructive/30 bg-destructive/6",
    mark: "text-destructive",
    icon: AlertTriangleIcon,
  },
}

export function PresetStatePanel({
  state,
  title,
  description,
  badge,
  children,
  actions,
}: {
  state: PresetLinkState
  title: string
  description: string
  badge?: ReactNode
  children?: ReactNode
  actions?: ReactNode
}) {
  const style = STATE_STYLE[state]
  const Icon = style.icon

  return (
    <section className={cn("rounded-xl border p-4", style.shell)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", style.mark)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{title}</h2>
            {badge}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
      {actions ? (
        <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </section>
  )
}

export interface ChangeCount {
  label: string
  value: number
  /** `add` and `remove` are signed and coloured; `edit` is neutral. */
  kind: "add" | "edit" | "remove"
}

/**
 * What a version does to a year.
 *
 * Only the non-zero lines survive, so the summary is a sentence about the
 * update rather than a scoreboard that is mostly zeros. When everything is
 * zero it says so once, in words.
 */
export function ChangeSummary({
  counts,
  emptyLabel,
  className,
}: {
  counts: readonly ChangeCount[]
  emptyLabel?: string
  className?: string
}) {
  const t = useExtracted()
  const meaningful = counts.filter((count) => count.value !== 0)

  if (meaningful.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {emptyLabel ?? t("Nothing changes.")}
      </p>
    )
  }

  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {meaningful.map((count) => (
        <li
          key={count.label}
          className={cn(
            "flex items-baseline gap-1.5 rounded-lg px-2.5 py-1.5 text-sm",
            count.kind === "add" && "bg-positive/10 text-positive",
            count.kind === "remove" && "bg-destructive/10 text-destructive",
            count.kind === "edit" && "bg-muted text-foreground"
          )}
        >
          <span className="numeric font-semibold">
            {count.kind === "add" ? "+" : count.kind === "remove" ? "−" : ""}
            {Math.abs(count.value)}
          </span>
          <span className="text-xs opacity-80">{count.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** A preset in a list you can choose from. */
/**
 * The shell a preset choice wears.
 *
 * `role="radio"` rather than `aria-pressed`: this is one choice among several, and a
 * set of independent toggles is what a pressed button announces. A screen reader now
 * hears how many options there are and which one is taken.
 */
function PresetChoice({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex h-full w-full min-w-0 flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors",
        // One signal, not three. It carried a primary border *and* a tinted
        // background *and* a ring, which is a lot of ceremony for a boolean — and the
        // ring sat outside the border, so a column of them read as misaligned.
        selected ? "border-primary bg-primary/8" : "bg-card hover:bg-accent/50"
      )}
    >
      {children}
    </button>
  )
}

export function PresetCard({
  name,
  description,
  version,
  subjectCount,
  averageCount,
  featured,
  tags,
  selected,
  onSelect,
}: {
  name: string
  description: string
  version: number
  subjectCount: number
  averageCount: number
  featured?: boolean
  tags?: readonly string[]
  selected: boolean
  onSelect: () => void
}) {
  const t = useExtracted()

  return (
    <PresetChoice selected={selected} onSelect={onSelect}>
      {/* `break-words` stays, and my first attempt at this was wrong. It splits a
          word only when the word cannot fit the column at all — so "Section Générale
          & Technologique" coming out as "Technologiq" over "ue" was the *column*
          being 250px wide, not this class. Clamping the name instead traded a break
          for a truncation, which is worse and which the classes flow test rightly
          refuses: a chooser you scan by name must not hide one. The fix belongs at
          the grid, and it is there. */}
      <span className="flex min-w-0 items-start gap-2">
        {featured ? (
          <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        ) : null}
        <span className="min-w-0 flex-1 font-medium break-words whitespace-normal">
          {name}
        </span>
      </span>
      {/* Shown when there is one. The shipped catalogue described every preset as
          "Préset pour <its own name>" — the title again, with filler — and I first
          answered that here, with a guard that spotted a restatement. Wrong place:
          a description that says nothing is a description that should not have been
          written, so the catalogue was fixed instead. */}
      {description ? (
        <span className="text-sm leading-relaxed break-words whitespace-normal text-muted-foreground">
          {description}
        </span>
      ) : null}
      {/* Pushed to the bottom, so a row of cards lines its tags and counts up
          instead of hanging them wherever each description happened to end. */}
      <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
        {tags?.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-[10px]">
            {tag}
          </Badge>
        ))}
        <span className="numeric text-xs text-muted-foreground">
          {/* Averages only when there are some: "0 averages" is a fact about
              nothing, printed on most of the catalogue. And the version comes down
              here rather than sitting beside the name — every preset in the list is
              v1, so at the top it was a badge that distinguished nothing while
              taking the space a long name needed. */}
          {averageCount > 0
            ? t("{subjects} subjects · {averages} averages · v{version}", {
                subjects: String(subjectCount),
                averages: String(averageCount),
                version: String(version),
              })
            : t("{subjects} subjects · v{version}", {
                subjects: String(subjectCount),
                version: String(version),
              })}
        </span>
      </span>
    </PresetChoice>
  )
}
