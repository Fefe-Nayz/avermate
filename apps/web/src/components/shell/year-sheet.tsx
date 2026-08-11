"use client"

import Link from "next/link"
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  ArchiveRestoreIcon,
  CheckIcon,
  GraduationCapIcon,
  PlusIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * Changing school year, on a phone.
 *
 * The desktop switcher lives in the sidebar header, which does not exist under
 * `md` — so on a phone the year needs an affordance of its own. A sheet of
 * choices rather than a form: picking a year is one tap, and every screen in
 * the app re-reads its data from it.
 */

interface YearSheetStore {
  open: () => void
}

const YearSheetContext = createContext<YearSheetStore | null>(null)

export function YearSheetProvider({ children }: { children: ReactNode }) {
  const t = useExtracted()
  const format = useFormatter()
  const { years, year, selectYear } = useYear()
  const [open, setOpen] = useState(false)
  const activeYears = years.filter((item) => !item.archivedAt)
  const hasArchivedYears = activeYears.length !== years.length

  const store = useMemo<YearSheetStore>(
    () => ({ open: () => setOpen(true) }),
    []
  )

  return (
    <YearSheetContext.Provider value={store}>
      {children}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="pb-safe">
          <DrawerHeader className="pb-2 text-left">
            <DrawerTitle>{t("School years")}</DrawerTitle>
            <DrawerDescription>
              {t("Everything you see follows the year you pick.")}
            </DrawerDescription>
          </DrawerHeader>

          <div className="grid gap-1 px-3 pb-4">
            {activeYears.map((item) => {
              const active = item.id === year?.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    haptic("selection")
                    selectYear(item.id)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex min-h-13 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-accent",
                    active && "bg-primary/8"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-xl",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <GraduationCapIcon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {format.dateTime(new Date(item.startsAt), {
                        month: "short",
                        year: "numeric",
                      })}
                      {" → "}
                      {format.dateTime(new Date(item.endsAt), {
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </span>
                  {active ? (
                    <CheckIcon className="size-5 shrink-0 text-primary" />
                  ) : null}
                </button>
              )
            })}

            {hasArchivedYears ? (
              <Link
                href="/settings/year"
                onClick={() => setOpen(false)}
                className="flex min-h-13 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-accent"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <ArchiveRestoreIcon className="size-5" />
                </span>
                <span className="text-sm font-medium">
                  {t("Manage archived years")}
                </span>
              </Link>
            ) : null}

            <Link
              href="/onboarding/new-year"
              onClick={() => setOpen(false)}
              className="flex min-h-13 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-accent"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed text-muted-foreground">
                <PlusIcon className="size-5" />
              </span>
              <span className="text-sm font-medium">{t("Add a year")}</span>
            </Link>
          </div>
        </DrawerContent>
      </Drawer>
    </YearSheetContext.Provider>
  )
}

export function useYearSheet(): YearSheetStore {
  return useContext(YearSheetContext) ?? { open: () => undefined }
}
