"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AssistantModelPreference } from "@avermate/agent-contracts"
import {
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CpuIcon,
  KeyRoundIcon,
  NetworkIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { SettingsSection } from "@/components/settings/settings-section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
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
import { orpc } from "@/lib/orpc"

function optionalPositive(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function optionalNonNegative(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function PreferenceEditor({
  preference,
  availableModels,
  pending,
  onSave,
}: {
  preference: AssistantModelPreference
  availableModels: readonly { modelKey: string; label: string }[]
  pending: boolean
  onSave: (input: {
    defaultModelKey: string | null
    route: "selected-only" | "prefer-node" | "prefer-core" | "managed-only"
    fallback: "none" | "same-provider" | "configured-routes"
    maximumInputTokens: number | null
    maximumOutputTokens: number | null
    maximumEstimatedCostMinor: number | null
    currency: string | null
    expectedRevision: number
  }) => void
}) {
  const t = useExtracted()
  const [defaultModelKey, setDefaultModelKey] = useState<string | null>(
    preference.defaultModelKey
  )
  const [route, setRoute] = useState(preference.route)
  const [fallback, setFallback] = useState(preference.fallback)
  const [maximumInputTokens, setMaximumInputTokens] = useState(
    preference.maximumInputTokens?.toString() ?? ""
  )
  const [maximumOutputTokens, setMaximumOutputTokens] = useState(
    preference.maximumOutputTokens?.toString() ?? ""
  )
  const [maximumEstimatedCostMinor, setMaximumEstimatedCostMinor] = useState(
    preference.maximumEstimatedCostMinor?.toString() ?? ""
  )
  const [currency, setCurrency] = useState(preference.currency ?? "EUR")
  const routeItems = [
    { value: "selected-only" as const, label: t("Selected model only") },
    { value: "prefer-node" as const, label: t("Prefer my Node") },
    { value: "prefer-core" as const, label: t("Prefer Avermate Core") },
    { value: "managed-only" as const, label: t("Managed service only") },
  ]
  const fallbackItems = [
    { value: "none" as const, label: t("No implicit fallback") },
    { value: "same-provider" as const, label: t("Same provider only") },
    {
      value: "configured-routes" as const,
      label: t("Explicitly configured routes"),
    },
  ]
  const modelItems = [
    { value: null, label: t("Choose for each message") },
    ...availableModels.map((model) => ({
      value: model.modelKey,
      label: model.label,
    })),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Model policy")}</CardTitle>
        <CardDescription>
          {t(
            "Placement, fallbacks and limits are persisted and frozen in each run. No provider becomes a fallback without this explicit policy."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("Default model")}</FieldLabel>
            <Select
              items={modelItems}
              value={defaultModelKey}
              onValueChange={setDefaultModelKey}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {modelItems.map((item) => (
                    <SelectItem key={item.value ?? "manual"} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>{t("Preferred placement")}</FieldLabel>
              <Select
                items={routeItems}
                value={route}
                onValueChange={(value) => value && setRoute(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {routeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t("Fallback")}</FieldLabel>
              <Select
                items={fallbackItems}
                value={fallback}
                onValueChange={(value) => value && setFallback(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {fallbackItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="assistant-max-input">
                {t("Input tokens")}
              </FieldLabel>
              <Input
                id="assistant-max-input"
                inputMode="numeric"
                min={1}
                value={maximumInputTokens}
                onChange={(event) => setMaximumInputTokens(event.target.value)}
                placeholder={t("Unlimited")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="assistant-max-output">
                {t("Output tokens")}
              </FieldLabel>
              <Input
                id="assistant-max-output"
                inputMode="numeric"
                min={1}
                value={maximumOutputTokens}
                onChange={(event) => setMaximumOutputTokens(event.target.value)}
                placeholder={t("Unlimited")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="assistant-max-cost">
                {t("Maximum cost")}
              </FieldLabel>
              <Input
                id="assistant-max-cost"
                inputMode="numeric"
                min={0}
                value={maximumEstimatedCostMinor}
                onChange={(event) =>
                  setMaximumEstimatedCostMinor(event.target.value)
                }
                placeholder={t("Minor currency unit")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="assistant-cost-currency">
                {t("Currency")}
              </FieldLabel>
              <Input
                id="assistant-cost-currency"
                value={currency}
                onChange={(event) =>
                  setCurrency(event.target.value.toUpperCase().slice(0, 3))
                }
                maxLength={3}
                placeholder="EUR"
              />
            </Field>
          </div>
          <FieldDescription>
            {t(
              "An empty limit adds no user ceiling; placement quotas still apply."
            )}
          </FieldDescription>

          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={
                pending ||
                (Boolean(maximumEstimatedCostMinor) && currency.length !== 3)
              }
              onClick={() =>
                onSave({
                  defaultModelKey,
                  route,
                  fallback,
                  maximumInputTokens: optionalPositive(maximumInputTokens),
                  maximumOutputTokens: optionalPositive(maximumOutputTokens),
                  maximumEstimatedCostMinor: optionalNonNegative(
                    maximumEstimatedCostMinor
                  ),
                  currency:
                    maximumEstimatedCostMinor.trim() && currency.length === 3
                      ? currency
                      : null,
                  expectedRevision: preference.revision,
                })
              }
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {t("Save policy")}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

export function AssistantModelSettingsSection() {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const catalogue = useQuery(orpc.assistant.models.catalogue.queryOptions())
  const preference = useQuery(
    orpc.assistant.models.preference.get.queryOptions()
  )
  const update = useMutation({
    ...orpc.assistant.models.preference.update.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.assistant.models.preference.get.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.assistant.models.list.queryKey(),
        }),
      ])
      toast.success(t("Assistant model policy saved."))
    },
    onError: (error) => toast.error(error.message),
  })

  const availableModels =
    catalogue.data?.items
      .filter((entry) => entry.available)
      .map((entry) => entry.capability) ?? []

  function modelPlacementLabel(placement: { kind: string }) {
    switch (placement.kind) {
      case "direct-byok":
        return t("Personal key · direct request")
      case "node":
        return t("Personal Node")
      case "managed":
        return t("Avermate managed service")
      case "core":
        return t("Avermate instance")
      default:
        return placement.kind
    }
  }

  return (
    <SettingsSection
      id="assistant-models"
      icon={BotIcon}
      title={t("Assistant models and routing")}
      description={t(
        "Inspect each exact model placement, select explicit fallbacks and set token or spend ceilings for new assistant runs."
      )}
    >
      {catalogue.error || preference.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{t("Model catalogue unavailable")}</AlertTitle>
          <AlertDescription>
            {catalogue.error?.message ?? preference.error?.message}
          </AlertDescription>
        </Alert>
      ) : null}

      {catalogue.isPending ? (
        <div
          className="grid gap-3 md:grid-cols-2"
          role="status"
          aria-label={t("Loading model catalogue")}
        >
          <Skeleton className="h-52" />
          <Skeleton className="h-52" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {catalogue.data?.items.map((entry) => (
            <Card key={entry.routeKey} size="sm">
              <CardHeader>
                <CardTitle>{entry.capability.label}</CardTitle>
                <CardDescription>
                  {typeof entry.capability.contextTokens === "number"
                    ? format.number(entry.capability.contextTokens)
                    : "?"}{" "}
                  {t("context tokens")} ·{" "}
                  {typeof entry.capability.maxOutputTokens === "number"
                    ? format.number(entry.capability.maxOutputTokens)
                    : "?"}{" "}
                  {t("maximum output")}
                </CardDescription>
                <CardAction>
                  <Badge variant={entry.available ? "default" : "outline"}>
                    {entry.available ? t("Available") : t("Unavailable")}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ItemGroup className="gap-2">
                  <Item size="xs" variant="muted">
                    <ItemMedia variant="icon">
                      <CpuIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {modelPlacementLabel(entry.placement)}
                      </ItemTitle>
                      <ItemDescription>
                        {entry.capability.providerKey} · {t("model")}{" "}
                        {entry.modelRevision}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                  <Item size="xs" variant="muted">
                    <ItemMedia variant="icon">
                      {entry.capability.contentLeavesPlacement ? (
                        <NetworkIcon />
                      ) : (
                        <ShieldCheckIcon />
                      )}
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {entry.capability.contentLeavesPlacement
                          ? t("Selected context leaves this placement")
                          : t("Context stays within this placement")}
                      </ItemTitle>
                      <ItemDescription>
                        {entry.available
                          ? t("Route {route}", { route: entry.routeKey })
                          : t("Reason: {reason}", {
                              reason: entry.unavailableReason ?? t("unknown"),
                            })}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </ItemGroup>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!availableModels.length && !catalogue.isPending ? (
        <Alert>
          <KeyRoundIcon />
          <AlertTitle>{t("No production model is ready")}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {t(
              "Add a personal provider key or pair an Avermate Node to use a production model. Existing conversations remain readable."
            )}
            <Button
              size="sm"
              variant="outline"
              render={<Link href="/settings/integrations#ai-keys" />}
            >
              <KeyRoundIcon data-icon="inline-start" />
              {t("Configure keys")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {preference.isPending ? (
        <Skeleton className="h-96" />
      ) : preference.data ? (
        <PreferenceEditor
          key={preference.data.revision}
          preference={preference.data}
          availableModels={availableModels}
          pending={update.isPending}
          onSave={(input) => update.mutate(input)}
        />
      ) : null}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2Icon className="size-3.5" />
        {t(
          "Each run preserves the model, provider, policy, tool catalogue and context manifest revisions."
        )}
      </p>
    </SettingsSection>
  )
}
