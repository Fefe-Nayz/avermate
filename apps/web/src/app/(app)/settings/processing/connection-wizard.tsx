"use client"

import { useMemo, useState } from "react"
import type {
  CapabilityKind,
  CapabilityOffering,
  CapabilityOfferingPlacement,
  ProviderPluginManifest,
} from "@avermate/agent-contracts"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  Loader2Icon,
  NetworkIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useProcessingLabels } from "./processing-labels"
import { orpc } from "@/lib/orpc"
import { CAPABILITY_PURPOSES } from "./capability-settings-model"

const STEPS = [
  "Placement",
  "Provider",
  "Configuration",
  "Secrets",
  "Validation",
  "Discovery",
  "Consent",
  "Policies",
] as const

type PlacementKind = Extract<
  CapabilityOfferingPlacement,
  { kind: "direct-byok" | "node" }
>["kind"]
type PublicConnectionPlacement = Extract<
  CapabilityOfferingPlacement,
  { kind: PlacementKind }
>
type ConfigurationValue = string | number | boolean
type PluginCatalogueEntry = ProviderPluginManifest & {
  runtimeAvailability: "ready" | "catalogue-only"
}
type ConnectionSnapshot = {
  id: string
  revision: number
}

const PLACEMENTS: ReadonlyArray<{
  kind: PlacementKind
  title: string
  description: string
  icon: typeof KeyRoundIcon
}> = [
  {
    kind: "direct-byok",
    title: "Personal API key",
    description: "Avermate calls the provider with your encrypted credential.",
    icon: KeyRoundIcon,
  },
  {
    kind: "node",
    title: "Avermate Node",
    description:
      "The credential and execution remain under your Node's custody.",
    icon: ServerIcon,
  },
]

const FIXED_PROVIDER_ORIGINS: Readonly<Record<string, string>> = {
  "avermate.mistral": "https://api.mistral.ai",
  "ai-sdk.google": "https://generativelanguage.googleapis.com",
  "avermate.cohere": "https://api.cohere.com",
  "ai-sdk.openai": "https://api.openai.com",
  "avermate.openrouter": "https://openrouter.ai",
  "ai-sdk.deepgram": "https://api.deepgram.com",
  "ai-sdk.elevenlabs": "https://api.elevenlabs.io",
  "avermate.huggingface-inference": "https://router.huggingface.co",
}

function snapshotFromMutation(value: unknown): ConnectionSnapshot | null {
  if (!value || typeof value !== "object") return null
  let candidate = value as Record<string, unknown>
  for (let depth = 0; depth < 2; depth += 1) {
    if (!candidate.connection || typeof candidate.connection !== "object") break
    candidate = candidate.connection as Record<string, unknown>
  }
  return typeof candidate.id === "string" &&
    typeof candidate.revision === "number"
    ? { id: candidate.id, revision: candidate.revision }
    : null
}

function buildPlacement(
  kind: PlacementKind,
  reference: string,
  secondaryReference: string
): PublicConnectionPlacement | null {
  const primary = reference.trim()
  const secondary = secondaryReference.trim()
  if (kind === "direct-byok") {
    try {
      return { kind, origin: new URL(primary).origin }
    } catch {
      return null
    }
  }
  if (!primary || !/^sha256:[a-f0-9]{64}$/u.test(secondary)) return null
  return { kind, nodeId: primary, configRevision: secondary }
}

function configurationPayload(
  fields: ProviderPluginManifest["configurationFields"],
  values: Record<string, ConfigurationValue>
) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = values[field.key]
      if (value === undefined || value === "") return []
      return [[field.key, value]]
    })
  )
}

function requiredConfigurationReady(
  fields: ProviderPluginManifest["configurationFields"],
  values: Record<string, ConfigurationValue>
) {
  return fields.every(
    (field) =>
      !field.required ||
      (values[field.key] !== undefined && values[field.key] !== "")
  )
}

export function ConnectionWizard({
  plugins,
  offerings,
}: {
  plugins: PluginCatalogueEntry[]
  offerings: CapabilityOffering[]
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [placementKind, setPlacementKind] =
    useState<PlacementKind>("direct-byok")
  const [placementReference, setPlacementReference] = useState(
    "https://api.mistral.ai"
  )
  const [secondaryReference, setSecondaryReference] = useState("")
  const [pluginId, setPluginId] = useState(plugins[0]?.id ?? "")
  const [displayName, setDisplayName] = useState("")
  const [configuration, setConfiguration] = useState<
    Record<string, ConfigurationValue>
  >({})
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [connection, setConnection] = useState<ConnectionSnapshot | null>(null)
  const [discoveredOfferings, setDiscoveredOfferings] = useState<
    CapabilityOffering[]
  >([])
  const [selectedPurposes, setSelectedPurposes] = useState<string[]>([])

  const placementPlugins = useMemo(
    () =>
      plugins.filter((candidate) =>
        placementKind === "node"
          ? candidate.id === "avermate.node"
          : candidate.id !== "avermate.node"
      ),
    [placementKind, plugins]
  )
  const plugin =
    placementPlugins.find((candidate) => candidate.id === pluginId) ??
    placementPlugins[0] ??
    null
  const effectiveConfiguration = useMemo(
    () =>
      plugin?.id === "avermate.node"
        ? {
            ...configuration,
            nodeId: configuration.nodeId || placementReference,
            configRevision: configuration.configRevision || secondaryReference,
          }
        : configuration,
    [configuration, placementReference, plugin?.id, secondaryReference]
  )
  const effectivePlacementReference =
    placementKind === "direct-byok" &&
    typeof effectiveConfiguration.origin === "string"
      ? effectiveConfiguration.origin
      : placementReference
  const selectedPlacement = buildPlacement(
    placementKind,
    effectivePlacementReference,
    secondaryReference
  )
  const connectionOfferings = useMemo(() => {
    const combined = new Map(
      [...offerings, ...discoveredOfferings].map((offering) => [
        offering.id,
        offering,
      ])
    )
    return [...combined.values()].filter(
      (offering) => offering.connectionId === connection?.id
    )
  }, [connection?.id, discoveredOfferings, offerings])
  const availablePurposes = useMemo(
    () =>
      CAPABILITY_PURPOSES.filter((purpose) =>
        connectionOfferings.some(
          (offering) => offering.capability === purpose.capability
        )
      ),
    [connectionOfferings]
  )

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.connections.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.offerings.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.policies.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.consents.list.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.capabilities.readiness.key(),
      }),
    ])
  }

  const create = useMutation(
    orpc.capabilities.connections.create.mutationOptions()
  )
  const validate = useMutation(
    orpc.capabilities.connections.validate.mutationOptions()
  )
  const discover = useMutation(
    orpc.capabilities.connections.discover.mutationOptions()
  )
  const grantConsent = useMutation(
    orpc.capabilities.consents.grant.mutationOptions()
  )
  const savePolicy = useMutation(
    orpc.capabilities.policies.upsert.mutationOptions()
  )

  const busy =
    create.isPending ||
    validate.isPending ||
    discover.isPending ||
    grantConsent.isPending ||
    savePolicy.isPending

  const reset = () => {
    setStep(0)
    setPlacementKind("direct-byok")
    setPlacementReference("https://api.mistral.ai")
    setSecondaryReference("")
    setPluginId(plugins[0]?.id ?? "")
    setDisplayName("")
    setConfiguration({})
    setSecrets({})
    setConnection(null)
    setDiscoveredOfferings([])
    setSelectedPurposes([])
  }

  const next = () =>
    setStep((current) => Math.min(STEPS.length - 1, current + 1))
  const back = () => setStep((current) => Math.max(0, current - 1))

  const createAndValidate = async () => {
    if (!plugin || plugin.runtimeAvailability !== "ready" || !selectedPlacement)
      return
    try {
      const created = await create.mutateAsync({
        pluginId: plugin.id,
        displayName: displayName.trim() || plugin.displayName,
        placement: selectedPlacement,
        configVersion: 1,
        config: configurationPayload(
          plugin.configurationFields,
          effectiveConfiguration
        ),
        secrets: plugin.secretSlots.flatMap((slot) => {
          const value = secrets[slot.name]?.trim()
          return value ? [{ slot: slot.name, value }] : []
        }),
      })
      const createdSnapshot = snapshotFromMutation(created)
      if (!createdSnapshot)
        throw new Error("Connection creation returned no snapshot")
      const validated = await validate.mutateAsync({
        connectionId: createdSnapshot.id,
        expectedRevision: createdSnapshot.revision,
      })
      const validatedSnapshot =
        snapshotFromMutation(validated) ?? createdSnapshot
      setConnection(validatedSnapshot)
      setSecrets({})
      await invalidate()
      toast.success(t("Connection validated."))
      next()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("The connection could not be validated.")
      )
    }
  }

  const discoverOfferings = async () => {
    if (!connection) return
    try {
      const result = await discover.mutateAsync({
        connectionId: connection.id,
        expectedRevision: connection.revision,
      })
      const resultRecord =
        result && typeof result === "object"
          ? (result as Record<string, unknown>)
          : {}
      const resultOfferings = Array.isArray(resultRecord.offerings)
        ? (resultRecord.offerings as CapabilityOffering[])
        : []
      const updatedConnection = snapshotFromMutation(result)
      if (updatedConnection) setConnection(updatedConnection)
      setDiscoveredOfferings(resultOfferings)
      await invalidate()
      toast.success(
        t("Discovered {count} capability offerings.", {
          count: String(resultOfferings.length),
        })
      )
      next()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Discovery failed.")
      )
    }
  }

  const grantRequiredConsents = async () => {
    if (!connection) return
    const required = connectionOfferings.filter(
      (offering) => offering.dataHandling.requiresExplicitConsent
    )
    const unique = [
      ...new Map(
        required.map((offering) => [
          `${offering.capability}:${offering.dataHandling.disclosureRevision}`,
          offering,
        ])
      ).values(),
    ]
    try {
      for (const offering of unique) {
        await grantConsent.mutateAsync({
          connectionId: connection.id,
          capability: offering.capability,
          disclosureRevision: offering.dataHandling.disclosureRevision,
          expectedRevision: null,
        })
      }
      await invalidate()
      next()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Consent could not be saved.")
      )
    }
  }

  const enablePurposes = async () => {
    try {
      for (const purpose of availablePurposes.filter((candidate) =>
        selectedPurposes.includes(candidate.id)
      )) {
        const offering = connectionOfferings.find(
          (candidate) => candidate.capability === purpose.capability
        )
        if (!offering) continue
        await savePolicy.mutateAsync({
          expectedRevision: null,
          scope: { kind: "user" },
          capability: purpose.capability,
          purposePattern: purpose.id,
          mode: "ordered",
          primaryOfferingId: offering.id,
          fallbackOfferingIds: [],
          constraints: {
            requiredFeatures: [],
            allowedPlacements: [offering.placement.kind],
            allowedProviders: [offering.provider],
            deniedProviders: [],
            maximumDataEgress: offering.dataHandling.egress,
            allowPrivacyEscalationOnFallback: false,
            maximumEstimatedCostMinor: null,
            preferredLatencyClass: "normal",
            requireUserCredential: offering.placement.kind === "direct-byok",
            allowManagedCredential: offering.placement.kind === "managed",
            requireHealthy: true,
          },
        })
      }
      await invalidate()
      toast.success(t("Connection setup completed."))
      setOpen(false)
      reset()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Policies could not be saved.")
      )
    }
  }

  const canContinue =
    (step === 0 && Boolean(selectedPlacement)) ||
    (step === 1 && plugin?.runtimeAvailability === "ready") ||
    (step === 2 &&
      Boolean(plugin) &&
      requiredConfigurationReady(
        plugin?.configurationFields ?? [],
        effectiveConfiguration
      )) ||
    (step === 3 &&
      Boolean(plugin) &&
      (plugin?.secretSlots ?? []).every(
        (slot) => !slot.required || Boolean(secrets[slot.name]?.trim())
      ))

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && !connection) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <SparklesIcon data-icon="inline-start" />
        {t("Add connection")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" closeLabel={t("Close")}>
        <DialogHeader>
          <div className="flex items-start justify-between gap-8 pe-8">
            <div>
              <DialogTitle>
                {t("Connect an AI or processing provider")}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {t(
                  "Secrets are write-only. Validation, discovery and consent happen before a workflow can use this connection."
                )}
              </DialogDescription>
            </div>
            <Badge variant="outline">
              {step + 1}/{STEPS.length}
            </Badge>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100}>
            <ProgressLabel>
              {processingLabel(STEPS[step] ?? "Setup")}
            </ProgressLabel>
          </Progress>
        </DialogHeader>

        <div className="min-h-80 py-2">
          {step === 0 ? (
            <PlacementStep
              value={placementKind}
              onChange={setPlacementKind}
              reference={placementReference}
              onReferenceChange={setPlacementReference}
              secondaryReference={secondaryReference}
              onSecondaryReferenceChange={setSecondaryReference}
            />
          ) : null}
          {step === 1 ? (
            <ProviderStep
              plugins={placementPlugins}
              value={plugin?.id ?? ""}
              onChange={(value) => {
                setPluginId(value)
                if (placementKind === "direct-byok") {
                  setPlacementReference(FIXED_PROVIDER_ORIGINS[value] ?? "")
                }
                setConfiguration({})
                setSecrets({})
              }}
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
            />
          ) : null}
          {step === 2 && plugin ? (
            <ConfigurationStep
              plugin={plugin}
              values={effectiveConfiguration}
              onChange={(key, value) =>
                setConfiguration((current) => ({ ...current, [key]: value }))
              }
            />
          ) : null}
          {step === 3 && plugin ? (
            <SecretsStep
              plugin={plugin}
              values={secrets}
              onChange={(key, value) =>
                setSecrets((current) => ({ ...current, [key]: value }))
              }
            />
          ) : null}
          {step === 4 ? (
            <ReviewStep
              plugin={plugin}
              placement={selectedPlacement}
              displayName={displayName}
              configuredFields={Object.keys(
                configurationPayload(
                  plugin?.configurationFields ?? [],
                  effectiveConfiguration
                )
              )}
            />
          ) : null}
          {step === 5 ? (
            <DiscoveryStep
              connection={connection}
              onDiscover={discoverOfferings}
              pending={discover.isPending}
            />
          ) : null}
          {step === 6 ? <ConsentStep offerings={connectionOfferings} /> : null}
          {step === 7 ? (
            <PolicyStep
              purposes={availablePurposes}
              selected={selectedPurposes}
              onToggle={(purpose, checked) =>
                setSelectedPurposes((current) =>
                  checked
                    ? [...new Set([...current, purpose])]
                    : current.filter((candidate) => candidate !== purpose)
                )
              }
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy || step === 0 || step === 5}
            onClick={back}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {t("Back")}
          </Button>
          {step < 4 ? (
            <Button disabled={busy || !canContinue} onClick={next}>
              {t("Continue")}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          ) : null}
          {step === 4 ? (
            <Button
              disabled={busy || !plugin || !selectedPlacement}
              onClick={createAndValidate}
            >
              {busy ? (
                <Loader2Icon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              {t("Create and validate")}
            </Button>
          ) : null}
          {step === 5 ? null : null}
          {step === 6 ? (
            <Button disabled={busy} onClick={grantRequiredConsents}>
              {grantConsent.isPending ? (
                <Loader2Icon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <ShieldCheckIcon data-icon="inline-start" />
              )}
              {connectionOfferings.some(
                (offering) => offering.dataHandling.requiresExplicitConsent
              )
                ? t("Accept disclosed processing")
                : t("Continue")}
            </Button>
          ) : null}
          {step === 7 ? (
            <Button disabled={busy} onClick={enablePurposes}>
              {savePolicy.isPending ? (
                <Loader2Icon
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <CheckCircle2Icon data-icon="inline-start" />
              )}
              {t("Finish setup")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlacementStep({
  value,
  onChange,
  reference,
  onReferenceChange,
  secondaryReference,
  onSecondaryReferenceChange,
}: {
  value: PlacementKind
  onChange: (value: PlacementKind) => void
  reference: string
  onReferenceChange: (value: string) => void
  secondaryReference: string
  onSecondaryReferenceChange: (value: string) => void
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>{t("Where should this provider run?")}</FieldLabel>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PLACEMENTS.map((placement) => {
            const Icon = placement.icon
            const selected = placement.kind === value
            return (
              <button
                key={placement.kind}
                type="button"
                aria-pressed={selected}
                className="rounded-xl border p-3 text-left transition-colors hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-primary/5"
                onClick={() => {
                  onChange(placement.kind)
                  if (placement.kind === "direct-byok") {
                    onReferenceChange("https://api.mistral.ai")
                  } else {
                    onReferenceChange("")
                  }
                  onSecondaryReferenceChange("")
                }}
              >
                <Icon className="mb-3 size-5 text-muted-foreground" />
                <span className="block text-sm font-medium">
                  {processingLabel(placement.title)}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {processingLabel(placement.description)}
                </span>
              </button>
            )
          })}
        </div>
      </Field>
      <Field>
        <FieldLabel htmlFor="capability-placement-reference">
          {value === "direct-byok" ? t("Provider origin") : t("Node ID")}
        </FieldLabel>
        <Input
          id="capability-placement-reference"
          type={value === "direct-byok" ? "url" : "text"}
          value={reference}
          onChange={(event) => onReferenceChange(event.target.value)}
          placeholder={
            value === "direct-byok" ? "https://api.example.com" : undefined
          }
        />
      </Field>
      {value === "node" ? (
        <Field>
          <FieldLabel htmlFor="capability-placement-secondary">
            {t("Signed config revision")}
          </FieldLabel>
          <Input
            id="capability-placement-secondary"
            value={secondaryReference}
            onChange={(event) => onSecondaryReferenceChange(event.target.value)}
            placeholder="sha256:…"
          />
          <FieldDescription>
            {t(
              "Copy this immutable revision from the paired Node settings page."
            )}
          </FieldDescription>
        </Field>
      ) : null}
    </FieldGroup>
  )
}

function ProviderStep({
  plugins,
  value,
  onChange,
  displayName,
  onDisplayNameChange,
}: {
  plugins: PluginCatalogueEntry[]
  value: string
  onChange: (value: string) => void
  displayName: string
  onDisplayNameChange: (value: string) => void
}) {
  const t = useExtracted()
  const plugin = plugins.find((candidate) => candidate.id === value)
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="capability-plugin">
          {t("Provider or protocol")}
        </FieldLabel>
        <Select value={value} onValueChange={(next) => next && onChange(next)}>
          <SelectTrigger id="capability-plugin" className="w-full">
            <SelectValue placeholder={t("Choose a provider")} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{t("Reviewed connectors")}</SelectLabel>
              {plugins.map((candidate) => (
                <SelectItem
                  key={candidate.id}
                  value={candidate.id}
                  disabled={candidate.runtimeAvailability !== "ready"}
                >
                  {candidate.displayName}
                  {candidate.runtimeAvailability === "catalogue-only"
                    ? ` — ${t("adapter unavailable in this build")}`
                    : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          {t(
            "Native providers, known protocols and Node sidecars use the same typed capability contract."
          )}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="capability-display-name">
          {t("Connection name")}
        </FieldLabel>
        <Input
          id="capability-display-name"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          placeholder={
            plugin ? `${plugin.displayName} — ${t("personal")}` : undefined
          }
        />
      </Field>
      {plugin ? (
        <div className="space-y-2">
          {plugin.runtimeAvailability === "catalogue-only" ? (
            <p className="text-sm text-destructive">
              {t(
                "This reviewed protocol is visible for compatibility, but its adapter is not compiled into this server build."
              )}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {plugin.capabilities.map((capability) => (
              <Badge key={capability} variant="outline">
                {capability}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </FieldGroup>
  )
}

function ConfigurationStep({
  plugin,
  values,
  onChange,
}: {
  plugin: ProviderPluginManifest
  values: Record<string, ConfigurationValue>
  onChange: (key: string, value: ConfigurationValue) => void
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  if (plugin.configurationFields.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
        <CheckCircle2Icon className="size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">
          {t("No public configuration is required")}
        </p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {t(
            "This connector only needs the secret slots shown on the next step."
          )}
        </p>
      </div>
    )
  }
  return (
    <FieldGroup>
      {plugin.configurationFields.map((field) => (
        <Field key={field.key}>
          <FieldLabel htmlFor={`capability-config-${field.key}`}>
            {processingLabel(field.label)}
            {field.required ? " *" : ""}
          </FieldLabel>
          {field.kind === "select" && field.options.length > 0 ? (
            <Select
              value={
                typeof values[field.key] === "string"
                  ? String(values[field.key])
                  : ""
              }
              onValueChange={(value) => value && onChange(field.key, value)}
            >
              <SelectTrigger
                id={`capability-config-${field.key}`}
                className="w-full"
              >
                <SelectValue
                  placeholder={field.placeholder ?? t("Choose a value")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {field.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {processingLabel(option.label)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : field.kind === "boolean" ? (
            <Switch
              id={`capability-config-${field.key}`}
              checked={Boolean(values[field.key])}
              onCheckedChange={(checked) => onChange(field.key, checked)}
            />
          ) : (
            <Input
              id={`capability-config-${field.key}`}
              type={
                field.kind === "number"
                  ? "number"
                  : field.kind === "url"
                    ? "url"
                    : "text"
              }
              value={String(values[field.key] ?? "")}
              placeholder={field.placeholder ?? undefined}
              onChange={(event) =>
                onChange(
                  field.key,
                  field.kind === "number"
                    ? Number(event.target.value)
                    : event.target.value
                )
              }
            />
          )}
          <FieldDescription>{processingLabel(field.help)}</FieldDescription>
        </Field>
      ))}
    </FieldGroup>
  )
}

function SecretsStep({
  plugin,
  values,
  onChange,
}: {
  plugin: ProviderPluginManifest
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  const t = useExtracted()
  if (plugin.secretSlots.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
        <ShieldCheckIcon className="size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">{t("No browser-supplied secret")}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {t("This placement uses operator or Node-local credential custody.")}
        </p>
      </div>
    )
  }
  return (
    <FieldGroup>
      {plugin.secretSlots.map((slot) => (
        <Field key={slot.name}>
          <FieldLabel htmlFor={`capability-secret-${slot.name}`}>
            {slot.name}
            {slot.required ? " *" : ""}
          </FieldLabel>
          <Input
            id={`capability-secret-${slot.name}`}
            type="password"
            autoComplete="off"
            value={values[slot.name] ?? ""}
            onChange={(event) => onChange(slot.name, event.target.value)}
          />
          <FieldDescription>
            {t(
              "Stored encrypted, versioned and write-only. Validation: {method}.",
              {
                method: slot.validation,
              }
            )}
          </FieldDescription>
        </Field>
      ))}
    </FieldGroup>
  )
}

function ReviewStep({
  plugin,
  placement,
  displayName,
  configuredFields,
}: {
  plugin: ProviderPluginManifest | null
  placement: CapabilityOfferingPlacement | null
  displayName: string
  configuredFields: string[]
}) {
  const t = useExtracted()
  return (
    <div className="space-y-3">
      <div className="rounded-xl border p-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("Name")}</dt>
            <dd className="mt-1 font-medium">
              {displayName || plugin?.displayName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("Placement")}</dt>
            <dd className="mt-1 font-medium">{placement?.kind ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("Connector")}</dt>
            <dd className="mt-1 font-medium">{plugin?.displayName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("Public fields")}
            </dt>
            <dd className="mt-1 font-medium">
              {configuredFields.length > 0
                ? configuredFields.join(", ")
                : t("None")}
            </dd>
          </div>
        </dl>
      </div>
      <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        {t(
          "A minimal validation call runs next. The secret value is never returned to this page, logs or operation diagnostics."
        )}
      </div>
    </div>
  )
}

function DiscoveryStep({
  connection,
  onDiscover,
  pending,
}: {
  connection: ConnectionSnapshot | null
  onDiscover: () => void
  pending: boolean
}) {
  const t = useExtracted()
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
      <NetworkIcon className="size-8 text-muted-foreground" />
      <p className="mt-3 font-medium">
        {t("Discover models, voices and capabilities")}
      </p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {t(
          "Discovery creates immutable offerings. Updating the connection later creates new revisions instead of rewriting past operations."
        )}
      </p>
      <Button
        className="mt-5"
        disabled={!connection || pending}
        onClick={onDiscover}
      >
        {pending ? (
          <Loader2Icon className="animate-spin" data-icon="inline-start" />
        ) : null}
        {t("Run discovery")}
      </Button>
    </div>
  )
}

function ConsentStep({ offerings }: { offerings: CapabilityOffering[] }) {
  const t = useExtracted()
  const external = offerings.filter(
    (offering) => offering.dataHandling.requiresExplicitConsent
  )
  if (external.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
        <ShieldCheckIcon className="size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">
          {t("No external-data consent is required")}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "These offerings keep data inside the selected execution boundary."
          )}
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {external.map((offering) => (
        <div key={offering.id} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{offering.capability}</p>
            <Badge variant="outline">{offering.dataHandling.egress}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              "Content may be sent to {provider} in {region}. Disclosure revision: {revision}.",
              {
                provider:
                  offering.dataHandling.providerName ?? offering.provider,
                region:
                  offering.dataHandling.region ?? t("provider-selected region"),
                revision: offering.dataHandling.disclosureRevision,
              }
            )}
          </p>
        </div>
      ))}
    </div>
  )
}

function PolicyStep({
  purposes,
  selected,
  onToggle,
}: {
  purposes: ReadonlyArray<{
    id: string
    capability: CapabilityKind
    title: string
  }>
  selected: string[]
  onToggle: (purpose: string, checked: boolean) => void
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>{t("Where may this connection be used?")}</FieldLabel>
        <FieldDescription>
          {t(
            "Nothing is enabled implicitly. You can refine fallbacks later in Capability policies."
          )}
        </FieldDescription>
        <div className="mt-2 divide-y rounded-xl border">
          {purposes.length > 0 ? (
            purposes.map((purpose) => (
              <label
                key={purpose.id}
                className="flex items-center gap-3 px-3 py-3"
              >
                <Switch
                  checked={selected.includes(purpose.id)}
                  onCheckedChange={(checked) => onToggle(purpose.id, checked)}
                  aria-label={processingLabel(purpose.title)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {processingLabel(purpose.title)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {purpose.capability} · {purpose.id}
                  </span>
                </span>
              </label>
            ))
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              {t(
                "No compatible offering was discovered. Finish without enabling a policy and inspect diagnostics."
              )}
            </p>
          )}
        </div>
      </Field>
    </FieldGroup>
  )
}
