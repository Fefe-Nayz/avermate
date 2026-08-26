"use client"

import Link from "next/link"
import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowUpRightIcon,
  BookOpenTextIcon,
  FileSearchIcon,
  SearchIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
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
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  citationOpenHref,
  locatorLabel,
  type ProjectSourceKind,
  type ProjectSourceOption,
} from "./project-model"
import type { ProjectSourceItem } from "./project-source-manager"

type SearchMode = "terms" | "phrase" | "prefix" | "exact"

export function ProjectSearch({
  projectId,
  yearId,
  items,
  catalogue,
  subjects,
}: {
  projectId: string
  yearId: string | null
  items: readonly ProjectSourceItem[]
  catalogue: readonly ProjectSourceOption[]
  subjects: readonly { id: string; name: string }[]
}) {
  const t = useExtracted()
  const isOnline = useOnlineStatus()
  const showDiagnostics = process.env.NODE_ENV === "development"
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query.trim())
  const [mode, setMode] = useState<SearchMode>("terms")
  const [originKinds, setOriginKinds] = useState<ProjectSourceKind[]>([])
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [citationId, setCitationId] = useState<string | null>(null)

  const resultQuery = useQuery({
    ...orpc.projects.search.queryOptions({
      input: {
        query: deferredQuery || "_",
        mode,
        projectIds: [projectId],
        yearIds: yearId ? [yearId] : [],
        subjectIds: subjectId ? [subjectId] : [],
        originKinds,
        limit: 20,
        cursor: null,
      },
    }),
    enabled: deferredQuery.length > 0 && isOnline,
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const citationQuery = useQuery({
    ...orpc.projects.readCitation.queryOptions({
      input: { citationId: citationId ?? "_" },
    }),
    enabled: Boolean(citationId) && isOnline,
    staleTime: Infinity,
  })

  const subjectItems = [
    { value: null, label: t("All subjects") },
    ...subjects.map((subject) => ({ value: subject.id, label: subject.name })),
  ]
  const searchModes = [
    { value: "terms" as const, label: t("Terms") },
    { value: "phrase" as const, label: t("Phrase") },
    { value: "prefix" as const, label: t("Prefix") },
    { value: "exact" as const, label: t("Exact") },
  ]
  const searchableKinds: readonly {
    value: ProjectSourceKind
    label: string
  }[] = [
    { value: "material", label: t("Documents") },
    { value: "study-document", label: t("Study sheets") },
    { value: "recording", label: t("Course recordings") },
    { value: "grade", label: t("Grades") },
    { value: "subject", label: t("Subjects") },
    { value: "artifact", label: t("Artifacts") },
  ]

  function sourceTitle(sourceId: string) {
    const item = items.find((candidate) => candidate.sourceId === sourceId)
    if (!item) return t("Source")
    return (
      item.label ??
      catalogue.find(
        (candidate) =>
          candidate.kind === item.kind && candidate.id === item.referenceId
      )?.title ??
      item.referenceId
    )
  }

  const evidence = resultQuery.data?.evidence ?? []
  const citation = citationQuery.data?.citation

  return (
    <section
      aria-labelledby="project-search-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="project-search-title"
          className="font-heading text-lg font-medium"
        >
          {t("Search this project")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Search follows this project's settings: by keyword, by meaning, merged and de-duplicated, then re-scored once that is ready. Every result points to a fixed version and an exact place in it."
          )}
        </p>
      </div>

      {!isOnline ? (
        <Alert role="status">
          <FileSearchIcon />
          <AlertTitle>{t("You are offline")}</AlertTitle>
          <AlertDescription>
            {t(
              "Previously opened sources remain available when cached. New searches and citation fetches resume after reconnection."
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup className="rounded-xl border p-4">
        <Field>
          <FieldLabel htmlFor="project-search-query">{t("Query")}</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="project-search-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t(
                "For example: kinetic energy, ‘acid-base reaction’, E=mc²…"
              )}
              disabled={!isOnline}
            />
          </InputGroup>
        </Field>

        <div className="flex flex-wrap items-end gap-4">
          <Field className="w-auto">
            <FieldLabel id="search-mode-label">{t("Mode")}</FieldLabel>
            <ToggleGroup
              aria-labelledby="search-mode-label"
              value={[mode]}
              onValueChange={(values) => {
                const next = values[0] as typeof mode | undefined
                if (next) setMode(next)
              }}
              variant="outline"
              spacing={1}
            >
              {searchModes.map((entry) => (
                <ToggleGroupItem key={entry.value} value={entry.value}>
                  {entry.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field className="min-w-52 flex-1">
            <FieldLabel>{t("Subject")}</FieldLabel>
            <Select
              items={subjectItems}
              value={subjectId}
              onValueChange={(value) => setSubjectId(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {subjectItems.map((subject) => (
                    <SelectItem
                      key={subject.value ?? "all"}
                      value={subject.value}
                    >
                      {subject.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel id="source-kind-label">{t("Source types")}</FieldLabel>
          <ToggleGroup
            aria-labelledby="source-kind-label"
            multiple
            value={originKinds}
            onValueChange={(values) =>
              setOriginKinds(values as ProjectSourceKind[])
            }
            variant="outline"
            spacing={1}
            className="flex-wrap"
          >
            {searchableKinds.map((kind) => (
              <ToggleGroupItem key={kind.value} value={kind.value}>
                {kind.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      </FieldGroup>

      {resultQuery.isError ? (
        <Alert variant="destructive">
          <FileSearchIcon />
          <AlertTitle>{t("Search unavailable")}</AlertTitle>
          <AlertDescription>{resultQuery.error.message}</AlertDescription>
        </Alert>
      ) : resultQuery.isFetching && deferredQuery ? (
        <div
          className="flex flex-col gap-3"
          role="status"
          aria-label={t("Searching")}
          aria-busy="true"
        >
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : deferredQuery && evidence.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSearchIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No passage found")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Adjust the filters. A scanned page without OCR cannot produce a text result."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : evidence.length > 0 ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>
              {resultQuery.data?.retrievalMode === "reranked"
                ? t("Hybrid RAG + reranking")
                : resultQuery.data?.retrievalMode === "hybrid"
                  ? t("Hybrid RAG")
                  : t("Lexical search")}
            </Badge>
            {resultQuery.data?.vectorImplementation ? (
              <Badge variant="outline">{t("Embeddings active")}</Badge>
            ) : null}
            {resultQuery.data?.rerankImplementation ? (
              <Badge variant="outline">{t("Cross-encoder active")}</Badge>
            ) : null}
            {showDiagnostics ? (
              <span className="font-mono text-xs text-muted-foreground">
                {resultQuery.data?.operationId.slice(0, 12)}…
              </span>
            ) : null}
          </div>
          {resultQuery.data?.fallbackReason ? (
            <Alert>
              <FileSearchIcon />
              <AlertTitle>{t("Pipeline degraded by policy")}</AlertTitle>
              <AlertDescription>
                {resultQuery.data.fallbackReason}.{" "}
                {t(
                  "Displayed results follow the project's explicit fallback policy."
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          {showDiagnostics ? (
            <details className="rounded-lg border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">
                {t("Inspect retrieval stages")}
              </summary>
              <div className="mt-2 grid gap-1">
                {resultQuery.data?.stages.map((stage, index) => (
                  <div
                    key={`${stage.stage}:${index}`}
                    className="flex flex-wrap justify-between gap-2 text-muted-foreground"
                  >
                    <span>
                      {stage.stage} · {stage.status}
                    </span>
                    <span className="tabular-nums">
                      {stage.inputCount}→{stage.outputCount} ·{" "}
                      {stage.durationMs} ms
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <ItemGroup>
            {evidence.map((result, index) => (
              <Item
                key={result.citationId}
                variant="outline"
                render={
                  <button
                    type="button"
                    className="cursor-pointer text-left"
                    onClick={() => setCitationId(result.citationId)}
                  />
                }
              >
                <ItemMedia variant="icon">
                  <BookOpenTextIcon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>
                    {sourceTitle(result.sourceId)}
                    <Badge variant={index === 0 ? "default" : "outline"}>
                      {index === 0
                        ? t("Top result")
                        : t("Rank {rank}", { rank: String(index + 1) })}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription>{result.snippet}</ItemDescription>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {locatorLabel(result.locator)}
                    </Badge>
                    <Badge variant="secondary">{result.evidenceKind}</Badge>
                  </div>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenTextIcon />
            </EmptyMedia>
            <EmptyTitle>{t("Search your sources")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Passages stay linked to their exact source and are ranked by the project's active retrieval policy."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <Sheet
        open={Boolean(citationId)}
        onOpenChange={(open) => {
          if (!open) setCitationId(null)
        }}
      >
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{citation?.displayTitle ?? t("Citation")}</SheetTitle>
            <SheetDescription>
              {citation ? locatorLabel(citation.locator) : t("Loading…")}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {!isOnline && !citation ? (
              <Alert>
                <FileSearchIcon />
                <AlertTitle>{t("Citation unavailable offline")}</AlertTitle>
                <AlertDescription>
                  {t("Reconnect to fetch this exact source reference.")}
                </AlertDescription>
              </Alert>
            ) : citationQuery.isLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : citationQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{t("Citation is no longer readable")}</AlertTitle>
                <AlertDescription>
                  {citationQuery.error.message}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-col gap-4">
                <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
                  {citationQuery.data?.text ??
                    t(
                      "This reference opens the original source without a text excerpt."
                    )}
                </pre>
                {citation ? (
                  <dl className="grid gap-2 text-xs text-muted-foreground">
                    <div className="flex justify-between gap-3">
                      <dt>{t("Version")}</dt>
                      <dd className="truncate font-mono">
                        {citation.versionId}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>{t("Digest")}</dt>
                      <dd className="truncate font-mono">
                        {citation.contentHash}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            )}
          </div>
          {citation ? (
            <SheetFooter>
              <Link
                href={citationOpenHref(citation.openTarget)}
                className={buttonVariants()}
              >
                {t("Open exact source")}
                <ArrowUpRightIcon data-icon="inline-end" />
              </Link>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  )
}
