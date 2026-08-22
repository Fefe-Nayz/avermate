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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

const searchModes = [
  { value: "terms", label: "Mots" },
  { value: "phrase", label: "Phrase" },
  { value: "prefix", label: "Préfixe" },
  { value: "exact", label: "Exact" },
] as const

const searchableKinds: readonly {
  value: ProjectSourceKind
  label: string
}[] = [
  { value: "material", label: "Documents" },
  { value: "study-document", label: "Fiches" },
  { value: "recording", label: "Cours audio" },
  { value: "grade", label: "Notes" },
  { value: "subject", label: "Matières" },
  { value: "artifact", label: "Artéfacts" },
]

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
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query.trim())
  const [mode, setMode] =
    useState<(typeof searchModes)[number]["value"]>("terms")
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
    enabled: deferredQuery.length > 0,
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const citationQuery = useQuery({
    ...orpc.projects.readCitation.queryOptions({
      input: { citationId: citationId ?? "_" },
    }),
    enabled: Boolean(citationId),
    staleTime: Infinity,
  })

  const subjectItems = [
    { value: null, label: "Toutes les matières" },
    ...subjects.map((subject) => ({ value: subject.id, label: subject.name })),
  ]

  function sourceTitle(sourceId: string) {
    const item = items.find((candidate) => candidate.sourceId === sourceId)
    if (!item) return "Source"
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
          Recherche dans le projet
        </h2>
        <p className="text-sm text-muted-foreground">
          La recherche lexicale reste disponible sans IA. Chaque résultat pointe
          vers une version et une position immuables.
        </p>
      </div>

      <FieldGroup className="rounded-xl border p-4">
        <Field>
          <FieldLabel htmlFor="project-search-query">Requête</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id="project-search-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ex. énergie cinétique, « réaction acide-base », E=mc^2…"
            />
          </InputGroup>
        </Field>

        <div className="flex flex-wrap items-end gap-4">
          <Field className="w-auto">
            <FieldLabel id="search-mode-label">Mode</FieldLabel>
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
            <FieldLabel>Matière</FieldLabel>
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
          <FieldLabel id="source-kind-label">Types de source</FieldLabel>
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
          <AlertTitle>Recherche indisponible</AlertTitle>
          <AlertDescription>{resultQuery.error.message}</AlertDescription>
        </Alert>
      ) : resultQuery.isFetching && deferredQuery ? (
        <div className="flex flex-col gap-3" aria-label="Recherche en cours">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : deferredQuery && evidence.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSearchIcon />
            </EmptyMedia>
            <EmptyTitle>Aucun passage trouvé</EmptyTitle>
            <EmptyDescription>
              Ajustez les filtres. Une page scannée non OCRisée ne peut pas
              produire de résultat textuel.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : evidence.length > 0 ? (
        <ItemGroup aria-live="polite">
          {evidence.map((result) => (
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
              <ItemContent>
                <ItemTitle>{sourceTitle(result.sourceId)}</ItemTitle>
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
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenTextIcon />
            </EmptyMedia>
            <EmptyTitle>Cherchez dans vos sources</EmptyTitle>
            <EmptyDescription>
              Les extraits sont classés par BM25 et restent liés à leur source
              exacte.
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
            <SheetTitle>{citation?.displayTitle ?? "Citation"}</SheetTitle>
            <SheetDescription>
              {citation ? locatorLabel(citation.locator) : "Chargement…"}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {citationQuery.isLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-40 w-full" />
              </div>
            ) : citationQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>La citation n’est plus lisible</AlertTitle>
                <AlertDescription>
                  {citationQuery.error.message}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-col gap-4">
                <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm whitespace-pre-wrap">
                  {citationQuery.data?.text ??
                    "Cette référence ouvre la source originale sans extrait textuel."}
                </pre>
                {citation ? (
                  <dl className="grid gap-2 text-xs text-muted-foreground">
                    <div className="flex justify-between gap-3">
                      <dt>Version</dt>
                      <dd className="truncate font-mono">
                        {citation.versionId}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Empreinte</dt>
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
              <Button
                render={<Link href={citationOpenHref(citation.openTarget)} />}
                nativeButton={false}
              >
                Ouvrir la source exacte
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            </SheetFooter>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  )
}
