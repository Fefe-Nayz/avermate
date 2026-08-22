"use client"

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default function LearningError({ reset }: { reset: () => void }) {
  const t = useExtracted()
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>
        {t("The learning workspace could not be loaded.")}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        {t("The original grades and papers have not been changed.")}
        <Button size="sm" variant="outline" onClick={reset}>
          <RotateCcwIcon /> {t("Try again")}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
