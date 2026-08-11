"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { AlertTriangleIcon, HomeIcon, RotateCcwIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { orpc } from "@/lib/orpc"

/** Authenticated route failure with a deduplicated, privacy-conscious report. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useExtracted()
  const reported = useRef(false)
  const report = useMutation(orpc.feedback.autoReport.mutationOptions())

  useEffect(() => {
    if (reported.current) return
    reported.current = true

    const opaqueDigest = error.digest || "client-boundary"
    const storageKey = `avermate:error:${opaqueDigest}`
    if (sessionStorage.getItem(storageKey)) return
    sessionStorage.setItem(storageKey, "1")

    report.mutate({
      source: "web",
      errorDigest: opaqueDigest,
      route: window.location.pathname,
      appVersion: "web-0.0.1",
      context: {
        viewport: `${window.innerWidth}×${window.innerHeight}`,
      },
    })
  }, [error, report])

  return (
    <main className="grid min-h-[60svh] place-items-center px-4 py-12">
      <section className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border bg-card p-6 text-center shadow-sm">
        <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangleIcon className="size-6" aria-hidden />
        </span>
        <div className="space-y-2">
          <h1 className="font-heading text-xl font-semibold">
            {t("Something went wrong")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "The problem was reported automatically. You can retry without losing your account data."
            )}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={reset}>
            <RotateCcwIcon className="size-4" />
            {t("Try again")}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            render={<Link href="/dashboard" />}
          >
            <HomeIcon className="size-4" />
            {t("Dashboard")}
          </Button>
        </div>
      </section>
    </main>
  )
}
