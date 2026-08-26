"use client"

import { rpc } from "@/lib/orpc"

import {
  BanIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  FilmIcon,
  PlusIcon,
  RefreshCwIcon,
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  TERMINAL_WORKFLOW_STATUSES,
  stageCanApprove,
  stageCanRetry,
  stageProgress,
  workflowStatusVariant,
} from "./media-studio-model"
import { useMediaStudioCopy } from "./media-studio-copy"

/**
 * The workflow list, and whichever run is selected.
 *
 * This was the deepest thing in the studio screen — the stage rows sat
 * twenty-two levels in, which is why a two-line change to a retry button meant
 * counting closing braces. Moved out whole; the studio keeps the tab and this
 * file keeps what is inside it.
 */
type WorkflowRun = Awaited<
  ReturnType<typeof rpc.mediaStudio.listWorkflows>
>[number]

interface PendingAction<Input> {
  mutate: (input: Input) => void
  isPending: boolean
}

export function WorkflowActivityPanel({
  workflowsQuery,
  selectedWorkflow,
  workflow,
  artifactKindLabel,
  setCreateOpen,
  setSelectedRunId,
  approve,
  retry,
  cancel,
  isOnline,
  formatDate,
}: {
  workflowsQuery: {
    data?: WorkflowRun[]
    error: { message: string } | null
    isPending: boolean
  }
  selectedWorkflow: WorkflowRun | null
  /** The detailed run, which the list rows do not carry. */
  workflow:
    Awaited<ReturnType<typeof rpc.mediaStudio.getWorkflow>> | WorkflowRun | null
  artifactKindLabel: (kind: string) => string
  setCreateOpen: (open: boolean) => void
  setSelectedRunId: (id: string | null) => void
  approve: PendingAction<Parameters<typeof rpc.mediaStudio.approveStage>[0]>
  retry: PendingAction<Parameters<typeof rpc.mediaStudio.retryStage>[0]>
  cancel: PendingAction<Parameters<typeof rpc.mediaStudio.cancelWorkflow>[0]>
  isOnline: boolean
  formatDate: (
    format: ReturnType<typeof useFormatter>,
    value: string | Date
  ) => string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const { workflowStatusLabel, stageLabel } = useMediaStudioCopy()

  // Derived here rather than passed in: it is a pure function of `workflow`,
  // which this panel already has, and a prop would be a second place for it to
  // go stale.
  const workflowProgress = workflow?.stages.length
    ? Math.round(
        workflow.stages.reduce(
          (sum, stage) => sum + stageProgress(stage.processed, stage.total),
          0
        ) / workflow.stages.length
      )
    : 0

  return (
    <>
      {workflowsQuery.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t("Workflows unavailable")}</AlertTitle>
          <AlertDescription>{workflowsQuery.error.message}</AlertDescription>
        </Alert>
      ) : workflowsQuery.isPending ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : !workflowsQuery.data?.length ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FilmIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No workflows")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Create a study sheet, quiz, podcast, presentation or video from a project's sources."
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setCreateOpen(true)} disabled={!isOnline}>
              <PlusIcon data-icon="inline-start" />
              {t("Plan an artifact")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid min-h-[34rem] gap-4 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
          <Card>
            <CardHeader>
              <CardTitle>{t("Activity")}</CardTitle>
              <CardDescription>
                {t("{count, plural, one {# workflow} other {# workflows}}", {
                  count: workflowsQuery.data.length,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-2">
              <ItemGroup className="gap-1">
                {workflowsQuery.data.map((run) => (
                  <Button
                    key={run.id}
                    variant={
                      selectedWorkflow?.id === run.id ? "secondary" : "ghost"
                    }
                    className="h-auto w-full justify-start px-2 py-2 text-left"
                    onClick={() => setSelectedRunId(run.id)}
                    aria-pressed={selectedWorkflow?.id === run.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {artifactKindLabel(run.kind)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatDate(format, run.updatedAt)}
                      </span>
                    </span>
                    <Badge variant={workflowStatusVariant(run.status)}>
                      {workflowStatusLabel(run.status)}
                    </Badge>
                  </Button>
                ))}
              </ItemGroup>
            </CardContent>
          </Card>

          <Card>
            {workflow ? (
              <>
                <CardHeader>
                  <CardTitle>{artifactKindLabel(workflow.kind)}</CardTitle>
                  <CardDescription>
                    {workflow.workflowId} · {t("version")}{" "}
                    {workflow.workflowVersion}
                  </CardDescription>
                  <CardAction>
                    <Badge variant={workflowStatusVariant(workflow.status)}>
                      {workflowStatusLabel(workflow.status)}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent
                  className="flex flex-col gap-5"
                  aria-live="polite"
                  aria-busy={!TERMINAL_WORKFLOW_STATUSES.has(workflow.status)}
                >
                  <Progress value={workflowProgress}>
                    <ProgressLabel>{t("Overall progress")}</ProgressLabel>
                    <ProgressValue>
                      {() => `${workflowProgress} %`}
                    </ProgressValue>
                  </Progress>

                  {workflow.reasonCode || workflow.safeError ? (
                    <Alert variant="destructive">
                      <CircleAlertIcon />
                      <AlertTitle>
                        {workflow.reasonCode || t("Workflow failed")}
                      </AlertTitle>
                      <AlertDescription>
                        {workflow.safeError ||
                          t(
                            "The workflow cannot advance from its current state."
                          )}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <ItemGroup>
                    {workflow.stages.map((stage) => {
                      const progress = stageProgress(
                        stage.processed,
                        stage.total
                      )
                      return (
                        <Item key={stage.id} variant="outline">
                          <ItemMedia variant="icon">
                            {stage.status === "completed" ? (
                              <CheckCircle2Icon className="text-primary" />
                            ) : stage.status === "failed" ? (
                              <CircleAlertIcon className="text-destructive" />
                            ) : (
                              <Clock3Icon />
                            )}
                          </ItemMedia>
                          <ItemContent>
                            <ItemTitle>
                              {stage.position + 1}. {stageLabel(stage.key)}
                              <Badge
                                variant={workflowStatusVariant(stage.status)}
                              >
                                {workflowStatusLabel(stage.status)}
                              </Badge>
                            </ItemTitle>
                            <ItemDescription>
                              {stage.message ||
                                (stage.placement === "unavailable"
                                  ? t("No AI service is set up for this yet.")
                                  : t("Placement: {placement}", {
                                      placement: stage.placement,
                                    }))}
                            </ItemDescription>
                            <Progress value={progress} className="mt-1">
                              <ProgressValue>
                                {() =>
                                  stage.total > 0
                                    ? `${stage.processed}/${stage.total} ${stage.unit}`
                                    : t("Waiting")
                                }
                              </ProgressValue>
                            </Progress>
                            {stage.safeError ? (
                              <p className="text-xs text-destructive">
                                {stage.safeError}
                              </p>
                            ) : null}
                          </ItemContent>
                          {stageCanApprove(stage.status) ||
                          stageCanRetry(stage.status) ? (
                            <ItemActions>
                              {stageCanApprove(stage.status) ? (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    approve.mutate({
                                      runId: workflow.id,
                                      stageId: stage.id,
                                    })
                                  }
                                  disabled={!isOnline || approve.isPending}
                                >
                                  {t("Approve")}
                                </Button>
                              ) : null}
                              {stageCanRetry(stage.status) ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    retry.mutate({
                                      runId: workflow.id,
                                      stageId: stage.id,
                                    })
                                  }
                                  disabled={!isOnline || retry.isPending}
                                >
                                  <RefreshCwIcon data-icon="inline-start" />
                                  {t("Retry")}
                                </Button>
                              ) : null}
                            </ItemActions>
                          ) : null}
                        </Item>
                      )
                    })}
                  </ItemGroup>
                </CardContent>
                <CardFooter className="justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {t("Updated {date}", {
                      date: formatDate(format, workflow.updatedAt),
                    })}
                  </span>
                  {!TERMINAL_WORKFLOW_STATUSES.has(workflow.status) ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => cancel.mutate({ runId: workflow.id })}
                      disabled={!isOnline || cancel.isPending}
                    >
                      <BanIcon data-icon="inline-start" />
                      {t("Cancel")}
                    </Button>
                  ) : null}
                </CardFooter>
              </>
            ) : null}
          </Card>
        </div>
      )}
    </>
  )
}
