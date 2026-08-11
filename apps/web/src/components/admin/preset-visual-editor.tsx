"use client"

import { useMemo } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FolderPlusIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  DragHandle,
  SortableList,
  SortableRow,
} from "@/components/ui/sortable-list"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

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

function reorderNode(
  nodes: readonly PresetEditorSubject[],
  key: string,
  offset: -1 | 1
): PresetEditorSubject[] {
  const index = nodes.findIndex((node) => node.key === key)
  if (index >= 0) {
    const target = index + offset
    if (target < 0 || target >= nodes.length) return [...nodes]
    const next = [...nodes]
    const current = next[index]
    const sibling = next[target]
    if (!current || !sibling) return next
    next[index] = sibling
    next[target] = current
    return next
  }
  return nodes.map((node) => ({
    ...node,
    children: reorderNode(node.children, key, offset),
  }))
}

function collectKeys(node: PresetEditorSubject): string[] {
  return [node.key, ...node.children.flatMap(collectKeys)]
}

function NumberInput({
  value,
  onChange,
  nullable = false,
}: {
  value: number | null
  onChange: (value: number | null) => void
  nullable?: boolean
}) {
  return (
    <Input
      className="numeric h-8 w-24"
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

  const moveToParent = (key: string, parentKey: string | null) => {
    const current = subjectByKey.get(key)
    if (!current || current.descendantKeys.includes(parentKey ?? "")) return
    const result = removeNode(value.subjects, key)
    if (!result.removed) return
    updateSubjects(insertNode(result.nodes, parentKey, result.removed))
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
          <div>
            <h3 className="text-sm font-semibold">
              {t("Subjects and categories")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                "Names, hierarchy, order and coefficients are versioned together."
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                updateSubjects([...value.subjects, makeSubject("category")])
              }
            >
              <FolderPlusIcon className="size-4" /> {t("Add category")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => updateSubjects([...value.subjects, makeSubject()])}
            >
              <PlusIcon className="size-4" /> {t("Add subject")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-3">
          {flat.map((subject, index) => {
            const node = (() => {
              const find = (
                nodes: readonly PresetEditorSubject[]
              ): PresetEditorSubject | null => {
                for (const item of nodes) {
                  if (item.key === subject.key) return item
                  const nested = find(item.children)
                  if (nested) return nested
                }
                return null
              }
              return find(value.subjects)
            })()
            if (!node) return null
            const siblings = flat.filter(
              (item) => item.parentKey === subject.parentKey
            )
            const siblingIndex = siblings.findIndex(
              (item) => item.key === subject.key
            )
            const disallowedParents = new Set([
              subject.key,
              ...subject.descendantKeys,
            ])

            return (
              <article
                key={node.key}
                className="rounded-lg border bg-background p-3"
                style={{ marginLeft: `${Math.min(subject.depth, 4) * 16}px` }}
              >
                <div className="grid gap-2 @2xl/main:grid-cols-[minmax(10rem,1.4fr)_8rem_7rem_minmax(9rem,1fr)_auto]">
                  <Input
                    aria-label={t("Subject name")}
                    className="h-8"
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
                    className="h-8"
                    placeholder={t("Short name")}
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
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    ×
                    <NumberInput
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
                  </label>
                  <select
                    aria-label={t("Parent category")}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={subject.parentKey ?? ""}
                    onChange={(event) =>
                      moveToParent(node.key, event.target.value || null)
                    }
                  >
                    <option value="">{t("Top level")}</option>
                    {flat
                      .filter(
                        (candidate) =>
                          candidate.kind === "category" &&
                          !disallowedParents.has(candidate.key)
                      )
                      .map((candidate) => (
                        <option key={candidate.key} value={candidate.key}>
                          {"— ".repeat(candidate.depth)}
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Move up")}
                      disabled={siblingIndex <= 0}
                      onClick={() =>
                        updateSubjects(
                          reorderNode(value.subjects, node.key, -1)
                        )
                      }
                    >
                      <ArrowUpIcon className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Move down")}
                      disabled={
                        siblingIndex < 0 || siblingIndex >= siblings.length - 1
                      }
                      onClick={() =>
                        updateSubjects(reorderNode(value.subjects, node.key, 1))
                      }
                    >
                      <ArrowDownIcon className="size-4" />
                    </Button>
                    {node.kind === "category" ? (
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
                      disabled={value.subjects.length === 1 && index === 0}
                      onClick={() => removeSubject(node.key)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <span>{t("Category")}</span>
                    <Switch
                      checked={node.kind === "category"}
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
                  </label>
                  <label className="flex items-center gap-2">
                    <span>{t("Main subject")}</span>
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
                  </label>
                  <span
                    className="font-mono text-[10px] text-muted-foreground"
                    title={node.key}
                  >
                    {t("Stable key")}: {node.key.slice(0, 22)}
                    {node.key.length > 22 ? "…" : ""}
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
          <div>
            <h3 className="text-sm font-semibold">{t("Custom averages")}</h3>
            <p className="text-xs text-muted-foreground">
              {t(
                "Choose which managed subjects participate and how they are weighted."
              )}
            </p>
          </div>
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
            <PlusIcon className="size-4" /> {t("Add average")}
          </Button>
        </div>
        <div className="flex flex-col gap-3 p-3">
          {value.averages.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              {t("No managed averages in this version.")}
            </p>
          ) : null}
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
            {value.averages.map((average) => {
              const used = new Set(
                average.entries.map((entry) => entry.subjectKey)
              )
              return (
                <SortableRow
                  key={average.key}
                  id={average.key}
                  as="div"
                  className="rounded-lg border bg-background p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <DragHandle className="-ml-1" />
                    <Input
                      aria-label={t("Average name")}
                      className="h-8 min-w-40 flex-1"
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
                    <label className="flex items-center gap-2 text-xs">
                      {t("Main average")}
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

                  <div className="mt-3 flex flex-col gap-2">
                    {average.entries.map((entry, entryIndex) => (
                      <div
                        key={`${average.key}:${entry.subjectKey}`}
                        className="grid items-center gap-2 rounded-md bg-muted/40 p-2 @xl/main:grid-cols-[minmax(10rem,1fr)_7rem_auto_auto]"
                      >
                        <select
                          aria-label={t("Average subject")}
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          value={entry.subjectKey}
                          onChange={(event) =>
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
                                                subjectKey: event.target.value,
                                              }
                                            : candidate
                                      ),
                                    }
                                  : item
                              )
                            )
                          }
                        >
                          {flat.map((subject) => (
                            <option
                              key={subject.key}
                              value={subject.key}
                              disabled={
                                used.has(subject.key) &&
                                subject.key !== entry.subjectKey
                              }
                            >
                              {"— ".repeat(subject.depth)}
                              {subject.name}
                            </option>
                          ))}
                        </select>
                        <NumberInput
                          nullable
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
                        <label className="flex items-center gap-2 text-xs">
                          {t("Include children")}
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
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive"
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
          </SortableList>
        </div>
      </section>
    </div>
  )
}
