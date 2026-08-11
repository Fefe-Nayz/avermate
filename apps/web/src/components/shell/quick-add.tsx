"use client"

import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  BookMarkedIcon,
  CalendarRangeIcon,
  FolderPlusIcon,
  PlusCircleIcon,
  SigmaIcon,
  TargetIcon,
  type LucideIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { ResponsiveSheet } from "@/components/ui/responsive-sheet"
import { haptic } from "@/lib/haptics"

/**
 * The "+" action.
 *
 * A sheet of choices, not a form — picking what to create is a one-tap
 * decision, and every option then opens a full screen of its own. That is the
 * line this app draws: choices can live in a sheet, input never does.
 */

interface QuickAddStore {
  open: () => void
  close: () => void
}

const QuickAddContext = createContext<QuickAddStore | null>(null)

interface Action {
  href: string
  label: string
  hint: string
  icon: LucideIcon
  accent?: boolean
}

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const t = useExtracted()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const store = useMemo<QuickAddStore>(
    () => ({ open: () => setOpen(true), close: () => setOpen(false) }),
    []
  )

  const actions: Action[] = [
    {
      href: "/grades/new",
      label: t("Grade"),
      hint: t("Record a result you were given"),
      icon: PlusCircleIcon,
      accent: true,
    },
    {
      href: "/subjects/new",
      label: t("Subject"),
      hint: t("Add a course to this year"),
      icon: BookMarkedIcon,
    },
    {
      href: "/subjects/new?kind=category",
      label: t("Category"),
      hint: t("Group subjects without adding a level of averaging"),
      icon: FolderPlusIcon,
    },
    {
      href: "/goals/new",
      label: t("Goal"),
      hint: t("Set a target and get a way to reach it"),
      icon: TargetIcon,
    },
    {
      href: "/settings/averages/new",
      label: t("Custom average"),
      hint: t("Combine a few subjects into their own average"),
      icon: SigmaIcon,
    },
    {
      href: "/settings/year",
      label: t("Period"),
      hint: t("Split the year into trimesters or semesters"),
      icon: CalendarRangeIcon,
    },
  ]

  const go = useCallback(
    (href: string) => {
      haptic("light")
      setOpen(false)
      router.push(href)
    },
    [router]
  )

  return (
    <QuickAddContext.Provider value={store}>
      {children}
      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title={t("What are you adding?")}
        description={t("Everything here opens as its own screen.")}
      >
        <div className="grid gap-1">
            {actions.map((action) => (
              <button
                key={action.href}
                type="button"
                onClick={() => go(action.href)}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60 active:bg-accent"
              >
                <span
                  className={
                    action.accent
                      ? "flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
                      : "flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                  }
                >
                  <action.icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {action.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {action.hint}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </ResponsiveSheet>
    </QuickAddContext.Provider>
  )
}

export function useQuickAdd(): QuickAddStore {
  return (
    useContext(QuickAddContext) ?? {
      open: () => undefined,
      close: () => undefined,
    }
  )
}
