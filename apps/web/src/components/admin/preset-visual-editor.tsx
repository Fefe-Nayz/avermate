"use client"

import { useMemo, type ComponentType, type ReactNode } from "react"
import {
  FolderPlusIcon,
  KeyRoundIcon,
  PlusIcon,
  SigmaIcon,
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
import { cn } from "@/lib/utils"

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
  isMain: boolean
  entries: PresetEditorAverageEntry[]
}

export interface PresetEditorConfiguration {
  subjects: PresetEditorSubject[]
  averages: PresetEditorAverage[]
}

interface FlatSubject {
  key: string
  name: string
  kind: "subject" | "category"
  depth: number
  parentKey: string | null
  descendantKeys: string[]
}

function freshKey(prefix: "subject" | "average") {
  return `${prefix}:${crypto.randomUUID().replaceAll("-", "")}`
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

function NumberInput({
  value,
  onChange,
  label,
  nullable = false,
}: {
  value: number | null
  onChange: (value: number | null) => void
  label: string
  nullable?: boolean
}) {
  return (
    <Input
      aria-label={label}
      className="numeric h-9 w-16 shrink-0"
      inputMode="decimal"
      value={value ?? ""}
      placeholder={nullable ? "auto" : "1"}
      onChange={(event) => {
        const raw = event.target.value.replace(",", ".")
        if (!raw && nullable) return onChange(null)
        const parsed = Number(raw)
        if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed)
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
}: {
  value: PresetEditorConfiguration
  onChange: (value: PresetEditorConfiguration) => void
}) {
  const t = useExtracted()
  const flat = useMemo(() => flatten(value.subjects), [value.subjects])
  const subjectByKey = new Map(flat.map((subject) => [subject.key, subject]))

  const updateSubjects = (subjects: PresetEditorSubject[]) =>
    onChange({ ...value, subjects })
  const updateAverages = (averages: PresetEditorAverage[]) =>
    onChange({ ...value, averages })

  const removeSubject = (key: string) => {
    const result = removeNode(value.subjects, key)
    if (!result.removed) return
    const removedKeys = new Set(collectKeys(result.removed))
    onChange({
      subjects: result.nodes,
      averages: value.averages.map((average) => ({
        ...average,
        entries: average.entries.filter(
          (entry) => !removedKeys.has(entry.subjectKey)
        ),
      })),
    })
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
                      { value: "", label: t("Top level") },
                      ...flat
                        .filter(
                          (candidate) =>
                            candidate.kind === "category" &&
                            !disallowedParents.has(candidate.key)
                        )
                        .map((candidate) => ({
                          value: candidate.key,
                          label: `${"— ".repeat(candidate.depth)}${candidate.name}`,
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
                  <span
                    title={node.key}
                    className="ml-auto flex min-w-0 items-center gap-1 font-mono text-[10px] text-muted-foreground/70"
                  >
                    <KeyRoundIcon className="size-3 shrink-0" />
                    <span className="truncate">{node.key}</span>
                  </span>
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
            disabled={flat.length === 0}
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
                      <label className="flex shrink-0 items-center gap-2 text-xs">
                        <Switch
                          checked={average.isMain}
                          onCheckedChange={(isMain) =>
                            updateAverages(
                              value.averages.map((item) => ({
                                ...item,
                                isMain:
                                  item.key === average.key
                                    ? isMain
                                    : isMain
                                      ? false
                                      : item.isMain,
                              }))
                            )
                          }
                        />
                        {t("Headline")}
                      </label>
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
                        disabled={used.size >= flat.length}
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
    </div>
  )
}
