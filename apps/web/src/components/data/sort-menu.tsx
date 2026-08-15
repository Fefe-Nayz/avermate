"use client"

import { ArrowDownUpIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { haptic } from "@/lib/haptics"

/**
 * The list-sorting idiom in one place: an icon trigger opening a radio
 * dropdown, labeled inside the group. The grades page and the subject lists
 * share it, so choosing an order reads the same everywhere.
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
    <DropdownMenu>
      <DropdownMenuTrigger
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            haptic("selection")
            onValueChange(next as T)
          }}
        >
          {/* Inside the radio group, so it labels it rather than floating
              above as a heading with nothing attached. */}
          <DropdownMenuLabel>{t("Sort by")}</DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
