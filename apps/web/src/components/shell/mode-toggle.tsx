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
  const { theme, resolvedTheme, setPreferredTheme } = useThemeControl()

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
        {resolvedTheme === "dark" ? (
          <MoonIcon className="size-4" />
        ) : (
          <SunIcon className="size-4" />
        )}
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
                <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
