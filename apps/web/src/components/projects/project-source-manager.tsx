"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FilePlus2Icon,
  PinIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  nextItemOrder,
  type ProjectSourceKind,
  type ProjectSourceOption,
} from "./project-model"

type ProjectContextMode = "include" | "on-demand" | "exclude"

export interface ProjectSourceItem {
  id: string
  kind: string
  referenceId: string
  position: number
  contextMode: ProjectContextMode
  label: string | null
  sourceId: string | null
  indexStatus: string | null
  coverage: string | null
  missing: boolean
  currentVersionId: string | null
  sourceVersionId: string | null
  conversationBranchId: string | null
  conversationHeadMessageId: string | null
  trackingMode: string
  selectorReviewRequired: boolean
}

function useCoverageText() {
  const t = useExtracted()
  return (coverage: string | null) => {
    if (coverage === "searchable-native-text") return t("Indexed native text")
    if (coverage === "searchable-ocr") return t("Indexed OCR")
    if (coverage === "metadata-and-locators-only") {
      return t("OCR is required to search the text")
    }
    if (coverage === "unsupported") return t("Not indexable")
    return t("Index pending")
  }
}

function useIndexStatusText() {
  const t = useExtracted()
  return (status: string | null) => {
    if (status === "ready" || status === "indexed") return t("Ready")
    if (status === "indexing") return t("Indexing")
    if (status === "registered") return t("Queued")
    if (status === "failed") return t("Failed")
    if (status === "partial") return t("Partially indexed")
    return t("Not started")
  }
}

function sourceKey(source: Pick<ProjectSourceOption, "kind" | "id">) {
  return `${source.kind}:${source.id}`
}

function parseSourceKey(value: string | null) {
  if (!value) return null
  const separator = value.indexOf(":")
  if (separator <= 0) return null
  return {
    kind: value.slice(0, separator) as ProjectSourceKind,
    referenceId: value.slice(separator + 1),
  }
}

export function ProjectSourceManager({
  projectId,
  revision,
  items,
  catalogue,
  pendingAction,
  onAdd,
  onRemove,
  onReorder,
  onRetry,
  onTracking,
  onContextMode,
}: {
  projectId: string
  revision: number
  items: readonly ProjectSourceItem[]
  catalogue: readonly ProjectSourceOption[]
  pendingAction: boolean
  onAdd: (input: {
    projectId: string
    kind: ProjectSourceKind
    referenceId: string
    contextMode: "include" | "on-demand" | "exclude"
  }) => void
  onRemove: (input: { projectId: string; itemId: string }) => void
  onReorder: (input: {
    projectId: string
    revision: number
    itemIds: string[]
  }) => void
  onRetry: (input: { kind: ProjectSourceKind; referenceId: string }) => void
  onTracking: (input: {
    projectId: string
    itemId: string
    trackingMode: "pinned" | "follow-head"
  }) => void
  onContextMode: (input: {
    projectId: string
    itemId: string
    contextMode: ProjectContextMode
  }) => void
}) {
  const t = useExtracted()
  const coverageText = useCoverageText()
  const indexStatusText = useIndexStatusText()
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [contextMode, setContextMode] = useState<ProjectContextMode>("include")
  const sourceSelectId = `available-source-${projectId}`
  const contextSelectId = `source-context-${projectId}`
  const contextModes: readonly {
    label: string
    value: ProjectContextMode
  }[] = [
    { label: t("Always include"), value: "include" },
    { label: t("Available on demand"), value: "on-demand" },
    { label: t("Exclude from context"), value: "exclude" },
  ]

  const attached = useMemo(
    () => new Set(items.map((item) => `${item.kind}:${item.referenceId}`)),
    [items]
  )
  const available = useMemo(() => {
    const normalized = filter.trim().toLocaleLowerCase()
    return catalogue.filter(
      (source) =>
        !attached.has(sourceKey(source)) &&
        (!normalized ||
          `${source.title} ${source.subtitle ?? ""} ${source.kind}`
            .toLocaleLowerCase()
            .includes(normalized))
    )
  }, [attached, catalogue, filter])
  const sourceItems = available.map((source) => ({
    value: sourceKey(source),
    label: source.title,
  }))
  const contextItems = contextModes.map((mode) => ({
    value: mode.value,
    label: mode.label,
  }))

  function add() {
    const source = parseSourceKey(selected)
    if (!source) return
    onAdd({ projectId, ...source, contextMode })
    setSelected(null)
  }

  function move(itemId: string, direction: -1 | 1) {
    const itemIds = items.map((item) => item.id)
    const next = nextItemOrder(itemIds, itemId, direction)
    if (next.every((id, index) => id === itemIds[index])) return
    onReorder({ projectId, revision, itemIds: next })
  }

  return (
    <section
      aria-labelledby="project-sources-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="project-sources-title"
            className="font-heading text-lg font-medium"
          >
            {t("Sources")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "A reference stays in its original location and keeps the version used for citations."
            )}
          </p>
        </div>
        <Badge variant="secondary">
          {t("{count, plural, one {# source} other {# sources}}", {
            count: items.length,
          })}
        </Badge>
      </div>

      <FieldGroup className="rounded-xl border p-4">
        <Field>
          <FieldLabel htmlFor="source-filter">{t("Find a source")}</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="source-filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("Document, subject, grade or recording…")}
            />
          </InputGroup>
        </Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_13rem_auto] md:items-end">
          <Field>
            <FieldLabel htmlFor={sourceSelectId}>
              {t("Available source")}
            </FieldLabel>
            <Select
              items={sourceItems}
              value={selected}
              onValueChange={(value) => setSelected(value)}
            >
              <SelectTrigger id={sourceSelectId} className="w-full">
                <SelectValue>
                  {(value: string | null) =>
                    sourceItems.find((item) => item.value === value)?.label ??
                    t("Choose a source")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {available.map((source) => (
                    <SelectItem
                      key={sourceKey(source)}
                      value={sourceKey(source)}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{source.title}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {source.subtitle ?? source.kind}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={contextSelectId}>{t("Context")}</FieldLabel>
            <Select
              items={contextItems}
              value={contextMode}
              onValueChange={(value) =>
                setContextMode(value as ProjectContextMode)
              }
            >
              <SelectTrigger id={contextSelectId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {contextModes.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button onClick={add} disabled={!selected || pendingAction}>
            {pendingAction ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FilePlus2Icon data-icon="inline-start" />
            )}
            {t("Add")}
          </Button>
        </div>
      </FieldGroup>

      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilePlus2Icon />
            </EmptyMedia>
            <EmptyTitle>{t("No sources in this project")}</EmptyTitle>
            <EmptyDescription>
              {t("Add a document, subject, grade or recording.")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {items.map((item, index) => {
            const source = catalogue.find(
              (candidate) =>
                candidate.kind === item.kind &&
                candidate.id === item.referenceId
            )
            const retryable =
              item.indexStatus === "failed" ||
              item.indexStatus === "partial" ||
              item.indexStatus === null
            const indexing =
              item.indexStatus === "indexing" ||
              item.indexStatus === "registered"
            const itemLabel = item.label ?? source?.title ?? item.referenceId
            const itemContextSelectId = `source-context-${projectId}-${item.id}`
            return (
              <Item key={item.id} variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {itemLabel}
                    {item.missing ? (
                      <Badge variant="destructive">{t("Missing source")}</Badge>
                    ) : null}
                    {indexing ? (
                      <Badge variant="secondary">{t("Indexing…")}</Badge>
                    ) : null}
                  </ItemTitle>
                  <ItemDescription>
                    {coverageText(item.coverage)} ·{" "}
                    {contextModes.find(
                      (mode) => mode.value === item.contextMode
                    )?.label ?? t("Unknown context rule")}
                    {item.kind === "conversation"
                      ? item.selectorReviewRequired
                        ? t(" · branch needs review")
                        : t(" · pinned branch {head}…", {
                            head:
                              item.conversationHeadMessageId?.slice(0, 10) ??
                              "—",
                          })
                      : item.trackingMode === "pinned"
                        ? t(" · pinned version {version}…", {
                            version: item.sourceVersionId?.slice(0, 10) ?? "—",
                          })
                        : t(" · follows the latest version")}
                  </ItemDescription>
                  <div
                    className="mt-2 flex flex-wrap gap-1.5"
                    aria-label={t("Indexing stages")}
                  >
                    <Badge variant={item.sourceId ? "secondary" : "outline"}>
                      {item.sourceId
                        ? t("Source registered")
                        : t("Registration pending")}
                    </Badge>
                    <Badge
                      variant={
                        item.currentVersionId || item.sourceVersionId
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {item.currentVersionId || item.sourceVersionId
                        ? t("Version locked and ready")
                        : t("Version pending")}
                    </Badge>
                    <Badge
                      variant={
                        item.indexStatus === "ready" ||
                        item.indexStatus === "indexed"
                          ? "secondary"
                          : item.indexStatus === "failed"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {t("Retrieval index: {status}", {
                        status: indexStatusText(item.indexStatus),
                      })}
                    </Badge>
                    <Badge variant="outline">
                      {t("Coverage: {coverage}", {
                        coverage: coverageText(item.coverage),
                      })}
                    </Badge>
                  </div>
                </ItemContent>
                <ItemActions className="basis-full flex-wrap justify-end sm:basis-auto">
                  <Field className="min-w-0 flex-1 sm:w-44 sm:flex-none">
                    <FieldLabel
                      className="sr-only"
                      htmlFor={itemContextSelectId}
                    >
                      {t("Context for {source}", { source: itemLabel })}
                    </FieldLabel>
                    <Select
                      items={contextItems}
                      value={item.contextMode}
                      disabled={pendingAction}
                      onValueChange={(value) => {
                        if (
                          value !== "include" &&
                          value !== "on-demand" &&
                          value !== "exclude"
                        ) {
                          return
                        }
                        if (value === item.contextMode) return
                        onContextMode({
                          projectId,
                          itemId: item.id,
                          contextMode: value,
                        })
                      }}
                    >
                      <SelectTrigger
                        id={itemContextSelectId}
                        size="sm"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {contextModes.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                              {mode.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  {item.kind === "conversation" &&
                  item.selectorReviewRequired ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <Link
                          href={`/assistant?thread=${encodeURIComponent(item.referenceId)}`}
                        />
                      }
                    >
                      {t("Review branch")}
                    </Button>
                  ) : item.kind !== "conversation" ? (
                    <Button
                      size="icon-sm"
                      variant={
                        item.trackingMode === "pinned" ? "secondary" : "ghost"
                      }
                      aria-label={
                        item.trackingMode === "pinned"
                          ? t("Follow the latest version again")
                          : t("Pin the current version")
                      }
                      disabled={
                        pendingAction || item.missing || !item.currentVersionId
                      }
                      onClick={() =>
                        onTracking({
                          projectId,
                          itemId: item.id,
                          trackingMode:
                            item.trackingMode === "pinned"
                              ? "follow-head"
                              : "pinned",
                        })
                      }
                    >
                      <PinIcon />
                    </Button>
                  ) : null}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("Move source up")}
                    disabled={pendingAction || index === 0}
                    onClick={() => move(item.id, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("Move source down")}
                    disabled={pendingAction || index === items.length - 1}
                    onClick={() => move(item.id, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  {retryable ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("Repair index")}
                      disabled={pendingAction || item.missing}
                      onClick={() =>
                        onRetry({
                          kind: item.kind as ProjectSourceKind,
                          referenceId: item.referenceId,
                        })
                      }
                    >
                      <RefreshCwIcon />
                    </Button>
                  ) : null}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("Remove reference from project")}
                    disabled={pendingAction}
                    onClick={() => onRemove({ projectId, itemId: item.id })}
                  >
                    <Trash2Icon />
                  </Button>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </section>
  )
}
