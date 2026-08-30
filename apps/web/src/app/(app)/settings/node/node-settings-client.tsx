"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { NodeCapabilityId } from "@avermate/agent-contracts"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  DatabaseIcon,
  FingerprintIcon,
  KeyRoundIcon,
  ListRestartIcon,
  NetworkIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCwIcon,
  ServerCogIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UnplugIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { orpc, rpc } from "@/lib/orpc"
import {
  formatNodePairingCode,
  fullSelfHostReadinessProgress,
  isCompleteNodePairingCode,
  isDurableNodeCapability,
  nodeDisplayState,
  nodePlacementProviderId,
  NODE_CAPABILITIES,
  type NodePlacementKind,
} from "./node-settings-model"

type Readiness = Awaited<ReturnType<typeof rpc.node.readiness>>
type NodeRecord = Readiness["nodes"][number]
type PlacementRecord = Readiness["placements"][number]
type DiagnosticRecord = Readiness["diagnostics"][number]
type PairingPreview = Awaited<ReturnType<typeof rpc.node.claim>>
type LifecycleEvent = Awaited<ReturnType<typeof rpc.node.lifecycle>>[number]
type RemoteDeletion = Awaited<
  ReturnType<typeof rpc.node.remoteDeletions>
>[number]
type PlacementMigration = Awaited<
  ReturnType<typeof rpc.node.migrations>
>[number]

type RevokeReason = "USER_REVOKED" | "NODE_RETIRED" | "CREDENTIAL_COMPROMISED"

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function truncated(value: string | null | undefined, length = 18) {
  if (!value) return "—"
  return value.length > length ? `${value.slice(0, length)}…` : value
}

function primitiveMetadata(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, item]) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      return [[key, String(item)] as [string, string]]
    }
    return []
  })
}

function capabilityPresent(node: NodeRecord, capability: NodeCapabilityId) {
  return node.capabilities.includes(capability)
}

export function AvermateNodeSettingsClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [pairingCode, setPairingCode] = useState("")
  const [pairingPreview, setPairingPreview] = useState<PairingPreview | null>(
    null
  )
  const [pairingConfirmed, setPairingConfirmed] = useState(false)
  const [rotateNode, setRotateNode] = useState<NodeRecord | null>(null)
  const [revokeNode, setRevokeNode] = useState<NodeRecord | null>(null)
  const [revokeReason, setRevokeReason] = useState<RevokeReason>("USER_REVOKED")
  const [lifecycleNodeId, setLifecycleNodeId] = useState("all")

  const readiness = useQuery({
    ...orpc.node.readiness.queryOptions(),
    refetchInterval: 15_000,
  })
  const lifecycle = useQuery({
    ...orpc.node.lifecycle.queryOptions({
      input: {
        ...(lifecycleNodeId === "all" ? {} : { nodeId: lifecycleNodeId }),
        limit: 100,
      },
    }),
    refetchInterval: 30_000,
  })
  const migrations = useQuery({
    ...orpc.node.migrations.queryOptions(),
    refetchInterval: 2_000,
  })
  const remoteDeletions = useQuery({
    ...orpc.node.remoteDeletions.queryOptions({ input: { limit: 100 } }),
    refetchInterval: 30_000,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.node.readiness.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.node.list.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.node.lifecycle.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.node.migrations.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.node.remoteDeletions.key(),
      }),
    ])
  }

  const claim = useMutation({
    ...orpc.node.claim.mutationOptions(),
    onSuccess: (preview) => {
      setPairingCode("")
      setPairingConfirmed(false)
      setPairingPreview(preview)
      toast.success(t("Pairing code accepted. Verify the Node identity."))
    },
    onError: (error) =>
      toast.error(
        errorMessage(error, t("This pairing code could not be claimed."))
      ),
  })
  const confirm = useMutation({
    ...orpc.node.confirm.mutationOptions(),
    onSuccess: async () => {
      setPairingPreview(null)
      setPairingConfirmed(false)
      toast.success(t("Avermate Node paired."))
      await refresh()
    },
    onError: (error) =>
      toast.error(
        errorMessage(error, t("The Node identity could not be confirmed."))
      ),
  })
  const rotate = useMutation({
    ...orpc.node.rotateCredentials.mutationOptions(),
    onSuccess: async () => {
      setRotateNode(null)
      toast.success(t("New credentials are waiting for delivery to the Node."))
      await refresh()
    },
    onError: (error) =>
      toast.error(
        errorMessage(error, t("The Node credentials could not be rotated."))
      ),
  })
  const revoke = useMutation({
    ...orpc.node.revoke.mutationOptions(),
    onSuccess: async () => {
      setRevokeNode(null)
      setRevokeReason("USER_REVOKED")
      toast.success(t("The Node has been revoked."))
      await refresh()
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("The Node could not be revoked."))),
  })
  const setPlacement = useMutation({
    ...orpc.node.setPlacement.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.migrationState === "planned"
          ? t("Choice saved. The move still has to be verified.")
          : t("Placement updated.")
      )
      await refresh()
    },
    onError: (error) =>
      toast.error(
        errorMessage(error, t("Where your data lives could not be changed."))
      ),
  })
  const migrationMutationOptions = {
    onSuccess: async () => {
      await refresh()
    },
    onError: (error: unknown) =>
      toast.error(errorMessage(error, t("The move could not continue."))),
  }
  const startMigration = useMutation({
    ...orpc.node.startMigration.mutationOptions(),
    ...migrationMutationOptions,
  })
  const pauseMigration = useMutation({
    ...orpc.node.pauseMigration.mutationOptions(),
    ...migrationMutationOptions,
  })
  const retryMigration = useMutation({
    ...orpc.node.retryMigration.mutationOptions(),
    ...migrationMutationOptions,
  })
  const cancelMigration = useMutation({
    ...orpc.node.cancelMigration.mutationOptions(),
    ...migrationMutationOptions,
  })
  const completeMigration = useMutation({
    ...orpc.node.completeMigration.mutationOptions(),
    ...migrationMutationOptions,
  })
  const retryRemoteDeletion = useMutation({
    ...orpc.node.retryRemoteDeletion.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.state === "verified_deleted"
          ? t("Remote deletion verified.")
          : t("Remote deletion retried; verification is still pending.")
      )
      await queryClient.invalidateQueries({
        queryKey: orpc.node.remoteDeletions.key(),
      })
    },
    onError: (error) =>
      toast.error(
        errorMessage(error, t("The remote deletion could not be retried."))
      ),
  })

  const capabilityLabels = useCapabilityLabels()
  const data = readiness.data

  function submitPairingCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isCompleteNodePairingCode(pairingCode)) return
    claim.mutate({ code: pairingCode })
  }

  return (
    <>
      <PageMeta
        title={t("Avermate Node")}
        subtitle={t("Pair a server you own, and choose what runs where.")}
      />

      <div className="flex flex-col gap-4">
        {readiness.isError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("Node readiness is unavailable.")}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              {t(
                "While the Node cannot be reached, nothing is assumed to have moved."
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => readiness.refetch()}
              >
                <RefreshCwIcon data-icon="inline-start" />
                {t("Try again")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {data ? (
          <ReadinessSection data={data} labels={capabilityLabels} />
        ) : (
          <ReadinessSkeleton />
        )}

        <PairingSection
          pairingCode={pairingCode}
          setPairingCode={setPairingCode}
          preview={pairingPreview}
          confirmed={pairingConfirmed}
          setConfirmed={setPairingConfirmed}
          claimPending={claim.isPending}
          confirmPending={confirm.isPending}
          onSubmit={submitPairingCode}
          onCancelPreview={() => {
            setPairingPreview(null)
            setPairingConfirmed(false)
          }}
          onConfirm={() => {
            if (!pairingPreview || !pairingConfirmed) return
            confirm.mutate({
              pairingAttemptId: pairingPreview.pairingAttemptId,
              fingerprint: pairingPreview.fingerprint,
              capabilities: pairingPreview.capabilities,
            })
          }}
          labels={capabilityLabels}
        />

        <SettingsSection
          id="nodes"
          icon={ServerIcon}
          title={t("Paired Nodes")}
          description={t(
            "Only checked reports and live status are shown here. Your Node's credentials never reach the browser."
          )}
        >
          {!data ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : data.nodes.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UnplugIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No Node is paired")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "Open the loopback configurator on your server, generate a one-time code, then enter it above."
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {data.nodes.map((node) => (
                <NodeCard
                  key={node.nodeId}
                  node={node}
                  expectedProtocolMajor={data.expectedProtocolMajor}
                  labels={capabilityLabels}
                  onRotate={() => setRotateNode(node)}
                  onRevoke={() => setRevokeNode(node)}
                />
              ))}
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          id="placements"
          icon={NetworkIcon}
          title={t("Capability placement")}
          description={t(
            "Choose data residency and execution independently. Node outages never trigger a silent managed or Core fallback."
          )}
        >
          {data ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {NODE_CAPABILITIES.map((capability) => {
                const current = data.placements.find(
                  (placement) => placement.capability === capability
                )
                /**
                 * The revision belongs in the key on purpose: the card seeds
                 * its draft from `current` with `useState`, which only reads
                 * on mount, so a saved change has to remount it to show. The
                 * same row was being searched for twice — once to build this
                 * key and once to pass down.
                 */
                return (
                  <PlacementCard
                    key={`${capability}:${current?.revision ?? 0}:${data.nodes
                      .map((node) => node.nodeId)
                      .join(",")}`}
                    capability={capability}
                    current={current}
                    nodes={data.nodes}
                    expectedProtocolMajor={data.expectedProtocolMajor}
                    label={capabilityLabels[capability]}
                    pending={setPlacement.isPending}
                    onApply={(placement, nodeId) =>
                      setPlacement.mutate({
                        capability,
                        placement,
                        ...(placement === "node" && nodeId ? { nodeId } : {}),
                        providerId: nodePlacementProviderId(placement, nodeId),
                        idempotencyKey: crypto.randomUUID(),
                      })
                    }
                  />
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {NODE_CAPABILITIES.slice(0, 4).map((capability) => (
                <Skeleton key={capability} className="h-48" />
              ))}
            </div>
          )}
        </SettingsSection>

        <MigrationSection
          migrations={migrations.data}
          isPending={migrations.isPending}
          isError={migrations.isError}
          actionPending={
            startMigration.isPending ||
            pauseMigration.isPending ||
            retryMigration.isPending ||
            cancelMigration.isPending ||
            completeMigration.isPending
          }
          labels={capabilityLabels}
          onRetryLoad={() => migrations.refetch()}
          onStart={(migrationId) => startMigration.mutate({ migrationId })}
          onPause={(migrationId) => pauseMigration.mutate({ migrationId })}
          onRetry={(migrationId) => retryMigration.mutate({ migrationId })}
          onCancel={(migrationId) => cancelMigration.mutate({ migrationId })}
          onComplete={(migrationId, deleteSource) =>
            completeMigration.mutate({ migrationId, deleteSource })
          }
        />

        <RemoteDeletionSection
          records={remoteDeletions.data}
          isPending={remoteDeletions.isPending}
          isError={remoteDeletions.isError}
          retryingDigest={
            retryRemoteDeletion.isPending
              ? retryRemoteDeletion.variables?.manifestDigest
              : null
          }
          onRetryLoad={() => remoteDeletions.refetch()}
          onRetryDeletion={(manifestDigest) =>
            retryRemoteDeletion.mutate({ manifestDigest })
          }
        />

        <LifecycleSection
          events={lifecycle.data}
          isPending={lifecycle.isPending}
          isError={lifecycle.isError}
          nodes={data?.nodes ?? []}
          selectedNodeId={lifecycleNodeId}
          onSelectedNodeId={setLifecycleNodeId}
          onRetry={() => lifecycle.refetch()}
          placements={data?.placements ?? []}
          labels={capabilityLabels}
        />
      </div>

      <RotateCredentialsDialog
        node={rotateNode}
        pending={rotate.isPending}
        onOpenChange={(open) => {
          if (!open && !rotate.isPending) setRotateNode(null)
        }}
        onConfirm={() => {
          if (rotateNode) {
            rotate.mutate({ nodeId: rotateNode.nodeId, overlapSeconds: 300 })
          }
        }}
      />
      <RevokeNodeDialog
        node={revokeNode}
        reason={revokeReason}
        setReason={setRevokeReason}
        pending={revoke.isPending}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setRevokeNode(null)
        }}
        onConfirm={() => {
          if (revokeNode) {
            revoke.mutate({ nodeId: revokeNode.nodeId, reason: revokeReason })
          }
        }}
      />
    </>
  )
}

function useCapabilityLabels(): Record<NodeCapabilityId, string> {
  const t = useExtracted()
  return {
    storage: t("Files and object storage"),
    conversations: t("Conversation history"),
    retrieval: t("Search, embeddings and reranking"),
    inference: t("Generic AI and processing capabilities"),
    models: t("Model inference"),
    jobs: t("Background and specialist jobs"),
    sandbox: t("Sandbox execution"),
    renderers: t("Artifact renderers"),
    "school-connectors": t("School connectors"),
    mcp: t("MCP tool access"),
  }
}

function ReadinessSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
    </div>
  )
}

function ReadinessSection({
  data,
  labels,
}: {
  data: Readiness
  labels: Record<NodeCapabilityId, string>
}) {
  const t = useExtracted()
  const progress = fullSelfHostReadinessProgress(data.diagnostics)
  const paired = data.nodes.some((node) => node.state !== "revoked")
  const connected = data.nodes.some(
    (node) =>
      node.state !== "revoked" &&
      node.online &&
      node.protocolMajor === data.expectedProtocolMajor &&
      node.manifestFresh
  )
  const readinessComplete = data.fullSelfHost
    ? data.ready
    : data.diagnostics.every((diagnostic) => diagnostic.ready)

  return (
    <SettingsSection
      id="readiness"
      icon={ServerCogIcon}
      title={t("Deployment readiness")}
      description={t(
        "The same screen covers a hosted setup and a fully self-hosted one."
      )}
    >
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <Badge variant="outline">
          {data.fullSelfHost
            ? t("Full self-host")
            : t("Hosted Core with optional Node")}
        </Badge>
        <Badge variant={readinessComplete ? "secondary" : "destructive"}>
          {readinessComplete ? t("Ready") : t("Action required")}
        </Badge>
        <Badge variant="outline">
          {t("Protocol v{version}", {
            version: String(data.expectedProtocolMajor),
          })}
        </Badge>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("Full-self-host capability gate")}</CardTitle>
          <CardDescription>
            {t(
              "A running container is not enough. Avermate also checks where your data lives, that the move finished, that the relay answers, and that the Node's signature matches."
            )}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">
              {t("{ready}/{total} verified", {
                ready: String(progress.ready),
                total: String(progress.total),
              })}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Progress value={progress.percent}>
            <ProgressLabel>{t("Verified capability lanes")}</ProgressLabel>
          </Progress>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.diagnostics.map((diagnostic) => (
              <ReadinessDiagnostic
                key={diagnostic.capability}
                diagnostic={diagnostic}
                label={labels[diagnostic.capability]}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t("Full-self-host onboarding")}</CardTitle>
          <CardDescription>
            {t(
              "These checks run against the live APIs, whether or not you use avermate.fr."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            <OnboardingStep
              number="1"
              title={t("Pair and verify a Node identity")}
              description={t(
                "Use a one-time code, then compare its fingerprint and signed capabilities."
              )}
              complete={paired}
            />
            <OnboardingStep
              number="2"
              title={t("Connect a Node running a compatible version")}
              description={t(
                "The Node has to agree on the protocol version and be running the current configuration."
              )}
              complete={connected}
            />
            <OnboardingStep
              number="3"
              title={t("Place and verify every required capability")}
              description={t(
                "Storing data needs a verified move. Running models needs the Node online."
              )}
              complete={readinessComplete}
            />
          </ol>
        </CardContent>
      </Card>

      {!readinessComplete ? (
        <Alert variant={data.fullSelfHost ? "destructive" : "default"}>
          <ShieldAlertIcon />
          <AlertTitle>
            {data.fullSelfHost
              ? t("This self-host deployment is not ready.")
              : t("The complete self-host path is not ready yet.")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "Anything you required to run on your Node stays blocked until the move is verified and the Node answers."
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>{t("All required Node lanes are verified.")}</AlertTitle>
          <AlertDescription>
            {t(
              "Health is rechecked at dispatch; readiness never bypasses ownership or tool authorization."
            )}
          </AlertDescription>
        </Alert>
      )}
    </SettingsSection>
  )
}

function OnboardingStep({
  number,
  title,
  description,
  complete,
}: {
  number: string
  title: string
  description: string
  complete: boolean
}) {
  const t = useExtracted()
  return (
    <li className="flex items-start gap-3">
      <Badge variant={complete ? "secondary" : "outline"}>{number}</Badge>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          <Badge variant={complete ? "secondary" : "outline"}>
            {complete ? t("Complete") : t("Pending")}
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </li>
  )
}

function ReadinessDiagnostic({
  diagnostic,
  label,
}: {
  diagnostic: DiagnosticRecord
  label: string
}) {
  const t = useExtracted()
  const reason = diagnostic.ready
    ? t("Verified")
    : diagnostic.reasonCode === "node-placement-required"
      ? t("Must run on your Node")
      : diagnostic.reasonCode === "migration-not-verified"
        ? t("Migration proof required")
        : diagnostic.reasonCode === "node-offline"
          ? t("Node offline")
          : t("Capability not advertised")
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border p-3">
      {diagnostic.ready ? (
        <CheckCircle2Icon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <AlertTriangleIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{reason}</p>
      </div>
    </div>
  )
}

function PairingSection({
  pairingCode,
  setPairingCode,
  preview,
  confirmed,
  setConfirmed,
  claimPending,
  confirmPending,
  onSubmit,
  onCancelPreview,
  onConfirm,
  labels,
}: {
  pairingCode: string
  setPairingCode: (value: string) => void
  preview: PairingPreview | null
  confirmed: boolean
  setConfirmed: (value: boolean) => void
  claimPending: boolean
  confirmPending: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancelPreview: () => void
  onConfirm: () => void
  labels: Record<NodeCapabilityId, string>
}) {
  const t = useExtracted()
  const format = useFormatter()
  return (
    <SettingsSection
      id="pairing"
      icon={FingerprintIcon}
      title={t("Pair a Node")}
      description={t(
        "The code is single-use and short-lived. Confirm the identity shown by your local configurator before credentials are issued."
      )}
    >
      {!preview ? (
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field
              data-invalid={
                pairingCode.length > 0 &&
                !isCompleteNodePairingCode(pairingCode)
              }
            >
              <FieldLabel htmlFor="node-pairing-code">
                {t("One-time pairing code")}
              </FieldLabel>
              <Input
                id="node-pairing-code"
                name="node-pairing-code"
                value={pairingCode}
                onChange={(event) =>
                  setPairingCode(formatNodePairingCode(event.target.value))
                }
                placeholder="ABCD-2345"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={9}
                className="max-w-64 font-mono uppercase"
                aria-invalid={
                  pairingCode.length > 0 &&
                  !isCompleteNodePairingCode(pairingCode)
                }
              />
              <FieldDescription>
                {t(
                  "Generate this code in the loopback-only Node configurator. It is never a reusable access token."
                )}
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Button
                type="submit"
                disabled={
                  !isCompleteNodePairingCode(pairingCode) || claimPending
                }
              >
                {claimPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FingerprintIcon data-icon="inline-start" />
                )}
                {t("Inspect Node")}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("Confirm this exact Node")}</CardTitle>
            <CardDescription>
              {t(
                "Compare the fingerprint, protocol, build and capabilities with the local screen. Cancel if any value differs."
              )}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{t("Expires soon")}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Metadata label={t("Node ID")} value={preview.nodeId} mono />
              <Metadata
                label={t("Protocol")}
                value={`avermate-node/${preview.protocolMajor}`}
                mono
              />
              <Metadata label={t("Node build")} value={preview.build} mono />
              <Metadata
                label={t("Configuration revision")}
                value={preview.configRevision}
                mono
              />
              <Metadata
                label={t("Confirmation expires")}
                value={format.dateTime(new Date(preview.expiresAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              />
            </dl>
            <div>
              <p className="text-sm font-medium">{t("Fingerprint")}</p>
              <code className="mt-1 block rounded-lg bg-muted p-3 text-sm break-all">
                {preview.fingerprint}
              </code>
            </div>
            <div>
              <p className="text-sm font-medium">
                {t("Capabilities to authorize")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {preview.capabilities.map((capability) => (
                  <Badge key={capability} variant="outline">
                    {labels[capability]}
                  </Badge>
                ))}
              </div>
            </div>
            <Field orientation="horizontal">
              <Checkbox
                id="node-identity-confirmation"
                checked={confirmed}
                onCheckedChange={(checked) => setConfirmed(checked === true)}
              />
              <FieldLabel htmlFor="node-identity-confirmation">
                {t(
                  "I compared this fingerprint and capability list with my local Node."
                )}
              </FieldLabel>
            </Field>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={confirmPending}
              onClick={onCancelPreview}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={!confirmed || confirmPending}
              onClick={onConfirm}
            >
              {confirmPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ShieldCheckIcon data-icon="inline-start" />
              )}
              {t("Confirm and pair")}
            </Button>
          </CardFooter>
        </Card>
      )}
    </SettingsSection>
  )
}

function NodeCard({
  node,
  expectedProtocolMajor,
  labels,
  onRotate,
  onRevoke,
}: {
  node: NodeRecord
  expectedProtocolMajor: number
  labels: Record<NodeCapabilityId, string>
  onRotate: () => void
  onRevoke: () => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const state = nodeDisplayState({
    state: node.state,
    online: node.online,
    protocolMajor: node.protocolMajor,
    expectedProtocolMajor,
  })
  const stateCopy = {
    online: t("Online"),
    offline: t("Offline"),
    revoked: t("Revoked"),
    "upgrade-required": t("Upgrade required"),
  }[state]
  const statusVariant =
    state === "online"
      ? ("secondary" as const)
      : state === "offline"
        ? ("outline" as const)
        : ("destructive" as const)
  const featureLines = useFeatureSummaries(node)
  const healthStateLabels = useHealthStateLabels()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Avermate Node")}</CardTitle>
        <CardDescription title={node.nodeId} className="font-mono">
          {truncated(node.nodeId, 28)}
        </CardDescription>
        <CardAction aria-live="polite">
          <Badge variant={statusVariant}>{stateCopy}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state === "revoked" ? (
          <Alert variant="destructive">
            <ShieldAlertIcon />
            <AlertTitle>{t("This Node is revoked.")}</AlertTitle>
            <AlertDescription>
              {t(
                "Its relay is fenced and it cannot receive new grants. Historical diagnostics remain visible."
              )}
            </AlertDescription>
          </Alert>
        ) : state === "upgrade-required" ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("Protocol upgrade required")}</AlertTitle>
            <AlertDescription>
              {t(
                "This Node uses protocol v{actual}; this Core requires v{expected}. Dispatch is blocked.",
                {
                  actual: String(node.protocolMajor),
                  expected: String(expectedProtocolMajor),
                }
              )}
            </AlertDescription>
          </Alert>
        ) : state === "offline" ? (
          <Alert>
            <UnplugIcon />
            <AlertTitle>{t("Node offline")}</AlertTitle>
            <AlertDescription>
              {t(
                "Node-owned data and execution remain unavailable. Avermate will not copy or reroute them silently."
              )}
            </AlertDescription>
          </Alert>
        ) : !node.manifestFresh ? (
          <Alert>
            <Clock3Icon />
            <AlertTitle>{t("Waiting for the Node to report in")}</AlertTitle>
            <AlertDescription>
              {t("Dispatch remains fenced until the relay revalidates it.")}
            </AlertDescription>
          </Alert>
        ) : null}

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Metadata label={t("Fingerprint")} value={node.fingerprint} mono />
          <Metadata
            label={t("Protocol")}
            value={`avermate-node/${node.protocolMajor}`}
            mono
          />
          <Metadata
            label={t("Configuration revision")}
            value={node.configRevision ?? t("Not reported")}
            mono
          />
          <Metadata
            label={t("Connection epoch")}
            value={
              node.connectionEpoch === null
                ? t("No active relay")
                : String(node.connectionEpoch)
            }
            mono
          />
          <Metadata
            label={t("Last heartbeat")}
            value={
              node.lastHeartbeatAt
                ? format.dateTime(new Date(node.lastHeartbeatAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : t("Never")
            }
          />
          <Metadata
            label={t("Manifest")}
            value={node.manifestFresh ? t("Live and verified") : t("Cached")}
          />
        </dl>

        <div>
          <p className="text-sm font-medium">{t("Authorized capabilities")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {node.capabilities.length > 0 ? (
              node.capabilities.map((capability) => (
                <Badge key={capability} variant="outline">
                  {labels[capability]}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">
                {t("No capability is currently authorized.")}
              </span>
            )}
          </div>
        </div>

        {featureLines.length > 0 ? (
          <div>
            <p className="text-sm font-medium">{t("What the Node reports")}</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground">
              {featureLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="text-sm font-medium">{t("Live capability health")}</p>
          {node.health.length > 0 ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {node.health.map((health) => (
                <div
                  key={health.capability}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {labels[health.capability]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("{active} active · {queued} queued", {
                        active: String(health.active),
                        queued: String(health.queued),
                      })}
                    </p>
                    {health.safeErrorCode ? (
                      <code className="mt-1 block truncate text-xs text-muted-foreground">
                        {health.safeErrorCode}
                      </code>
                    ) : null}
                  </div>
                  <Badge
                    variant={
                      health.state === "healthy"
                        ? "secondary"
                        : health.state === "offline" ||
                            health.state === "degraded"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {healthStateLabels[health.state] ?? health.state}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("No live health sample is available.")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {!node.manifestFresh
              ? t("Runtime checkpoint readiness unknown")
              : node.providerNativeRuntimeCheckpoints
                ? t("Native runtime checkpoints")
                : t("Logical snapshots only")}
          </Badge>
          {node.specialistKinds.length > 0 ? (
            node.specialistKinds.map((kind) => (
              <Badge key={kind} variant="outline">
                {kind}
              </Badge>
            ))
          ) : (
            <Badge variant="outline">
              {node.manifestFresh
                ? t("No specialist worker")
                : t("Specialist worker readiness unknown")}
            </Badge>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={state === "revoked" || state === "upgrade-required"}
          onClick={onRotate}
        >
          <RotateCwIcon data-icon="inline-start" />
          {t("Rotate credentials")}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={state === "revoked"}
          onClick={onRevoke}
        >
          <Trash2Icon data-icon="inline-start" />
          {t("Revoke Node")}
        </Button>
      </CardFooter>
    </Card>
  )
}

function useFeatureSummaries(node: NodeRecord): string[] {
  const t = useExtracted()
  const features = node.features
  if (!features) return []
  const lines: string[] = []
  if (features.storage) {
    lines.push(
      features.storage.multipart
        ? t("Storage supports verified multipart transfers.")
        : t("Storage supports single-part transfers only.")
    )
  }
  if (features.conversations) {
    lines.push(
      features.conversations.search
        ? t("Conversation storage includes local search.")
        : t("Conversation storage does not advertise local search.")
    )
  }
  if (features.retrieval) {
    if (features.retrieval.vectorSpaces.length > 0) {
      lines.push(
        t(
          "Retrieval: lexical {lexical}; {spaces} local vector spaces advertised.",
          {
            lexical: features.retrieval.lexical ? t("ready") : t("missing"),
            spaces: String(features.retrieval.vectorSpaces.length),
          }
        )
      )
    } else {
      lines.push(
        t(
          "Retrieval: lexical {lexical}; no local vector index is advertised.",
          {
            lexical: features.retrieval.lexical ? t("ready") : t("missing"),
          }
        )
      )
    }
    const retrievalProviders = features.retrieval.providers ?? []
    for (const provider of retrievalProviders) {
      lines.push(
        provider.purpose === "embedding"
          ? t("Embedding provider route: {provider} · {model}.", {
              provider: provider.provider,
              model: provider.model,
            })
          : t("Reranking provider route: {provider} · {model}.", {
              provider: provider.provider,
              model: provider.model,
            })
      )
    }
    if (retrievalProviders.length > 0) {
      lines.push(
        t(
          "Provider routes are configured capabilities; they do not imply a local vector index."
        )
      )
    }
  }
  if (features.models) {
    lines.push(
      t("{count} model revisions advertised.", {
        count: String(features.models.models.length),
      })
    )
  }
  if (features.jobs) {
    lines.push(
      t("{count} bounded job kinds, up to {maximum} concurrent.", {
        count: String(features.jobs.kinds.length),
        maximum: String(features.jobs.maxConcurrent),
      })
    )
  }
  if (features.sandbox) {
    lines.push(
      t("Sandbox isolation: {isolation}; runtime checkpoints: {checkpoints}.", {
        isolation: features.sandbox.isolation,
        checkpoints: features.sandbox.runtimeCheckpoints
          ? t("available")
          : t("unavailable"),
      })
    )
  }
  if (features.renderers) {
    lines.push(
      t("{count} artifact renderer kinds advertised.", {
        count: String(features.renderers.kinds.length),
      })
    )
  }
  if (features.schoolConnectors) {
    lines.push(
      t("{count} school connector providers advertised.", {
        count: String(features.schoolConnectors.providers.length),
      })
    )
  }
  return lines
}

function useHealthStateLabels(): Record<string, string> {
  const t = useExtracted()
  return {
    configured: t("Configured"),
    supported: t("Supported"),
    healthy: t("Healthy"),
    degraded: t("Degraded"),
    offline: t("Offline"),
  }
}

function Metadata({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={mono ? "truncate font-mono text-sm" : "truncate text-sm"}
        title={value}
      >
        {mono ? truncated(value, 30) : value}
      </dd>
    </div>
  )
}

function PlacementCard({
  capability,
  current,
  nodes,
  expectedProtocolMajor,
  label,
  pending,
  onApply,
}: {
  capability: NodeCapabilityId
  current?: PlacementRecord
  nodes: NodeRecord[]
  expectedProtocolMajor: number
  label: string
  pending: boolean
  onApply: (placement: NodePlacementKind, nodeId?: string) => void
}) {
  const t = useExtracted()
  const placementLabels = usePlacementLabels()
  const migrationLabels = useMigrationLabels()
  const [draft, setDraft] = useState<NodePlacementKind>(
    (current?.placementKind as NodePlacementKind | undefined) ?? "core"
  )
  const [nodeId, setNodeId] = useState(
    current?.nodeId ??
      nodes.find((node) => node.state !== "revoked")?.nodeId ??
      ""
  )
  const [reviewOpen, setReviewOpen] = useState(false)

  const selectedNode = nodes.find((node) => node.nodeId === nodeId)
  const selectedNodeState = selectedNode
    ? nodeDisplayState({
        state: selectedNode.state,
        online: selectedNode.online,
        protocolMajor: selectedNode.protocolMajor,
        expectedProtocolMajor,
      })
    : null
  const nodeEligible = Boolean(
    selectedNode &&
    selectedNodeState !== "revoked" &&
    selectedNodeState !== "upgrade-required" &&
    capabilityPresent(selectedNode, capability)
  )
  const unchanged = Boolean(
    current &&
    current.placementKind === draft &&
    (draft !== "node" || current.nodeId === nodeId)
  )
  const invalid = draft === "node" && (!nodeId || !nodeEligible)
  const durable = isDurableNodeCapability(capability)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          {current
            ? t("Revision {revision} · {placement}", {
                revision: String(current.revision),
                placement:
                  placementLabels[current.placementKind as NodePlacementKind],
              })
            : t("No explicit placement")}
        </CardDescription>
        <CardAction>
          <Badge
            variant={
              current?.migrationState === "failed"
                ? "destructive"
                : current?.migrationState === "verified"
                  ? "secondary"
                  : "outline"
            }
          >
            {migrationStateLabel(current?.migrationState, migrationLabels)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`placement-${capability}`}>
              {t("Run and store on")}
            </FieldLabel>
            <Select
              value={draft}
              onValueChange={(value) =>
                value && setDraft(value as NodePlacementKind)
              }
            >
              <SelectTrigger id={`placement-${capability}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="core">{t("This Core")}</SelectItem>
                  <SelectItem value="node" disabled={nodes.length === 0}>
                    {t("Avermate Node")}
                  </SelectItem>
                  <SelectItem value="byok">{t("Direct BYOK")}</SelectItem>
                  <SelectItem value="managed">
                    {t("Managed service")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {draft === "node" ? (
            <Field data-invalid={invalid}>
              <FieldLabel htmlFor={`placement-node-${capability}`}>
                {t("Target Node")}
              </FieldLabel>
              <Select
                value={nodeId}
                onValueChange={(value) => value && setNodeId(value)}
              >
                <SelectTrigger
                  id={`placement-node-${capability}`}
                  className="w-full"
                  aria-invalid={invalid}
                >
                  <SelectValue placeholder={t("Choose a Node")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {nodes.map((node) => (
                      <SelectItem
                        key={node.nodeId}
                        value={node.nodeId}
                        disabled={
                          node.state === "revoked" ||
                          node.protocolMajor !== expectedProtocolMajor
                        }
                      >
                        {truncated(node.nodeId, 24)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {!selectedNode
                  ? t("Choose a paired Node.")
                  : !capabilityPresent(selectedNode, capability)
                    ? t("This Node does not advertise the capability.")
                    : selectedNodeState === "offline"
                      ? t(
                          "The Node is offline; Node-owned requests will remain unavailable."
                        )
                      : t("The Node reports that it can do this.")}
              </FieldDescription>
            </Field>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={pending || unchanged || invalid}
            onClick={() => setReviewOpen(true)}
          >
            <WorkflowIcon data-icon="inline-start" />
            {t("Review consequences")}
          </Button>
        </FieldGroup>
      </CardContent>
      {current?.migrationState === "planned" ? (
        <CardFooter>
          <p className="text-xs text-muted-foreground">
            {t(
              "Migration is planned, not completed. Existing data is not silently moved and routing remains fail-closed until verification."
            )}
          </p>
        </CardFooter>
      ) : null}

      <AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <NetworkIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Place {capability} on {placement}?", {
                capability: label,
                placement: placementLabels[draft],
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Review residency, visibility, offline behavior and cost before saving this revision."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <Consequence
              label={t("Durable location")}
              value={durable ? placementLabels[draft] : t("Request-scoped")}
            />
            <Consequence
              label={t("Who can see content")}
              value={
                draft === "node"
                  ? t("This Core relay in transit, then the Node provider")
                  : draft === "byok"
                    ? t("The selected third-party provider")
                    : draft === "managed"
                      ? t("The managed provider and this Core")
                      : t("This Core and its configured provider")
              }
            />
            <Consequence
              label={t("Offline behavior")}
              value={
                draft === "node"
                  ? t("Unavailable; no silent fallback")
                  : t("Controlled by this Core placement")
              }
            />
            <Consequence
              label={t("Cost")}
              value={
                draft === "managed"
                  ? t("Managed metering and quotas")
                  : draft === "byok"
                    ? t("Billed by your provider")
                    : t("Owned by the selected deployment")
              }
            />
            {durable ? (
              <Alert>
                <DatabaseIcon />
                <AlertTitle>{t("Migration verification required")}</AlertTitle>
                <AlertDescription>
                  {t(
                    "This action creates a migration plan. Review inventory and space, then start and validate the transfer in the migration wizard below."
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                onApply(draft, draft === "node" ? nodeId : undefined)
                setReviewOpen(false)
              }}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {durable ? t("Record migration plan") : t("Save placement")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function usePlacementLabels(): Record<NodePlacementKind, string> {
  const t = useExtracted()
  return {
    core: t("This Core"),
    node: t("Avermate Node"),
    managed: t("Managed service"),
    byok: t("Direct BYOK"),
  }
}

function useMigrationLabels(): Record<string, string> {
  const t = useExtracted()
  return {
    unconfigured: t("Unconfigured"),
    "not-required": t("No migration required"),
    planned: t("Migration planned"),
    running: t("Migration running"),
    verified: t("Migration verified"),
    failed: t("Migration failed"),
  }
}

function migrationStateLabel(
  state: string | undefined,
  labels: Record<string, string>
) {
  return labels[state ?? "unconfigured"] ?? labels.failed
}

function Consequence({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function migrationProgress(migration: PlacementMigration) {
  if (migration.state === "completed") return 100
  if (migration.state === "source-retained") return 95
  if (migration.state === "switched") return 90
  if (migration.state === "ready-to-switch") return 80
  if (migration.state === "verifying") return 75
  if (
    migration.state === "copying" &&
    typeof migration.preview.totalBytes === "number" &&
    migration.preview.totalBytes > 0
  ) {
    return Math.min(
      70,
      Math.round((migration.copiedBytes / migration.preview.totalBytes) * 70)
    )
  }
  if (migration.state === "copying") return 35
  return migration.state === "failed" ? 0 : 5
}

function byteLabel(value: number | null) {
  if (value === null) return "—"
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: value >= 1024 * 1024 * 1024 ? "gigabyte" : "megabyte",
    maximumFractionDigits: 1,
  }).format(
    value >= 1024 * 1024 * 1024
      ? value / (1024 * 1024 * 1024)
      : value / (1024 * 1024)
  )
}

function MigrationSection({
  migrations,
  isPending,
  isError,
  actionPending,
  labels,
  onRetryLoad,
  onStart,
  onPause,
  onRetry,
  onCancel,
  onComplete,
}: {
  migrations: PlacementMigration[] | undefined
  isPending: boolean
  isError: boolean
  actionPending: boolean
  labels: Record<NodeCapabilityId, string>
  onRetryLoad: () => void
  onStart: (migrationId: string) => void
  onPause: (migrationId: string) => void
  onRetry: (migrationId: string) => void
  onCancel: (migrationId: string) => void
  onComplete: (migrationId: string, deleteSource: boolean) => void
}) {
  const t = useExtracted()
  const active = migrations?.filter(
    (migration) =>
      migration.state !== "completed" ||
      migration.safeErrorCode !== "CANCELLED_BY_USER"
  )
  return (
    <SettingsSection
      id="placement-migrations"
      icon={WorkflowIcon}
      title={t("Core ↔ Node migration")}
      description={t(
        "Inventory, copy, digest validation and the routing switch are explicit. Source data is retained until you confirm cleanup."
      )}
    >
      {isError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("Migration status is unavailable.")}</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" onClick={onRetryLoad}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("Try again")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : isPending ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : !active || active.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseIcon />
            </EmptyMedia>
            <EmptyTitle>{t("No placement migration")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Changing where stored data lives starts a move you review here."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {active.map((migration) => {
            const progress = migrationProgress(migration)
            const source = migration.sourcePlacement.kind
            const destination = migration.destinationPlacement.kind
            return (
              <Card key={migration.id} size="sm">
                <CardHeader>
                  <CardTitle>{labels[migration.resourceKind]}</CardTitle>
                  <CardDescription>
                    {source} → {destination} · {migration.preview.itemCount}{" "}
                    {t("items")}
                  </CardDescription>
                  <CardAction>
                    <Badge
                      variant={
                        migration.state === "failed"
                          ? "destructive"
                          : migration.state === "completed"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {migration.state}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Progress value={progress}>
                    <ProgressLabel>
                      {t("Migration progress")}: {progress}%
                    </ProgressLabel>
                  </Progress>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <Metadata
                      label={t("Inventory")}
                      value={byteLabel(migration.preview.totalBytes)}
                    />
                    <Metadata
                      label={t("Copied")}
                      value={byteLabel(migration.copiedBytes)}
                    />
                    <Metadata
                      label={t("Available on destination")}
                      value={byteLabel(migration.preview.availableBytes)}
                    />
                    <Metadata
                      label={t("Digest validation")}
                      value={
                        migration.destinationDigest &&
                        migration.destinationDigest === migration.sourceDigest
                          ? t("Matched")
                          : t("Pending")
                      }
                    />
                  </dl>
                  {!migration.preview.spaceReady ? (
                    <Alert variant="destructive">
                      <AlertTriangleIcon />
                      <AlertTitle>
                        {t("Not enough destination space")}
                      </AlertTitle>
                    </Alert>
                  ) : null}
                  {migration.safeErrorCode ? (
                    <Alert
                      variant={
                        migration.state === "failed" ? "destructive" : "default"
                      }
                    >
                      <AlertTriangleIcon />
                      <AlertTitle>{migration.safeErrorCode}</AlertTitle>
                    </Alert>
                  ) : null}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  {migration.state === "planned" ? (
                    <Button
                      size="sm"
                      disabled={actionPending || !migration.preview.spaceReady}
                      onClick={() => onStart(migration.id)}
                    >
                      <PlayIcon data-icon="inline-start" />
                      {t("Start migration")}
                    </Button>
                  ) : null}
                  {migration.state === "copying" ||
                  migration.state === "verifying" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionPending}
                      onClick={() => onPause(migration.id)}
                    >
                      <PauseIcon data-icon="inline-start" />
                      {t("Pause")}
                    </Button>
                  ) : null}
                  {migration.state === "failed" ? (
                    <Button
                      size="sm"
                      disabled={actionPending}
                      onClick={() => onRetry(migration.id)}
                    >
                      <RefreshCwIcon data-icon="inline-start" />
                      {t("Retry")}
                    </Button>
                  ) : null}
                  {["planned", "copying", "verifying", "failed"].includes(
                    migration.state
                  ) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={actionPending}
                      onClick={() => onCancel(migration.id)}
                    >
                      <XIcon data-icon="inline-start" />
                      {t("Cancel")}
                    </Button>
                  ) : null}
                  {migration.state === "source-retained" ? (
                    <>
                      <Button
                        size="sm"
                        disabled={actionPending}
                        onClick={() => onComplete(migration.id, false)}
                      >
                        <CheckCircle2Icon data-icon="inline-start" />
                        {t("Keep source and finish")}
                      </Button>
                      {migration.resourceKind === "storage" &&
                      migration.sourcePlacement.kind === "node" ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={actionPending}
                          onClick={() => onComplete(migration.id, true)}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          {t("Delete verified source")}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}
    </SettingsSection>
  )
}

function RemoteDeletionSection({
  records,
  isPending,
  isError,
  retryingDigest,
  onRetryLoad,
  onRetryDeletion,
}: {
  records: readonly RemoteDeletion[] | undefined
  isPending: boolean
  isError: boolean
  retryingDigest: string | null | undefined
  onRetryLoad: () => void
  onRetryDeletion: (manifestDigest: string) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const pending = records?.filter(
    (record) => record.state !== "verified_deleted"
  )

  return (
    <SettingsSection
      id="remote-deletions"
      icon={Trash2Icon}
      title={t("Remote deletion receipts")}
      description={t(
        "Objects on a disconnected Node remain visibly pending until the original Node returns a verified receipt."
      )}
    >
      {isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="status">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("Remote deletions are unavailable")}</AlertTitle>
          <AlertDescription>
            {t(
              "No object is described as deleted while the receipt ledger cannot be loaded."
            )}
          </AlertDescription>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetryLoad}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {t("Try again")}
          </Button>
        </Alert>
      ) : !records?.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2Icon />
            </EmptyMedia>
            <EmptyTitle>{t("No remote deletion is pending")}</EmptyTitle>
            <EmptyDescription>
              {t("No Node deletions have been recorded for this account.")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {pending?.length ? (
            <Alert variant="destructive">
              <ShieldAlertIcon />
              <AlertTitle>
                {t(
                  "{count, plural, one {# deletion awaits a receipt} other {# deletions await receipts}}",
                  {
                    count: pending.length,
                  }
                )}
              </AlertTitle>
              <AlertDescription>
                {t(
                  "Reconnect the matching Node before retrying. Avermate will not silently move or claim deletion of those bytes."
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {records.map((record) => {
              const verified = record.state === "verified_deleted"
              const retrying = retryingDigest === record.manifestDigest
              return (
                <Card key={record.manifestDigest} size="sm">
                  <CardHeader>
                    <CardTitle>{record.nodeId}</CardTitle>
                    <CardDescription
                      className="truncate font-mono"
                      title={record.manifestDigest}
                    >
                      {record.manifestDigest}
                    </CardDescription>
                    <CardAction>
                      <Badge variant={verified ? "secondary" : "destructive"}>
                        {verified ? t("Verified deleted") : record.state}
                      </Badge>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {t(
                          "{count, plural, one {# object} other {# objects}}",
                          {
                            count: record.objectCount,
                          }
                        )}
                      </Badge>
                      {record.deletedCount !== null ? (
                        <Badge variant="outline">
                          {t("{count} receipt deletions", {
                            count: String(record.deletedCount),
                          })}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("Updated {date}", {
                        date: format.dateTime(new Date(record.updatedAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}
                    </p>
                    {record.safeOperatorInstruction ? (
                      <p className="rounded-lg bg-muted/50 p-2 text-xs">
                        {record.safeOperatorInstruction}
                      </p>
                    ) : null}
                  </CardContent>
                  {!verified ? (
                    <CardFooter>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(retryingDigest)}
                        onClick={() => onRetryDeletion(record.manifestDigest)}
                      >
                        {retrying ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <RefreshCwIcon data-icon="inline-start" />
                        )}
                        {t("Retry verification")}
                      </Button>
                    </CardFooter>
                  ) : null}
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

function LifecycleSection({
  events,
  isPending,
  isError,
  nodes,
  selectedNodeId,
  onSelectedNodeId,
  onRetry,
  placements,
  labels,
}: {
  events: LifecycleEvent[] | undefined
  isPending: boolean
  isError: boolean
  nodes: NodeRecord[]
  selectedNodeId: string
  onSelectedNodeId: (value: string) => void
  onRetry: () => void
  placements: PlacementRecord[]
  labels: Record<NodeCapabilityId, string>
}) {
  const t = useExtracted()
  const migrationLabels = useMigrationLabels()
  const format = useFormatter()
  const pendingMigrations = placements.filter(
    (placement) =>
      placement.migrationState === "planned" ||
      placement.migrationState === "running" ||
      placement.migrationState === "failed"
  )

  return (
    <SettingsSection
      id="lifecycle"
      icon={ListRestartIcon}
      title={t("Lifecycle and migration diagnostics")}
      description={t(
        "Append-only events remain visible after revocation. Metadata is redacted by the Core before it reaches the browser."
      )}
    >
      {pendingMigrations.length > 0 ? (
        <Alert>
          <DatabaseIcon />
          <AlertTitle>
            {t("{count} migration lanes need attention", {
              count: String(pendingMigrations.length),
            })}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
              {pendingMigrations.map((placement) => (
                <li key={placement.id}>
                  {labels[placement.capability]}:{" "}
                  {migrationStateLabel(
                    placement.migrationState,
                    migrationLabels
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>{t("No pending migration is recorded.")}</AlertTitle>
          <AlertDescription>
            {t(
              "This does not certify an unconfigured lane; full-self-host readiness still checks every required capability."
            )}
          </AlertDescription>
        </Alert>
      )}

      <Field>
        <FieldLabel htmlFor="node-lifecycle-filter">
          {t("Filter lifecycle by Node")}
        </FieldLabel>
        <Select
          value={selectedNodeId}
          onValueChange={(value) => value && onSelectedNodeId(value)}
        >
          <SelectTrigger id="node-lifecycle-filter" className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">{t("All Nodes")}</SelectItem>
              {nodes.map((node) => (
                <SelectItem key={node.nodeId} value={node.nodeId}>
                  {truncated(node.nodeId, 28)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {isError ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("Lifecycle events could not be loaded.")}</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCwIcon data-icon="inline-start" />
              {t("Try again")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : !events || events.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clock3Icon />
            </EmptyMedia>
            <EmptyTitle>{t("No lifecycle event")}</EmptyTitle>
            <EmptyDescription>
              {t("Pairing, relay, rotation and placement events appear here.")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-2">
          {events.map((event, index) => {
            const metadata = primitiveMetadata(event.safeMetadata)
            return (
              <li key={`${event.nodeId}:${event.occurredAt}:${index}`}>
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="font-mono">
                      {event.eventType}
                    </CardTitle>
                    <CardDescription title={event.nodeId}>
                      {truncated(event.nodeId, 32)}
                    </CardDescription>
                    <CardAction>
                      <time dateTime={event.occurredAt}>
                        <Badge variant="outline">
                          {format.dateTime(new Date(event.occurredAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </Badge>
                      </time>
                    </CardAction>
                  </CardHeader>
                  {metadata.length > 0 ? (
                    <CardContent>
                      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {metadata.map(([key, value]) => (
                          <Metadata key={key} label={key} value={value} mono />
                        ))}
                      </dl>
                    </CardContent>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ol>
      )}
    </SettingsSection>
  )
}

function RotateCredentialsDialog({
  node,
  pending,
  onOpenChange,
  onConfirm,
}: {
  node: NodeRecord | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const t = useExtracted()
  return (
    <AlertDialog open={Boolean(node)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <KeyRoundIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("Rotate Node credentials?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "A new relay and capability generation will be issued. The previous generation overlaps for five minutes so an online Node can switch safely."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert>
          <Clock3Icon />
          <AlertTitle>{t("Delivery must complete")}</AlertTitle>
          <AlertDescription>
            {t(
              "The local Node must collect and acknowledge the new credentials; the browser never receives them."
            )}
          </AlertDescription>
        </Alert>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCwIcon data-icon="inline-start" />
            )}
            {t("Rotate credentials")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RevokeNodeDialog({
  node,
  reason,
  setReason,
  pending,
  onOpenChange,
  onConfirm,
}: {
  node: NodeRecord | null
  reason: RevokeReason
  setReason: (reason: RevokeReason) => void
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const t = useExtracted()
  return (
    <AlertDialog open={Boolean(node)} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ShieldAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("Revoke this Node?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "Live connections are cut at once. Data on the Node stays on the Node, and may be out of reach until you recover it or move it."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="node-revoke-reason">
            {t("Revocation reason")}
          </FieldLabel>
          <Select
            value={reason}
            onValueChange={(value) => value && setReason(value as RevokeReason)}
          >
            <SelectTrigger id="node-revoke-reason" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="USER_REVOKED">
                  {t("I no longer trust this Node")}
                </SelectItem>
                <SelectItem value="NODE_RETIRED">
                  {t("This Node is retired")}
                </SelectItem>
                <SelectItem value="CREDENTIAL_COMPROMISED">
                  {t("Credentials may be compromised")}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("This action interrupts Node flows.")}</AlertTitle>
          <AlertDescription>
            {t(
              "There is no automatic Core or managed fallback. Historical lifecycle diagnostics remain visible."
            )}
          </AlertDescription>
        </Alert>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t("Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Trash2Icon data-icon="inline-start" />
            )}
            {t("Revoke Node")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
