"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  CheckCircle2Icon,
  DownloadIcon,
  MoreVerticalIcon,
  ShareIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { haptic } from "@/lib/haptics"

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function getStandaloneSnapshot() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  )
}

function subscribeToStandalone(onStoreChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)")
  media.addEventListener("change", onStoreChange)
  window.addEventListener("appinstalled", onStoreChange)
  return () => {
    media.removeEventListener("change", onStoreChange)
    window.removeEventListener("appinstalled", onStoreChange)
  }
}

const subscribeToStaticBrowserState = () => () => undefined

/** Browser-aware install guidance; no fake button when the browser owns install. */
export function InstallCard() {
  const t = useExtracted()
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null)
  const installed = useSyncExternalStore(
    subscribeToStandalone,
    getStandaloneSnapshot,
    () => false
  )
  const ios = useSyncExternalStore(
    subscribeToStaticBrowserState,
    () => /iPad|iPhone|iPod/.test(navigator.userAgent),
    () => false
  )

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => {
      setPrompt(null)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  if (installed) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2Icon className="size-4 shrink-0" />
        {t("Avermate is installed on this device.")}
      </div>
    )
  }

  if (prompt) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t("Open Avermate like an app, directly from your home screen.")}
        </p>
        <Button
          size="sm"
          onClick={async () => {
            haptic("light")
            await prompt.prompt()
            await prompt.userChoice
            setPrompt(null)
          }}
        >
          <DownloadIcon className="size-4" />
          {t("Install Avermate")}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex gap-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
      {ios ? (
        <ShareIcon className="mt-0.5 size-4 shrink-0" />
      ) : (
        <MoreVerticalIcon className="mt-0.5 size-4 shrink-0" />
      )}
      <p>
        {ios
          ? t(
              "In Safari, tap Share, then Add to Home Screen to install Avermate."
            )
          : t(
              "Open your browser menu and choose Install app or Add to home screen."
            )}
      </p>
    </div>
  )
}
