"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import confetti from "canvas-confetti"
import { FlameIcon, HeartHandshakeIcon, SparklesIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { usePreferences } from "@/hooks/use-preferences"
import { orpc } from "@/lib/orpc"

const CELEBRATION_KEY = "mokattam-unlocked"

/** A once-per-grant thank-you. The preference is acknowledged server-side. */
export function MokattamCelebration() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { preferences, update } = usePreferences()
  const [dismissed, setDismissed] = useState(false)
  const handled = useRef(false)
  const mark = useMutation({
    ...orpc.preferences.markCelebrationSeen.mutationOptions(),
    onSuccess: (next) => {
      queryClient.setQueryData(orpc.preferences.get.queryKey(), next)
    },
  })
  const markSeen = mark.mutate
  const eligible =
    preferences.unlockedThemes.includes("mokattam") &&
    !preferences.seenCelebrations.includes(CELEBRATION_KEY)

  useEffect(() => {
    if (!eligible || handled.current) return
    handled.current = true
    if (!preferences.reduceMotion) {
      void confetti({
        particleCount: 120,
        spread: 95,
        startVelocity: 42,
        gravity: 0.8,
        origin: { x: 0.5, y: 0.38 },
        colors: ["#ea580c", "#f97316", "#fb923c", "#fdba74", "#fff7ed"],
        disableForReducedMotion: true,
      })
    }
  }, [eligible, preferences.reduceMotion])

  return (
    <Dialog
      open={eligible && !dismissed}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return
        setDismissed(true)
        markSeen({ key: CELEBRATION_KEY })
      }}
    >
      <DialogContent className="overflow-hidden border-orange-300/70 p-0 dark:border-orange-500/30">
        <div className="bg-gradient-to-br from-orange-100 via-amber-50 to-background p-5 dark:from-orange-500/20 dark:via-amber-500/10">
          <div className="flex gap-2">
            <Badge className="bg-orange-600 text-white">
              <FlameIcon /> {t("Mokattam")}
            </Badge>
            <Badge variant="outline" className="border-orange-300/70">
              <HeartHandshakeIcon /> {t("Thank you")}
            </Badge>
          </div>
          <DialogHeader className="mt-4">
            <DialogTitle className="text-xl text-orange-950 dark:text-orange-50">
              {t("A new theme is yours")}
            </DialogTitle>
            <DialogDescription className="text-orange-950/75 dark:text-orange-100/75">
              {t(
                "Your support unlocked Mokattam. It now follows your account on the web and mobile app."
              )}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="px-5 pb-5">
          <p className="text-sm text-muted-foreground">
            {t(
              "You can activate it now or find it later in Appearance. Your current theme is never replaced without your choice."
            )}
          </p>
        </div>
        <DialogFooter className="mx-0 mb-0 px-5">
          <Button
            variant="outline"
            onClick={() => {
              setDismissed(true)
              markSeen({ key: CELEBRATION_KEY })
            }}
          >
            {t("Later")}
          </Button>
          <Button
            className="bg-orange-600 text-white hover:bg-orange-700"
            onClick={() => {
              update({ themePreset: "mokattam" })
              setDismissed(true)
              markSeen({ key: CELEBRATION_KEY })
            }}
          >
            <SparklesIcon className="size-4" />
            {t("Activate Mokattam")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
