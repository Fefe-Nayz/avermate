"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { useExtracted } from "next-intl"
import { Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FenceFrame, FenceStatus } from "./fence-frame"
import { pythonSourceIssue } from "./python-run-policy"
import type { PythonRunPhase, PythonRunResult } from "./python-run-protocol"
import { PythonRunError, runPythonInBrowser } from "./python-runner"

type RunState =
  | { status: "idle" }
  | { status: "working"; phase: PythonRunPhase }
  | { status: "succeeded"; result: PythonRunResult }
  | { status: "failed"; message: string }

export function PythonRunFence({ source }: { source: string }) {
  const t = useExtracted()
  const issue = pythonSourceIssue(source)
  const [state, setState] = useState<RunState>({ status: "idle" })
  const controllerRef = useRef<AbortController | null>(null)
  const runRef = useRef(0)

  useEffect(
    () => () => {
      runRef.current += 1
      controllerRef.current?.abort()
    },
    []
  )

  const start = async () => {
    if (issue || state.status === "working") return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const run = runRef.current + 1
    runRef.current = run
    setState({ status: "working", phase: "loading-runtime" })
    try {
      const result = await runPythonInBrowser(source, {
        signal: controller.signal,
        onPhase: (phase) => {
          if (runRef.current === run) setState({ status: "working", phase })
        },
      })
      if (runRef.current === run) setState({ status: "succeeded", result })
    } catch (error) {
      if (runRef.current !== run) return
      const message =
        error instanceof PythonRunError && error.kind === "aborted"
          ? t("Python execution was cancelled.")
          : error instanceof Error
            ? error.message
            : t("Python execution failed.")
      setState({ status: "failed", message })
    } finally {
      if (runRef.current === run) controllerRef.current = null
    }
  }

  const stop = () => {
    controllerRef.current?.abort()
  }

  const phaseLabel =
    state.status !== "working"
      ? null
      : state.phase === "loading-runtime"
        ? t("Loading the local Python runtime…")
        : state.phase === "loading-packages"
          ? t("Loading scientific packages…")
          : state.phase === "ready"
            ? t("Starting isolated execution…")
            : t("Running Python locally…")

  return (
    <FenceFrame label={t("Executable Python block")}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Python · {t("runs locally")}
          </span>
          {state.status === "working" ? (
            <Button type="button" variant="outline" size="sm" onClick={stop}>
              <Square className="size-3.5" aria-hidden="true" />
              {t("Stop")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={Boolean(issue)}
              onClick={() => void start()}
            >
              <Play className="size-3.5" aria-hidden="true" />
              {state.status === "succeeded" ? t("Run again") : t("Run")}
            </Button>
          )}
        </div>

        <pre className="max-h-80 overflow-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed">
          <code>{source}</code>
        </pre>

        {issue ? <FenceStatus error>{issue}</FenceStatus> : null}
        {phaseLabel ? (
          <FenceStatus>
            <span aria-live="polite">{phaseLabel}</span>
          </FenceStatus>
        ) : null}
        {state.status === "failed" ? (
          <FenceStatus error>{state.message}</FenceStatus>
        ) : null}
        {state.status === "succeeded" ? (
          <PythonOutput result={state.result} />
        ) : null}
      </div>
    </FenceFrame>
  )
}

function PythonOutput({ result }: { result: PythonRunResult }) {
  const t = useExtracted()
  const empty = !result.stdout && !result.stderr && result.figures.length === 0
  return (
    <div
      className="space-y-3 border-t pt-3"
      aria-label={t("Python output")}
      aria-live="polite"
    >
      {result.stdout ? (
        <section aria-label={t("Standard output")}>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            stdout
          </div>
          <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs whitespace-pre-wrap">
            {result.stdout}
          </pre>
        </section>
      ) : null}
      {result.stderr ? (
        <section aria-label={t("Errors and warnings")}>
          <div className="mb-1 text-xs font-medium text-destructive">
            stderr
          </div>
          <pre className="max-h-72 overflow-auto rounded-md bg-destructive/8 p-3 text-xs whitespace-pre-wrap text-destructive">
            {result.stderr}
          </pre>
        </section>
      ) : null}
      {result.figures.map((figure, index) => (
        <Image
          key={`${index}-${figure.length}`}
          src={figure}
          alt={t("Matplotlib figure {number}", {
            number: String(index + 1),
          })}
          width={1_200}
          height={800}
          sizes="(max-width: 768px) 100vw, 800px"
          unoptimized
          className="h-auto max-h-[36rem] w-auto max-w-full rounded-md border bg-white object-contain"
        />
      ))}
      {empty ? (
        <p className="text-sm text-muted-foreground">
          {t("Execution completed without output.")}
        </p>
      ) : null}
      <p className="text-right text-[11px] text-muted-foreground tabular-nums">
        {t("Completed in {duration} ms", {
          duration: String(Math.round(result.durationMs)),
        })}
      </p>
    </div>
  )
}
