"use client"

import { useMemo, type ComponentType, type ReactNode } from "react"
import {
  FolderPlusIcon,
  KeyRoundIcon,
  PlusIcon,
  SigmaIcon,
  TagsIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { SelectControl } from "@/components/forms/controls"
import { Button } from "@/components/ui/button"
import {
  DragHandle,
  SortableGroup,
  SortableList,
  SortableRoot,
  SortableRow,
} from "@/components/ui/sortable-list"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { CARD_ACCENTS } from "@/components/cards/card-accent"
import { cn } from "@/lib/utils"
import { randomId } from "@/lib/id"

export interface PresetEditorSubject {
  key: string
  name: string
  shortName?: string
  kind: "subject" | "category"
  isMain: boolean
  coefficient: number
  children: PresetEditorSubject[]
}

export interface PresetEditorAverageEntry {
  subjectKey: string
  coefficient: number | null
  includeChildren: boolean
}

export interface PresetEditorAverage {
  key: string
  name: string
  /** @deprecated Kept in the serialized preset shape; always false. */
  isMain: boolean
  entries: PresetEditorAverageEntry[]
}

export interface PresetEditorGradeType {
  key: string
  name: string
  titlePrefix: string
  coefficient: number
  outOf: number
  accent: string | null
}

export const PRESET_GRADE_TYPE_LIMITS = {
  name: 48,
  titlePrefix: 48,
  coefficient: 1_000,
  outOf: 100_000,
} as const

export const PRESET_EDITOR_LIMITS = {
  rootSubjects: 300,
  childSubjects: 200,
  subjectName: 96,
  subjectShortName: 24,
  coefficient: 1_000,
  averages: 100,
  averageName: 64,
  averageEntries: 200,
  gradeTypes: 24,
  nodeKey: 128,
  accent: 32,
} as const

const NODE_KEY = /^[a-zA-Z0-9:._-]+$/

function nodeKeyIsValid(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= PRESET_EDITOR_LIMITS.nodeKey &&
    NODE_KEY.test(key)
  )
}

function finiteBetween(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

export function presetGradeTypeIsValid(type: PresetEditorGradeType): boolean {
  const name = type.name.trim()
  return (
    name.length > 0 &&
    name.length <= PRESET_GRADE_TYPE_LIMITS.name &&
    type.titlePrefix.length <= PRESET_GRADE_TYPE_LIMITS.titlePrefix &&
    Number.isFinite(type.coefficient) &&
    type.coefficient >= 0 &&
    type.coefficient <= PRESET_GRADE_TYPE_LIMITS.coefficient &&
    Number.isFinite(type.outOf) &&
    type.outOf > 0 &&
    type.outOf <= PRESET_GRADE_TYPE_LIMITS.outOf
  )
}

export interface PresetEditorConfiguration {
  subjects: PresetEditorSubject[]
  averages: PresetEditorAverage[]
  /** Absent in a version published before assessment types existed. */
  gradeTypes?: PresetEditorGradeType[]
}

/** Mirrors the managed-preset schema used when a class builder is submitted. */
export function presetConfigurationIsValid(
  configuration: PresetEditorConfiguration
): boolean {
  if (
    configuration.subjects.length === 0 ||
    configuration.subjects.length > PRESET_EDITOR_LIMITS.rootSubjects ||
    configuration.averages.length > PRESET_EDITOR_LIMITS.averages ||
    (configuration.gradeTypes?.length ?? 0) > PRESET_EDITOR_LIMITS.gradeTypes
  ) {
    return false
  }

  const subjectKeys = new Set<string>()
  const subjectsAreValid = (
    subjects: readonly PresetEditorSubject[],
    limit: number
  ): boolean =>
    subjects.length <= limit &&
    subjects.every((subject) => {
      const name = subject.name.trim()
      const shortName = subject.shortName?.trim() ?? ""
      if (
        !nodeKeyIsValid(subject.key) ||
        subjectKeys.has(subject.key) ||
        name.length === 0 ||
        name.length > PRESET_EDITOR_LIMITS.subjectName ||
        shortName.length > PRESET_EDITOR_LIMITS.subjectShortName ||
        !finiteBetween(
          subject.coefficient,
          0,
          PRESET_EDITOR_LIMITS.coefficient
        ) ||
        (subject.kind === "subject" && subject.children.length > 0)
      ) {
        return false
      }
      subjectKeys.add(subject.key)
      return subjectsAreValid(
        subject.children,
        PRESET_EDITOR_LIMITS.childSubjects
      )
    })

  if (
    !subjectsAreValid(configuration.subjects, PRESET_EDITOR_LIMITS.rootSubjects)
  ) {
    return false
  }

  const averageKeys = new Set<string>()
  if (
    !configuration.averages.every((average) => {
      const entryKeys = new Set<string>()
      const name = average.name.trim()
      if (
        !nodeKeyIsValid(average.key) ||
        averageKeys.has(average.key) ||
        name.length === 0 ||
        name.length > PRESET_EDITOR_LIMITS.averageName ||
        average.entries.length === 0 ||
        average.entries.length > PRESET_EDITOR_LIMITS.averageEntries
      ) {
        return false
      }
      averageKeys.add(average.key)
      return average.entries.every((entry) => {
        if (
          !subjectKeys.has(entry.subjectKey) ||
          entryKeys.has(entry.subjectKey) ||
          (entry.coefficient !== null &&
            !finiteBetween(
              entry.coefficient,
              0,
              PRESET_EDITOR_LIMITS.coefficient
            ))
        ) {
          return false
        }
        entryKeys.add(entry.subjectKey)
        return true
      })
    })
  ) {
    return false
  }

  const gradeTypeKeys = new Set<string>()
  return (configuration.gradeTypes ?? []).every((type) => {
    if (
      !nodeKeyIsValid(type.key) ||
      gradeTypeKeys.has(type.key) ||
      !presetGradeTypeIsValid(type) ||
      (type.accent !== null &&
        type.accent.trim().length > PRESET_EDITOR_LIMITS.accent)
    ) {
      return false
    }
    gradeTypeKeys.add(type.key)
    return true
  })
}

interface FlatSubject {
  key: string
  name: string
  kind: "subject" | "category"
  depth: number
  parentKey: string | null
  descendantKeys: string[]
  childCount: number
}

function freshKey(prefix: "subject" | "average" | "type") {
  return `${prefix}:${randomId().replaceAll("-", "")}`
}

function makeSubject(
  kind: "subject" | "category" = "subject"
): PresetEditorSubject {
  return {
    key: freshKey("subject"),
    name: kind === "category" ? "New category" : "New subject",
    kind,
    isMain: false,
    coefficient: 1,
    children: [],
  }
}

function flatten(
  nodes: readonly PresetEditorSubject[],
  depth = 0,
  parentKey: string | null = null
): FlatSubject[] {
  return nodes.flatMap((node) => {
    const children = flatten(node.children, depth + 1, node.key)
    return [
      {
        key: node.key,
        name: node.name,
        kind: node.kind,
        depth,
        parentKey,
        descendantKeys: children.map((child) => child.key),
        childCount: node.children.length,
      },
      ...children,
    ]
  })
}

function updateNode(
  nodes: readonly PresetEditorSubject[],
  key: string,
  update: (node: PresetEditorSubject) => PresetEditorSubject
): PresetEditorSubject[] {
  return nodes.map((node) =>
    node.key === key
      ? update(node)
      : { ...node, children: updateNode(node.children, key, update) }
  )
}

function removeNode(
  nodes: readonly PresetEditorSubject[],
  key: string
): { nodes: PresetEditorSubject[]; removed: PresetEditorSubject | null } {
  let removed: PresetEditorSubject | null = null
  const next: PresetEditorSubject[] = []
  for (const node of nodes) {
    if (node.key === key) {
      removed = node
      continue
    }
    const childResult = removeNode(node.children, key)
    if (childResult.removed) removed = childResult.removed
    next.push({ ...node, children: childResult.nodes })
  }
  return { nodes: next, removed }
}

function insertNode(
  nodes: readonly PresetEditorSubject[],
  parentKey: string | null,
  node: PresetEditorSubject
): PresetEditorSubject[] {
  if (!parentKey) return [...nodes, node]
  return updateNode(nodes, parentKey, (parent) => ({
    ...parent,
    children: [...parent.children, node],
  }))
}

function collectKeys(node: PresetEditorSubject): string[] {
  return [node.key, ...node.children.flatMap(collectKeys)]
}

/**
 * The configuration a subject's removal leaves behind, or null if it was not there.
 *
 * Pure and exported so it can be tested: it used to be built field by field inside the
 * component, which meant it silently dropped everything the configuration held beyond
 * subjects and averages. The assessment types went that way, and the next publish
 * recorded their disappearance as a deliberate deletion for every linked year.
 */
export function withoutSubject(
  value: PresetEditorConfiguration,
  key: string
): PresetEditorConfiguration | null {
  const result = removeNode(value.subjects, key)
  if (!result.removed) return null
  const removedKeys = new Set(collectKeys(result.removed))
  return {
    ...value,
    subjects: result.nodes,
    averages: value.averages.map((average) => ({
      ...average,
      entries: average.entries.filter(
        (entry) => !removedKeys.has(entry.subjectKey)
      ),
    })),
  }
}

function NumberInput({
  value,
  onChange,
  label,
  nullable = false,
  /** The smallest accepted value. A denominator of zero is not a denominator. */
  min = 0,
  max,
}: {
  value: number | null
  onChange: (value: number | null) => void
  label: string
  nullable?: boolean
  min?: number
  max?: number
}) {
  return (
    <Input
      aria-label={label}
      className="numeric h-9 w-16 shrink-0"
      inputMode="decimal"
      max={max}
      min={min}
      value={value ?? ""}
      placeholder={nullable ? "auto" : "1"}
      onChange={(event) => {
        const raw = event.target.value.replace(",", ".")
        if (!raw && nullable) return onChange(null)
        const parsed = Number(raw)
        if (
          Number.isFinite(parsed) &&
          parsed >= min &&
          (max === undefined || parsed <= max)
        ) {
          onChange(parsed)
        }
      }}
    />
  )
}

/**
 * A heading inside the caller's card — deliberately not a card of its own.
 *
 * This editor used to draw a bordered `<section>` per group while the screen
 * hosting it is already a card, so the page showed a card inside a card inside
 * a card, with the same heading and the same sentence printed twice.
 */
function Group({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            {title}
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * The preset structure editor.
 *
 * Three things were wrong, and all three showed the moment it opened.
 *
 * It drew its own bordered card per group inside a screen that is already a
 * card — hence the doubled heading and the nested boxes.
 *
 * Its parent picker and its average-subject picker were raw `<select>`
 * elements: the operating system's own menu, unstyleable, sitting in an admin
 * form whose every other control had been moved off native months earlier.
 *
 * And a row was a six-column grid of fixed widths inside a fixed-width column,
 * so it ran off the side of the page and took the delete button with it. Every
 * row wraps now, and nothing in here has a width it cannot give up.
 *
 * The stable key stays visible — it is what makes versioning work, and an
 * admin renaming a subject needs to see they have not changed it — but as a
 * quiet tail rather than a column competing with the name.
 */
export function PresetVisualEditor({
  value,
  onChange,
  showStableKeys = true,
}: {
  value: PresetEditorConfiguration
  onChange: (value: PresetEditorConfiguration) => void
  /** Stable identifiers matter to preset admins, but are internal class-builder data. */
  showStableKeys?: boolean
}) {
  const t = useExtracted()
  const flat = useMemo(() => flatten(value.subjects), [value.subjects])
  const subjectByKey = new Map(flat.map((subject) => [subject.key, subject]))

  const updateSubjects = (subjects: PresetEditorSubject[]) =>
    onChange({ ...value, subjects })
  const updateAverages = (averages: PresetEditorAverage[]) =>
    onChange({
      ...value,
      averages: averages.map((average) => ({ ...average, isMain: false })),
    })
  // A version published before types existed simply has none, rather than being invalid.
  const gradeTypes = value.gradeTypes ?? []
  const updateGradeTypes = (next: PresetEditorGradeType[]) =>
    onChange({ ...value, gradeTypes: next })
  const patchGradeType = (key: string, patch: Partial<PresetEditorGradeType>) =>
    updateGradeTypes(
      gradeTypes.map((type) =>
        type.key === key ? { ...type, ...patch } : type
      )
    )
  const accentLabels: Record<string, string> = {
    primary: t("Accent"),
    positive: t("Green"),
    "chart-2": t("Teal"),
    "chart-3": t("Blue"),
    "chart-4": t("Purple"),
    "chart-5": t("Amber"),
  }
  const accentOptions = [
    { value: "", label: t("No colour") },
    ...CARD_ACCENTS.map((accent) => ({
      value: accent.value,
      label: accentLabels[accent.value] ?? accent.label,
    })),
  ]

  const removeSubject = (key: string) => {
    const next = withoutSubject(value, key)
    if (next) onChange(next)
  }

  const reorderSubjects = (activeKey: string, overKey: string) => {
    const active = subjectByKey.get(activeKey)
    const over = subjectByKey.get(overKey)
    // Levels are separate sortable groups, but a stray cross-level drop would
    // otherwise reorder the wrong list. Reparenting has its own control.
    if (!active || !over || active.parentKey !== over.parentKey) return

    const reorder = (
      nodes: readonly PresetEditorSubject[]
    ): PresetEditorSubject[] => {
      const from = nodes.findIndex((node) => node.key === activeKey)
      const to = nodes.findIndex((node) => node.key === overKey)
      if (from >= 0 && to >= 0) {
        const next = [...nodes]
        next.splice(to, 0, ...next.splice(from, 1))
        return next
      }
      return nodes.map((node) => ({
        ...node,
        children: reorder(node.children),
      }))
    }

    updateSubjects(reorder(value.subjects))
  }

  const moveToParent = (key: string, parentKey: string | null) => {
    const current = subjectByKey.get(key)
    if (!current || current.descendantKeys.includes(parentKey ?? "")) return
    if (
      parentKey === null &&
      current.parentKey !== null &&
      value.subjects.length >= PRESET_EDITOR_LIMITS.rootSubjects
    ) {
      return
    }
    const parent = parentKey ? subjectByKey.get(parentKey) : null
    if (
      parent &&
      current.parentKey !== parentKey &&
      parent.childCount >= PRESET_EDITOR_LIMITS.childSubjects
    ) {
      return
    }
    const result = removeNode(value.subjects, key)
    if (!result.removed) return
    updateSubjects(insertNode(result.nodes, parentKey, result.removed))
  }

  /**
   * One level of the tree, draggable.
   *
   * Rendered recursively so each level is its own sortable group: dragging
   * reorders a level and can never reparent a subject. That change is the
   * parent picker beside each row, where it is a deliberate choice.
   */
  const renderSubjectLevel = (
    nodes: readonly PresetEditorSubject[],
    depth: number
  ): ReactNode => {
    if (nodes.length === 0) return null

    return (
      <SortableGroup ids={nodes.map((node) => node.key)}>
        {nodes.map((node) => {
          const subject = subjectByKey.get(node.key)
          if (!subject) return null
          const isCategory = node.kind === "category"
          const disallowedParents = new Set([
            subject.key,
            ...subject.descendantKeys,
          ])

          return (
            <SortableRow
              key={node.key}
              id={node.key}
              as="div"
              className="flex min-w-0 flex-col gap-2"
              style={{ marginInlineStart: `${Math.min(depth, 4) * 14}px` }}
            >
              <article
                className={cn(
                  "flex min-w-0 flex-col gap-2 rounded-lg border p-2.5",
                  isCategory ? "bg-muted/40" : "bg-background"
                )}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <DragHandle className="-ml-1 shrink-0" />
                  <Input
                    aria-label={t("Subject name")}
                    className="h-9 min-w-36 flex-1"
                    maxLength={PRESET_EDITOR_LIMITS.subjectName}
                    value={node.name}
                    onChange={(event) =>
                      updateSubjects(
                        updateNode(value.subjects, node.key, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      )
                    }
                  />
                  <Input
                    aria-label={t("Short name")}
                    className="h-9 w-24 shrink-0"
                    maxLength={PRESET_EDITOR_LIMITS.subjectShortName}
                    placeholder={t("Short")}
                    value={node.shortName ?? ""}
                    onChange={(event) =>
                      updateSubjects(
                        updateNode(value.subjects, node.key, (current) => ({
                          ...current,
                          shortName: event.target.value || undefined,
                        }))
                      )
                    }
                  />
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    ×
                    <NumberInput
                      label={t("Coefficient")}
                      max={PRESET_EDITOR_LIMITS.coefficient}
                      value={node.coefficient}
                      onChange={(coefficient) =>
                        coefficient != null &&
                        updateSubjects(
                          updateNode(value.subjects, node.key, (current) => ({
                            ...current,
                            coefficient,
                          }))
                        )
                      }
                    />
                  </span>
                  {isCategory ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Add nested subject")}
                      disabled={
                        node.children.length >=
                        PRESET_EDITOR_LIMITS.childSubjects
                      }
                      onClick={() =>
                        updateSubjects(
                          updateNode(value.subjects, node.key, (current) => ({
                            ...current,
                            children: [...current.children, makeSubject()],
                          }))
                        )
                      }
                    >
                      <PlusIcon className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={t("Remove")}
                    disabled={value.subjects.length === 1 && depth === 0}
                    onClick={() => removeSubject(node.key)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>

                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:pl-7">
                  <SelectControl
                    aria-label={t("Parent category")}
                    className="h-8 w-40 text-xs"
                    value={subject.parentKey ?? ""}
                    onValueChange={(parentKey) =>
                      moveToParent(node.key, parentKey || null)
                    }
                    options={[
                      {
                        value: "",
                        label: t("Top level"),
                        disabled:
                          subject.parentKey !== null &&
                          value.subjects.length >=
                            PRESET_EDITOR_LIMITS.rootSubjects,
                      },
                      ...flat
                        .filter(
                          (candidate) =>
                            candidate.kind === "category" &&
                            !disallowedParents.has(candidate.key)
                        )
                        .map((candidate) => ({
                          value: candidate.key,
                          label: `${"— ".repeat(candidate.depth)}${candidate.name}`,
                          disabled:
                            subject.parentKey !== candidate.key &&
                            candidate.childCount >=
                              PRESET_EDITOR_LIMITS.childSubjects,
                        })),
                    ]}
                  />
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={isCategory}
                      disabled={node.children.length > 0}
                      onCheckedChange={(category) =>
                        updateSubjects(
                          updateNode(value.subjects, node.key, (current) => ({
                            ...current,
                            kind: category ? "category" : "subject",
                          }))
                        )
                      }
                    />
                    {t("Category")}
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={node.isMain}
                      onCheckedChange={(isMain) =>
                        updateSubjects(
                          updateNode(value.subjects, node.key, (current) => ({
                            ...current,
                            isMain,
                          }))
                        )
                      }
                    />
                    {t("Main subject")}
                  </label>
                  {showStableKeys ? (
                    <span
                      title={node.key}
                      className="ml-auto flex min-w-0 items-center gap-1 font-mono text-[10px] text-muted-foreground/70"
                    >
                      <KeyRoundIcon className="size-3 shrink-0" />
                      <span className="truncate">{node.key}</span>
                    </span>
                  ) : null}
                </div>
              </article>
              {renderSubjectLevel(node.children, depth + 1)}
            </SortableRow>
          )
        })}
      </SortableGroup>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Group
        icon={FolderPlusIcon}
        title={t("Subjects and categories")}
        description={t(
          "Drag to reorder within a level. The parent picker is what moves a subject elsewhere."
        )}
        action={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                value.subjects.length >= PRESET_EDITOR_LIMITS.rootSubjects
              }
              onClick={() =>
                updateSubjects([...value.subjects, makeSubject("category")])
              }
            >
              <FolderPlusIcon className="size-4" /> {t("Category")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                value.subjects.length >= PRESET_EDITOR_LIMITS.rootSubjects
              }
              onClick={() => updateSubjects([...value.subjects, makeSubject()])}
            >
              <PlusIcon className="size-4" /> {t("Subject")}
            </Button>
          </>
        }
      >
        <div className="flex min-w-0 flex-col gap-2">
          <SortableRoot
            ids={flat.map((item) => item.key)}
            restrictToParent={false}
            onDrop={reorderSubjects}
          >
            {renderSubjectLevel(value.subjects, 0)}
          </SortableRoot>
        </div>
      </Group>

      <Group
        icon={SigmaIcon}
        title={t("Custom averages")}
        description={t(
          "Choose which managed subjects participate and how they are weighted."
        )}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              flat.length === 0 ||
              value.averages.length >= PRESET_EDITOR_LIMITS.averages
            }
            onClick={() => {
              const first = flat[0]
              if (!first) return
              updateAverages([
                ...value.averages,
                {
                  key: freshKey("average"),
                  name: "New average",
                  isMain: false,
                  entries: [
                    {
                      subjectKey: first.key,
                      coefficient: null,
                      includeChildren: false,
                    },
                  ],
                },
              ])
            }}
          >
            <PlusIcon className="size-4" /> {t("Average")}
          </Button>
        }
      >
        {value.averages.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t("No managed averages in this version.")}
          </p>
        ) : (
          <SortableList
            ids={value.averages.map((average) => average.key)}
            onReorder={(keys) => {
              const byKey = new Map(
                value.averages.map((average) => [average.key, average])
              )
              const next = keys
                .map((key) => byKey.get(key))
                .filter((average) => average !== undefined)
              if (next.length === value.averages.length) updateAverages(next)
            }}
          >
            <div className="flex min-w-0 flex-col gap-2">
              {value.averages.map((average) => {
                const used = new Set(
                  average.entries.map((entry) => entry.subjectKey)
                )
                return (
                  <SortableRow
                    key={average.key}
                    id={average.key}
                    as="div"
                    className="flex min-w-0 flex-col gap-3 rounded-lg border bg-background p-2.5"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <DragHandle className="-ml-1 shrink-0" />
                      <Input
                        aria-label={t("Average name")}
                        className="h-9 min-w-36 flex-1"
                        maxLength={PRESET_EDITOR_LIMITS.averageName}
                        value={average.name}
                        onChange={(event) =>
                          updateAverages(
                            value.averages.map((item) =>
                              item.key === average.key
                                ? { ...item, name: event.target.value }
                                : item
                            )
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={t("Remove")}
                        onClick={() =>
                          updateAverages(
                            value.averages.filter(
                              (item) => item.key !== average.key
                            )
                          )
                        }
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>

                    <div className="flex min-w-0 flex-col gap-2 sm:pl-7">
                      {average.entries.map((entry, entryIndex) => (
                        <div
                          key={`${average.key}:${entry.subjectKey}`}
                          className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2"
                        >
                          <SelectControl
                            aria-label={t("Average subject")}
                            className="h-8 min-w-36 flex-1 text-xs"
                            value={entry.subjectKey}
                            onValueChange={(subjectKey) =>
                              updateAverages(
                                value.averages.map((item) =>
                                  item.key === average.key
                                    ? {
                                        ...item,
                                        entries: item.entries.map(
                                          (candidate, index) =>
                                            index === entryIndex
                                              ? { ...candidate, subjectKey }
                                              : candidate
                                        ),
                                      }
                                    : item
                                )
                              )
                            }
                            options={flat.map((item) => ({
                              value: item.key,
                              label: `${"— ".repeat(item.depth)}${item.name}`,
                              disabled:
                                used.has(item.key) &&
                                item.key !== entry.subjectKey,
                            }))}
                          />
                          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            ×
                            <NumberInput
                              nullable
                              label={t("Coefficient")}
                              max={PRESET_EDITOR_LIMITS.coefficient}
                              value={entry.coefficient}
                              onChange={(coefficient) =>
                                updateAverages(
                                  value.averages.map((item) =>
                                    item.key === average.key
                                      ? {
                                          ...item,
                                          entries: item.entries.map(
                                            (candidate, index) =>
                                              index === entryIndex
                                                ? { ...candidate, coefficient }
                                                : candidate
                                          ),
                                        }
                                      : item
                                  )
                                )
                              }
                            />
                          </span>
                          <label className="flex shrink-0 items-center gap-2 text-xs">
                            <Switch
                              checked={entry.includeChildren}
                              onCheckedChange={(includeChildren) =>
                                updateAverages(
                                  value.averages.map((item) =>
                                    item.key === average.key
                                      ? {
                                          ...item,
                                          entries: item.entries.map(
                                            (candidate, index) =>
                                              index === entryIndex
                                                ? {
                                                    ...candidate,
                                                    includeChildren,
                                                  }
                                                : candidate
                                          ),
                                        }
                                      : item
                                  )
                                )
                              }
                            />
                            {t("With children")}
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="ml-auto text-destructive"
                            aria-label={t("Remove")}
                            disabled={average.entries.length === 1}
                            onClick={() =>
                              updateAverages(
                                value.averages.map((item) =>
                                  item.key === average.key
                                    ? {
                                        ...item,
                                        entries: item.entries.filter(
                                          (_, index) => index !== entryIndex
                                        ),
                                      }
                                    : item
                                )
                              )
                            }
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        disabled={
                          used.size >= flat.length ||
                          average.entries.length >=
                            PRESET_EDITOR_LIMITS.averageEntries
                        }
                        onClick={() => {
                          const available = flat.find(
                            (subject) => !used.has(subject.key)
                          )
                          if (!available) return
                          updateAverages(
                            value.averages.map((item) =>
                              item.key === average.key
                                ? {
                                    ...item,
                                    entries: [
                                      ...item.entries,
                                      {
                                        subjectKey: available.key,
                                        coefficient: null,
                                        includeChildren: false,
                                      },
                                    ],
                                  }
                                : item
                            )
                          )
                        }}
                      >
                        <PlusIcon className="size-4" /> {t("Add entry")}
                      </Button>
                    </div>
                  </SortableRow>
                )
              })}
            </div>
          </SortableList>
        )}
      </Group>

      <Group
        icon={TagsIcon}
        title={t("Assessment types")}
        description={t(
          "The kinds of assessment this year holds. Each one fills in a result's name, coefficient and scale as it is written down, and lets a card read one kind against another."
        )}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={gradeTypes.length >= PRESET_EDITOR_LIMITS.gradeTypes}
            onClick={() =>
              updateGradeTypes([
                ...gradeTypes,
                {
                  key: freshKey("type"),
                  name: "New type",
                  titlePrefix: "",
                  coefficient: 1,
                  outOf: 20,
                  accent: null,
                },
              ])
            }
          >
            <PlusIcon className="size-4" /> {t("Type")}
          </Button>
        }
      >
        {gradeTypes.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t("No assessment types in this version.")}
          </p>
        ) : (
          <SortableList
            ids={gradeTypes.map((type) => type.key)}
            onReorder={(keys) => {
              const byKey = new Map(gradeTypes.map((type) => [type.key, type]))
              const next = keys
                .map((key) => byKey.get(key))
                .filter((type) => type !== undefined)
              if (next.length === gradeTypes.length) updateGradeTypes(next)
            }}
          >
            <div className="flex min-w-0 flex-col gap-2">
              {gradeTypes.map((type) => (
                <SortableRow
                  key={type.key}
                  id={type.key}
                  as="div"
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-background p-2.5"
                >
                  <DragHandle className="-ml-1 shrink-0" />
                  <Input
                    aria-label={t("Type name")}
                    className="h-9 min-w-32 flex-1"
                    maxLength={PRESET_GRADE_TYPE_LIMITS.name}
                    value={type.name}
                    onChange={(event) =>
                      patchGradeType(type.key, { name: event.target.value })
                    }
                  />
                  <Input
                    aria-label={t("Name results like")}
                    className="h-9 min-w-24 flex-1"
                    maxLength={PRESET_GRADE_TYPE_LIMITS.titlePrefix}
                    placeholder={t("DS ")}
                    value={type.titlePrefix}
                    onChange={(event) =>
                      patchGradeType(type.key, {
                        titlePrefix: event.target.value,
                      })
                    }
                  />
                  <NumberInput
                    label={t("Coefficient")}
                    max={PRESET_GRADE_TYPE_LIMITS.coefficient}
                    value={type.coefficient}
                    onChange={(next) =>
                      patchGradeType(type.key, { coefficient: next ?? 1 })
                    }
                  />
                  <NumberInput
                    label={t("Out of")}
                    // The server refuses a non-positive denominator, and it is right to:
                    // a mark out of nothing has no value. Refused here too, rather than
                    // accepted and rejected a screen later.
                    min={0.01}
                    max={PRESET_GRADE_TYPE_LIMITS.outOf}
                    value={type.outOf}
                    onChange={(next) =>
                      patchGradeType(type.key, { outOf: next ?? 20 })
                    }
                  />
                  <SelectControl
                    aria-label={t("Colour")}
                    className="h-9 w-28 shrink-0 text-xs"
                    value={type.accent ?? ""}
                    onValueChange={(next) =>
                      patchGradeType(type.key, { accent: next || null })
                    }
                    options={accentOptions}
                  />
                  {showStableKeys ? (
                    <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <KeyRoundIcon className="size-3 shrink-0" />
                      <span className="truncate">{type.key}</span>
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto text-destructive"
                    aria-label={t("Remove")}
                    onClick={() =>
                      updateGradeTypes(
                        gradeTypes.filter((item) => item.key !== type.key)
                      )
                    }
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </SortableRow>
              ))}
            </div>
          </SortableList>
        )}
      </Group>
    </div>
  )
}
