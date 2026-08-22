"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DatabaseZapIcon,
  DownloadIcon,
  EyeIcon,
  FileArchiveIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"

type ProviderDisclosure = {
  provider: string
  model: string
  modelRevision: string
}

type DeleteMode = "copy-analysis" | "all-computed" | "all" | null

function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function LearningPrivacyControls({
  providers,
  online,
}: {
  providers: ProviderDisclosure[]
  online: boolean
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [deleteMode, setDeleteMode] = useState<DeleteMode>(null)
  const [confirmation, setConfirmation] = useState("")
  const settings = useQuery({
    ...orpc.learning.settings.get.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const preview = useQuery({
    ...orpc.learning.privacy.preview.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: orpc.learning.key() })
  }

  const update = useMutation({
    ...orpc.learning.settings.update.mutationOptions(),
    onSuccess: async () => {
      await settings.refetch()
      toast.success(t("Learning privacy settings updated"))
    },
    onError: async (value) => {
      await settings.refetch()
      toast.error(value.message)
    },
  })
  const exportData = useMutation({
    ...orpc.learning.privacy.export.mutationOptions(),
    onSuccess: ({ json, markdown }) => {
      const date = new Date().toISOString().slice(0, 10)
      downloadText(
        `avermate-learning-${date}.json`,
        JSON.stringify(json, null, 2),
        "application/json;charset=utf-8"
      )
      downloadText(
        `avermate-learning-${date}.md`,
        markdown,
        "text/markdown;charset=utf-8"
      )
      toast.success(t("JSON and Markdown exports downloaded"))
    },
    onError: (value) => toast.error(value.message),
  })
  const deleteDerivatives = useMutation({
    ...orpc.learning.privacy.deleteDerivatives.mutationOptions(),
    onSuccess: async () => {
      setDeleteMode(null)
      setConfirmation("")
      await refresh()
      toast.success(t("Derived learning data deleted"))
    },
    onError: (value) => toast.error(value.message),
  })
  const deleteAll = useMutation({
    ...orpc.learning.privacy.deleteAll.mutationOptions(),
    onSuccess: async () => {
      setDeleteMode(null)
      setConfirmation("")
      await refresh()
      toast.success(t("Learning data deleted"))
    },
    onError: (value) => toast.error(value.message),
  })

  const uniqueProviders = [
    ...new Map(
      providers.map((provider) => [
        `${provider.provider}:${provider.model}:${provider.modelRevision}`,
        provider,
      ])
    ).values(),
  ]
  const expectedPhrase =
    deleteMode === "all" ? "DELETE LEARNING" : "DELETE DERIVATIVES"
  const deleting = deleteDerivatives.isPending || deleteAll.isPending

  return (
    <Card id="privacy" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon /> {t("Learning privacy and data")}
        </CardTitle>
        <CardDescription>
          {t(
            "Paper analysis is opt-in, provider disclosure is explicit, and every learning row can be exported or deleted independently from grades and original files."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        {settings.isError ? (
          <Alert variant="destructive" className="lg:col-span-2">
            <AlertTitle>{t("Learning privacy and data")}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              {settings.error.message}
              <Button
                size="sm"
                variant="outline"
                disabled={!online || settings.isFetching}
                onClick={() => settings.refetch()}
              >
                {t("Try again")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <section className="grid gap-3 rounded-xl border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium">{t("On-demand paper analysis")}</p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Only the copy you select is sent to the configured OCR/model provider. The school grade and unrelated identity data are not included."
                )}
              </p>
            </div>
            <Switch
              aria-label={t("Enable paper analysis")}
              checked={settings.data?.analysisEnabled ?? false}
              disabled={
                !online ||
                settings.isLoading ||
                settings.isError ||
                update.isPending
              }
              onCheckedChange={(checked) =>
                update.mutate({
                  analysisEnabled: checked,
                  expectedRevision: settings.data?.revision ?? 0,
                })
              }
            />
          </div>
          <div className="flex items-start justify-between gap-4 border-t pt-3">
            <div>
              <p className="font-medium">{t("Quiz response timing")}</p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Latency is collected only when this separate setting is enabled."
                )}
              </p>
            </div>
            <Switch
              aria-label={t("Collect quiz response timing")}
              checked={settings.data?.latencyCollectionEnabled ?? false}
              disabled={
                !online ||
                settings.isLoading ||
                settings.isError ||
                update.isPending
              }
              onCheckedChange={(checked) =>
                update.mutate({
                  latencyCollectionEnabled: checked,
                  expectedRevision: settings.data?.revision ?? 0,
                })
              }
            />
          </div>
          <Alert>
            <ShieldCheckIcon />
            <AlertTitle>{t("Training export is off")}</AlertTitle>
            <AlertDescription>
              {t(
                "Corrections and copies are never exported for model training by these settings."
              )}
            </AlertDescription>
          </Alert>
        </section>

        <section className="grid gap-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{t("Provider disclosure")}</p>
            <Badge variant="outline">{t("Per selected copy")}</Badge>
          </div>
          {uniqueProviders.length ? (
            <ul className="grid gap-2">
              {uniqueProviders.map((provider) => (
                <li
                  key={`${provider.provider}:${provider.model}:${provider.modelRevision}`}
                  className="rounded-lg bg-muted/50 p-3 text-sm"
                >
                  <p className="font-medium">{provider.provider}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {provider.model} · {provider.modelRevision}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(
                "No copy has been sent yet. The active provider and model revision will appear here after a request."
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t(
              "Credentials remain server-side. Avermate stores the provider, model and revision with each proposal for audit."
            )}
          </p>
        </section>

        <section className="grid gap-3 rounded-xl border p-4 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{t("Export preview")}</p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "The export contains concepts, evidence, corrections, projections, plans and source references in both machine-readable JSON and Markdown."
                )}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!online || exportData.isPending}
              onClick={() => exportData.mutate({})}
            >
              {exportData.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <DownloadIcon data-icon="inline-start" />
              )}
              {t("Download JSON and Markdown")}
            </Button>
          </div>
          {preview.isLoading ? (
            <Skeleton className="h-20" />
          ) : preview.isError ? (
            <Alert variant="destructive">
              <AlertTitle>{t("Export preview unavailable")}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                {preview.error.message}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!online || preview.isFetching}
                  onClick={() => preview.refetch()}
                >
                  {t("Try again")}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {Object.entries(preview.data?.counts ?? {}).map(
                ([name, count]) => (
                  <div key={name} className="rounded-lg bg-muted/50 p-3">
                    <dt
                      className="truncate text-xs text-muted-foreground"
                      title={name}
                    >
                      {name}
                    </dt>
                    <dd className="numeric text-lg font-medium">{count}</dd>
                  </div>
                )
              )}
            </dl>
          )}
        </section>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2 border-t">
        <Button
          variant="outline"
          disabled={!online}
          onClick={() => {
            setConfirmation("")
            setDeleteMode("copy-analysis")
          }}
        >
          <FileArchiveIcon data-icon="inline-start" />
          {t("Delete copy derivatives")}
        </Button>
        <Button
          variant="outline"
          disabled={!online}
          onClick={() => {
            setConfirmation("")
            setDeleteMode("all-computed")
          }}
        >
          <DatabaseZapIcon data-icon="inline-start" />
          {t("Delete all computed learning data")}
        </Button>
        <Button
          variant="destructive"
          disabled={!online}
          onClick={() => {
            setConfirmation("")
            setDeleteMode("all")
          }}
        >
          <Trash2Icon data-icon="inline-start" />
          {t("Delete all learning data")}
        </Button>
      </CardFooter>

      <AlertDialog
        open={deleteMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteMode(null)
            setConfirmation("")
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteMode === "copy-analysis"
                ? t("Delete copy-analysis derivatives?")
                : deleteMode === "all-computed"
                  ? t("Delete all computed learning data?")
                  : t("Delete every learning row?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteMode === "copy-analysis"
                ? t(
                    "OCR/model proposals, reviews and copy-derived evidence are deleted. Original grade attachments remain."
                  )
                : deleteMode === "all-computed"
                  ? t(
                      "Model/parser evidence, mastery histories and learning-plan suggestions are also deleted. Concepts and human/provider evidence remain."
                    )
                  : t(
                      "Every Learning row is deleted. Grades, original files, projects and authoritative planning tasks remain."
                    )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="learning-delete-confirmation">
              {t("Type {phrase} to confirm", { phrase: expectedPhrase })}
            </Label>
            <Input
              id="learning-delete-confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <Alert>
            <EyeIcon />
            <AlertTitle>{t("Review the retained data above")}</AlertTitle>
            <AlertDescription>
              {t(
                "This action does not silently delete the original school grade or planning task."
              )}
            </AlertDescription>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!online || confirmation !== expectedPhrase || deleting}
              onClick={() => {
                if (deleteMode === "all")
                  deleteAll.mutate({ confirmation: "DELETE LEARNING" })
                else if (deleteMode)
                  deleteDerivatives.mutate({
                    scope: deleteMode,
                    confirmation: "DELETE DERIVATIVES",
                  })
              }}
            >
              {deleting ? <Spinner data-icon="inline-start" /> : null}
              {t("Delete confirmed scope")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
