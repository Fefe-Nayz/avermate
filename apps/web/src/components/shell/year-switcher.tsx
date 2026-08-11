"use client"

import Link from "next/link"
import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  GraduationCapIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"

export function YearSwitcher() {
  const t = useExtracted()
  const format = useFormatter()
  const { years, year, selectYear } = useYear()
  const { state } = useSidebar()

  const subtitle = year
    ? `${format.dateTime(new Date(year.startsAt), { month: "short", year: "numeric" })} → ${format.dateTime(new Date(year.endsAt), { month: "short", year: "numeric" })}`
    : t("No year yet")

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <GraduationCapIcon className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">
                {year?.name ?? t("Avermate")}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4 opacity-60" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="start"
            side={state === "collapsed" ? "right" : "bottom"}
            className="w-(--anchor-width) min-w-56"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("School years")}</DropdownMenuLabel>
              {years.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => {
                    haptic("selection")
                    selectYear(item.id)
                  }}
                >
                  <span className="truncate">{item.name}</span>
                  {item.id === year?.id ? (
                    <CheckIcon className="ml-auto size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/onboarding/new-year" />}>
              <PlusIcon className="size-4" />
              {t("Add a year")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
