import type { ComponentType, ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRightIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { initialsOf } from "@/lib/name"

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
 * permission and a withheld one must never be told apart by a word alone.
 */

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
  children,
  className,
}: {
  title?: string
  description?: string
  icon?: ComponentType<{ className?: string }>
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {title ? (
        <header className="flex items-start justify-between gap-3 px-4 pt-4">
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
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {trailing}
        </div>
      ) : null}
    </div>
  )
}

/** A list of rows with the dividers already right. */
export function SocialList({ children }: { children: ReactNode }) {
  return <div className="divide-y">{children}</div>
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
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
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
export function SocialActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

export function GroupTypeIcon({ className }: { className?: string }) {
  return <UsersRoundIcon className={className} aria-hidden />
}

/** Kept for the screens still to be rebuilt on the pieces above. */
export function SocialPageHeading(props: {
  title: string
  description: string
  action?: ReactNode
}) {
  return <SocialHeading {...props} />
}

export function PrivacyBoundaryNotice({ compact }: { compact?: boolean }) {
  return <PrivacyNote className={compact ? "text-[11px]" : undefined} />
}

export function SocialMetricCard(props: {
  label: string
  value: string | number
  description?: string
}) {
  return (
    <SocialStat label={props.label} value={props.value} hint={props.description} />
  )
}

export { Button as SocialButton }
