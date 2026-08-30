"use client"

import { useState } from "react"
import type {
  ProviderConnectionPublicSnapshot,
  ProviderPluginManifest,
} from "@avermate/agent-contracts"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PencilIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useProcessingLabels } from "./processing-labels"
import { orpc } from "@/lib/orpc"

type PublicValue = string | number | boolean

function scalarConfiguration(config: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(config).filter(
      (entry): entry is [string, PublicValue] =>
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean"
    )
  )
}

export function ConnectionEditor({
  connection,
  plugin,
}: {
  connection: ProviderConnectionPublicSnapshot
  plugin: ProviderPluginManifest
}) {
  const t = useExtracted()
  const processingLabel = useProcessingLabels()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState(connection.displayName)
  const [configuration, setConfiguration] = useState<
    Record<string, PublicValue>
  >(() => scalarConfiguration(connection.config))
  const [secrets, setSecrets] = useState<Record<string, string>>({})

  const setDialogOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setDisplayName(connection.displayName)
      setConfiguration(scalarConfiguration(connection.config))
      setSecrets({})
    }
    setOpen(nextOpen)
  }

  const update = useMutation({
    ...orpc.capabilities.connections.update.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.capabilities.connections.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.capabilities.offerings.list.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.capabilities.readiness.key(),
        }),
      ])
      setSecrets({})
      setOpen(false)
      toast.success(t("Connection updated. Validate it before discovery."))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const requiredReady = plugin.configurationFields.every(
    (field) =>
      !field.required ||
      (configuration[field.key] !== undefined &&
        configuration[field.key] !== "")
  )

  return (
    <Dialog open={open} onOpenChange={setDialogOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <PencilIcon data-icon="inline-start" />
        {t("Edit")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" closeLabel={t("Close")}>
        <DialogHeader>
          <DialogTitle>{t("Edit provider connection")}</DialogTitle>
          <DialogDescription>
            {t(
              "Saving creates a new revision and returns the connection to draft. Blank secret fields keep their current value."
            )}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`connection-name-${connection.id}`}>
              {t("Connection name")}
            </FieldLabel>
            <Input
              id={`connection-name-${connection.id}`}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>

          {plugin.configurationFields.map((field) => (
            <Field key={field.key}>
              <FieldLabel
                htmlFor={`connection-config-${connection.id}-${field.key}`}
              >
                {processingLabel(field.label)}
                {field.required ? " *" : ""}
              </FieldLabel>
              {field.kind === "select" && field.options.length > 0 ? (
                <Select
                  value={String(configuration[field.key] ?? "")}
                  onValueChange={(value) =>
                    value &&
                    setConfiguration((current) => ({
                      ...current,
                      [field.key]: value,
                    }))
                  }
                >
                  <SelectTrigger
                    id={`connection-config-${connection.id}-${field.key}`}
                    className="w-full"
                  >
                    <SelectValue placeholder={field.placeholder ?? undefined} />
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
                  id={`connection-config-${connection.id}-${field.key}`}
                  checked={Boolean(configuration[field.key])}
                  onCheckedChange={(checked) =>
                    setConfiguration((current) => ({
                      ...current,
                      [field.key]: checked,
                    }))
                  }
                />
              ) : (
                <Input
                  id={`connection-config-${connection.id}-${field.key}`}
                  type={
                    field.kind === "number"
                      ? "number"
                      : field.kind === "url"
                        ? "url"
                        : "text"
                  }
                  value={String(configuration[field.key] ?? "")}
                  placeholder={field.placeholder ?? undefined}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      [field.key]:
                        field.kind === "number"
                          ? Number(event.target.value)
                          : event.target.value,
                    }))
                  }
                />
              )}
              <FieldDescription>{processingLabel(field.help)}</FieldDescription>
            </Field>
          ))}

          {plugin.secretSlots.map((slot) => (
            <Field key={slot.name}>
              <FieldLabel
                htmlFor={`connection-secret-${connection.id}-${slot.name}`}
              >
                {t("Rotate {slot}", { slot: slot.name })}
              </FieldLabel>
              <Input
                id={`connection-secret-${connection.id}-${slot.name}`}
                type="password"
                autoComplete="off"
                value={secrets[slot.name] ?? ""}
                placeholder={t("Leave blank to keep the current secret")}
                onChange={(event) =>
                  setSecrets((current) => ({
                    ...current,
                    [slot.name]: event.target.value,
                  }))
                }
              />
              <FieldDescription>
                {t(
                  "The old credential version is never returned to this form."
                )}
              </FieldDescription>
            </Field>
          ))}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={update.isPending || !displayName.trim() || !requiredReady}
            onClick={() =>
              update.mutate({
                connectionId: connection.id,
                expectedRevision: connection.revision,
                displayName: displayName.trim(),
                configVersion: 1,
                config: configuration,
                secrets: plugin.secretSlots.flatMap((slot) => {
                  const value = secrets[slot.name]?.trim()
                  return value ? [{ slot: slot.name, value }] : []
                }),
              })
            }
          >
            {t("Save new revision")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
