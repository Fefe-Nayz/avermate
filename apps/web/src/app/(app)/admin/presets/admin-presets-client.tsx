"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FileClockIcon,
  PlusIcon,
  SaveIcon,
  UsersIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { TextField } from "@/components/forms/controls"
import {
  PresetVisualEditor,
  type PresetEditorConfiguration,
  type PresetEditorSubject,
} from "@/components/admin/preset-visual-editor"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"

const emptyConfiguration = {
  subjects: [
    {
      key: "first-subject",
      name: "First subject",
      kind: "subject",
      isMain: true,
      coefficient: 1,
      children: [],
    },
  ],
  averages: [],
}

interface Draft {
  name: string
  description: string
  tags: string
  featured: boolean
  configuration: string
  changeNote: string
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function parseConfiguration(value: string): PresetEditorConfiguration {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== "object")
    throw new Error("Configuration must be an object")
  return parsed as PresetEditorConfiguration
}

function configurationDiff(
  previous: PresetEditorConfiguration,
  next: PresetEditorConfiguration
) {
  const flatten = (
    nodes: readonly PresetEditorSubject[],
    parentKey: string | null = null,
    output = new Map<string, unknown>()
  ) => {
    nodes.forEach((node, sortOrder) => {
      output.set(node.key, {
        name: node.name,
        shortName: node.shortName ?? null,
        kind: node.kind,
        isMain: node.isMain,
        coefficient: node.coefficient,
        parentKey,
        sortOrder,
      })
      flatten(node.children, node.key, output)
    })
    return output
  }
  const fromSubjects = flatten(previous.subjects)
  const toSubjects = flatten(next.subjects)
  const fromAverages = new Map(
    previous.averages.map((average) => [average.key, average])
  )
  const toAverages = new Map(
    next.averages.map((average) => [average.key, average])
  )
  return {
    added: [...toSubjects.keys()].filter((key) => !fromSubjects.has(key))
      .length,
    changed: [...toSubjects].filter(
      ([key, value]) =>
        fromSubjects.has(key) &&
        JSON.stringify(fromSubjects.get(key)) !== JSON.stringify(value)
    ).length,
    removed: [...fromSubjects.keys()].filter((key) => !toSubjects.has(key))
      .length,
    averagesChanged: [
      ...new Set([...fromAverages.keys(), ...toAverages.keys()]),
    ].filter(
      (key) =>
        JSON.stringify(fromAverages.get(key)) !==
        JSON.stringify(toAverages.get(key))
    ).length,
  }
}

export function AdminPresetsClient({
  initialPresetId,
}: {
  initialPresetId: string | null
}) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(initialPresetId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sourceVersion, setSourceVersion] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [newId, setNewId] = useState("")
  const [newDraft, setNewDraft] = useState<Draft>({
    name: "",
    description: "",
    tags: "",
    featured: false,
    configuration: pretty(emptyConfiguration),
    changeNote: "",
  })

  const list = useQuery(orpc.presets.admin.list.queryOptions())
  const detail = useQuery({
    ...orpc.presets.admin.get.queryOptions({
      input: { presetId: selectedId ?? "" },
    }),
    enabled: Boolean(selectedId),
  })
  const current = detail.data
  const currentVersion = current?.versions.find(
    (version) => version.version === current.currentVersion
  )

  if (current && currentVersion && sourceVersion !== currentVersion.version) {
    setDraft({
      name: current.name,
      description: current.description,
      tags: current.tags.join(", "),
      featured: current.featured,
      configuration: pretty(currentVersion.configuration),
      changeNote: "",
    })
    setSourceVersion(currentVersion.version)
  }

  const selectedSummary = useMemo(
    () => list.data?.find((preset) => preset.id === selectedId),
    [list.data, selectedId]
  )
  const parsedDraft = useMemo(() => {
    if (!draft) return { value: null, error: null }
    try {
      return { value: parseConfiguration(draft.configuration), error: null }
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Invalid configuration",
      }
    }
  }, [draft])
  const parsedNewDraft = useMemo(() => {
    try {
      return { value: parseConfiguration(newDraft.configuration), error: null }
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "Invalid configuration",
      }
    }
  }, [newDraft.configuration])
  const diff = useMemo(() => {
    if (!parsedDraft.value || !currentVersion) return null
    return configurationDiff(
      currentVersion.configuration as PresetEditorConfiguration,
      parsedDraft.value
    )
  }, [currentVersion, parsedDraft.value])
  const tags = (value: string) =>
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)

  const invalidate = async (presetId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.presets.admin.list.key(),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.presets.list.key() }),
      ...(presetId
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.presets.admin.get.queryKey({
                input: { presetId },
              }),
            }),
          ]
        : []),
    ])
  }

  const publish = useMutation({
    ...orpc.presets.admin.publish.mutationOptions(),
    onSuccess: async (_, variables) => {
      haptic("success")
      toast.success(t("Preset version published."))
      setSourceVersion(null)
      await invalidate(variables.presetId)
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message)
    },
  })
  const create = useMutation({
    ...orpc.presets.admin.create.mutationOptions(),
    onSuccess: async (created) => {
      haptic("success")
      toast.success(t("Preset created."))
      setCreating(false)
      if (created) setSelectedId(created.id)
      setSourceVersion(null)
      await invalidate(created?.id)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const archive = useMutation({
    ...orpc.presets.admin.archive.mutationOptions(),
    onSuccess: async (_, variables) => {
      toast.success(
        variables.archived ? t("Preset archived.") : t("Preset restored.")
      )
      await invalidate(variables.presetId)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const publishDraft = () => {
    if (!selectedId || !draft) return
    try {
      publish.mutate({
        presetId: selectedId,
        name: draft.name.trim(),
        description: draft.description.trim(),
        tags: tags(draft.tags),
        featured: draft.featured,
        changeNote: draft.changeNote.trim(),
        configuration: parseConfiguration(draft.configuration),
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("Invalid JSON configuration.")
      )
    }
  }

  return (
    <>
      <PageMeta title={t("Managed presets")} backHref="/admin" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Managed presets")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Publish versioned curriculum updates without overwriting years that students customized."
              )}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon className="size-4" /> {t("New preset")}
          </Button>
        </div>

        <div className="grid gap-4 @3xl/main:grid-cols-[18rem_1fr]">
          <SettingsSection title={t("Preset catalogue")}>
            <div className="flex flex-col gap-1">
              {list.data?.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    selectedId === preset.id
                      ? "border-primary bg-primary/6"
                      : "hover:bg-accent/50"
                  )}
                  onClick={() => {
                    setSelectedId(preset.id)
                    setSourceVersion(null)
                  }}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className="min-w-0 flex-1 truncate">
                      {preset.name}
                    </span>
                    <Badge variant={preset.archived ? "outline" : "secondary"}>
                      v{preset.currentVersion}
                    </Badge>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("{linked} linked · {customized} customized", {
                      linked: String(preset.adoption.linked),
                      customized: String(preset.adoption.customized),
                    })}
                  </span>
                  {preset.adoption.updateAvailable > 0 ? (
                    <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-300">
                      {t("{count} updates available", {
                        count: String(preset.adoption.updateAvailable),
                      })}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </SettingsSection>

          {draft && current ? (
            <div className="flex min-w-0 flex-col gap-4">
              <SettingsSection
                title={t("Publish version {version}", {
                  version: String(current.currentVersion + 1),
                })}
                description={t(
                  "Keys identify nodes across versions. Keep a key unchanged when renaming or moving the same subject."
                )}
                footer={
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={archive.isPending}
                      onClick={() =>
                        archive.mutate({
                          presetId: current.id,
                          archived: !current.archived,
                        })
                      }
                    >
                      {current.archived ? (
                        <ArchiveRestoreIcon className="size-4" />
                      ) : (
                        <ArchiveIcon className="size-4" />
                      )}
                      {current.archived ? t("Restore") : t("Archive")}
                    </Button>
                    <Button
                      className="ml-auto"
                      size="sm"
                      disabled={
                        publish.isPending ||
                        !draft.name.trim() ||
                        !draft.changeNote.trim()
                      }
                      onClick={publishDraft}
                    >
                      {publish.isPending ? (
                        <Spinner className="size-4" />
                      ) : (
                        <SaveIcon className="size-4" />
                      )}
                      {t("Publish new version")}
                    </Button>
                  </>
                }
              >
                <div className="grid gap-3 @xl/main:grid-cols-2">
                  <TextField
                    label={t("Name")}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft(
                        (value) =>
                          value && { ...value, name: event.target.value }
                      )
                    }
                  />
                  <TextField
                    label={t("Tags")}
                    description={t("Separate tags with commas.")}
                    value={draft.tags}
                    onChange={(event) =>
                      setDraft(
                        (value) =>
                          value && { ...value, tags: event.target.value }
                      )
                    }
                  />
                </div>
                <Field>
                  <FieldLabel>{t("Description")}</FieldLabel>
                  <Textarea
                    value={draft.description}
                    onChange={(event) =>
                      setDraft(
                        (value) =>
                          value && { ...value, description: event.target.value }
                      )
                    }
                  />
                </Field>
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span>
                    <span className="block font-medium">{t("Featured")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("Highlight this preset during onboarding.")}
                    </span>
                  </span>
                  <Switch
                    checked={draft.featured}
                    onCheckedChange={(featured) =>
                      setDraft((value) => value && { ...value, featured })
                    }
                  />
                </label>
                {parsedDraft.value ? (
                  <>
                    {diff ? (
                      <div className="grid grid-cols-2 gap-2 @xl/main:grid-cols-4">
                        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                          <span className="numeric block font-semibold">
                            +{diff.added}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("Subjects added")}
                          </span>
                        </div>
                        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                          <span className="numeric block font-semibold">
                            {diff.changed}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("Subjects changed")}
                          </span>
                        </div>
                        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                          <span className="numeric block font-semibold">
                            −{diff.removed}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("Subjects removed")}
                          </span>
                        </div>
                        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                          <span className="numeric block font-semibold">
                            {diff.averagesChanged}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t("Averages changed")}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    <PresetVisualEditor
                      value={parsedDraft.value}
                      onChange={(configuration) =>
                        setDraft(
                          (value) =>
                            value && {
                              ...value,
                              configuration: pretty(configuration),
                            }
                        )
                      }
                    />
                    <details className="rounded-lg border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t("Advanced JSON editor")}
                      </summary>
                      <Field className="mt-3">
                        <FieldLabel>{t("Raw configuration")}</FieldLabel>
                        <Textarea
                          className="min-h-80 font-mono text-xs"
                          spellCheck={false}
                          value={draft.configuration}
                          onChange={(event) =>
                            setDraft(
                              (value) =>
                                value && {
                                  ...value,
                                  configuration: event.target.value,
                                }
                            )
                          }
                        />
                        <FieldDescription>
                          {t(
                            "The server validates unique stable keys, hierarchy, coefficients and average references before publishing."
                          )}
                        </FieldDescription>
                      </Field>
                    </details>
                  </>
                ) : (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <p className="font-medium">
                      {t("The advanced JSON is invalid.")}
                    </p>
                    <p className="mt-1 text-xs">{parsedDraft.error}</p>
                    <Textarea
                      className="mt-3 min-h-80 font-mono text-xs"
                      value={draft.configuration}
                      onChange={(event) =>
                        setDraft(
                          (value) =>
                            value && {
                              ...value,
                              configuration: event.target.value,
                            }
                        )
                      }
                    />
                  </div>
                )}
                <TextField
                  label={t("What changed?")}
                  description={t(
                    "Students use this note to understand the update."
                  )}
                  value={draft.changeNote}
                  onChange={(event) =>
                    setDraft(
                      (value) =>
                        value && { ...value, changeNote: event.target.value }
                    )
                  }
                />
              </SettingsSection>

              <SettingsSection title={t("Version history")}>
                <ul className="divide-y">
                  {[...current.versions].reverse().map((version) => (
                    <li
                      key={version.id}
                      className="flex items-start gap-3 py-3 first:pt-0"
                    >
                      <FileClockIcon className="mt-0.5 size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {t("Version {version}", {
                            version: String(version.version),
                          })}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {version.changeNote}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format.dateTime(new Date(version.createdAt), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </SettingsSection>
            </div>
          ) : detail.isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner className="size-6" />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t("Create a preset to publish its first version.")}
            </div>
          )}
        </div>

        {selectedSummary ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UsersIcon className="size-4" />
            {t(
              "Adoption is counted per school year, never per browser session."
            )}
          </div>
        ) : null}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("New managed preset")}</DialogTitle>
            <DialogDescription>
              {t(
                "Start with one stable subject, then publish richer versions at any time."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <TextField
              label={t("Stable ID")}
              description={t(
                "Letters, numbers, underscores and hyphens. This cannot change later."
              )}
              value={newId}
              onChange={(event) => setNewId(event.target.value)}
            />
            <TextField
              label={t("Name")}
              value={newDraft.name}
              onChange={(event) =>
                setNewDraft((value) => ({ ...value, name: event.target.value }))
              }
            />
            <TextField
              label={t("Tags")}
              value={newDraft.tags}
              onChange={(event) =>
                setNewDraft((value) => ({ ...value, tags: event.target.value }))
              }
            />
            <Field>
              <FieldLabel>{t("Description")}</FieldLabel>
              <Textarea
                value={newDraft.description}
                onChange={(event) =>
                  setNewDraft((value) => ({
                    ...value,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
            {parsedNewDraft.value ? (
              <PresetVisualEditor
                value={parsedNewDraft.value}
                onChange={(configuration) =>
                  setNewDraft((value) => ({
                    ...value,
                    configuration: pretty(configuration),
                  }))
                }
              />
            ) : (
              <div className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                {parsedNewDraft.error}
              </div>
            )}
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("Advanced JSON editor")}
              </summary>
              <Textarea
                className="mt-3 min-h-72 font-mono text-xs"
                spellCheck={false}
                value={newDraft.configuration}
                onChange={(event) =>
                  setNewDraft((value) => ({
                    ...value,
                    configuration: event.target.value,
                  }))
                }
              />
            </details>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={
                create.isPending || !newId.trim() || !newDraft.name.trim()
              }
              onClick={() => {
                try {
                  create.mutate({
                    id: newId.trim(),
                    name: newDraft.name.trim(),
                    description: newDraft.description.trim(),
                    tags: tags(newDraft.tags),
                    featured: newDraft.featured,
                    configuration: parseConfiguration(newDraft.configuration),
                  })
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t("Invalid JSON configuration.")
                  )
                }
              }}
            >
              {create.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <PlusIcon className="size-4" />
              )}
              {t("Create preset")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
