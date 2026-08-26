"use client"

import type { AgentActionDto } from "@avermate/agent-contracts"
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  EyeIcon,
  LinkIcon,
  RotateCcwIcon,
} from "lucide-react"
import Link from "next/link"
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
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { ActionApprovalPanel } from "./action-approval"
import {
  actionCanRequestUndo,
  actionConsequence,
  resourceHref,
  resourceLabel,
  trimActionJson,
} from "./action-model"
import { ActionStateBadges } from "./action-state-badges"
import { useActionCopy } from "./use-action-copy"

export interface ActionCardOperations {
  pendingActionId?: string | null
  disabled?: boolean
  onApprovalDecision?: (
    action: AgentActionDto,
    decision: "approve" | "reject"
  ) => void
  onInspect?: (action: AgentActionDto) => void
  onRequestUndo?: (actionIds: readonly string[]) => void
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <pre className="max-h-64 overflow-auto rounded-lg bg-muted/40 p-2 text-xs whitespace-pre-wrap">
        {trimActionJson(value)}
      </pre>
    </section>
  )
}

export function ActionCard({
  action,
  compact = false,
  operations = {},
}: {
  action: AgentActionDto
  compact?: boolean
  operations?: ActionCardOperations
}) {
  const t = useExtracted()
  const format = useFormatter()
  const actionCopy = useActionCopy()
  const reason = actionCopy.reason(action)
  const consequence = actionConsequence(action)
  const pending = operations.pendingActionId === action.id
  const canUndo = actionCanRequestUndo(action)

  return (
    <Card
      size="sm"
      data-action-id={action.id}
      data-tool-call-id={action.toolCallId ?? undefined}
    >
      <CardHeader>
        <CardTitle>{actionCopy.title(action)}</CardTitle>
        <CardDescription>
          {consequence ??
            t("{effect} via {tool}", {
              effect: action.effect,
              tool: action.toolId,
            })}
        </CardDescription>
        <CardAction>
          <ActionStateBadges action={action} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span>
            {action.actorKind === "embedded-agent"
              ? t("Avermate assistant")
              : action.actorKind === "mcp"
                ? t("MCP client")
                : action.actorKind === "user-undo"
                  ? t("User undo")
                  : t("Avermate system")}
          </span>
          <span aria-hidden>·</span>
          <time dateTime={action.createdAt}>
            {format.dateTime(new Date(action.createdAt), {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
          <span aria-hidden>·</span>
          <span className="font-mono">
            {action.toolId}@{action.toolVersion}
          </span>
        </div>

        {action.resources.length > 0 ? (
          <section
            aria-label={t("Affected resources")}
            className="flex flex-col gap-2"
          >
            <h4 className="text-xs font-medium text-muted-foreground">
              {t("Affected resources")}
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {action.resources.map((resource) => {
                const href = resourceHref(resource)
                const label = resourceLabel(resource)
                return href ? (
                  <Badge
                    key={`${resource.resourceKind}:${resource.resourceId}:${resource.operation}`}
                    variant="outline"
                    render={<Link href={href} />}
                  >
                    <LinkIcon data-icon="inline-start" />
                    {label}
                  </Badge>
                ) : (
                  <Badge
                    key={`${resource.resourceKind}:${resource.resourceId}:${resource.operation}`}
                    variant="outline"
                    title={resource.resourceId}
                  >
                    {label}
                  </Badge>
                )
              })}
            </div>
          </section>
        ) : null}

        {reason ? (
          <Alert
            variant={
              action.safeError ||
              [
                "failed",
                "conflicted",
                "blocked",
                "partially-compensated",
              ].includes(action.undoState)
                ? "destructive"
                : "default"
            }
          >
            <AlertTriangleIcon />
            <AlertTitle>
              {action.undoState === "partially-compensated"
                ? t("Partial undo")
                : action.undoState === "conflicted"
                  ? t("Later changes conflict with undo")
                  : action.undoState === "blocked"
                    ? t("Blocked by a dependent action")
                    : t("Action detail")}
            </AlertTitle>
            <AlertDescription>{reason}</AlertDescription>
          </Alert>
        ) : null}

        <ActionApprovalPanel
          action={action}
          pending={pending}
          disabled={operations.disabled}
          onDecision={(decision) =>
            operations.onApprovalDecision?.(action, decision)
          }
        />

        {!compact ? (
          <Collapsible>
            <CollapsibleTrigger
              render={<Button type="button" variant="ghost" size="sm" />}
            >
              {t("Technical details")}
              <ChevronDownIcon data-icon="inline-end" />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 pt-3">
              <Separator />
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <JsonBlock
                  label={t("Redacted input")}
                  value={action.redactedInput}
                />
                <JsonBlock
                  label={t("Concrete preview")}
                  value={action.preview}
                />
                <JsonBlock
                  label={t("Safe result")}
                  value={action.resultSummary}
                />
              </div>
              <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t("Action ID")}</dt>
                  <dd className="truncate font-mono" title={action.id}>
                    {action.id}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("Batch")}</dt>
                  <dd
                    className="truncate font-mono"
                    title={action.batchId ?? ""}
                  >
                    {action.batchId ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("Scope")}</dt>
                  <dd className="truncate font-mono">
                    {action.domainScopeKind && action.domainScopeId
                      ? `${action.domainScopeKind}:${action.domainScopeId}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("Sequence")}</dt>
                  <dd className="font-mono">{action.actionSequence}</dd>
                </div>
              </dl>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        {operations.onInspect ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending || operations.disabled}
            onClick={() => operations.onInspect?.(action)}
          >
            <EyeIcon data-icon="inline-start" />
            {action.undoState === "conflicted"
              ? t("Review conflict")
              : t("Inspect")}
          </Button>
        ) : null}
        {canUndo && operations.onRequestUndo ? (
          <Button
            type="button"
            variant={
              action.undoState === "eligible" ? "outline" : "destructive"
            }
            size="sm"
            disabled={pending || operations.disabled}
            onClick={() => operations.onRequestUndo?.([action.id])}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCcwIcon data-icon="inline-start" />
            )}
            {action.undoState === "eligible"
              ? t("Preview undo")
              : t("Review undo")}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
