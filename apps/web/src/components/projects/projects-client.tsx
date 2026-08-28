"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BookOpenTextIcon,
  BotIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Edit3Icon,
  FileOutputIcon,
  FilePlus2Icon,
  FolderKanbanIcon,
  GraduationCapIcon,
  LibraryIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { AssistantWorkspaceClient } from "@/components/assistant/assistant-client"
import {
  CreateArtifactDialog,
  type ArtifactPlanValue,
} from "@/components/media-studio/create-artifact-dialog"
import { useMediaStudioCopy } from "@/components/media-studio/media-studio-copy"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useYear } from "@/components/year/year-provider"
import { orpc, rpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingsInput,
  materialsDocumentsInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"
import { buildSourceCatalogue, type ProjectSourceOption } from "./project-model"
import { ProjectAddSourceDialog } from "./project-add-source-dialog"
import { ProjectLearningOverview } from "./project-learning-overview"
import {
  ProjectDialog,
  type EditableProject,
  type ProjectFormValue,
} from "./project-dialog"
import { ProjectSearch } from "./project-search"
import { ProjectRetrievalPolicyCard } from "./project-retrieval-policy-card"
import {
  ProjectSourceManager,
  type ProjectSourceItem,
} from "./project-source-manager"

function projectDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(value)
}

type ProjectArtifact = Awaited<
  ReturnType<typeof rpc.mediaStudio.listArtifacts>
>[number]

export function ProjectsClient({
  selectedProjectId = null,
}: {
  selectedProjectId?: string | null
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, years, subjects } = useYear()
  const { artifactKindLabel } = useMediaStudioCopy()
  const [editorOpen, setEditorOpen] = useState(false)
  const [workspaceTab, setWorkspaceTab] = useState("overview")
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false)
  const [deleteProject, setDeleteProject] = useState<EditableProject | null>(
    null
  )

  const listQuery = useQuery({
    ...orpc.projects.list.queryOptions({ input: { include: "all" } }),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const projectQuery = useQuery({
    ...orpc.projects.get.queryOptions({
      input: { projectId: selectedProjectId ?? "_" },
    }),
    enabled: Boolean(selectedProjectId),
    staleTime: COMMON_QUERY_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (item) =>
          item.indexStatus === "indexing" || item.indexStatus === "registered"
      )
        ? 1_500
        : false,
  })
  const materialQuery = useQuery({
    ...orpc.materials.documents.list.queryOptions({
      input: materialsDocumentsInput(yearId ?? ""),
    }),
    enabled: Boolean(selectedProjectId && yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const studyQuery = useQuery({
    ...orpc.documents.list.queryOptions({
      input: studyDocumentsInput(yearId ?? ""),
    }),
    enabled: Boolean(selectedProjectId && yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const recordingQuery = useQuery({
    ...orpc.recordings.list.queryOptions({
      input: lectureRecordingsInput(yearId ?? ""),
    }),
    enabled: Boolean(selectedProjectId && yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const artifactsInput = { projectId: selectedProjectId }
  const artifactsQuery = useQuery({
    ...orpc.mediaStudio.listArtifacts.queryOptions({ input: artifactsInput }),
    enabled: Boolean(selectedProjectId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  const catalogue = useMemo(
    () =>
      buildSourceCatalogue({
        materials: materialQuery.data ?? [],
        studyDocuments: studyQuery.data ?? [],
        recordings: recordingQuery.data ?? [],
        subjects,
      }),
    [materialQuery.data, recordingQuery.data, studyQuery.data, subjects]
  )

  async function refreshProject(projectId?: string) {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.projects.list.queryKey({ input: { include: "all" } }),
        exact: true,
      }),
      ...(projectId
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.projects.get.queryKey({ input: { projectId } }),
              exact: true,
            }),
            queryClient.invalidateQueries({
              queryKey: orpc.projects.retrievalPolicy.queryKey({
                input: { projectId },
              }),
              exact: true,
            }),
          ]
        : []),
    ])
  }

  const create = useMutation({
    ...orpc.projects.create.mutationOptions(),
    onSuccess: async (project) => {
      await refreshProject(project.id)
      setEditorOpen(false)
      toast.success(t("Study project created"))
      router.push(`/projects/${project.id}`)
    },
    onError: (error) => toast.error(error.message),
  })
  const update = useMutation({
    ...orpc.projects.update.mutationOptions(),
    onSuccess: async (project) => {
      await refreshProject(project.id)
      setEditorOpen(false)
      toast.success(t("Study project updated"))
    },
    onError: (error) => toast.error(error.message),
  })
  const star = useMutation({
    ...orpc.projects.star.mutationOptions(),
    onSuccess: (project) => refreshProject(project.id),
    onError: (error) => toast.error(error.message),
  })
  const trash = useMutation({
    ...orpc.projects.trash.mutationOptions(),
    onSuccess: async () => {
      await refreshProject(selectedProjectId ?? undefined)
      setDeleteProject(null)
      toast.success(t("Study project moved to trash"))
      router.push("/projects")
    },
    onError: (error) => toast.error(error.message),
  })
  const restore = useMutation({
    ...orpc.projects.restore.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success(t("Study project restored"))
    },
    onError: (error) => toast.error(error.message),
  })
  const addItem = useMutation({
    ...orpc.projects.addItem.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success(t("Source added. It is being indexed."))
    },
    onError: (error) => toast.error(error.message),
  })
  const removeItem = useMutation({
    ...orpc.projects.removeItem.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success(t("Reference removed. The source itself is untouched."))
    },
    onError: (error) => toast.error(error.message),
  })
  const reorder = useMutation({
    ...orpc.projects.reorderItems.mutationOptions(),
    onSuccess: (_, input) => refreshProject(input.projectId),
    onError: (error) => {
      toast.error(error.message)
      if (selectedProjectId) void refreshProject(selectedProjectId)
    },
  })
  const retry = useMutation({
    ...orpc.projects.retryIndex.mutationOptions(),
    onSuccess: async () => {
      if (selectedProjectId) await refreshProject(selectedProjectId)
      toast.success(t("The index will be rebuilt."))
    },
    onError: (error) => toast.error(error.message),
  })
  const setItemTracking = useMutation({
    ...orpc.projects.setItemTracking.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success(
        input.trackingMode === "pinned"
          ? t("Current version pinned in the project")
          : t("The source now follows its latest version")
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const setItemContextMode = useMutation({
    ...orpc.projects.setItemContextMode.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success(t("Source context rule updated"))
    },
    onError: (error, input) => {
      toast.error(error.message)
      void refreshProject(input.projectId)
    },
  })
  const planArtifact = useMutation({
    ...orpc.mediaStudio.planArtifact.mutationOptions(),
    onSuccess: async () => {
      setArtifactDialogOpen(false)
      setWorkspaceTab("productions")
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.mediaStudio.listArtifacts.queryKey({
            input: artifactsInput,
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.mediaStudio.listWorkflows.key(),
        }),
      ])
      toast.success(t("Production started."))
    },
    onError: (error) => toast.error(error.message),
  })

  const selected = projectQuery.data?.project ?? null
  const editable = selected as EditableProject | null
  const actionPending =
    addItem.isPending ||
    removeItem.isPending ||
    reorder.isPending ||
    retry.isPending ||
    setItemTracking.isPending ||
    setItemContextMode.isPending

  function submitProject(value: ProjectFormValue) {
    if (editable) {
      update.mutate({
        projectId: editable.id,
        revision: editable.revision,
        ...value,
      })
      return
    }
    create.mutate(value)
  }

  function submitArtifact(value: ArtifactPlanValue) {
    planArtifact.mutate({
      ...value,
      projectId: selectedProjectId,
      idempotencyKey: `project-${crypto.randomUUID()}`,
    })
  }

  if (selectedProjectId) {
    return (
      <>
        <PageMeta
          title={selected?.title ?? t("Study project")}
          subtitle={t(
            "A focused place to study this topic with your own sources."
          )}
          backHref="/projects"
        />
        <PageActions>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditorOpen(true)}
            disabled={!selected}
          >
            <Edit3Icon data-icon="inline-start" />
            {t("Edit")}
          </Button>
        </PageActions>

        {projectQuery.isLoading ? (
          <ProjectSkeleton />
        ) : projectQuery.isError || !selected ? (
          <Alert variant="destructive">
            <AlertTitle>{t("Project unavailable")}</AlertTitle>
            <AlertDescription>
              {projectQuery.error?.message ??
                t("This project no longer exists.")}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex min-w-0 flex-col gap-5">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="hidden items-center gap-2 md:flex">
                  <span className="text-xl" aria-hidden>
                    {selected.emoji ?? "📚"}
                  </span>
                  {selected.title}
                </CardTitle>
                <CardDescription>
                  {selected.description ||
                    t(
                      "A focused place to study this topic with your own sources."
                    )}
                </CardDescription>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t("Project actions")}
                        />
                      }
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() =>
                            star.mutate({
                              projectId: selected.id,
                              starred: !selected.starredAt,
                            })
                          }
                        >
                          <StarIcon />
                          {selected.starredAt
                            ? t("Remove from favorites")
                            : t("Add to favorites")}
                        </DropdownMenuItem>
                        {selected.deletedAt ? (
                          <DropdownMenuItem
                            onClick={() =>
                              restore.mutate({ projectId: selected.id })
                            }
                          >
                            <ArchiveRestoreIcon />
                            {t("Restore")}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteProject(editable)}
                          >
                            <Trash2Icon />
                            {t("Move to trash")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  {selected.starredAt ? <Badge>{t("Favorite")}</Badge> : null}
                  {selected.yearId ? (
                    <Badge variant="outline">{t("Linked year")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("No linked year")}</Badge>
                  )}
                  <Badge variant="secondary">
                    {t("Updated {date}", {
                      date: projectDate(selected.updatedAt),
                    })}
                  </Badge>
                </div>
                {!selected.deletedAt ? (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setWorkspaceTab("chat")}>
                      <BotIcon data-icon="inline-start" />
                      {t("Study with the assistant")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setSourceDialogOpen(true)}
                    >
                      <FilePlus2Icon data-icon="inline-start" />
                      {t("Add a source")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setArtifactDialogOpen(true)}
                    >
                      <FileOutputIcon data-icon="inline-start" />
                      {t("Create a study aid")}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
              {selected.instructionsMarkdown ? (
                <CardFooter>
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">
                    {selected.instructionsMarkdown}
                  </p>
                </CardFooter>
              ) : null}
            </Card>

            <Tabs
              value={workspaceTab}
              onValueChange={setWorkspaceTab}
              className="min-w-0"
            >
              <TabsList
                variant="line"
                className="no-scrollbar max-w-full justify-start overflow-x-auto overflow-y-hidden"
              >
                <TabsTrigger value="overview">
                  <LibraryIcon data-icon="inline-start" />
                  {t("Overview")}
                </TabsTrigger>
                <TabsTrigger value="chat">
                  <MessageSquareTextIcon data-icon="inline-start" />
                  {t("Chat")}
                </TabsTrigger>
                <TabsTrigger value="sources">
                  <BookOpenTextIcon data-icon="inline-start" />
                  {t("Sources")}
                </TabsTrigger>
                <TabsTrigger value="learning">
                  <GraduationCapIcon data-icon="inline-start" />
                  {t("Progress in this subject")}
                </TabsTrigger>
                <TabsTrigger value="productions">
                  <FileOutputIcon data-icon="inline-start" />
                  {t("Study aids")}
                </TabsTrigger>
                <TabsTrigger value="search">
                  <SearchIcon data-icon="inline-start" />
                  {t("Search")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="pt-4">
                <ProjectOverview
                  items={projectQuery.data?.items as ProjectSourceItem[]}
                  sourceSummary={projectQuery.data!.sourceSummary}
                  catalogue={catalogue}
                  artifacts={artifactsQuery.data ?? []}
                  artifactsLoading={artifactsQuery.isLoading}
                  onOpenChat={() => setWorkspaceTab("chat")}
                  onOpenSources={() => setWorkspaceTab("sources")}
                  onAddSource={() => setSourceDialogOpen(true)}
                  onCreateArtifact={() => setArtifactDialogOpen(true)}
                  artifactKindLabel={artifactKindLabel}
                />
              </TabsContent>

              <TabsContent value="chat" className="pt-4">
                <section
                  aria-labelledby="project-chat-title"
                  className="flex min-w-0 flex-col gap-3"
                >
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 id="project-chat-title" className="font-medium">
                        {t("Assistant for this project")}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "Every new conversation inherits this project's instructions and searchable sources."
                        )}
                      </p>
                    </div>
                    <Badge variant="outline">{t("Project context")}</Badge>
                  </div>
                  <AssistantWorkspaceClient
                    projectId={selected.id}
                    compactRail
                    className="h-[min(76vh,48rem)] rounded-xl border"
                  />
                </section>
              </TabsContent>

              <TabsContent value="sources" className="pt-4">
                <ProjectRetrievalPolicyCard projectId={selected.id} />
                <ProjectSourceManager
                  projectId={selected.id}
                  revision={selected.revision}
                  items={projectQuery.data?.items as ProjectSourceItem[]}
                  catalogue={catalogue}
                  pendingAction={actionPending}
                  onAdd={(input) => addItem.mutate(input)}
                  onRemove={(input) => removeItem.mutate(input)}
                  onReorder={(input) => reorder.mutate(input)}
                  onRetry={(input) => retry.mutate(input)}
                  onTracking={(input) => setItemTracking.mutate(input)}
                  onContextMode={(input) => setItemContextMode.mutate(input)}
                />
              </TabsContent>

              <TabsContent value="learning" className="pt-4">
                <ProjectLearningOverview
                  yearId={selected.yearId}
                  subjectId={selected.subjectId}
                  yearName={
                    years.find((candidate) => candidate.id === selected.yearId)
                      ?.name ?? null
                  }
                  subjectName={
                    subjects.find(
                      (candidate) => candidate.id === selected.subjectId
                    )?.name ?? null
                  }
                  onEditProject={() => setEditorOpen(true)}
                />
              </TabsContent>

              <TabsContent value="productions" className="pt-4">
                <ProjectProductions
                  projectId={selected.id}
                  artifacts={artifactsQuery.data ?? []}
                  loading={artifactsQuery.isLoading}
                  error={artifactsQuery.error?.message ?? null}
                  artifactKindLabel={artifactKindLabel}
                  onCreate={() => setArtifactDialogOpen(true)}
                />
              </TabsContent>

              <TabsContent value="search" className="pt-4">
                <ProjectSearch
                  projectId={selected.id}
                  yearId={selected.yearId}
                  items={projectQuery.data?.items as ProjectSourceItem[]}
                  catalogue={catalogue}
                  subjects={subjects}
                />
              </TabsContent>
            </Tabs>

            <ProjectAddSourceDialog
              key={selected.id}
              open={sourceDialogOpen}
              onOpenChange={setSourceDialogOpen}
              projectId={selected.id}
              yearId={selected.yearId ?? yearId}
              onCompleted={() => refreshProject(selected.id)}
            />
            {artifactDialogOpen ? (
              <CreateArtifactDialog
                key={`project-artifact:${selected.id}`}
                open
                onOpenChange={setArtifactDialogOpen}
                projects={listQuery.data ?? []}
                defaultProjectId={selected.id}
                pending={planArtifact.isPending}
                onSubmit={submitArtifact}
              />
            ) : null}
          </div>
        )}

        <ProjectDialog
          key={`${editorOpen ? "open" : "closed"}:${editable?.id ?? "new"}:${editable?.revision ?? 0}`}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          project={editable}
          yearId={yearId ?? ""}
          subjects={subjects}
          pending={update.isPending}
          onSubmit={submitProject}
        />
        <DeleteProjectDialog
          project={deleteProject}
          pending={trash.isPending}
          onOpenChange={(open) => {
            if (!open) setDeleteProject(null)
          }}
          onConfirm={(projectId) => trash.mutate({ projectId })}
        />
      </>
    )
  }

  const projects = listQuery.data ?? []
  const live = projects.filter((project) => !project.deletedAt)
  const trashed = projects.filter((project) => project.deletedAt)

  return (
    <>
      <PageMeta
        title={t("Study projects")}
        subtitle={t("Your school notebooks, sources and research")}
      />
      <PageActions>
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          {t("New project")}
        </Button>
      </PageActions>

      {listQuery.isLoading ? (
        <ProjectSkeleton />
      ) : listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("Projects could not be loaded")}</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : live.length === 0 && trashed.length === 0 ? (
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanbanIcon />
            </EmptyMedia>
            <EmptyTitle>{t("Create your first study project")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Group courses, study guides, notes and recordings without moving the originals."
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setEditorOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              {t("New project")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live">
              {t("Active ({count})", { count: String(live.length) })}
            </TabsTrigger>
            <TabsTrigger value="trash">
              {t("Trash ({count})", { count: String(trashed.length) })}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="pt-4">
            <ProjectGrid
              projects={live}
              onStar={(projectId, starred) =>
                star.mutate({ projectId, starred })
              }
              onTrash={(project) => setDeleteProject(project)}
              onRestore={(projectId) => restore.mutate({ projectId })}
            />
          </TabsContent>
          <TabsContent value="trash" className="pt-4">
            <ProjectGrid
              projects={trashed}
              onStar={(projectId, starred) =>
                star.mutate({ projectId, starred })
              }
              onTrash={(project) => setDeleteProject(project)}
              onRestore={(projectId) => restore.mutate({ projectId })}
            />
          </TabsContent>
        </Tabs>
      )}

      <ProjectDialog
        key={editorOpen ? "create-open" : "create-closed"}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        project={null}
        yearId={yearId ?? ""}
        subjects={subjects}
        pending={create.isPending}
        onSubmit={submitProject}
      />
      <DeleteProjectDialog
        project={deleteProject}
        pending={trash.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteProject(null)
        }}
        onConfirm={(projectId) => trash.mutate({ projectId })}
      />
    </>
  )
}

function ProjectOverview({
  items,
  sourceSummary,
  catalogue,
  artifacts,
  artifactsLoading,
  onOpenChat,
  onOpenSources,
  onAddSource,
  onCreateArtifact,
  artifactKindLabel,
}: {
  items: readonly ProjectSourceItem[]
  sourceSummary: Awaited<ReturnType<typeof rpc.projects.get>>["sourceSummary"]
  catalogue: readonly ProjectSourceOption[]
  artifacts: readonly ProjectArtifact[]
  artifactsLoading: boolean
  onOpenChat: () => void
  onOpenSources: () => void
  onAddSource: () => void
  onCreateArtifact: () => void
  artifactKindLabel: (kind: string) => string
}) {
  const t = useExtracted()
  const selectedVersion = (item: ProjectSourceItem) =>
    item.trackingMode === "pinned"
      ? item.sourceVersionId
      : item.currentVersionId
  const isSearchable = (item: ProjectSourceItem) =>
    !item.missing &&
    !item.selectorReviewRequired &&
    Boolean(selectedVersion(item)) &&
    (item.indexStatus === "ready" || item.indexStatus === "indexed")
  const automaticReady = sourceSummary.automaticSearchable
  const onDemandReady = Math.max(
    0,
    sourceSummary.contextSearchable - sourceSummary.automaticSearchable
  )
  const needsAttention = items.filter(
    (item) =>
      item.contextMode !== "exclude" &&
      (item.missing ||
        item.selectorReviewRequired ||
        item.indexStatus === "failed" ||
        item.indexStatus === "partial" ||
        (!selectedVersion(item) &&
          item.indexStatus !== "registered" &&
          item.indexStatus !== "indexing"))
  ).length
  const automaticReadiness = sourceSummary.automaticEligible
    ? Math.round((automaticReady / sourceSummary.automaticEligible) * 100)
    : 0
  const onDemandReadiness = sourceSummary.onDemand
    ? Math.round((onDemandReady / sourceSummary.onDemand) * 100)
    : 0
  const recentSources = sourceSummary.recentContextItemIds.flatMap((itemId) => {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item || item.contextMode === "exclude") return []
    return [
      {
        item,
        source: catalogue.find(
          (candidate) =>
            candidate.kind === item.kind && candidate.id === item.referenceId
        ),
      },
    ]
  })

  const next =
    items.length === 0
      ? {
          title: t("Start with one trustworthy source"),
          description: t(
            "Add a course, a marked paper, a web page or your own note. It becomes the grounded context for chat and generation."
          ),
          label: t("Add the first source"),
          icon: <FilePlus2Icon data-icon="inline-start" />,
          action: onAddSource,
        }
      : sourceSummary.contextEligible === 0
        ? {
            title: t("Choose what belongs in the project context"),
            description: t(
              "Every attached source is excluded. Include a source, or make it available on demand, before asking the assistant to use it."
            ),
            label: t("Manage sources"),
            icon: <BookOpenTextIcon data-icon="inline-start" />,
            action: onOpenSources,
          }
        : needsAttention > 0
          ? {
              title: t("Review sources that need attention"),
              description: t(
                "At least one source is missing or only partly indexed. Fix it before relying on a generated answer."
              ),
              label: t("Review sources"),
              icon: <BookOpenTextIcon data-icon="inline-start" />,
              action: onOpenSources,
            }
          : artifacts.length === 0
            ? {
                title: t("Turn these sources into understanding"),
                description: t(
                  "Ask a first question, compare ideas across documents, or create a revision aid from the exact same context."
                ),
                label: t("Open the project assistant"),
                icon: <BotIcon data-icon="inline-start" />,
                action: onOpenChat,
              }
            : {
                title: t("Continue where you left off"),
                description: t(
                  "The project context and generated study aids are ready. Continue the conversation or create the next revision."
                ),
                label: t("Continue studying"),
                icon: <ArrowRightIcon data-icon="inline-end" />,
                action: onOpenChat,
              }

  return (
    <section
      aria-labelledby="project-overview-title"
      className="flex flex-col gap-4"
    >
      <h2 id="project-overview-title" className="sr-only">
        {t("Project overview")}
      </h2>

      <Card>
        <CardHeader>
          <CardDescription>{t("Recommended next step")}</CardDescription>
          <CardTitle>{next.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
            {next.description}
          </p>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button onClick={next.action}>
            {next.icon}
            {next.label}
          </Button>
          {sourceSummary.contextEligible > 0 ? (
            <Button variant="outline" onClick={onCreateArtifact}>
              <FileOutputIcon data-icon="inline-start" />
              {t("Create a study aid")}
            </Button>
          ) : null}
        </CardFooter>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("Source readiness")}</CardTitle>
            <CardDescription>
              {t(
                "What the assistant can retrieve automatically or when requested"
              )}
            </CardDescription>
            <CardAction>
              <Button size="sm" variant="ghost" onClick={onOpenSources}>
                {t("Manage")}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {sourceSummary.contextEligible === 0 ? (
              <p className="text-sm text-muted-foreground">
                {items.length > 0
                  ? t(
                      "No included or on-demand source is available to the assistant."
                    )
                  : t("No source has been attached yet.")}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {sourceSummary.automaticEligible > 0 ? (
                  <Progress value={automaticReadiness}>
                    <ProgressLabel>{t("Automatic context")}</ProgressLabel>
                    <ProgressValue>
                      {() =>
                        `${automaticReady}/${sourceSummary.automaticEligible}`
                      }
                    </ProgressValue>
                  </Progress>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("No source is included automatically.")}
                  </p>
                )}
                {sourceSummary.onDemand > 0 ? (
                  <Progress value={onDemandReadiness}>
                    <ProgressLabel>{t("Available on demand")}</ProgressLabel>
                    <ProgressValue>
                      {() => `${onDemandReady}/${sourceSummary.onDemand}`}
                    </ProgressValue>
                  </Progress>
                ) : null}
              </div>
            )}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t("Technical index")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Across all attached sources, including sources excluded from assistant context."
                    )}
                  </p>
                </div>
                <Badge variant="outline" className="w-fit shrink-0">
                  {sourceSummary.indexed}/{sourceSummary.total}
                </Badge>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">
                  {t("Assistant context rules")}
                </p>
                <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center">
                  <div className="min-w-0">
                    <p className="numeric text-lg font-semibold">
                      {sourceSummary.included}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Included")}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="numeric text-lg font-semibold">
                      {sourceSummary.onDemand}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("On demand")}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="numeric text-lg font-semibold">
                      {sourceSummary.excluded}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("Excluded")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Study aids")}</CardTitle>
            <CardDescription>
              {t("Versioned outputs generated from this project")}
            </CardDescription>
            <CardAction>
              <Button size="sm" variant="ghost" onClick={onCreateArtifact}>
                <PlusIcon data-icon="inline-start" />
                {t("Create")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {artifactsLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : artifacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("No quiz, summary, presentation or other study aid yet.")}
              </p>
            ) : (
              <ItemGroup className="gap-2">
                {artifacts.slice(0, 3).map((artifact) => (
                  <Item key={artifact.id} size="sm" variant="outline">
                    <ItemMedia variant="icon">
                      <FileOutputIcon />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{artifact.title}</ItemTitle>
                      <ItemDescription>
                        {artifactKindLabel(artifact.kind)} · {artifact.state}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      </div>

      {recentSources.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("Project context")}</CardTitle>
            <CardDescription>
              {t(
                "Recently added included and on-demand sources; excluded sources never appear here."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-2">
              {recentSources.map(({ item, source }) => (
                <Item key={item.id} size="sm" variant="outline">
                  <ItemMedia variant="icon">
                    {isSearchable(item) ? <CheckCircle2Icon /> : <Clock3Icon />}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {item.label ?? source?.title ?? item.referenceId}
                    </ItemTitle>
                    <ItemDescription>
                      {source?.subtitle ?? item.kind}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Badge variant="outline">
                      {item.contextMode === "include"
                        ? t("Included")
                        : t("On demand")}
                    </Badge>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}

function ProjectProductions({
  projectId,
  artifacts,
  loading,
  error,
  artifactKindLabel,
  onCreate,
}: {
  projectId: string
  artifacts: readonly ProjectArtifact[]
  loading: boolean
  error: string | null
  artifactKindLabel: (kind: string) => string
  onCreate: () => void
}) {
  const t = useExtracted()
  const studioHref = `/materials/studio?project=${encodeURIComponent(projectId)}`

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("Study aids are unavailable")}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (artifacts.length === 0) {
    return (
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileOutputIcon />
          </EmptyMedia>
          <EmptyTitle>{t("Create something you can revise with")}</EmptyTitle>
          <EmptyDescription>
            {t(
              "Generate a cited summary, quiz, PDF, presentation, podcast or another versioned artifact from this project's sources."
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            {t("Create a study aid")}
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <section
      aria-labelledby="project-productions-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="project-productions-title"
            className="font-heading text-lg font-medium"
          >
            {t("Study aids")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("Every revision remains inspectable and linked to its sources.")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={studioHref} />}>
            {t("Open Studio")}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
          <Button onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            {t("Create")}
          </Button>
        </div>
      </div>
      <ItemGroup>
        {artifacts.map((artifact) => (
          <Item key={artifact.id} variant="outline">
            <ItemMedia variant="icon">
              <FileOutputIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{artifact.title}</ItemTitle>
              <ItemDescription>
                {artifactKindLabel(artifact.kind)} ·{" "}
                {t("revision {revision}", {
                  revision: String(artifact.identityRevision),
                })}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="outline">{artifact.state}</Badge>
              <Button
                size="sm"
                variant="ghost"
                render={
                  <Link
                    href={`${studioHref}&artifact=${encodeURIComponent(artifact.id)}`}
                  />
                }
              >
                {t("Open")}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}

function ProjectGrid({
  projects,
  onStar,
  onTrash,
  onRestore,
}: {
  projects: readonly EditableProjectWithDates[]
  onStar: (projectId: string, starred: boolean) => void
  onTrash: (project: EditableProject) => void
  onRestore: (projectId: string) => void
}) {
  const t = useExtracted()

  if (projects.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderKanbanIcon />
          </EmptyMedia>
          <EmptyTitle>{t("Nothing here")}</EmptyTitle>
          <EmptyDescription>
            {t("There are no projects here.")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <Card key={project.id}>
          <CardHeader>
            <CardTitle>
              <Link
                href={`/projects/${project.id}`}
                className="hover:underline"
              >
                <span aria-hidden>{project.emoji ?? "📚"}</span> {project.title}
              </Link>
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {project.description || t("No description.")}
            </CardDescription>
            <CardAction>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("Actions for {title}", {
                        title: project.title,
                      })}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => onStar(project.id, !project.starredAt)}
                    >
                      <StarIcon />
                      {project.starredAt
                        ? t("Remove from favorites")
                        : t("Add to favorites")}
                    </DropdownMenuItem>
                    {project.deletedAt ? (
                      <DropdownMenuItem onClick={() => onRestore(project.id)}>
                        <ArchiveRestoreIcon />
                        {t("Restore")}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onTrash(project)}
                      >
                        <Trash2Icon />
                        {t("Move to trash")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {project.starredAt ? <Badge>{t("Favorite")}</Badge> : null}
            <Badge variant="outline">
              {project.subjectId ? t("Subject scoped") : t("All subjects")}
            </Badge>
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {projectDate(project.updatedAt)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              render={<Link href={`/projects/${project.id}`} />}
              nativeButton={false}
            >
              {t("Open")}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

type EditableProjectWithDates = EditableProject & {
  starredAt: Date | null
  deletedAt: Date | null
  updatedAt: Date
}

function DeleteProjectDialog({
  project,
  pending,
  onOpenChange,
  onConfirm,
}: {
  project: EditableProject | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (projectId: string) => void
}) {
  const t = useExtracted()

  return (
    <AlertDialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("Move this project to trash?")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "Original sources will not be moved or deleted. You can restore the project later."
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => project && onConfirm(project.id)}
          >
            {t("Move to trash")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ProjectSkeleton() {
  const t = useExtracted()

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      aria-label={t("Loading projects")}
    >
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  )
}
