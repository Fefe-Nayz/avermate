import type { ReactNode } from "react"
import Link from "next/link"
import {
  EyeIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { initialsOf } from "@/components/shell/nav-user"
import { cn } from "@/lib/utils"

export function SocialPageHeading({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  )
}

export function PrivacyBoundaryNotice({
  compact = false,
}: {
  compact?: boolean
}) {
  const t = useExtracted()

  return (
    <Alert
      className={cn("border-primary/20 bg-primary/[0.035]", compact && "py-2")}
    >
      <ShieldCheckIcon aria-hidden />
      <AlertTitle>{t("Shared by choice")}</AlertTitle>
      <AlertDescription>
        {t(
          "A missing permission always means no access. Friends and group managers never receive your complete grades, subject names, notes, comments, dates or email through social views."
        )}{" "}
        <Link href="/legal/social-sharing">
          {t("How social sharing works")}
        </Link>
      </AlertDescription>
    </Alert>
  )
}

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
      <Avatar className={size === "large" ? "size-12" : undefined}>
        <AvatarImage src={avatarUrl ?? undefined} alt="" />
        <AvatarFallback>{initialsOf(displayName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{displayName}</p>
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

export function SocialMetricCard({
  label,
  value,
  description,
  privateValue = false,
}: {
  label: string
  value: ReactNode
  description?: string
  privateValue?: boolean
}) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {privateValue ? (
            <LockKeyholeIcon className="size-3.5" aria-hidden />
          ) : null}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div className="numeric text-2xl font-semibold">{value}</div>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function SharingFieldList({
  fields,
  emptyLabel,
}: {
  fields: Array<{
    key: string
    label: string
    required?: boolean
    exposure?: string
  }>
  emptyLabel: string
}) {
  const t = useExtracted()

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {fields.map((field) => (
        <li
          key={field.key}
          className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5"
        >
          <EyeIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="min-w-0 flex-1 text-sm">{field.label}</span>
          {field.required ? (
            <Badge variant="secondary">{t("Required")}</Badge>
          ) : null}
          {field.exposure ? (
            <Badge variant="outline">{field.exposure}</Badge>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function GroupTypeIcon({ className }: { className?: string }) {
  return <UsersRoundIcon className={cn("size-4", className)} aria-hidden />
}
