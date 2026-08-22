"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CodeIcon,
  FileClockIcon,
  LayersIcon,
  PlusIcon,
  SaveIcon,
  ScrollTextIcon,
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
import { ChangeSummary, VersionBadge } from "@/components/presets/preset-ui"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"

const EMPTY_CONFIGURATION: PresetEditorConfiguration = {
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
  gradeTypes: [],
}

/**
 * A draft holds the *parsed* configuration.
 *
 * It used to hold a JSON string, re-parsed on every keystroke, with the visual
 * editor serialising back into it. So the ordinary path — typing a subject
 * name — ran through `JSON.parse`, and the screen carried a permanent "the
 * advanced JSON is invalid" branch with a second copy of the editor inside it,
 * for a state the visual editor cannot produce. The raw text now exists only
 * inside the advanced tab, and is applied deliberately.
 */
interface Draft {
  name: string
  description: string
  tags: string
  featured: boolean
  configuration: PresetEditorConfiguration
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
  const fromTypes = new Map(
    (previous.gradeTypes ?? []).map((type) => [type.key, type])
  )
  const toTypes = new Map(
    (next.gradeTypes ?? []).map((type) => [type.key, type])
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
    gradeTypesChanged: [
      ...new Set([...fromTypes.keys(), ...toTypes.keys()]),
    ].filter(
      (key) =>
        JSON.stringify(fromTypes.get(key)) !== JSON.stringify(toTypes.get(key))
    ).length,
  }
}

/**
 * Managed presets.
 *
 * A catalogue on the left and one preset on the right, split across tabs —
 * identity, structure, history. It was a single column that scrolled through
 * all three plus a raw JSON textarea, headed "Publish version 2", which named
 * the button rather than the thing being edited.
 */
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
    configuration: EMPTY_CONFIGURATION,
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
      configuration: currentVersion.configuration as PresetEditorConfiguration,
      changeNote: "",
    })
    setSourceVersion(currentVersion.version)
  }

  const patch = (values: Partial<Draft>) =>
    setDraft((value) => value && { ...value, ...values })

  const diff = useMemo(() => {
    if (!draft || !currentVersion) return null
    return configurationDiff(
      currentVersion.configuration as PresetEditorConfiguration,
      draft.configuration
    )
  }, [currentVersion, draft])

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
    publish.mutate({
      presetId: selectedId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      tags: tags(draft.tags),
      featured: draft.featured,
      changeNote: draft.changeNote.trim(),
      configuration: draft.configuration,
    })
  }

  const untouched = diff
    ? diff.added === 0 &&
      diff.changed === 0 &&
      diff.removed === 0 &&
      diff.averagesChanged === 0 &&
      diff.gradeTypesChanged === 0
    : true

  return (
    <>
      <PageMeta title={t("Managed presets")} backHref="/admin" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
              <ScrollTextIcon className="size-5 text-muted-foreground" />
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

        <div className="grid gap-4 @3xl/main:grid-cols-[17rem_minmax(0,1fr)] @3xl/main:items-start">
          <nav
            aria-label={t("Preset catalogue")}
            className="flex flex-col gap-1"
          >
            {list.data?.map((preset) => {
              const selected = selectedId === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/6"
                      : "border-transparent hover:bg-accent/50"
                  )}
                  onClick={() => {
                    setSelectedId(preset.id)
                    setSourceVersion(null)
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {preset.name}
                    </span>
                    <VersionBadge version={preset.currentVersion} />
                  </span>
                  {/* Adoption is only worth a line once somebody has adopted
                      it; "0 linked · 0 customized" on every row is noise. */}
                  {preset.adoption.linked > 0 ||
                  preset.adoption.customized > 0 ? (
                    <span className="numeric text-xs text-muted-foreground">
                      {t("{linked} linked · {customized} customized", {
                        linked: String(preset.adoption.linked),
                        customized: String(preset.adoption.customized),
                      })}
                    </span>
                  ) : null}
                  {preset.adoption.updateAvailable > 0 ? (
                    <span className="w-fit rounded-full bg-caution/12 px-2 py-0.5 text-xs font-medium text-caution">
                      {t("{count} updates available", {
                        count: String(preset.adoption.updateAvailable),
                      })}
                    </span>
                  ) : null}
                  {preset.archived ? (
                    <Badge variant="outline" className="w-fit">
                      {t("Archived")}
                    </Badge>
                  ) : null}
                </button>
              )
            })}
          </nav>

          {draft && current ? (
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-tight">
                    {draft.name || current.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {untouched
                      ? t("Version {version}, unchanged", {
                          version: String(current.currentVersion),
                        })
                      : t("Publishing will create version {version}", {
                          version: String(current.currentVersion + 1),
                        })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                    {t("Publish")}
                  </Button>
                </div>
              </div>

              {diff ? (
                <ChangeSummary
                  emptyLabel={t(
                    "No structural change yet — publishing would only update the details."
                  )}
                  counts={[
                    { label: t("subjects"), value: diff.added, kind: "add" },
                    {
                      label: t("subjects changed"),
                      value: diff.changed,
                      kind: "edit",
                    },
                    {
                      label: t("subjects"),
                      value: diff.removed,
                      kind: "remove",
                    },
                    {
                      label: t("averages changed"),
                      value: diff.averagesChanged,
                      kind: "edit",
                    },
                    {
                      label: t("assessment types changed"),
                      value: diff.gradeTypesChanged,
                      kind: "edit",
                    },
                  ]}
                />
              ) : null}

              <Tabs defaultValue="structure" className="gap-4">
                <TabsList className="w-full overflow-x-auto @lg/main:w-fit">
                  <TabsTrigger value="structure">
                    <LayersIcon /> {t("Structure")}
                  </TabsTrigger>
                  <TabsTrigger value="details">
                    <ScrollTextIcon /> {t("Details")}
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    <FileClockIcon /> {t("History")}
                  </TabsTrigger>
                  <TabsTrigger value="raw">
                    <CodeIcon /> {t("JSON")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="structure">
                  <SettingsSection
                    icon={LayersIcon}
                    title={t("What this version contains")}
                    description={t(
                      "Names, hierarchy, order and coefficients are versioned together."
                    )}
                    footer={
                      <TextField
                        className="w-full"
                        label={t("What changed?")}
                        description={t(
                          "Students read this note before accepting the update."
                        )}
                        value={draft.changeNote}
                        onChange={(event) =>
                          patch({ changeNote: event.target.value })
                        }
                      />
                    }
                  >
                    <PresetVisualEditor
                      value={draft.configuration}
                      onChange={(configuration) => patch({ configuration })}
                    />
                  </SettingsSection>
                </TabsContent>

                <TabsContent value="details">
                  <SettingsSection
                    icon={ScrollTextIcon}
                    title={t("How it appears during onboarding")}
                  >
                    <div className="grid gap-3 @xl/main:grid-cols-2">
                      <TextField
                        label={t("Name")}
                        value={draft.name}
                        onChange={(event) =>
                          patch({ name: event.target.value })
                        }
                      />
                      <TextField
                        label={t("Tags")}
                        description={t("Separate tags with commas.")}
                        value={draft.tags}
                        onChange={(event) =>
                          patch({ tags: event.target.value })
                        }
                      />
                    </div>
                    <Field>
                      <FieldLabel>{t("Description")}</FieldLabel>
                      <Textarea
                        rows={3}
                        value={draft.description}
                        onChange={(event) =>
                          patch({ description: event.target.value })
                        }
                      />
                    </Field>
                    <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                      <span>
                        <span className="block font-medium">
                          {t("Featured")}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("Highlight this preset during onboarding.")}
                        </span>
                      </span>
                      <Switch
                        checked={draft.featured}
                        onCheckedChange={(featured) => patch({ featured })}
                      />
                    </label>
                  </SettingsSection>
                </TabsContent>

                <TabsContent value="history">
                  <SettingsSection
                    icon={FileClockIcon}
                    title={t("Version history")}
                    description={t(
                      "Adoption is counted per school year, never per browser session."
                    )}
                  >
                    <ul className="divide-y">
                      {[...current.versions].reverse().map((version) => (
                        <li
                          key={version.id}
                          className="flex items-start gap-3 py-3"
                        >
                          <VersionBadge version={version.version} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm">
                              {version.changeNote || t("No note")}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
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
                </TabsContent>

                <TabsContent value="raw">
                  <RawConfigurationEditor
                    value={draft.configuration}
                    onApply={(configuration) => patch({ configuration })}
                  />
                </TabsContent>
              </Tabs>
            </div>
          ) : detail.isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <UsersIcon className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                {list.data?.length
                  ? t("Choose a preset to edit it.")
                  : t("Create a preset to publish its first version.")}
              </p>
            </div>
          )}
        </div>
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
                rows={3}
                value={newDraft.description}
                onChange={(event) =>
                  setNewDraft((value) => ({
                    ...value,
                    description: event.target.value,
                  }))
                }
              />
            </Field>
            <PresetVisualEditor
              value={newDraft.configuration}
              onChange={(configuration) =>
                setNewDraft((value) => ({ ...value, configuration }))
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={
                create.isPending || !newId.trim() || !newDraft.name.trim()
              }
              onClick={() =>
                create.mutate({
                  id: newId.trim(),
                  name: newDraft.name.trim(),
                  description: newDraft.description.trim(),
                  tags: tags(newDraft.tags),
                  featured: newDraft.featured,
                  configuration: newDraft.configuration,
                })
              }
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

/**
 * The escape hatch.
 *
 * Raw JSON is a real need — pasting a whole curriculum is faster than building
 * it by hand — but it was wired straight into the draft, so a half-typed brace
 * put the whole screen into an error state. Here it is a scratch buffer that
 * has to be applied, and it can only report its own syntax error.
 */
function RawConfigurationEditor({
  value,
  onApply,
}: {
  value: PresetEditorConfiguration
  onApply: (configuration: PresetEditorConfiguration) => void
}) {
  const t = useExtracted()
  const [text, setText] = useState(() => pretty(value))
  const [error, setError] = useState<string | null>(null)

  return (
    <SettingsSection
      icon={CodeIcon}
      title={t("Raw configuration")}
      description={t(
        "The server validates unique stable keys, hierarchy, coefficients and average references before publishing."
      )}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setText(pretty(value))
              setError(null)
            }}
          >
            {t("Reset to current")}
          </Button>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              try {
                onApply(parseConfiguration(text))
                setError(null)
                toast.success(t("Configuration applied to the editor."))
              } catch (parseError) {
                setError(
                  parseError instanceof Error
                    ? parseError.message
                    : t("Invalid JSON configuration.")
                )
              }
            }}
          >
            {t("Apply to editor")}
          </Button>
        </>
      }
    >
      <Textarea
        className="min-h-80 font-mono text-xs"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {error ? (
        <FieldDescription className="text-destructive">
          {error}
        </FieldDescription>
      ) : null}
    </SettingsSection>
  )
}
