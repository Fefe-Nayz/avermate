import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import { EyeIcon, EyeOffIcon, type LucideProps } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/**
 * The social vocabulary, sized to the feature it now serves: people, the
 * numbers they chose to share, and the few places to act on both. No client
 * directive here — server components compose these too.
 */

type Icon = ComponentType<LucideProps>

export function SocialHeading({
  icon: IconComponent,
  title,
  description,
  action,
}: {
  icon: Icon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconComponent className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action}
    </header>
  )
}

export function SocialSection({
  icon: IconComponent,
  title,
  description,
  action,
  children,
  className,
}: {
  icon?: Icon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {IconComponent ? (
            <IconComponent
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function SocialList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y rounded-lg border">{children}</ul>
}

export function SocialRow({
  href,
  leading,
  trailing,
  children,
}: {
  href?: string
  leading?: ReactNode
  trailing?: ReactNode
  children: ReactNode
}) {
  const content = (
    <>
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
    </>
  )
  return (
    <li className="flex min-w-0 items-center">
      {href ? (
        <Link
          href={href}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {content}
        </Link>
      ) : (
        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2">
          {content}
        </div>
      )}
    </li>
  )
}

export function SocialIdentity({
  name,
  handle,
  avatarUrl,
  hint,
}: {
  name: string
  handle?: string | null
  avatarUrl?: string | null
  hint?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-9 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback>{(name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        {handle || hint ? (
          <p className="truncate text-xs text-muted-foreground">
            {[handle ? `@${handle}` : null, hint].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function SocialEmpty({
  icon: IconComponent,
  title,
  description,
  action,
  compact = false,
}: {
  icon: Icon
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 text-center",
        compact ? "py-8" : "py-14"
      )}
    >
      <IconComponent className="size-6 text-muted-foreground/70" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function SocialActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

export function SocialCallout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "positive" | "caution"
  title?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm leading-relaxed",
        tone === "positive" && "border-positive/30 bg-positive/5",
        tone === "caution" && "border-caution/30 bg-caution/5",
        tone === "neutral" && "bg-muted/40"
      )}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="text-muted-foreground">{children}</div>
    </div>
  )
}

/** Shared / not shared, as a small badge readers learn once. */
export function SharingState({
  granted,
  label,
  className,
}: {
  granted: boolean
  label: string
  className?: string
}) {
  const IconComponent = granted ? EyeIcon : EyeOffIcon
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
      <IconComponent className="size-3 shrink-0" aria-hidden />
      {label}
    </span>
  )
}

/**
 * "14,52 / 20" in the owner's scale — the figure this feature exists for.
 * Percent figures (pass rates, goal progress) trade the denominator for "%".
 */
export function SharedAverage({
  ratio,
  scale,
  decimals,
  locale,
  unit = "scale",
  className,
}: {
  ratio: number | null
  scale: number
  decimals: number
  locale: string
  unit?: "scale" | "percent"
  className?: string
}) {
  if (ratio === null) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>—</span>
    )
  }
  if (unit === "percent") {
    const value = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(ratio * 100)
    return (
      <span className={cn("text-sm font-semibold tabular-nums", className)}>
        {value}
        <span className="font-normal text-muted-foreground"> %</span>
      </span>
    )
  }
  const digits = Math.min(decimals, 2)
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio * scale)
  const outOf = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(scale)
  return (
    <span className={cn("text-sm font-semibold tabular-nums", className)}>
      {value}
      <span className="font-normal text-muted-foreground"> / {outOf}</span>
    </span>
  )
}
