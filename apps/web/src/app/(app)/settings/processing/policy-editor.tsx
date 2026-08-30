"use client"

import { useMemo, useState } from "react"
import type {
  CapabilityOffering,
  CapabilityPlacementKind,
  CapabilityPolicy,
  CapabilityPolicyMode,
  DataEgressClass,
} from "@avermate/agent-contracts"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  RouteIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  CAPABILITY_PURPOSES,
  fallbackDisclosure,
  isPrivacyEscalation,
} from "./capability-settings-model"

const PLACEMENTS = [
  "core",
  "managed",
  "direct-byok",
  "node",
  "full-self-host",
] as const satisfies readonly CapabilityPlacementKind[]

const EGRESS_OPTIONS = [
  "none",
  "owner-node",
  "avermate-managed",
  "external-provider",
] as const satisfies readonly DataEgressClass[]

export function CapabilityPolicyEditor({
  purposeId,
  policy,
  offerings,
}: {
  purposeId: string
  policy: CapabilityPolicy | null
  offerings: CapabilityOffering[]
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  const queryClient = useQueryClient()
  const purpose = CAPABILITY_PURPOSES.find(
    (candidate) => candidate.id === purposeId
  )
  const compatibleOfferings = useMemo(
    () =>
      offerings.filter(
        (offering) => offering.capability === purpose?.capability
      ),
    [offerings, purpose?.capability]
  )
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CapabilityPolicyMode>(
    policy?.mode ?? "automatic"
  )
  const [primaryId, setPrimaryId] = useState(policy?.primaryOfferingId ?? "")
  const [fallbackIds, setFallbackIds] = useState<string[]>(
    policy?.fallbackOfferingIds ?? []
  )
  const [maximumEgress, setMaximumEgress] = useState<DataEgressClass>(
    policy?.constraints.maximumDataEgress ?? "external-provider"
  )
  const [allowPrivacyEscalation, setAllowPrivacyEscalation] = useState(
    policy?.constraints.allowPrivacyEscalationOnFallback ?? false
  )
  const [requireHealthy, setRequireHealthy] = useState(
    policy?.constraints.requireHealthy ?? true
  )
  const [requiredFeatures, setRequiredFeatures] = useState(
    policy?.constraints.requiredFeatures.join(", ") ?? ""
  )
  const [maximumCost, setMaximumCost] = useState(
    policy?.constraints.maximumEstimatedCostMinor?.toString() ?? ""
  )

  const setDialogOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setMode(policy?.mode ?? "automatic")
      setPrimaryId(policy?.primaryOfferingId ?? "")
      setFallbackIds(policy?.fallbackOfferingIds ?? [])
      setMaximumEgress(
        policy?.constraints.maximumDataEgress ?? "external-provider"
      )
      setAllowPrivacyEscalation(
        policy?.constraints.allowPrivacyEscalationOnFallback ?? false
      )
      setRequireHealthy(policy?.constraints.requireHealthy ?? true)
      setRequiredFeatures(policy?.constraints.requiredFeatures.join(", ") ?? "")
      setMaximumCost(
        policy?.constraints.maximumEstimatedCostMinor?.toString() ?? ""
      )
    }
    setOpen(nextOpen)
  }

  const primary = compatibleOfferings.find(
    (offering) => offering.id === primaryId
  )
  const fallbacks = fallbackIds.flatMap((fallbackId) => {
    const offering = compatibleOfferings.find(
      (candidate) => candidate.id === fallbackId
    )
    return offering ? [offering] : []
  })
  const privacyEscalation = Boolean(
    primary &&
    fallbacks.some((fallback) =>
      isPrivacyEscalation(
        primary.dataHandling.egress,
        fallback.dataHandling.egress
      )
    )
  )

  const save = useMutation({
    ...orpc.capabilities.policies.upsert.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.capabilities.policies.list.key(),
      })
      toast.success(t("Capability policy saved."))
      setOpen(false)
    },
    onError: (error: Error) =>
      toast.error(error.message || t("The policy could not be saved.")),
  })

  if (!purpose) return null

  const savePolicy = () => {
    const selectedIds = [primaryId, ...fallbackIds].filter(Boolean)
    const selectedOfferings = compatibleOfferings.filter((offering) =>
      selectedIds.includes(offering.id)
    )
    const allowedPlacements = [
      ...new Set(selectedOfferings.map((offering) => offering.placement.kind)),
    ]
    const allowedProviders = [
      ...new Set(selectedOfferings.map((offering) => offering.provider)),
    ]
    const cost = maximumCost.trim() ? Number(maximumCost) : null

    save.mutate({
      ...(policy ? { policyId: policy.id } : {}),
      expectedRevision: policy?.revision ?? null,
      scope: { kind: "user" },
      capability: purpose.capability,
      purposePattern: purpose.id,
      mode,
      primaryOfferingId:
        mode === "pinned" || mode === "ordered" ? primaryId || null : null,
      fallbackOfferingIds: mode === "ordered" ? fallbackIds : [],
      constraints: {
        requiredFeatures: requiredFeatures
          .split(",")
          .map((feature) => feature.trim())
          .filter(Boolean),
        allowedPlacements:
          allowedPlacements.length > 0 ? allowedPlacements : [...PLACEMENTS],
        allowedProviders: allowedProviders.length > 0 ? allowedProviders : null,
        deniedProviders: [],
        maximumDataEgress: maximumEgress,
        allowPrivacyEscalationOnFallback: allowPrivacyEscalation,
        maximumEstimatedCostMinor:
          cost !== null && Number.isSafeInteger(cost) && cost >= 0
            ? cost
            : null,
        preferredLatencyClass: "normal",
        requireUserCredential: false,
        allowManagedCredential: true,
        requireHealthy,
      },
    })
  }

  const valid =
    mode === "disabled" ||
    mode === "automatic" ||
    ((mode === "pinned" || mode === "ordered") && Boolean(primaryId))

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <RouteIcon data-icon="inline-start" />
        {policy ? t("Edit route") : t("Configure")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" closeLabel={t("Close")}>
        <DialogHeader>
          <DialogTitle>{processingLabel(purpose.title)}</DialogTitle>
          <DialogDescription>
            {purpose.capability} · {purpose.id}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`policy-mode-${purpose.id}`}>
              {t("Routing mode")}
            </FieldLabel>
            <Select
              value={mode}
              onValueChange={(value) => value && setMode(value)}
            >
              <SelectTrigger
                id={`policy-mode-${purpose.id}`}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="automatic">{t("Automatic")}</SelectItem>
                  <SelectItem value="pinned">
                    {t("Pinned, no fallback")}
                  </SelectItem>
                  <SelectItem value="ordered">{t("Ordered route")}</SelectItem>
                  <SelectItem value="disabled">{t("Disabled")}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {t(
                "Automatic still obeys privacy, credential, health and feature constraints."
              )}
            </FieldDescription>
          </Field>

          {mode === "pinned" || mode === "ordered" ? (
            <Field>
              <FieldLabel htmlFor={`policy-primary-${purpose.id}`}>
                {t("Primary offering")}
              </FieldLabel>
              <OfferingSelect
                id={`policy-primary-${purpose.id}`}
                value={primaryId}
                offerings={compatibleOfferings}
                onChange={setPrimaryId}
                placeholder={t("Choose the primary route")}
              />
            </Field>
          ) : null}

          {mode === "ordered" ? (
            <Field>
              <FieldLabel htmlFor={`policy-fallback-${purpose.id}`}>
                {t("Ordered fallbacks")}
              </FieldLabel>
              <Select
                key={fallbackIds.join(":")}
                onValueChange={(value) => {
                  if (
                    typeof value === "string" &&
                    !fallbackIds.includes(value)
                  ) {
                    setFallbackIds((current) => [...current, value])
                  }
                }}
              >
                <SelectTrigger
                  id={`policy-fallback-${purpose.id}`}
                  className="w-full"
                >
                  <SelectValue placeholder={t("Add a fallback")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("Compatible offerings")}</SelectLabel>
                    {compatibleOfferings
                      .filter(
                        (offering) =>
                          offering.id !== primaryId &&
                          !fallbackIds.includes(offering.id)
                      )
                      .map((offering) => (
                        <SelectItem key={offering.id} value={offering.id}>
                          {offering.provider} · {offering.modelId} ·{" "}
                          {offering.placement.kind}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fallbacks.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {fallbacks.map((fallback, index) => (
                    <div
                      key={fallback.id}
                      className="flex items-center gap-2 rounded-lg border p-2"
                    >
                      <Badge variant="outline">{index + 1}</Badge>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {fallback.provider} · {fallback.modelId} ·{" "}
                        {fallback.placement.kind}
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() =>
                          setFallbackIds((current) => {
                            const next = [...current]
                            const [moving] = next.splice(index, 1)
                            if (moving) next.splice(index - 1, 0, moving)
                            return next
                          })
                        }
                      >
                        <ArrowUpIcon />
                        <span className="sr-only">{t("Move fallback up")}</span>
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={index === fallbacks.length - 1}
                        onClick={() =>
                          setFallbackIds((current) => {
                            const next = [...current]
                            const [moving] = next.splice(index, 1)
                            if (moving) next.splice(index + 1, 0, moving)
                            return next
                          })
                        }
                      >
                        <ArrowDownIcon />
                        <span className="sr-only">
                          {t("Move fallback down")}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        onClick={() =>
                          setFallbackIds((current) =>
                            current.filter((id) => id !== fallback.id)
                          )
                        }
                      >
                        <XIcon />
                        <span className="sr-only">{t("Remove fallback")}</span>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </Field>
          ) : null}

          {primary
            ? fallbacks.map((fallback) => (
                <FallbackDisclosure
                  key={fallback.id}
                  primary={primary}
                  fallback={fallback}
                />
              ))
            : null}

          <Field>
            <FieldLabel htmlFor={`policy-egress-${purpose.id}`}>
              {t("Maximum data egress")}
            </FieldLabel>
            <Select
              value={maximumEgress}
              onValueChange={(value) => value && setMaximumEgress(value)}
            >
              <SelectTrigger
                id={`policy-egress-${purpose.id}`}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {EGRESS_OPTIONS.map((egress) => (
                    <SelectItem key={egress} value={egress}>
                      {egress}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field orientation="horizontal">
            <div className="min-w-0 flex-1">
              <FieldLabel htmlFor={`policy-escalation-${purpose.id}`}>
                {t("Allow a less-private fallback")}
              </FieldLabel>
              <FieldDescription>
                {t(
                  "Only applies after the primary route fails and never bypasses consent."
                )}
              </FieldDescription>
            </div>
            <Switch
              id={`policy-escalation-${purpose.id}`}
              checked={allowPrivacyEscalation}
              onCheckedChange={setAllowPrivacyEscalation}
              disabled={!privacyEscalation}
            />
          </Field>

          <Field orientation="horizontal">
            <div className="min-w-0 flex-1">
              <FieldLabel htmlFor={`policy-health-${purpose.id}`}>
                {t("Require healthy offerings")}
              </FieldLabel>
              <FieldDescription>
                {t(
                  "Unhealthy routes are rejected before content is dispatched."
                )}
              </FieldDescription>
            </div>
            <Switch
              id={`policy-health-${purpose.id}`}
              checked={requireHealthy}
              onCheckedChange={setRequireHealthy}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`policy-features-${purpose.id}`}>
              {t("Required features")}
            </FieldLabel>
            <Input
              id={`policy-features-${purpose.id}`}
              value={requiredFeatures}
              onChange={(event) => setRequiredFeatures(event.target.value)}
              placeholder="timestamps.segment, language.fr"
            />
            <FieldDescription>
              {t("Comma-separated typed feature identifiers.")}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`policy-cost-${purpose.id}`}>
              {t("Maximum estimated cost, minor units")}
            </FieldLabel>
            <Input
              id={`policy-cost-${purpose.id}`}
              type="number"
              min={0}
              value={maximumCost}
              onChange={(event) => setMaximumCost(event.target.value)}
              placeholder={t("No explicit ceiling")}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </Button>
          <Button disabled={!valid || save.isPending} onClick={savePolicy}>
            {save.isPending ? (
              <RouteIcon className="animate-pulse" data-icon="inline-start" />
            ) : null}
            {t("Save policy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OfferingSelect({
  id,
  value,
  offerings,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  offerings: CapabilityOffering[]
  onChange: (value: string) => void
  placeholder: string
}) {
  const t = useExtracted()
  return (
    <Select
      value={value || undefined}
      onValueChange={(next) => next && onChange(next)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t("Compatible offerings")}</SelectLabel>
          {offerings.map((offering) => (
            <SelectItem key={offering.id} value={offering.id}>
              {offering.provider} · {offering.modelId} ·{" "}
              {offering.placement.kind}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function FallbackDisclosure({
  primary,
  fallback,
}: {
  primary: CapabilityOffering
  fallback: CapabilityOffering
}) {
  const t = useExtracted()
  const disclosure = fallbackDisclosure(
    primary.placement.kind,
    primary.dataHandling.egress,
    fallback.placement.kind,
    fallback.dataHandling.egress
  )
  const escalation = disclosure !== "same-boundary"
  return (
    <Alert variant={escalation ? "destructive" : "default"}>
      {escalation ? <ShieldAlertIcon /> : <ArrowDownIcon />}
      <AlertTitle>
        {escalation
          ? t("Privacy boundary changes on fallback")
          : t("Same privacy boundary")}
      </AlertTitle>
      <AlertDescription>
        {disclosure === "node-to-external"
          ? t(
              "If your local server is unavailable, content may be sent to {provider}.",
              {
                provider:
                  fallback.dataHandling.providerName ?? fallback.provider,
              }
            )
          : disclosure === "node-to-managed"
            ? t(
                "If your local server is unavailable, content may be processed by Avermate managed services."
              )
            : disclosure === "managed-to-external"
              ? t(
                  "If the managed route fails, content may be sent directly to {provider}.",
                  {
                    provider:
                      fallback.dataHandling.providerName ?? fallback.provider,
                  }
                )
              : escalation
                ? t(
                    "The fallback sends content across a broader data boundary."
                  )
                : t(
                    "Primary and fallback stay within an equivalent data boundary."
                  )}
      </AlertDescription>
    </Alert>
  )
}
