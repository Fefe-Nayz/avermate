"use client"

import { MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"

/** A deliberately tiny public-route island; the rest of landing/auth is RSC. */
export function PublicThemeToggle() {
  const t = useExtracted()
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("Toggle color theme")}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="size-4 dark:hidden" />
      <MoonIcon className="hidden size-4 dark:block" />
    </Button>
  )
}
