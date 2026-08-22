"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRoundIcon, Trash2Icon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SettingsSection } from "@/components/settings/settings-section"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { orpc } from "@/lib/orpc"

const SERVICES = ["mistral", "transcription", "inference"] as const
type ServiceKind = (typeof SERVICES)[number]

export function ServiceKeysSection() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const keys = useQuery(orpc.serviceKeys.list.queryOptions())
  const [drafts, setDrafts] = useState<Record<ServiceKind, string>>({
    mistral: "",
    transcription: "",
    inference: "",
  })

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.serviceKeys.list.queryKey(),
    })

  const save = useMutation({
    ...orpc.serviceKeys.set.mutationOptions(),
    onSuccess: async (_result, variables) => {
      setDrafts((current) => ({ ...current, [variables.kind]: "" }))
      toast.success(t("API key saved."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const clear = useMutation({
    ...orpc.serviceKeys.clear.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("API key removed."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const busy = save.isPending || clear.isPending

  const copy: Record<
    ServiceKind,
    { label: string; description: string; placeholder: string }
  > = {
    mistral: {
      label: t("Mistral OCR & podcasts"),
      description: t(
        "Extract searchable text and generate narrated podcasts from your sheets and notes."
      ),
      placeholder: t("Paste a Mistral API key"),
    },
    transcription: {
      label: t("Transcription"),
      description: t("Turn recorded lectures into searchable notes."),
      placeholder: t("Paste a transcription API key"),
    },
    inference: {
      label: t("AI inference"),
      description: t("Reserved for future model-powered study tools."),
      placeholder: t("Paste an inference API key"),
    },
  }

  function submit(event: FormEvent<HTMLFormElement>, kind: ServiceKind) {
    event.preventDefault()
    const key = drafts[kind].trim()
    if (!key) return
    save.mutate({ kind, key })
  }

  return (
    <SettingsSection
      id="ai-keys"
      icon={KeyRoundIcon}
      title={t("My API keys")}
      description={t(
        "Your keys are encrypted on the server and used only for your requests. They are never shown again or sent to the browser."
      )}
    >
      <div className="divide-y">
        {SERVICES.map((kind) => {
          const stored = keys.data?.find((entry) => entry.kind === kind)
          const fieldId = `service-key-${kind}`
          return (
            <form
              key={kind}
              className="grid gap-3 py-4 first:pt-0 last:pb-0 @lg/main:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)] @lg/main:items-end"
              onSubmit={(event) => submit(event, kind)}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={fieldId}>{copy[kind].label}</Label>
                  {stored ? (
                    <Badge
                      variant={
                        stored.status === "invalid"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {stored.status === "invalid"
                        ? t("Key rejected")
                        : t("Saved · ending in {hint}", { hint: stored.hint })}
                    </Badge>
                  ) : null}
                </div>
                <p
                  id={`${fieldId}-description`}
                  className="mt-1 text-xs leading-relaxed text-muted-foreground"
                >
                  {copy[kind].description}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <Input
                  id={fieldId}
                  type="password"
                  autoComplete="new-password"
                  aria-describedby={`${fieldId}-description`}
                  value={drafts[kind]}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [kind]: event.target.value,
                    }))
                  }
                  placeholder={
                    stored ? t("Replace the saved key") : copy[kind].placeholder
                  }
                  disabled={busy}
                  maxLength={4096}
                />
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="submit"
                    disabled={busy || !drafts[kind].trim()}
                    className="flex-1 sm:flex-none"
                  >
                    {stored ? t("Replace") : t("Save")}
                  </Button>
                  {stored ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={t("Remove {service} key", {
                        service: copy[kind].label,
                      })}
                      disabled={busy}
                      onClick={() => {
                        clear.mutate({ kind })
                      }}
                    >
                      <Trash2Icon />
                      <span className="sm:sr-only">{t("Remove")}</span>
                    </Button>
                  ) : null}
                </div>
              </div>
            </form>
          )
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          "When no personal key is saved, the instance may use an operator-provided key if one is available."
        )}
      </p>
    </SettingsSection>
  )
}
