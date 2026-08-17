"use client"

import { ArrowDownUpIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerLabel,
  DropDrawerRadioGroup,
  DropDrawerRadioItem,
  DropDrawerTrigger,
} from "@/components/ui/drop-drawer"
import { haptic } from "@/lib/haptics"

/**
 * The list-sorting idiom in one place: an icon trigger opening a radio choice,
 * labeled inside the group. The grades page and the subject lists share it, so
 * choosing an order reads the same everywhere.
 *
 * A dropdown on a pointer, a bottom sheet under a thumb — see `DropDrawer`. A
 * floating menu anchored to an icon in the top corner of a phone is the wrong
 * end of the screen for the hand that has to reach it, and its rows are cursor
 * height.
 */
export function SortMenu<T extends string>({
  value,
  onValueChange,
  options,
  variant = "outline",
  size = "icon",
  className,
}: {
  value: T
  onValueChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  variant?: "outline" | "ghost"
  size?: "icon" | "icon-sm"
  className?: string
}) {
  const t = useExtracted()
  return (
    <DropDrawer>
      <DropDrawerTrigger
        render={
          <Button
            variant={variant}
            size={size}
            aria-label={t("Sort")}
            className={className}
          />
        }
      >
        <ArrowDownUpIcon className="size-4" />
      </DropDrawerTrigger>
      <DropDrawerContent align="end">
        <DropDrawerRadioGroup
          value={value}
          onValueChange={(next) => {
            haptic("selection")
            onValueChange(next as T)
          }}
        >
          {/* Inside the radio group, so it labels it rather than floating
              above as a heading with nothing attached. */}
          <DropDrawerLabel>{t("Sort by")}</DropDrawerLabel>
          {options.map((option) => (
            <DropDrawerRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropDrawerRadioItem>
          ))}
        </DropDrawerRadioGroup>
      </DropDrawerContent>
    </DropDrawer>
  )
}
