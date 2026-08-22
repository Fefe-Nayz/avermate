"use client"

import { useRouter } from "next/navigation"
import { useThemeControl } from "@/hooks/use-preferences"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useExtracted } from "next-intl"
import {
  BookMarkedIcon,
  HistoryIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  SigmaIcon,
  Settings2Icon,
  TargetIcon,
} from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { NAV_ENTRIES } from "@/lib/nav"
import { useSettingsSections } from "@/lib/nav-labels"
import { useMaybeYear } from "@/components/year/year-provider"
import { AverageValue } from "@/components/data/value"
import { useIsAdmin } from "@/hooks/use-admin"
import { useMaterialsSearchEntries } from "@/components/materials/materials-search-entries"
import { cn } from "@/lib/utils"

/**
 * Search everything: screens, subjects, grades, goals, and a few commands.
 *
 * Deliberately flat. A student with sixty subjects wants to type three letters
 * and land on one, not navigate a tree they already navigated once.
 */

interface PaletteStore {
  open: () => void
  close: () => void
}

export function CommandResultColumns({
  primary,
  secondary,
  secondaryKind,
}: {
  primary: ReactNode
  secondary: ReactNode
  secondaryKind: "label" | "value"
}) {
  return (
    <span
      data-slot="command-result-columns"
      data-secondary-kind={secondaryKind}
      className={cn(
        "grid min-w-0 flex-1 items-center gap-3",
        secondaryKind === "label"
          ? "grid-cols-[minmax(0,1fr)_minmax(6rem,40%)]"
          : "grid-cols-[minmax(0,1fr)_minmax(3rem,auto)]"
      )}
    >
      <span
        data-slot="command-result-primary"
        className="min-w-0 break-words whitespace-normal"
      >
        {primary}
      </span>
      <span
        data-slot="command-result-secondary"
        className="min-w-0 justify-self-end text-right break-words whitespace-normal"
      >
        {secondary}
      </span>
    </span>
  )
}

const PaletteContext = createContext<PaletteStore | null>(null)

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const t = useExtracted()
  const router = useRouter()
  const year = useMaybeYear()
  const { isAdmin } = useIsAdmin()
  const { resolvedTheme, toggleTheme } = useThemeControl()
  const [open, setOpen] = useState(false)

  const store = useMemo<PaletteStore>(
    () => ({ open: () => setOpen(true), close: () => setOpen(false) }),
    []
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const run = (action: () => void) => {
    setOpen(false)
    action()
  }

  const labels: Record<string, string> = {
    Dashboard: t("Dashboard"),
    Subjects: t("Subjects"),
    Grades: t("Grades"),
    Materials: t("Materials"),
    Learning: t("Learning"),
    "Study projects": t("Study projects"),
    Assistant: t("Assistant"),
    Goals: t("Goals"),
    Planning: t("Planning"),
    Insights: t("Insights"),
    Social: t("Social"),
    "Year in review": t("Year in review"),
    Settings: t("Settings"),
    Admin: t("Admin"),
  }

  // Materials are the one place in the app holding hundreds of named things,
  // and they were the one place this could not find anything in. Nothing is
  // fetched until the palette is opened.
  const materials = useMaterialsSearchEntries(year?.yearId ?? undefined, open)
  const subjects = year?.subjects ?? []
  const averages = year?.customAverages ?? []
  const grades = year?.graph.allGrades().slice(-60).reverse() ?? []
  const settingsSections = useSettingsSections()

  return (
    <PaletteContext.Provider value={store}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("Search")}
        description={t("Jump to a screen, a subject or a grade")}
      >
        <Command>
          <CommandInput placeholder={t("Search subjects, grades, screens…")} />
          <CommandList>
            <CommandEmpty>{t("Nothing matches.")}</CommandEmpty>

            <CommandGroup heading={t("Create")}>
              <CommandItem
                value={`${t("New grade")} add`}
                onSelect={() => run(() => router.push("/grades/new"))}
              >
                <PlusIcon />
                {t("New grade")}
              </CommandItem>
              <CommandItem
                value={`${t("New subject")} add`}
                onSelect={() => run(() => router.push("/subjects/new"))}
              >
                <BookMarkedIcon />
                {t("New subject")}
              </CommandItem>
              <CommandItem
                value={`${t("New goal")} add`}
                onSelect={() => run(() => router.push("/goals/new"))}
              >
                <TargetIcon />
                {t("New goal")}
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading={t("Go to")}>
              {NAV_ENTRIES.filter((entry) => !entry.adminOnly || isAdmin).map(
                (entry) => (
                  <CommandItem
                    key={entry.href}
                    value={`${labels[entry.label] ?? entry.label} ${
                      entry.href === "/planning"
                        ? `${t("Agenda")} ${t("Calendar")} ${t("Tasks")} ${t("Kanban")} ${t("Timetable")}`
                        : ""
                    }`}
                    onSelect={() => run(() => router.push(entry.href))}
                  >
                    <entry.icon />
                    {labels[entry.label] ?? entry.label}
                  </CommandItem>
                )
              )}
            </CommandGroup>

            <CommandGroup heading={t("Settings")}>
              {settingsSections.map((section) => (
                <CommandItem
                  key={section.href}
                  value={`${section.label} ${section.href}`}
                  onSelect={() => run(() => router.push(section.href))}
                >
                  <Settings2Icon />
                  {section.label}
                </CommandItem>
              ))}
            </CommandGroup>

            {subjects.length > 0 ? (
              <CommandGroup heading={t("Subjects")}>
                {subjects.map((subject) => (
                  <CommandItem
                    key={subject.id}
                    value={`${subject.name} ${subject.shortName ?? ""}`}
                    className="[&>svg:last-child]:hidden"
                    onSelect={() =>
                      run(() => router.push(`/subjects/${subject.id}`))
                    }
                  >
                    <BookMarkedIcon />
                    <CommandResultColumns
                      primary={subject.name}
                      secondaryKind="value"
                      secondary={
                        <AverageValue
                          ratio={year?.graph.ratio(subject.id) ?? null}
                          animate={false}
                          decimals={1}
                          colored
                          className="text-xs"
                        />
                      }
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {year ? (
              <CommandGroup heading={t("Averages")}>
                <CommandItem
                  value={t("General average")}
                  onSelect={() => run(() => router.push("/averages/general"))}
                >
                  <SigmaIcon />
                  {t("General average")}
                </CommandItem>
                {averages.map((average) => (
                  <CommandItem
                    key={average.id}
                    value={average.name}
                    onSelect={() =>
                      run(() => router.push(`/averages/${average.id}`))
                    }
                  >
                    <SigmaIcon />
                    <span className="truncate">{average.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {materials.length > 0 ? (
              <CommandGroup heading={t("Materials")}>
                {materials.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={`${entry.title} ${entry.kind}`}
                    className="[&>svg:last-child]:hidden"
                    onSelect={() => run(() => router.push(entry.href))}
                  >
                    <CommandResultColumns
                      primary={entry.title}
                      secondaryKind="label"
                      secondary={
                        <span className="text-xs text-muted-foreground">
                          {entry.kind}
                        </span>
                      }
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {grades.length > 0 ? (
              <CommandGroup heading={t("Recent grades")}>
                {grades.map((grade) => (
                  <CommandItem
                    key={grade.id}
                    value={`${grade.name} ${year?.graph.byId(grade.subjectId)?.name ?? ""}`}
                    className="[&>svg:last-child]:hidden"
                    onSelect={() =>
                      run(() => router.push(`/grades/${grade.id}`))
                    }
                  >
                    <CommandResultColumns
                      primary={grade.name}
                      secondaryKind="label"
                      secondary={
                        <span className="text-xs text-muted-foreground">
                          {year?.graph.byId(grade.subjectId)?.name}
                        </span>
                      }
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            <CommandSeparator />

            <CommandGroup heading={t("Commands")}>
              <CommandItem
                value={t("Toggle theme")}
                onSelect={() => run(() => toggleTheme())}
              >
                {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
                {t("Toggle theme")}
              </CommandItem>
              <CommandItem
                value={t("Time travel")}
                onSelect={() =>
                  run(() => {
                    if (!year) return
                    year.setTimelineDate(
                      year.timelineDate
                        ? null
                        : new Date().toISOString().slice(0, 10)
                    )
                  })
                }
              >
                <HistoryIcon />
                {year?.timelineDate ? t("Back to today") : t("Time travel")}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </PaletteContext.Provider>
  )
}

export function useCommandPalette(): PaletteStore {
  return (
    useContext(PaletteContext) ?? {
      open: () => undefined,
      close: () => undefined,
    }
  )
}
