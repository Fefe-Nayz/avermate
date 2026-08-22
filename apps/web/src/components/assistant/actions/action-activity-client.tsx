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
  ArrowLeftIcon,
  FilterIcon,
  RotateCcwIcon,
  SearchXIcon,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

const ACTOR_ITEMS: readonly FilterItem[] = [
  { label: "Any actor", value: ALL_FILTER_VALUE },
  { label: "Avermate assistant", value: "embedded-agent" },
  { label: "MCP client", value: "mcp" },
  { label: "User undo", value: "user-undo" },
  { label: "System", value: "system" },
]

const STATUS_ITEMS: readonly FilterItem[] = [
  { label: "Any execution status", value: ALL_FILTER_VALUE },
  { label: "Pending", value: "reserved" },
  { label: "Pending approval", value: "awaiting-approval" },
  { label: "Executing", value: "executing" },
  { label: "Succeeded", value: "completed" },
  { label: "Failed", value: "failed" },
  { label: "Needs inspection", value: "inspect-required" },
  { label: "Rejected", value: "rejected" },
  { label: "Expired", value: "expired" },
]

const UNDO_ITEMS: readonly FilterItem[] = [
  { label: "Any undo state", value: ALL_FILTER_VALUE },
  { label: "Undo available", value: "eligible" },
  { label: "Undo approval pending", value: "approval-pending" },
  { label: "Undoing", value: "in-progress" },
  { label: "Undone", value: "compensated" },
  { label: "Partially undone", value: "partially-compensated" },
  { label: "Conflicted", value: "conflicted" },
  { label: "Compensation failed", value: "failed" },
  { label: "Blocked by dependencies", value: "blocked" },
  { label: "Not undoable", value: "ineligible" },
  { label: "No undo", value: "not-applicable" },
]

const UI_STATE_LABELS: Readonly<Record<ActionUiState, string>> = {
  pending: "Pending",
  executing: "Executing",
  succeeded: "Succeeded",
  failed: "Failed",
  undone: "Undone",
  compensation_failed: "Compensation failed",
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
  const update = <K extends keyof ActionActivityFilterDraft>(
    key: K,
    value: ActionActivityFilterDraft[K]
  ) => onChange({ ...draft, [key]: value })

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FilterIcon className="size-4" /> Filters
        </CardTitle>
        <CardDescription>
          Search the audit view without exposing raw model telemetry.
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="action-from-date">From</FieldLabel>
                <Input
                  id="action-from-date"
                  type="date"
                  value={draft.fromDate}
                  onChange={(event) => update("fromDate", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="action-to-date">To</FieldLabel>
                <Input
                  id="action-to-date"
                  type="date"
                  value={draft.toDate}
                  onChange={(event) => update("toDate", event.target.value)}
                />
              </Field>
              <FilterSelect
                id="action-actor"
                label="Actor"
                value={draft.actorKind}
                items={ACTOR_ITEMS}
                onValueChange={(value) =>
                  update(
                    "actorKind",
                    value as AgentActionActorKind | typeof ALL_FILTER_VALUE
                  )
                }
              />
              <FilterSelect
                id="action-status"
                label="Execution"
                value={draft.status}
                items={STATUS_ITEMS}
                onValueChange={(value) =>
                  update(
                    "status",
                    value as AgentActionStatus | typeof ALL_FILTER_VALUE
                  )
                }
              />
              <FilterSelect
                id="action-undo-state"
                label="Undo eligibility"
                value={draft.undoState}
                items={UNDO_ITEMS}
                onValueChange={(value) =>
                  update(
                    "undoState",
                    value as AgentActionUndoState | typeof ALL_FILTER_VALUE
                  )
                }
              />
              <Field>
                <FieldLabel htmlFor="action-tool">Tool ID</FieldLabel>
                <Input
                  id="action-tool"
                  value={draft.toolId}
                  placeholder="planning.tasks.create"
                  onChange={(event) => update("toolId", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="action-thread">Conversation ID</FieldLabel>
                <Input
                  id="action-thread"
                  value={draft.threadId}
                  onChange={(event) => update("threadId", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="action-resource-kind">
                  Resource kind
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
                  Resource ID
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
              Clear
            </Button>
            <Button type="submit">
              <FilterIcon data-icon="inline-start" /> Apply filters
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
  const operations = useActionInteractionOperations()
  const partial = actions.some(
    (action) => action.undoState === "partially-compensated"
  )
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={batchId ? `Batch ${batchId}` : "Individual actions"}
    >
      {batchId ? (
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Action batch</h2>
          <Badge variant="outline" title={batchId}>
            {batchId}
          </Badge>
          <Badge variant="secondary">{actions.length} actions</Badge>
        </div>
      ) : null}
      {partial ? (
        <Alert variant="destructive">
          <RotateCcwIcon />
          <AlertTitle>This batch was only partially undone</AlertTitle>
          <AlertDescription>
            Completed compensations remain recorded. Review each unresolved
            conflict or dependency below; the batch is not presented as rolled
            back.
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldSet>
        <FieldLegend className="sr-only">Select actions to undo</FieldLegend>
        <FieldGroup className="gap-3">
          {actions.map((action) => (
            <Field
              key={action.id}
              orientation="horizontal"
              className="items-start"
            >
              <Checkbox
                checked={selected.has(action.id)}
                aria-label={`Select ${action.toolId} action ${action.actionSequence}`}
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
          {selected.size} selected
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={selected.size === 0}
          onClick={() => operations.onRequestUndo?.([...selected])}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Preview selected undo
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
          View older actions
        </Button>
      ) : null}
    </div>
  )
}

export function ActionActivityClient() {
  const [draft, setDraft] = useState<ActionActivityFilterDraft>(
    EMPTY_ACTION_ACTIVITY_FILTER
  )
  const [applied, setApplied] = useState<ActionActivityFilterDraft>(
    EMPTY_ACTION_ACTIVITY_FILTER
  )
  const [cursor, setCursor] = useState<number | undefined>()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const input = useMemo(
    () => buildActionActivityFilter(applied, cursor),
    [applied, cursor]
  )
  const query = useQuery({
    ...orpc.actions.activity.list.queryOptions({ input }),
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
        title="Action activity"
        subtitle="Approvals, tool calls, affected resources and selective undo"
        backHref="/assistant"
      />
      <PageActions>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/assistant" />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" /> Assistant
        </Button>
      </PageActions>

      <div className="flex flex-col gap-5">
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
            aria-label="Visible action states"
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
                {UI_STATE_LABELS[state]} {count}
              </Badge>
            ))}
          </div>
        ) : null}

        {query.isLoading ? (
          <div
            className="flex flex-col gap-3"
            aria-label="Loading action activity"
          >
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <Alert variant="destructive">
            <ActivityIcon />
            <AlertTitle>Action activity cannot be loaded</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : actions.length === 0 ? (
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No matching actions</EmptyTitle>
              <EmptyDescription>
                Try clearing a filter. Read-only assistant calls do not create
                mutation-ledger actions.
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
