"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BrainCircuitIcon,
  KeyRoundIcon,
  Mic2Icon,
  RefreshCwIcon,
  ScanTextIcon,
  SparklesIcon,
  Trash2Icon,
  Volume2Icon,
} from "lucide-react"
import { useExtracted } from "next-intl"
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
  CardFooter,
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
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"

const CREDENTIALS = [
  {
    id: "mistral",
    kind: "mistral",
    provider: "mistral",
    icon: ScanTextIcon,
    scopes: ["ocr", "tts"],
  },
  {
    id: "mistral-transcription",
    kind: "transcription",
    provider: "mistral",
    icon: Mic2Icon,
    scopes: ["speech-to-text"],
  },
  {
    id: "openai-inference",
    kind: "inference",
    provider: "openai",
    icon: SparklesIcon,
    scopes: ["chat", "structured-generation"],
  },
  {
    id: "openrouter",
    kind: "inference",
    provider: "openrouter",
    icon: BrainCircuitIcon,
    scopes: ["chat", "structured-generation"],
  },
  {
    id: "gemini",
    kind: "inference",
    provider: "gemini",
    icon: BrainCircuitIcon,
    scopes: ["embedding:multimodal"],
  },
  {
    id: "cohere",
    kind: "inference",
    provider: "cohere",
    icon: RefreshCwIcon,
    scopes: ["rerank"],
  },
  {
    id: "elevenlabs",
    kind: "inference",
    provider: "elevenlabs",
    icon: Volume2Icon,
    scopes: ["text-to-speech"],
  },
] as const

type Credential = (typeof CREDENTIALS)[number]
type CredentialId = Credential["id"]

function dateLabel(value: Date | null) {
  if (!value) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

export function ServiceKeysSection() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const keys = useQuery(orpc.serviceKeys.metadata.queryOptions())
  const [drafts, setDrafts] = useState<Record<CredentialId, string>>(
    () =>
      Object.fromEntries(
        CREDENTIALS.map((credential) => [credential.id, ""])
      ) as Record<CredentialId, string>
  )
  const [busyId, setBusyId] = useState<CredentialId | "legacy" | null>(null)
  const copy: Record<
    CredentialId,
    { label: string; description: string; placeholder: string }
  > = {
    mistral: {
      label: "Mistral",
      description: t("OCR, document transcription and Mistral voices."),
      placeholder: t("Paste a Mistral API key"),
    },
    "mistral-transcription": {
      label: t("Mistral — transcription"),
      description: t("Lecture transcription and message dictation."),
      placeholder: t("Paste a Mistral API key"),
    },
    "openai-inference": {
      label: t("OpenAI — models"),
      description: t("Chat, structured generation and learning tools."),
      placeholder: t("Paste an OpenAI API key"),
    },
    openrouter: {
      label: "OpenRouter",
      description: t("Multi-model catalogue with explicit routing."),
      placeholder: t("Paste an OpenRouter API key"),
    },
    gemini: {
      label: "Gemini Embedding 2",
      description: t("Multimodal embeddings for text, PDF pages and images."),
      placeholder: t("Paste a Google AI Studio API key"),
    },
    cohere: {
      label: "Cohere Rerank",
      description: t("Cross-encoder reranking for search results."),
      placeholder: t("Paste a Cohere API key"),
    },
    elevenlabs: {
      label: "ElevenLabs",
      description: t("Optional voices for podcasts and narrated videos."),
      placeholder: t("Paste an ElevenLabs API key"),
    },
  }

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.serviceKeys.metadata.queryKey(),
    })

  const save = useMutation({
    ...orpc.serviceKeys.setValidated.mutationOptions(),
    onSuccess: async (_result, variables) => {
      const credential = CREDENTIALS.find(
        (candidate) =>
          candidate.kind === variables.kind &&
          candidate.provider === variables.provider &&
          candidate.scopes.every((scope) =>
            (variables.scopes ?? []).includes(scope)
          )
      )
      if (credential) {
        setDrafts((current) => ({ ...current, [credential.id]: "" }))
      }
      toast.success(t("API key validated and saved."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setBusyId(null),
  })
  const clear = useMutation({
    ...orpc.serviceKeys.clear.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("API key removed."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setBusyId(null),
  })

  const unmanagedLegacy = useMemo(
    () =>
      (keys.data ?? []).filter(
        (metadata) =>
          !CREDENTIALS.some(
            (credential) =>
              credential.kind === metadata.kind &&
              credential.provider === metadata.provider
          )
      ),
    [keys.data]
  )

  function submit(event: FormEvent<HTMLFormElement>, credential: Credential) {
    event.preventDefault()
    const key = drafts[credential.id].trim()
    if (!key) return
    setBusyId(credential.id)
    save.mutate({
      kind: credential.kind,
      provider: credential.provider,
      key,
      scopes: [...credential.scopes],
    })
  }

  return (
    <SettingsSection
      id="ai-keys"
      icon={KeyRoundIcon}
      title={t("AI provider keys")}
      description={t(
        "Each key is validated once, encrypted on the server and scoped to one capability. Secret values are never returned to the browser."
      )}
    >
      {keys.error ? (
        <Alert variant="destructive">
          <AlertTitle>{t("Provider keys are unavailable")}</AlertTitle>
          <AlertDescription>{keys.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-3 @3xl/main:grid-cols-2">
        {CREDENTIALS.map((credential) => {
          const stored = keys.data?.find(
            (entry) =>
              entry.kind === credential.kind &&
              entry.provider === credential.provider
          )
          const fieldId = `service-key-${credential.id}`
          const pending = busyId === credential.id
          const Icon = credential.icon
          return (
            <Card key={credential.id} size="sm">
              <form onSubmit={(event) => submit(event, credential)}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="text-muted-foreground" />
                    {copy[credential.id].label}
                  </CardTitle>
                  <CardDescription>
                    {copy[credential.id].description}
                  </CardDescription>
                  <CardAction>
                    {keys.isPending ? (
                      <Spinner />
                    ) : stored ? (
                      <Badge
                        variant={
                          stored.status === "active"
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {stored.status === "active"
                          ? t("Validated · ending in {hint}", {
                              hint: stored.hint,
                            })
                          : t("Key {status}", { status: stored.status })}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t("Not configured")}</Badge>
                    )}
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={fieldId}>
                        {stored ? t("Replace the key") : t("API key")}
                      </FieldLabel>
                      <Input
                        id={fieldId}
                        type="password"
                        autoComplete="new-password"
                        value={drafts[credential.id]}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [credential.id]: event.target.value,
                          }))
                        }
                        placeholder={copy[credential.id].placeholder}
                        disabled={Boolean(busyId)}
                        maxLength={4096}
                      />
                      <FieldDescription>
                        {stored?.lastValidatedAt
                          ? t("Last validated: {date}. Version {version}.", {
                              date: dateLabel(stored.lastValidatedAt) ?? "—",
                              version: String(stored.keyVersion),
                            })
                          : t(
                              "The key is checked with a minimal provider request before storage."
                            )}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                </CardContent>
                <CardFooter className="justify-end gap-2">
                  {stored ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={Boolean(busyId)}
                      onClick={() => {
                        setBusyId(credential.id)
                        clear.mutate({
                          kind: credential.kind,
                          provider: credential.provider,
                        })
                      }}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      {t("Remove")}
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    size="sm"
                    disabled={Boolean(busyId) || !drafts[credential.id].trim()}
                  >
                    {pending ? <Spinner data-icon="inline-start" /> : null}
                    {stored
                      ? t("Validate and replace")
                      : t("Validate and save")}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          )
        })}
      </div>

      {unmanagedLegacy.length ? (
        <Alert>
          <AlertTitle>{t("Legacy provider keys detected")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              {t(
                "Replace these generic credentials with one of the validated provider cards above, then remove the legacy entries."
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {unmanagedLegacy.map((entry) => (
                <Button
                  key={`${entry.kind}:${entry.provider}`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busyId)}
                  onClick={() => {
                    setBusyId("legacy")
                    clear.mutate({
                      kind: entry.kind,
                      provider: entry.provider,
                    })
                  }}
                >
                  <Trash2Icon data-icon="inline-start" />
                  {t("Remove legacy {kind} key", { kind: entry.kind })}
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          "Operator-paid credentials are never an implicit production fallback. Managed routing requires an explicit metered placement and consent."
        )}
      </p>
    </SettingsSection>
  )
}
