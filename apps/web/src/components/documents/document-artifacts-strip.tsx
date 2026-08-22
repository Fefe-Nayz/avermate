"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DownloadIcon,
  FileArchiveIcon,
  FileCode2Icon,
  HeadphonesIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"

type GeneratableKind = "anki" | "html" | "audio"

function active(status: string | undefined) {
  return status === "queued" || status === "running"
}

export function DocumentArtifactsStrip({
  documentId,
  revision,
  allowAnki,
  allowPodcast,
}: {
  documentId: string
  revision: number
  allowAnki: boolean
  allowPodcast: boolean
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const artifacts = useQuery({
    ...orpc.documents.artifacts.list.queryOptions({ input: { documentId } }),
  })
  const job = useQuery({
    ...orpc.jobs.get.queryOptions({ input: { jobId: jobId ?? "" } }),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      active(query.state.data?.status) ? 1_500 : false,
  })
  const generate = useMutation({
    ...orpc.documents.artifacts.generate.mutationOptions(),
    onSuccess: async (result) => {
      if (result.jobId) setJobId(result.jobId)
      await artifacts.refetch()
      toast.success(
        result.reused ? t("Export already available.") : t("Export queued.")
      )
    },
    onError: (error: Error) =>
      toast.error(error.message || t("The export could not start.")),
  })
  const download = useMutation({
    ...orpc.documents.artifacts.download.mutationOptions(),
    onError: (error: Error) =>
      toast.error(error.message || t("The export is unavailable.")),
  })
  const artifactRows = artifacts.data

  useEffect(() => {
    if (
      job.data?.status === "succeeded" ||
      job.data?.status === "failed" ||
      job.data?.status === "cancelled"
    ) {
      void queryClient.invalidateQueries({
        queryKey: orpc.documents.artifacts.list.queryKey({
          input: { documentId },
        }),
      })
    }
  }, [documentId, job.data?.status, queryClient])

  const latest = useMemo(() => {
    const byKind = new Map<string, NonNullable<typeof artifactRows>[number]>()
    for (const artifact of artifactRows ?? []) {
      if (!byKind.has(artifact.kind)) byKind.set(artifact.kind, artifact)
    }
    return [...byKind.values()]
  }, [artifactRows])

  const start = (kind: GeneratableKind) => {
    if (kind === "audio") setAudioUrl(null)
    generate.mutate({ documentId, kind, variant: "default" })
  }
  const open = async (artifactId: string) => {
    const target = window.open("about:blank", "_blank")
    if (target) target.opener = null
    try {
      const result = await download.mutateAsync({ artifactId })
      if (target) target.location.replace(result.url)
      else window.open(result.url, "_blank", "noopener,noreferrer")
    } catch {
      target?.close()
    }
  }
  const play = async (artifactId: string) => {
    try {
      const result = await download.mutateAsync({ artifactId })
      setAudioUrl(result.url)
    } catch {
      setAudioUrl(null)
    }
  }

  return (
    <section
      aria-label={t("Exports")}
      className="document-screen-only mb-4 rounded-xl border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t("Exports")}
        </span>
        {latest.map((artifact) => (
          <div
            key={artifact.id}
            className="flex items-center gap-1 rounded-lg border px-2 py-1"
          >
            <span className="text-xs font-medium uppercase">
              {artifact.kind === "audio" ? t("Podcast") : artifact.kind}
            </span>
            {artifact.kind === "audio" ? (
              <span className="text-[11px] text-muted-foreground">
                {t("AI-generated")}
              </span>
            ) : null}
            <Badge
              variant={artifact.status === "failed" ? "destructive" : "outline"}
            >
              {artifact.stale
                ? t("Outdated · revision {old} of {current}", {
                    old: String(artifact.sourceRevision),
                    current: String(revision),
                  })
                : artifact.status === "succeeded"
                  ? t("Up to date")
                  : artifact.status === "failed"
                    ? t("Failed")
                    : t("In progress")}
            </Badge>
            {artifact.status === "succeeded" && artifact.fileId ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={
                  artifact.kind === "audio"
                    ? t("Listen to podcast")
                    : t("Download {kind}", { kind: artifact.kind })
                }
                disabled={download.isPending}
                onClick={() =>
                  artifact.kind === "audio"
                    ? void play(artifact.id)
                    : void open(artifact.id)
                }
              >
                {artifact.kind === "audio" ? <PlayIcon /> : <DownloadIcon />}
              </Button>
            ) : null}
            {(artifact.kind === "anki" ||
              artifact.kind === "html" ||
              artifact.kind === "audio") &&
            artifact.stale ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("Regenerate {kind}", { kind: artifact.kind })}
                disabled={generate.isPending}
                onClick={() => start(artifact.kind as GeneratableKind)}
              >
                <RefreshCwIcon />
              </Button>
            ) : null}
          </div>
        ))}
        {allowAnki &&
        !latest.some(
          (artifact) => artifact.kind === "anki" && !artifact.stale
        ) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => start("anki")}
          >
            {generate.isPending ? <Spinner /> : <FileArchiveIcon />}
            {t("Export for Anki")}
          </Button>
        ) : null}
        {!latest.some(
          (artifact) => artifact.kind === "html" && !artifact.stale
        ) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => start("html")}
          >
            {generate.isPending ? <Spinner /> : <FileCode2Icon />}
            {t("Export HTML")}
          </Button>
        ) : null}
        {allowPodcast &&
        !latest.some(
          (artifact) => artifact.kind === "audio" && !artifact.stale
        ) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => start("audio")}
          >
            {generate.isPending ? <Spinner /> : <HeadphonesIcon />}
            {t("Generate podcast")}
          </Button>
        ) : null}
      </div>
      {audioUrl ? (
        <audio
          className="mt-3 w-full"
          controls
          autoPlay
          src={audioUrl}
          aria-label={t("Generated podcast")}
        />
      ) : null}
      {latest.find((artifact) => artifact.status === "failed")?.log ? (
        <p className="mt-2 truncate text-xs text-destructive">
          {latest.find((artifact) => artifact.status === "failed")?.log}
        </p>
      ) : null}
    </section>
  )
}
