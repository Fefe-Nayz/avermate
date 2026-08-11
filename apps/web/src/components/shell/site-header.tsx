"use client"

import { SearchIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ResponsiveBreadcrumb } from "@/components/breadcrumb/responsive-breadcrumb"
import { useBreadcrumbs } from "@/components/breadcrumb/use-breadcrumbs"
import { PeriodSwitcher } from "./period-switcher"
import { useCommandPalette } from "@/components/command/command-palette"

export function SiteHeader() {
  const t = useExtracted()
  const crumbs = useBreadcrumbs()
  const palette = useCommandPalette()

  return (
    <header className="sticky top-0 z-30 hidden h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-sm md:flex">
      <SidebarTrigger className="-ml-1" />
      <span aria-hidden className="mr-1 h-4 w-px shrink-0 bg-border" />

      <ResponsiveBreadcrumb items={crumbs} />

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => palette.open()}
          className="hidden gap-2 font-normal text-muted-foreground lg:inline-flex"
        >
          <SearchIcon className="size-4" />
          {t("Search")}
          <Kbd className="ml-2">⌘K</Kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Search")}
          onClick={() => palette.open()}
          className="lg:hidden"
        >
          <SearchIcon className="size-4" />
        </Button>
        <PeriodSwitcher />
      </div>
    </header>
  )
}
