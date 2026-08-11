"use client"

import { useState } from "react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { env } from "@/lib/env"
import { haptic } from "@/lib/haptics"

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.7l4-3Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
      />
    </svg>
  )
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  )
}

/** OAuth entry points. Rendered above the form: most people use one of these. */
export function SocialButtons({ next }: { next?: string }) {
  const t = useExtracted()
  const [pending, setPending] = useState<string | null>(null)

  const start = async (provider: "google" | "microsoft") => {
    haptic("light")
    setPending(provider)
    try {
      await authClient.signIn.social({
        provider,
        callbackURL: `${env.appUrl}${next ?? "/dashboard"}`,
      })
    } catch {
      setPending(null)
      toast.error(t("That sign-in could not be started."))
    }
  }

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={pending !== null}
        onClick={() => start("google")}
      >
        {pending === "google" ? <Spinner className="size-4" /> : <GoogleMark />}
        {t("Continue with Google")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={pending !== null}
        onClick={() => start("microsoft")}
      >
        {pending === "microsoft" ? (
          <Spinner className="size-4" />
        ) : (
          <MicrosoftMark />
        )}
        {t("Continue with Microsoft")}
      </Button>
    </div>
  )
}
