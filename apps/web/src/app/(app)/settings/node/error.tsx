"use client"

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default function AvermateNodeSettingsError({
  reset,
}: {
  reset: () => void
}) {
  const t = useExtracted()
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>
        {t("Avermate Node settings could not be loaded.")}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        {t(
          "No placement or credential change has been inferred from this failure."
        )}
        <Button size="sm" variant="outline" onClick={reset}>
          <RotateCcwIcon data-icon="inline-start" />
          {t("Try again")}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
