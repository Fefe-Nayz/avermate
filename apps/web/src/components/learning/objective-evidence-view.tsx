"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CircleOffIcon,
  FileQuestionIcon,
  InfoIcon,
  RotateCcwIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { orpc } from "@/lib/orpc"

function percent(value: number) {
  return `${Math.round(value * 100)} %`
}

/**
 * What each kind of evidence is called.
 *
 * This was eight nested ternaries inside the render loop — a lookup table
 * written as a conditional chain, which grows another branch every time a kind
 * is added and reads as a staircase in the diff. A record says the same thing
 * and makes a missing label a type error instead of a silent fall-through to
 * "Provider snapshot".
 */
function useEvidenceKindLabel() {
  const t = useExtracted()
  const labels: Record<string, string> = {
    "school-grade": t("School grade"),
    "copy-region": t("Reviewed paper region"),
    "teacher-comment": t("Teacher feedback"),
    "quiz-question": t("Quiz question"),
    exercise: t("Exercise"),
    "self-assessment": t("Self-assessment"),
    "manual-observation": t("Manual observation"),
  }
  const fallback = t("From your school")
  return (kind: string) => labels[kind] ?? fallback
}

export function ObjectiveEvidenceView({
  objectiveId,
}: {
  objectiveId: string
}) {
  const t = useExtracted()
  const kindLabel = useEvidenceKindLabel()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const explanation = useQuery(
    orpc.learning.mastery.explain.queryOptions({ input: { objectiveId } })
  )
  const evidence = useQuery(
    orpc.learning.evidence.list.queryOptions({ input: { objectiveId } })
  )
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.learning.mastery.explain.queryKey({
          input: { objectiveId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.learning.evidence.list.queryKey({
          input: { objectiveId },
        }),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.learning.mastery.key() }),
    ])
  }
  const decide = useMutation({
    ...orpc.learning.evidence.decide.mutationOptions(),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  })
  const projection = explanation.data?.projection
  const contributionById = new Map(
    projection?.explanationJson.contributions.map((row) => [
      row.evidenceId,
      row,
    ]) ?? []
  )
  return (
    <>
      <PageMeta
        title={explanation.data?.objective.statement ?? t("Objective")}
        subtitle={t("Evidence and explainable calculation")}
        backHref="/learning"
      />
      <main className="flex min-w-0 flex-col gap-4">
        {explanation.isLoading ? (
          <Skeleton className="h-48" />
        ) : explanation.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("Objective unavailable")}</AlertTitle>
            <AlertDescription>{explanation.error.message}</AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("Objective")}
                </p>
                <CardTitle>{explanation.data?.objective.statement}</CardTitle>
              </div>
              <Badge variant="outline">
                {projection?.algorithmRevision ?? t("No calculation")}
              </Badge>
            </CardHeader>
            <CardContent>
              {projection ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <Progress value={projection.estimate * 100}>
                    <ProgressLabel>{t("Mastery estimate")}</ProgressLabel>
                    <ProgressValue>
                      {() => percent(projection.estimate)}
                    </ProgressValue>
                  </Progress>
                  <p className="numeric text-sm text-muted-foreground">
                    {t("interval {low}–{high}", {
                      low: percent(projection.low),
                      high: percent(projection.high),
                    })}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("There is nothing to estimate from yet.")}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Alert>
          <InfoIcon />
          <AlertTitle>{t("This number is a versioned hypothesis")}</AlertTitle>
          <AlertDescription>
            {t(
              "It starts from no assumption, counts only marks that have a scale, and keeps the exclusions below."
            )}
          </AlertDescription>
        </Alert>

        {evidence.isLoading ? (
          <div className="grid gap-3">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        ) : evidence.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("Evidence unavailable")}</AlertTitle>
            <AlertDescription>{evidence.error.message}</AlertDescription>
          </Alert>
        ) : !evidence.data?.length ? (
          <Empty className="border py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileQuestionIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No evidence")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Confirm a paper region or complete a reviewed, sourced progress quiz."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {evidence.data.map((row) => {
              const contribution = contributionById.get(row.id)
              const included = row.decision.state === "included"
              return (
                <Card key={row.id} size="sm">
                  <CardHeader>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {format.dateTime(new Date(row.occurredAt), {
                          dateStyle: "medium",
                        })}
                      </p>
                      <CardTitle className="text-base">
                        {kindLabel(row.kind)}
                      </CardTitle>
                    </div>
                    <Badge variant={included ? "secondary" : "outline"}>
                      {included ? t("Included") : t("Excluded")}
                    </Badge>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <dl className="grid grid-cols-2 gap-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("Observation")}
                        </dt>
                        <dd className="numeric">
                          {row.observedOutcome === null
                            ? t("Non-numeric")
                            : `${row.observedOutcome}/${row.denominator}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("Reviewed reliability")}
                        </dt>
                        <dd className="numeric">{percent(row.reliability)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("Difficulty")}
                        </dt>
                        <dd>
                          {row.difficulty === null
                            ? t("Unknown")
                            : percent(row.difficulty)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("Contribution")}
                        </dt>
                        <dd>
                          {contribution?.alphaContribution === undefined
                            ? t("Explained omission")
                            : `+${contribution.alphaContribution.toFixed(2)} / +${contribution.betaContribution?.toFixed(2)}`}
                        </dd>
                      </div>
                    </dl>
                    {!included ? (
                      <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground">
                        {row.decision.reason ===
                        "excluded-from-mastery-explanation"
                          ? t("Excluded from the mastery explanation")
                          : row.decision.reason === "included-by-user"
                            ? t("Included again by the user")
                            : (row.decision.reason ??
                              t("Excluded by the user"))}
                      </p>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          evidenceId: row.id,
                          state: included ? "excluded" : "included",
                          reason: included
                            ? "excluded-from-mastery-explanation"
                            : "included-by-user",
                          idempotencyKey: `evidence:${crypto.randomUUID()}`,
                        })
                      }
                    >
                      {included ? <CircleOffIcon /> : <RotateCcwIcon />}
                      {included
                        ? t("Exclude from projection")
                        : t("Include again")}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
