import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRightIcon,
  CheckIcon,
  ChartNoAxesColumnIcon,
  EyeIcon,
  EyeOffIcon,
  GraduationCapIcon,
  InfoIcon,
  LockKeyholeIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TrophyIcon,
  UserRoundCogIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { initialsOf } from "@/lib/name"
import type { SocialExposure, SocialMetric } from "@/lib/social-presentation"

/**
 * The social vocabulary.
 *
 * Everything social is one of four things — a person, a permission, a count,
 * or a place you can go — and the old screens spelled each of them a different
 * way on every page: a friend was a card here and a table row there, a granted
 * field was a checkbox in one panel and a badge in another. The pieces below
 * are the whole set, so a rebuilt screen is an arrangement rather than an
 * invention.
 *
 * One rule runs through all of it: **what is shared has to be legible without
 * reading.** These screens govern who sees a student's results, so a granted
 * permission and a withheld one must never be told apart by a word alone —
 * every state carries a colour *and* an icon *and* a word.
 */

// -------------------------------------------------------------------- words

export type SocialRole = "owner" | "moderator" | "member"
export type SocialGroupType = "friends" | "study_group" | "class"
export type PolicyWindow =
  | "current_academic_year"
  | "last_90_days"
  | "last_30_days"

/**
 * Every name the feature uses, in one place.
 *
 * Five separate files each carried their own `metricLabel` switch, so the same
 * metric could be "Trend range" on the policy screen and something else on the
 * members panel. A shared policy that two people read differently is a bug in
 * a consent feature, not a style inconsistency.
 */
export function useSocialLabels() {
  const t = useExtracted()

  return {
    metric(value: string) {
      switch (value) {
        case "normalizedAverage":
          return t("Normalized average")
        case "median":
          return t("Median result")
        case "trendBand":
          return t("Trend range")
        case "passRateBand":
          return t("Success-rate range")
        case "gradeCountBand":
          return t("Activity range")
        case "genericGoalProgress":
          return t("Goal progress range")
        default:
          return t("Unknown metric")
      }
    },
    exposure(value: SocialExposure) {
      switch (value) {
        case "aggregate_only":
          return t("Group aggregate only")
        case "member_visible":
          return t("Visible to members")
        case "ranking":
          return t("Ranking eligible")
      }
    },
    exposureDescription(value: SocialExposure) {
      switch (value) {
        case "aggregate_only":
          return t("Blended into group figures. Nothing is attributed to you.")
        case "member_visible":
          return t("Participating members see this line beside your alias.")
        case "ranking":
          return t("Can be ranked, but only after a separate opt-in.")
      }
    },
    profileField(value: string) {
      switch (value) {
        case "displayName":
          return t("Display name")
        case "avatar":
          return t("Avatar")
        case "bio":
          return t("Bio")
        case "educationBand":
          return t("Education level")
        default:
          return t("Profile field")
      }
    },
    educationBand(value: string) {
      switch (value) {
        case "middle_school":
          return t("Middle school")
        case "high_school":
          return t("High school")
        case "higher_education":
          return t("Higher education")
        case "other":
          return t("Other education")
        default:
          return t("Not specified")
      }
    },
    role(value: SocialRole) {
      switch (value) {
        case "owner":
          return t("Owner")
        case "moderator":
          return t("Moderator")
        case "member":
          return t("Member")
      }
    },
    groupType(value: string) {
      switch (value) {
        case "class":
          return t("Self-declared class")
        case "study_group":
          return t("Study group")
        default:
          return t("Friends group")
      }
    },
    window(value: PolicyWindow) {
      switch (value) {
        case "current_academic_year":
          return t("Current academic year")
        case "last_90_days":
          return t("Last 90 days")
        case "last_30_days":
          return t("Last 30 days")
      }
    },
    /** Shared with moderation: a report says the same word on both sides. */
    reportCategory(value: string) {
      switch (value) {
        case "harassment":
          return t("Harassment")
        case "privacy":
          return t("Privacy")
        case "impersonation":
          return t("Impersonation")
        case "unsafe_content":
          return t("Unsafe content")
        default:
          return t("Other")
      }
    },
    reportStatus(value: string) {
      switch (value) {
        case "open":
          return t("Open")
        case "investigating":
          return t("Investigating")
        case "resolved":
          return t("Resolved")
        default:
          return t("Dismissed")
      }
    },
    reportPriority(value: string) {
      switch (value) {
        case "urgent":
          return t("Urgent")
        case "high":
          return t("High priority")
        case "low":
          return t("Low priority")
        default:
          return t("Normal priority")
      }
    },
    groupState(value: string) {
      switch (value) {
        case "active":
          return t("Active")
        case "frozen":
          return t("Frozen")
        default:
          return t("Archived")
      }
    },
    band(value: string) {
      switch (value) {
        case "improving":
          return t("Improving")
        case "stable":
          return t("Stable")
        case "declining":
          return t("Declining")
        case "high":
          return t("High")
        case "medium":
          return t("Medium")
        case "low":
          return t("Low")
        case "top_quartile":
          return t("Top quartile")
        case "upper_middle":
          return t("Upper-middle quartile")
        case "lower_middle":
          return t("Lower-middle quartile")
        case "bottom_quartile":
          return t("Bottom quartile")
        default:
          return t("Other protected range")
      }
    },
  }
}

// ------------------------------------------------------------------ headings

export function SocialHeading({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
          {Icon ? (
            <Icon className="size-5 shrink-0 text-muted-foreground" />
          ) : null}
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * A block of social content. Deliberately the same shape as a settings
 * section: these screens are configuration, whatever the feature is called.
 */
export function SocialSection({
  title,
  description,
  icon: Icon,
  action,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title?: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  action?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              {Icon ? (
                <Icon className="size-4 shrink-0 text-muted-foreground" />
              ) : null}
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn("flex flex-col gap-4 p-4", bodyClassName)}>
        {children}
      </div>
      {footer ? (
        <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </section>
  )
}

/**
 * The page frame for a flow that arrives from a link — an invitation, a
 * guardian review, a consent step. These have no navigation and one decision,
 * so they are centred and narrow instead of filling a dashboard width.
 */
export function SocialFlow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-col gap-4 py-2",
        className
      )}
    >
      {children}
    </div>
  )
}

// -------------------------------------------------------------------- people

export function SocialIdentity({
  displayName,
  avatarUrl,
  handle,
  secondary,
  size = "default",
}: {
  displayName: string
  avatarUrl?: string | null
  handle?: string | null
  secondary?: ReactNode
  size?: "default" | "large"
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className={size === "large" ? "size-11" : "size-9"}>
        <AvatarImage src={avatarUrl ?? undefined} alt="" />
        <AvatarFallback className="text-xs">
          {initialsOf(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-medium",
            size === "large" ? "text-base" : "text-sm"
          )}
        >
          {displayName}
        </p>
        {handle ? (
          <p className="truncate text-xs text-muted-foreground">@{handle}</p>
        ) : secondary ? (
          <div className="truncate text-xs text-muted-foreground">
            {secondary}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * An alias, not a person.
 *
 * Group members are deliberately pseudonymous, and drawing them with the same
 * avatar row as a friend implied the group knew who they were. A monogram tile
 * says "this is a name someone chose for this group" without borrowing the
 * visual language of an identity.
 */
export function SocialAlias({
  alias,
  secondary,
  self = false,
}: {
  alias: string
  secondary?: ReactNode
  self?: boolean
}) {
  const t = useExtracted()

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
          self
            ? "bg-primary/12 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {initialsOf(alias)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {alias}
          {self ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({t("You")})
            </span>
          ) : null}
        </p>
        {secondary ? (
          <div className="truncate text-xs text-muted-foreground">
            {secondary}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** A person, a permission summary and their actions, on one line. */
export function SocialRow({
  children,
  trailing,
  className,
}: {
  children: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0",
        className
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

/** A list of rows with the dividers already right. */
export function SocialList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("divide-y", className)}>{children}</div>
}

// --------------------------------------------------------------- permissions

/**
 * Whether one thing is shared.
 *
 * Colour *and* an icon *and* a word. On a screen about who can see a student's
 * marks, "shared" and "not shared" must not be distinguishable only by a
 * colour that a tenth of readers cannot separate.
 */
export function SharingState({
  granted,
  label,
  className,
}: {
  granted: boolean
  label?: string
  className?: string
}) {
  const t = useExtracted()
  const Icon = granted ? EyeIcon : EyeOffIcon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        granted
          ? "bg-positive/10 text-positive"
          : "bg-muted text-muted-foreground",
        className
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {label ?? (granted ? t("Shared") : t("Not shared"))}
    </span>
  )
}

/**
 * How far one metric travels.
 *
 * Exposure is the single most consequential word in a group policy and it had
 * been drawn as a plain outline badge identical to every other badge on the
 * page — "group aggregate only" and "visible to members" looked the same at a
 * glance. They are ordered, so they are drawn as an ordered scale.
 */
export function ExposureBadge({
  exposure,
  className,
}: {
  exposure: SocialExposure
  className?: string
}) {
  const labels = useSocialLabels()
  const tone =
    exposure === "aggregate_only"
      ? "bg-muted text-muted-foreground"
      : exposure === "member_visible"
        ? "bg-primary/10 text-primary"
        : "bg-caution/12 text-caution"
  const Icon =
    exposure === "aggregate_only"
      ? ChartNoAxesColumnIcon
      : exposure === "member_visible"
        ? EyeIcon
        : TrophyIcon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        tone,
        className
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {labels.exposure(exposure)}
    </span>
  )
}

/** What a single audience actually receives, field by field. */
export function SharingFieldList({
  fields,
  emptyLabel,
}: {
  fields: ReadonlyArray<{ key: string; label: string; granted: boolean }>
  emptyLabel?: string
}) {
  const t = useExtracted()

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyLabel ?? t("Nothing is shared.")}
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {fields.map((field) => (
        <li key={field.key} className="flex items-center gap-2 text-sm">
          {field.granted ? (
            <CheckIcon
              className="size-3.5 shrink-0 text-positive"
              aria-hidden
            />
          ) : (
            <LockKeyholeIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !field.granted && "text-muted-foreground"
            )}
          >
            {field.label}
          </span>
          <span className="sr-only">
            {field.granted ? t("Shared") : t("Not shared")}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Owner, moderator or member — a capability, so it is drawn as one. */
export function RoleBadge({ role }: { role: SocialRole }) {
  const labels = useSocialLabels()
  if (role === "member") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {labels.role(role)}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary">
      <UserRoundCogIcon aria-hidden /> {labels.role(role)}
    </Badge>
  )
}

export function GroupTypeBadge({ type }: { type: string }) {
  const labels = useSocialLabels()
  const Icon = type === "class" ? GraduationCapIcon : UsersRoundIcon
  return (
    <Badge variant="outline">
      <Icon aria-hidden /> {labels.groupType(type)}
    </Badge>
  )
}

/** Whether a one-time link is still usable. */
export function LinkState({
  consumed,
  revoked,
}: {
  consumed?: boolean | Date | string | null
  revoked?: boolean | Date | string | null
}) {
  const t = useExtracted()
  if (consumed) return <Badge variant="outline">{t("Used")}</Badge>
  if (revoked) return <Badge variant="outline">{t("Revoked")}</Badge>
  return (
    <Badge className="bg-positive/12 text-positive">
      <CheckIcon aria-hidden /> {t("Active")}
    </Badge>
  )
}

/**
 * The promise the whole feature rests on, stated where it is relevant rather
 * than once at the top of a page nobody rereads.
 */
export function PrivacyNote({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  const t = useExtracted()

  return (
    <p
      className={cn(
        "flex items-start gap-2 text-xs leading-relaxed text-muted-foreground",
        className
      )}
    >
      <ShieldCheckIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        {children ?? (
          <>
            {t(
              "A missing permission always means no access. Nobody receives your full grades, subject names, notes or dates through social views."
            )}{" "}
            <Link
              href="/legal/social-sharing"
              className="underline underline-offset-4"
            >
              {t("How social sharing works")}
            </Link>
          </>
        )}
      </span>
    </p>
  )
}

// ------------------------------------------------------------------ notices

/**
 * Something the reader has to know before acting.
 *
 * The old screens reached for `Alert` and then hardcoded `border-amber-500/30
 * bg-amber-500/5` when they wanted urgency, which ignored the palette the user
 * picked and stayed amber in every theme. Tones here are tokens, so a callout
 * follows the theme like everything else.
 */
export function SocialCallout({
  tone = "info",
  icon: Icon,
  title,
  children,
  action,
}: {
  tone?: "info" | "caution" | "positive" | "danger"
  icon?: ComponentType<{ className?: string }>
  title?: string
  children?: ReactNode
  action?: ReactNode
}) {
  const tones = {
    info: {
      shell: "border-border bg-muted/40",
      mark: "text-muted-foreground",
      icon: InfoIcon as ComponentType<{ className?: string }>,
    },
    caution: {
      shell: "border-caution/30 bg-caution/8",
      mark: "text-caution",
      icon: ShieldAlertIcon as ComponentType<{ className?: string }>,
    },
    positive: {
      shell: "border-positive/30 bg-positive/8",
      mark: "text-positive",
      icon: ShieldCheckIcon as ComponentType<{ className?: string }>,
    },
    danger: {
      shell: "border-destructive/30 bg-destructive/8",
      mark: "text-destructive",
      icon: ShieldAlertIcon as ComponentType<{ className?: string }>,
    },
  }[tone]
  const Mark = Icon ?? tones.icon

  return (
    <div className={cn("flex gap-3 rounded-xl border p-3.5", tones.shell)}>
      <Mark className={cn("mt-0.5 size-4 shrink-0", tones.mark)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        {children ? (
          <div
            className={cn(
              "text-xs leading-relaxed text-muted-foreground",
              title && "mt-1"
            )}
          >
            {children}
          </div>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------- stats

export function SocialStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string | number
  hint?: string
  icon?: ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
        {label}
      </div>
      <p className="numeric mt-1.5 text-2xl font-semibold tracking-tight">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * A five-number summary, drawn as a range rather than five equal tiles.
 *
 * Quartiles are positions on one axis; five identical boxes threw that away
 * and made the median look like an unrelated statistic. The bar restores the
 * shape of the distribution at a glance and keeps the numbers underneath.
 */
export function DistributionBar({
  minimum,
  lowerQuartile,
  median,
  upperQuartile,
  maximum,
  format = (value: number) => `${value.toFixed(1)}%`,
}: {
  minimum: number | null
  lowerQuartile: number | null
  median: number | null
  upperQuartile: number | null
  maximum: number | null
  format?: (value: number) => string
}) {
  const t = useExtracted()
  const points = [minimum, lowerQuartile, median, upperQuartile, maximum]
  const known = points.filter((value): value is number => value !== null)

  if (known.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Not enough shared data to draw a range.")}
      </p>
    )
  }

  const low = Math.min(...known)
  const high = Math.max(...known)
  const span = high - low || 1
  const at = (value: number) => ((value - low) / span) * 100

  return (
    <div>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        {lowerQuartile !== null && upperQuartile !== null ? (
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/30"
            style={{
              left: `${at(lowerQuartile)}%`,
              width: `${at(upperQuartile) - at(lowerQuartile)}%`,
            }}
          />
        ) : null}
        {median !== null ? (
          <div
            className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${at(median)}%` }}
          />
        ) : null}
      </div>
      <dl className="mt-1 flex justify-between gap-2 text-xs">
        {(
          [
            [t("Minimum"), minimum],
            [t("Lower quartile"), lowerQuartile],
            [t("Median"), median],
            [t("Upper quartile"), upperQuartile],
            [t("Maximum"), maximum],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="min-w-0 text-center">
            <dt className="truncate text-[11px] text-muted-foreground">
              {label}
            </dt>
            <dd className="numeric mt-0.5 font-medium">
              {value === null ? "—" : format(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ------------------------------------------------------------------- states

/**
 * Nothing here yet. Every social list has an empty state, and each one used to
 * write its own; an empty list that explains itself and offers the next step
 * is the difference between a feature that looks broken and one that looks new.
 */
export function SocialEmpty({
  icon: Icon = UsersRoundIcon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-4 text-center",
        compact ? "py-6" : "py-10"
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <div className="max-w-sm">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/**
 * The end of a one-decision flow.
 *
 * Accepting an invitation, declining one, and finding an expired link all end
 * the same way — a statement of what did or did not happen and a way back —
 * and five screens each wrote that ending differently. Saying plainly that
 * nothing was created is the whole point of the refusal case.
 */
export function SocialOutcome({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  action,
}: {
  tone?: "positive" | "neutral"
  icon?: ComponentType<{ className?: string }>
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  const Mark = Icon ?? (tone === "positive" ? ShieldCheckIcon : LockKeyholeIcon)

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 rounded-xl border bg-card px-6 py-10 text-center">
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full",
          tone === "positive"
            ? "bg-positive/12 text-positive"
            : "bg-muted text-muted-foreground"
        )}
      >
        <Mark className="size-5" aria-hidden />
      </span>
      <div>
        <p className="text-lg font-semibold tracking-tight">{title}</p>
        {children ? (
          <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {children}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** A card that leads somewhere, for hubs. */
export function SocialDestination({
  href,
  title,
  description,
  icon: Icon,
  badge,
}: {
  href: string
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  badge?: string | number
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-medium">
          {title}
          {badge !== undefined && badge !== 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
              {badge}
            </Badge>
          ) : null}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <ArrowRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

/** The action bar at the foot of a destructive or consequential panel. */
export function SocialActions({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ consent

/**
 * The box someone ticks to agree.
 *
 * Three screens each built this by hand out of a checkbox and a paragraph. It
 * is the moment consent is actually given, so it is one component with one
 * shape and a hit area that covers the whole thing.
 */
export function ConsentCheck({
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
        checked ? "border-positive/40 bg-positive/6" : "hover:bg-accent/40"
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <span className="text-sm leading-relaxed">{children}</span>
    </label>
  )
}

/**
 * An ordered choice, shown all at once.
 *
 * Exposure has three settings that mean progressively more disclosure, and a
 * dropdown hides two of them behind a click — so the reader cannot see that
 * they picked the middle of a scale. Few, ordered, consequential options
 * belong on screen together.
 */
export function SocialSegmented<T extends string>({
  label,
  value,
  options,
  disabled,
  onValueChange,
  className,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; icon?: LucideIcon }>
  disabled?: boolean
  onValueChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex w-full flex-wrap gap-1 rounded-lg bg-muted p-1",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "flex min-h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.icon ? (
              <option.icon className="size-3.5 shrink-0" aria-hidden />
            ) : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The three exposures, as the scale they are. */
export function ExposureChoice({
  value,
  disabled,
  allowRanking,
  onValueChange,
}: {
  value: SocialExposure
  disabled?: boolean
  allowRanking: boolean
  onValueChange: (value: SocialExposure) => void
}) {
  const t = useExtracted()

  return (
    <SocialSegmented<SocialExposure>
      label={t("How far this figure travels")}
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      options={[
        {
          value: "aggregate_only",
          label: t("Aggregate"),
          icon: ChartNoAxesColumnIcon,
        },
        { value: "member_visible", label: t("Members"), icon: EyeIcon },
        ...(allowRanking
          ? [
              {
                value: "ranking" as const,
                label: t("Ranking"),
                icon: TrophyIcon,
              },
            ]
          : []),
      ]}
    />
  )
}

/** A single choosable line in a policy — a metric, its exposure, its weight. */
export function MetricChoice({
  label,
  description,
  exposure,
  required = false,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  description?: ReactNode
  exposure?: SocialExposure
  required?: boolean
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const t = useExtracted()

  return (
    <label
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-colors",
        disabled ? "cursor-default" : "cursor-pointer hover:bg-accent/40"
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {required ? (
            <Badge variant="secondary">{t("Required")}</Badge>
          ) : null}
          {exposure ? <ExposureBadge exposure={exposure} /> : null}
        </span>
        {description ? (
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export type { SocialExposure, SocialMetric }
export type SocialIcon = LucideIcon
