"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useThemeControl } from "@/hooks/use-preferences"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * The theme control, in the header where every other cross-app utility now
 * lives. It offers all three choices rather than toggling: "system" is a real
 * preference, and a toggle cannot express it.
 */
export function ModeToggle({ className }: { className?: string }) {
  const t = useExtracted()
  const { theme, setPreferredTheme } = useThemeControl()

  const options = [
    { value: "light" as const, label: t("Light"), icon: SunIcon },
    { value: "dark" as const, label: t("Dark"), icon: MoonIcon },
    { value: "system" as const, label: t("System"), icon: MonitorIcon },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Colour theme")}
            className={cn(className)}
          />
        }
      >
        {/* Both icons, CSS choosing — the same pattern as the public
            toggle. `resolvedTheme` is unknowable on the server, so
            branching on it desynced the server HTML from a dark client's
            first render and React threw the whole tree away — which is
            also what client-rendered the theme provider's inline script
            and triggered the console warning about it. */}
        <SunIcon className="size-4 dark:hidden" />
        <MoonIcon className="hidden size-4 dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("Colour theme")}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => {
                haptic("selection")
                setPreferredTheme(option.value)
              }}
            >
              <option.icon className="size-4" />
              <span className="flex-1">{option.label}</span>
              {theme === option.value ? (
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-primary"
                />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
