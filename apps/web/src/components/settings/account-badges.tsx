"use client"

import { FlameIcon, ZapIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { usePreferences } from "@/hooks/use-preferences"

const EARLY_BIRD_CUTOFF = Date.parse("2025-09-01T00:00:00.000Z")

export function AccountBadges({ createdAt }: { createdAt: string }) {
  const t = useExtracted()
  const { preferences } = usePreferences()
  const earlyBird = Date.parse(createdAt) < EARLY_BIRD_CUTOFF
  const mokattam = preferences.unlockedThemes.includes("mokattam")

  if (!earlyBird && !mokattam) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {earlyBird ? (
        <Badge variant="secondary" title={t("Early Avermate member")}>
          <ZapIcon /> OG
        </Badge>
      ) : null}
      {mokattam ? (
        <Badge
          className="bg-orange-600 text-white"
          title={t("Mokattam supporter")}
        >
          <FlameIcon /> {t("Mokattam")}
        </Badge>
      ) : null}
    </span>
  )
}
