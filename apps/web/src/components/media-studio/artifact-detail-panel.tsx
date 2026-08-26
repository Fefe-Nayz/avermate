"use client"

import { rpc } from "@/lib/orpc"

import {
  ArchiveIcon,
  ChevronDownIcon,
  Clock3Icon,
  EyeIcon,
  HistoryIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Item,
  ItemActions,
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
import { Skeleton } from "@/components/ui/skeleton"
import { type ArtifactPlanSeed } from "./create-artifact-dialog"

/**
 * One artifact, and everything you can do to it.
 *
 * Three hundred and fifty lines living twenty-five levels deep inside the
 * studio screen — which is why nothing in it could be read or changed without
 * scrolling past the workflow list first. Same markup, moved out whole: the
 * studio now says *what* goes in the right-hand pane, and this file says what
 * that pane is.
 *
 * The prop list is long because the panel genuinely depends on that much, and
 * that is the argument for giving it a boundary rather than against it. Before,
 * these were closures nobody could enumerate.
 */
/**
 * The shapes come from the procedures themselves rather than from hand-written
 * interfaces: `listArtifacts` and `listRevisions` already define what a row is,
 * and restating it here would be a second definition free to drift from the
 * first.
 */
type ArtifactSummary = Awaited<
  ReturnType<typeof rpc.mediaStudio.listArtifacts>
>[number]
type ArtifactRevision = Awaited<
  ReturnType<typeof rpc.mediaStudio.listRevisions>
>[number]

/**
 * Only what the panel actually touches.
 *
 * Passing whole TanStack query and mutation objects would tie this file to
 * every field they happen to expose; naming the four it reads makes the
 * dependency legible and keeps the caller free to pass anything that satisfies
 * it — a fixture, for one.
 */
interface PendingAction<Input> {
  mutate: (input: Input) => void
  isPending: boolean
}

export function ArtifactDetailPanel({
  selectedArtifact,
  selectedRevision,
  comparisonRevision,
  compareRevisionId,
  revisionsQuery,
  manifestQuery,
  setState,
  promote,
  isOnline,
  formatDate,
  artifactKindLabel,
  setPreviewOpen,
  setCreateOpen,
  setCreateSeed,
  setCompareRevisionId,
  setSelectedRevisionId,
}: {
  selectedArtifact: ArtifactSummary | null
  selectedRevision: ArtifactRevision | null
  comparisonRevision: ArtifactRevision | null
  compareRevisionId: string | null
  revisionsQuery: {
    data?: ArtifactRevision[]
    error: { message: string } | null
    isPending: boolean
  }
  manifestQuery: {
    data?: Awaited<ReturnType<typeof rpc.mediaStudio.getManifest>>
    error: { message: string } | null
    isPending: boolean
  }
  setState: PendingAction<
    Parameters<typeof rpc.mediaStudio.setArtifactState>[0]
  >
  promote: PendingAction<Parameters<typeof rpc.mediaStudio.promoteRevision>[0]>
  isOnline: boolean
  formatDate: (
    format: ReturnType<typeof useFormatter>,
    value: string | Date
  ) => string
  artifactKindLabel: (kind: string) => string
  setPreviewOpen: (open: boolean) => void
  setCreateOpen: (open: boolean) => void
  setCreateSeed: (seed: ArtifactPlanSeed | null) => void
  setCompareRevisionId: (id: string | null) => void
  setSelectedRevisionId: (id: string | null) => void
}) {
  const t = useExtracted()
  const format = useFormatter()

  return (
    <Card>
      {selectedArtifact ? (
        <>
          <CardHeader>
            <CardTitle>{selectedArtifact.title}</CardTitle>
            <CardDescription>
              {artifactKindLabel(selectedArtifact.kind)} ·{" "}
              {t("identity revision {revision}", {
                revision: String(selectedArtifact.identityRevision),
              })}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{selectedArtifact.state}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div>
              <h3 className="mb-2 font-medium">{t("Revisions")}</h3>
              {revisionsQuery.isPending ? (
                <div
                  className="flex flex-col gap-2"
                  role="status"
                  aria-label={t("Loading revisions")}
                >
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : revisionsQuery.error ? (
                <Alert variant="destructive">
                  <AlertTitle>{t("Revision history unavailable")}</AlertTitle>
                  <AlertDescription>
                    {revisionsQuery.error.message}
                  </AlertDescription>
                </Alert>
              ) : !revisionsQuery.data?.length ? (
                <Alert>
                  <Clock3Icon />
                  <AlertTitle>{t("First output pending")}</AlertTitle>
                  <AlertDescription>
                    {t(
                      "The workflow exists, but no revision has been published yet."
                    )}
                  </AlertDescription>
                </Alert>
              ) : (
                <ItemGroup className="gap-2">
                  {revisionsQuery.data.map((revision) => (
                    <Item
                      key={revision.id}
                      variant={
                        selectedRevision?.id === revision.id
                          ? "muted"
                          : "outline"
                      }
                      size="sm"
                    >
                      <ItemMedia variant="icon">
                        <HistoryIcon />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>
                          {t("Revision {revision}", {
                            revision: String(revision.revision),
                          })}
                          {revision.current ? (
                            <Badge>{t("Published")}</Badge>
                          ) : null}
                        </ItemTitle>
                        <ItemDescription>
                          {revision.outputMime} ·{" "}
                          {formatDate(format, revision.createdAt)}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSelectedRevisionId(revision.id)
                            if (compareRevisionId === revision.id) {
                              setCompareRevisionId(null)
                            }
                          }}
                        >
                          {t("Inspect")}
                        </Button>
                        {!revision.current ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              promote.mutate({
                                artifactId: selectedArtifact.id,
                                artifactRevisionId: revision.id,
                                expectedIdentityRevision:
                                  selectedArtifact.identityRevision,
                              })
                            }
                            disabled={!isOnline || promote.isPending}
                          >
                            <RotateCcwIcon data-icon="inline-start" />
                            {t("Publish")}
                          </Button>
                        ) : null}
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              )}
            </div>

            {selectedRevision ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-medium">
                      {t("Revision {revision}", {
                        revision: String(selectedRevision.revision),
                      })}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {t("Manifest")}{" "}
                      {selectedRevision.manifestDigest.slice(0, 12)}…
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {revisionsQuery.data && revisionsQuery.data.length > 1 ? (
                      <Select
                        value={compareRevisionId ?? "none"}
                        onValueChange={(value) =>
                          setCompareRevisionId(value === "none" ? null : value)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-44"
                          aria-label={t("Compare with revision")}
                        >
                          <SelectValue placeholder={t("Compare")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="none">
                              {t("No comparison")}
                            </SelectItem>
                            {revisionsQuery.data
                              .filter(
                                (revision) =>
                                  revision.id !== selectedRevision.id
                              )
                              .map((revision) => (
                                <SelectItem
                                  key={revision.id}
                                  value={revision.id}
                                >
                                  {t("Revision {revision}", {
                                    revision: String(revision.revision),
                                  })}
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setCreateSeed({
                          projectId: selectedArtifact.projectId,
                          kind: selectedArtifact.kind,
                          title: `${selectedArtifact.title} — ${t("revision")}`,
                          parentArtifactRevisionIds: [selectedRevision.id],
                        })
                        setCreateOpen(true)
                      }}
                      disabled={!isOnline}
                    >
                      <RefreshCwIcon data-icon="inline-start" />
                      {t("Revise")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setPreviewOpen(true)}
                      disabled={!selectedRevision.outputFileId}
                    >
                      <EyeIcon data-icon="inline-start" />
                      {t("Preview")}
                    </Button>
                  </div>
                </div>

                <Collapsible>
                  <CollapsibleTrigger
                    render={<Button variant="outline" size="sm" />}
                  >
                    <ChevronDownIcon data-icon="inline-start" />
                    {t("Manifest and provenance")}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    {manifestQuery.isPending ? (
                      <Skeleton className="h-48" />
                    ) : manifestQuery.error ? (
                      <Alert variant="destructive">
                        <AlertTitle>{t("Manifest unavailable")}</AlertTitle>
                        <AlertDescription>
                          {manifestQuery.error.message}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
                        {JSON.stringify(manifestQuery.data, null, 2)}
                      </pre>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                {comparisonRevision ? (
                  /* A heading and two columns. It was a card
                       inside the artifact card, each column itself
                       bordered — three frames deep for a two-column
                       comparison. */
                  <section>
                    <h4 className="text-sm font-medium">
                      {t("Comparing two versions")}
                    </h4>
                    <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
                      {t(
                        "What changed between them. Open either one to read it in full."
                      )}
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {[selectedRevision, comparisonRevision].map(
                        (revision) => (
                          <dl
                            key={revision.id}
                            className="grid gap-2 rounded-lg border p-3 text-sm"
                          >
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                {t("Revision")}
                              </dt>
                              <dd className="font-medium">
                                {revision.revision}
                                {revision.current ? ` · ${t("Published")}` : ""}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                {t("Output")}
                              </dt>
                              <dd>{revision.outputMime}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                {t("Created")}
                              </dt>
                              <dd>{formatDate(format, revision.createdAt)}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                {t("Manifest")}
                              </dt>
                              <dd
                                className="truncate font-mono text-xs"
                                title={revision.manifestDigest}
                              >
                                {revision.manifestDigest}
                              </dd>
                            </div>
                          </dl>
                        )
                      )}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setState.mutate({
                  artifactId: selectedArtifact.id,
                  expectedIdentityRevision: selectedArtifact.identityRevision,
                  state:
                    selectedArtifact.state === "archived"
                      ? "active"
                      : "archived",
                })
              }
              disabled={!isOnline || setState.isPending}
            >
              <ArchiveIcon data-icon="inline-start" />
              {selectedArtifact.state === "archived"
                ? t("Reactivate")
                : t("Archive")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                setState.mutate({
                  artifactId: selectedArtifact.id,
                  expectedIdentityRevision: selectedArtifact.identityRevision,
                  state: "trashed",
                })
              }
              disabled={!isOnline || setState.isPending}
            >
              <Trash2Icon data-icon="inline-start" />
              {t("Move to trash")}
            </Button>
          </CardFooter>
        </>
      ) : null}
    </Card>
  )
}
