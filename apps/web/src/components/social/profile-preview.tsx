"use client"

import { EyeIcon, LockKeyholeIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { SocialIdentity, useSocialLabels } from "@/components/social/social-ui"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export interface SocialProfileProjection {
  displayName?: string | null
  avatar?: string | null
  bio?: string | null
  educationBand?: string | null
}

/**
 * What one audience actually receives.
 *
 * The projection the server returns *is* the answer — a field it left out is a
 * field that person cannot see — so the withheld ones are drawn as locked
 * lines rather than omitted. A preview that silently drops what is not shared
 * looks identical to a preview of a sparse profile, and the difference between
 * those two is the entire point of the screen.
 */
export function ProfilePreview({
  profile,
  audienceLabel,
  exact = false,
}: {
  profile: SocialProfileProjection
  audienceLabel: string
  exact?: boolean
}) {
  const t = useExtracted()
  const labels = useSocialLabels()
  const name = profile.displayName?.trim()

  const rows = [
    {
      key: "bio",
      label: t("Bio"),
      value: profile.bio?.trim() || null,
    },
    {
      key: "educationBand",
      label: t("Education level"),
      value: profile.educationBand
        ? labels.educationBand(profile.educationBand)
        : null,
    },
  ]

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {audienceLabel}
        </p>
        {exact ? (
          <Badge variant="outline" className="shrink-0">
            <EyeIcon aria-hidden /> {t("Exact view")}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {name ? (
          <SocialIdentity
            size="large"
            displayName={name}
            avatarUrl={profile.avatar}
            secondary={
              profile.avatar ? undefined : t("Avatar is not shared with them")
            }
          />
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LockKeyholeIcon className="size-4 shrink-0" aria-hidden />
            {t("Even your display name is withheld from this audience.")}
          </p>
        )}

        <dl className="divide-y rounded-lg border">
          {rows.map((row) => (
            <div key={row.key} className="flex gap-3 px-3 py-2.5 text-sm">
              <dt className="w-28 shrink-0 text-xs text-muted-foreground">
                {row.label}
              </dt>
              <dd
                className={cn(
                  "min-w-0 flex-1",
                  row.value ? "leading-relaxed" : "text-muted-foreground"
                )}
              >
                {row.value ?? (
                  <span className="flex items-center gap-1.5">
                    <LockKeyholeIcon className="size-3.5 shrink-0" aria-hidden />
                    {t("Not shared")}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
