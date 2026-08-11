"use client"

import { useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "./year-provider"

/**
 * Nothing in the app means anything without a year, so the first visit goes
 * straight to onboarding instead of showing a shell full of empty states.
 */
export function YearGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { isLoading, years } = useYear()

  useEffect(() => {
    if (isLoading || years.length > 0) return
    router.replace("/onboarding")
  }, [isLoading, years, router])

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (years.length === 0) return null

  return <>{children}</>
}
