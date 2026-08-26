"use client"

import type {
  AgentActionActorKind,
  AgentActionDto,
  AgentActionStatus,
  AgentActionUndoState,
} from "@avermate/agent-contracts"
import { useQuery } from "@tanstack/react-query"
import {
  ActivityIcon,
  FilterIcon,
  GitBranchIcon,
  RotateCcwIcon,
  SearchXIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { useMemo, useState } from "react"
import { useOnlineStatus } from "@/hooks/use-online-status"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { orpc } from "@/lib/orpc"
import {
  actionActivityFilterCount,
  ALL_FILTER_VALUE,
  buildActionActivityFilter,
  EMPTY_ACTION_ACTIVITY_FILTER,
  type ActionActivityFilterDraft,
} from "./action-activity-model"
import { ActionCard } from "./action-card"
import {
  ActionInteractionProvider,
  useActionInteractionOperations,
} from "./action-interactions"
import { actionIsLive, actionUiState, type ActionUiState } from "./action-model"

interface FilterItem {
  label: string
  value: string
}

function FilterSelect({
  id,
  label,
  value,
  items,
  onValueChange,
}: {
  id: string
  label: string
  value: string
  items: readonly FilterItem[]
  onValueChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onValueChange(String(next))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>
            {(current: string) =>
              items.find((item) => item.value === current)?.label ?? label
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function ActionFilters({
  draft,
  appliedCount,
  onChange,
  onApply,
  onClear,
}: {
  draft: ActionActivityFilterDraft
  appliedCount: number
  onChange: (draft: ActionActivityFilterDraft) => void
  onApply: () => void
  onClear: () => void
}) {
  const t = useExtracted()
  const actorItems: readonly FilterItem[] = [
    { label: t("Any actor"), value: ALL_FILTER_VALUE },
    { label: t("Avermate assistant"), value: "embedded-agent" },
    { label: t("MCP client"), value: "mcp" },
    { label: t("User undo"), value: "user-undo" },
    { label: t("System"), value: "system" },
  ]
  const statusItems: readonly FilterItem[] = [
    { label: t("Any execution status"), value: ALL_FILTER_VALUE },
    { label: t("Pending"), value: "reserved" },
    { label: t("Pending approval"), value: "awaiting-approval" },
    { label: t("Executing"), value: "executing" },
    { label: t("Succeeded"), value: "completed" },
    { label: t("Failed"), value: "failed" },
    { label: t("Needs inspection"), value: "inspect-required" },
    { label: t("Rejected"), value: "rejected" },
    { label: t("Expired"), value: "expired" },
  ]
  const undoItems: readonly FilterItem[] = [
    { label: t("Any undo state"), value: ALL_FILTER_VALUE },
    { label: t("Undo available"), value: "eligible" },
    { label: t("Undo approval pending"), value: "approval-pending" },
    { label: t("Undoing"), value: "in-progress" },
    { label: t("Undone"), value: "compensated" },
    { label: t("Partially undone"), value: "partially-compensated" },
    { label: t("Conflicted"), value: "conflicted" },
    { label: t("Compensation failed"), value: "failed" },
    { label: t("Blocked by dependencies"), value: "blocked" },
    { label: t("Not undoable"), value: "ineligible" },
    { label: t("No undo"), value: "not-applicable" },
  ]
  const update = <K extends keyof ActionActivityFilterDraft>(
    key: K,
    value: ActionActivityFilterDraft[K]
  ) => onChange({ ...draft, [key]: value })

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FilterIcon className="size-4" /> {t("Filters")}
        </CardTitle>
        <CardDescription>
          {t("Search the audit view without exposing raw model telemetry.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onApply()
          }}
        >
          <FieldGroup>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="action-from-date">{t("From")}</FieldLabel>
                <Input
                  id="action-from-date"
                  type="date"
                  value={draft.fromDate}
                  onChange={(event) => update("fromDate", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="action-to-date">{t("To")}</FieldLabel>
                <Input
                  id="action-to-date"
                  type="date"
                  value={draft.toDate}
                  onChange={(event) => update("toDate", event.target.value)}
                />
              </Field>
              <FilterSelect
                id="action-actor"
                label={t("Actor")}
                value={draft.actorKind}
                items={actorItems}
                onValueChange={(value) =>
                  update(
                    "actorKind",
                    value as AgentActionActorKind | typeof ALL_FILTER_VALUE
                  )
                }
              />
              <FilterSelect
                id="action-status"
                label={t("Execution")}
                value={draft.status}
                items={statusItems}
                onValueChange={(value) =>
                  update(
                    "status",
                    value as AgentActionStatus | typeof ALL_FILTER_VALUE
                  )
                }
              />
              <FilterSelect
                id="action-undo-state"
                label={t("Undo eligibility")}
                value={draft.undoState}
                items={undoItems}
                onValueChange={(value) =>
                  update(
                    "undoState",
                    value as AgentActionUndoState | typeof ALL_FILTER_VALUE
                  )
                }
              />
              <Field>
                <FieldLabel htmlFor="action-tool">{t("Tool ID")}</FieldLabel>
                <Input
                  id="action-tool"
                  value={draft.toolId}
                  placeholder="planning.tasks.create"
                  onChange={(event) => update("toolId", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="action-thread">
                  {t("Conversation ID")}
                </FieldLabel>
                <Input
                  id="action-thread"
                  value={draft.threadId}
                  onChange={(event) => update("threadId", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="action-resource-kind">
                  {t("Resource kind")}
                </FieldLabel>
                <Input
                  id="action-resource-kind"
                  value={draft.resourceKind}
                  placeholder="planning-task"
                  onChange={(event) =>
                    update("resourceKind", event.target.value)
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="action-resource-id">
                  {t("Resource ID")}
                </FieldLabel>
                <Input
                  id="action-resource-id"
                  value={draft.resourceId}
                  onChange={(event) => update("resourceId", event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={
                appliedCount === 0 && actionActivityFilterCount(draft) === 0
              }
              onClick={onClear}
            >
              {t("Clear")}
            </Button>
            <Button type="submit">
              <FilterIcon data-icon="inline-start" /> {t("Apply filters")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function BatchGroup({
  batchId,
  actions,
  selected,
  onSelectedChange,
}: {
  batchId: string | null
  actions: readonly AgentActionDto[]
  selected: ReadonlySet<string>
  onSelectedChange: (actionId: string, selected: boolean) => void
}) {
  const t = useExtracted()
  const operations = useActionInteractionOperations()
  const partial = actions.some(
    (action) => action.undoState === "partially-compensated"
  )
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={
        batchId ? t("Batch {id}", { id: batchId }) : t("Individual actions")
      }
    >
      {batchId ? (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">{t("Action batch")}</h2>
          <Badge variant="outline" title={batchId}>
            {batchId}
          </Badge>
          <Badge variant="secondary">
            {t("{count, plural, one {# action} other {# actions}}", {
              count: actions.length,
            })}
          </Badge>
        </div>
      ) : null}
      {partial ? (
        <Alert variant="destructive">
          <RotateCcwIcon />
          <AlertTitle>{t("This batch was only partially undone")}</AlertTitle>
          <AlertDescription>
            {t(
              "Completed compensations remain recorded. Review each unresolved conflict or dependency below; the batch is not presented as rolled back."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldSet>
        <FieldLegend className="sr-only">
          {t("Select actions to undo")}
        </FieldLegend>
        <FieldGroup className="gap-3">
          {actions.map((action) => (
            <Field
              key={action.id}
              orientation="horizontal"
              className="items-start"
            >
              <Checkbox
                checked={selected.has(action.id)}
                aria-label={t("Select {tool} action {sequence}", {
                  tool: action.toolId,
                  sequence: String(action.actionSequence),
                })}
                onCheckedChange={(checked) =>
                  onSelectedChange(action.id, checked === true)
                }
              />
              <div className="min-w-0 flex-1">
                <ActionCard action={action} operations={operations} />
              </div>
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>
    </section>
  )
}

function ActivityResults({
  actions,
  nextCursor,
  selected,
  onSelectedChange,
  onNextPage,
}: {
  actions: readonly AgentActionDto[]
  nextCursor: number | null
  selected: ReadonlySet<string>
  onSelectedChange: (actionId: string, selected: boolean) => void
  onNextPage: () => void
}) {
  const t = useExtracted()
  const operations = useActionInteractionOperations()
  const groups = useMemo(() => {
    const grouped = new Map<string | null, AgentActionDto[]>()
    for (const action of actions) {
      const key = action.batchId
      grouped.set(key, [...(grouped.get(key) ?? []), action])
    }
    return [...grouped.entries()]
  }, [actions])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t("{count, plural, one {# selected} other {# selected}}", {
            count: selected.size,
          })}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={selected.size === 0}
          onClick={() => operations.onRequestUndo?.([...selected])}
        >
          <RotateCcwIcon data-icon="inline-start" />
          {t("Preview selected undo")}
        </Button>
      </div>
      {groups.map(([batchId, groupedActions], index) => (
        <BatchGroup
          key={batchId ?? `individual-${index}`}
          batchId={batchId}
          actions={groupedActions}
          selected={selected}
          onSelectedChange={onSelectedChange}
        />
      ))}
      {nextCursor ? (
        <Button type="button" variant="outline" onClick={onNextPage}>
          {t("View older actions")}
        </Button>
      ) : null}
    </div>
  )
}

export function ActionActivityClient({
  initialThreadId = "",
}: {
  initialThreadId?: string
}) {
  const t = useExtracted()
  const isOnline = useOnlineStatus()
  const initialFilter = useMemo<ActionActivityFilterDraft>(
    () => ({ ...EMPTY_ACTION_ACTIVITY_FILTER, threadId: initialThreadId }),
    [initialThreadId]
  )
  const [draft, setDraft] = useState<ActionActivityFilterDraft>(initialFilter)
  const [applied, setApplied] =
    useState<ActionActivityFilterDraft>(initialFilter)
  const [cursor, setCursor] = useState<number | undefined>()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const input = useMemo(
    () => buildActionActivityFilter(applied, cursor),
    [applied, cursor]
  )
  const query = useQuery({
    ...orpc.actions.activity.list.queryOptions({ input }),
    enabled: isOnline,
    refetchInterval: (current) =>
      current.state.data?.items.some(actionIsLive) ? 1_500 : false,
  })
  const actions = useMemo(() => query.data?.items ?? [], [query.data?.items])
  const stateCounts = useMemo(() => {
    const counts = new Map<ActionUiState, number>()
    for (const action of actions) {
      const state = actionUiState(action)
      counts.set(state, (counts.get(state) ?? 0) + 1)
    }
    return counts
  }, [actions])

  function clearFilters() {
    setDraft(EMPTY_ACTION_ACTIVITY_FILTER)
    setApplied(EMPTY_ACTION_ACTIVITY_FILTER)
    setCursor(undefined)
  }

  return (
    <>
      <PageMeta
        title={t("Action activity")}
        subtitle={t(
          "Everything the assistant changed for you, and what you can still undo"
        )}
        backHref="/assistant"
      />
      {/*
        No "back to Assistant" button here any more.
        
        It portalled into the shell header, where it sat among the utilities
        and read as one more icon rather than as the way out. This view now
        opens in the conversation's own slot, which carries a close.
      */}
      <div className="flex flex-col gap-5 p-4">
        <div>
          <h2 className="text-lg font-semibold">{t("Action activity")}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              "Everything the assistant changed for you, and what you can still undo"
            )}
          </p>
        </div>
        {!isOnline ? (
          <Alert role="status">
            <ActivityIcon />
            <AlertTitle>{t("Action activity is offline")}</AlertTitle>
            <AlertDescription>
              {t(
                "Previously loaded audit entries remain visible. Filters, approvals and undo resume after reconnection."
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        {initialThreadId ? (
          <Alert>
            <GitBranchIcon />
            <AlertTitle>
              {t("Reviewing this conversation's data changes")}
            </AlertTitle>
            <AlertDescription>
              {t(
                "These are the changes this conversation made to your study data. Branching or editing the conversation does not undo them, and an undo that conflicts has to be reviewed by hand."
              )}
            </AlertDescription>
          </Alert>
        ) : null}
        <ActionFilters
          draft={draft}
          appliedCount={actionActivityFilterCount(applied)}
          onChange={setDraft}
          onApply={() => {
            setApplied({ ...draft })
            setCursor(undefined)
          }}
          onClear={clearFilters}
        />

        {actions.length > 0 ? (
          <div
            className="flex flex-wrap gap-1.5"
            aria-label={t("Visible action states")}
          >
            {[...stateCounts.entries()].map(([state, count]) => (
              <Badge
                key={state}
                variant={
                  state === "failed" || state === "compensation_failed"
                    ? "destructive"
                    : "secondary"
                }
                data-action-state={state}
              >
                {state === "pending"
                  ? t("Pending")
                  : state === "executing"
                    ? t("Executing")
                    : state === "succeeded"
                      ? t("Succeeded")
                      : state === "failed"
                        ? t("Failed")
                        : state === "undone"
                          ? t("Undone")
                          : t("Compensation failed")}{" "}
                {count}
              </Badge>
            ))}
          </div>
        ) : null}

        {query.isLoading ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-label={t("Loading action activity")}
            aria-busy="true"
          >
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <Alert variant="destructive">
            <ActivityIcon />
            <AlertTitle>{t("Action activity cannot be loaded")}</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                disabled={!isOnline || query.isFetching}
                onClick={() => void query.refetch()}
              >
                {t("Retry")}
              </Button>
            </AlertAction>
          </Alert>
        ) : actions.length === 0 ? (
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No matching actions")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Try clearing a filter. Read-only assistant calls do not create mutation-ledger actions."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ActionInteractionProvider
            actions={actions}
            onRefresh={() => query.refetch()}
          >
            <ActivityResults
              actions={actions}
              nextCursor={query.data?.nextCursor ?? null}
              selected={selected}
              onSelectedChange={(actionId, isSelected) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (isSelected) next.add(actionId)
                  else next.delete(actionId)
                  return next
                })
              }
              onNextPage={() => setCursor(query.data?.nextCursor ?? undefined)}
            />
          </ActionInteractionProvider>
        )}
      </div>
    </>
  )
}
