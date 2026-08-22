"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArchiveRestoreIcon,
  BookOpenTextIcon,
  Edit3Icon,
  FolderKanbanIcon,
  MoreHorizontalIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingsInput,
  materialsDocumentsInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"
import { buildSourceCatalogue } from "./project-model"
import {
  ProjectDialog,
  type EditableProject,
  type ProjectFormValue,
} from "./project-dialog"
import { ProjectSearch } from "./project-search"
import {
  ProjectSourceManager,
  type ProjectSourceItem,
} from "./project-source-manager"

function projectDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(value)
}

export function ProjectsClient({
  selectedProjectId = null,
}: {
  selectedProjectId?: string | null
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, subjects } = useYear()
  const [editorOpen, setEditorOpen] = useState(false)
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
  const embeddingQuery = useQuery({
    ...orpc.projects.embeddingPrivacy.queryOptions(),
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
      }),
      ...(projectId
        ? [
            queryClient.invalidateQueries({
              queryKey: orpc.projects.get.queryKey({ input: { projectId } }),
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
      toast.success("Projet créé")
      router.push(`/projects/${project.id}`)
    },
    onError: (error) => toast.error(error.message),
  })
  const update = useMutation({
    ...orpc.projects.update.mutationOptions(),
    onSuccess: async (project) => {
      await refreshProject(project.id)
      setEditorOpen(false)
      toast.success("Projet mis à jour")
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
      toast.success("Projet placé dans la corbeille")
      router.push("/projects")
    },
    onError: (error) => toast.error(error.message),
  })
  const restore = useMutation({
    ...orpc.projects.restore.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success("Projet restauré")
    },
    onError: (error) => toast.error(error.message),
  })
  const addItem = useMutation({
    ...orpc.projects.addItem.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success("Source ajoutée et indexation programmée")
    },
    onError: (error) => toast.error(error.message),
  })
  const removeItem = useMutation({
    ...orpc.projects.removeItem.mutationOptions(),
    onSuccess: async (_, input) => {
      await refreshProject(input.projectId)
      toast.success("Référence retirée — la source reste intacte")
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
      toast.success("Réparation de l’index programmée")
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

  const selected = projectQuery.data?.project ?? null
  const editable = selected as EditableProject | null
  const actionPending =
    addItem.isPending ||
    removeItem.isPending ||
    reorder.isPending ||
    retry.isPending ||
    setItemTracking.isPending

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

  if (selectedProjectId) {
    return (
      <>
        <PageMeta
          title={selected?.title ?? "Projet"}
          subtitle="Sources, recherche et citations"
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
            Modifier
          </Button>
        </PageActions>

        {projectQuery.isLoading ? (
          <ProjectSkeleton />
        ) : projectQuery.isError || !selected ? (
          <Alert variant="destructive">
            <AlertTitle>Projet indisponible</AlertTitle>
            <AlertDescription>
              {projectQuery.error?.message ?? "Ce projet n’existe plus."}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span aria-hidden>{selected.emoji ?? "📚"}</span>
                  {selected.title}
                </CardTitle>
                <CardDescription>
                  {selected.description || "Aucune description."}
                </CardDescription>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Actions du projet"
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
                            ? "Retirer des favoris"
                            : "Favori"}
                        </DropdownMenuItem>
                        {selected.deletedAt ? (
                          <DropdownMenuItem
                            onClick={() =>
                              restore.mutate({ projectId: selected.id })
                            }
                          >
                            <ArchiveRestoreIcon />
                            Restaurer
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteProject(editable)}
                          >
                            <Trash2Icon />
                            Mettre à la corbeille
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {selected.starredAt ? <Badge>Favori</Badge> : null}
                {selected.yearId ? (
                  <Badge variant="outline">Année liée</Badge>
                ) : (
                  <Badge variant="outline">Toutes les années</Badge>
                )}
                <Badge variant="secondary">
                  Modifié le {projectDate(selected.updatedAt)}
                </Badge>
              </CardContent>
              {selected.instructionsMarkdown ? (
                <CardFooter>
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">
                    {selected.instructionsMarkdown}
                  </p>
                </CardFooter>
              ) : null}
            </Card>

            <Alert>
              <BookOpenTextIcon />
              <AlertTitle>
                {embeddingQuery.data?.vectorConfigured
                  ? "Recherche hybride activée"
                  : "Recherche lexicale locale"}
              </AlertTitle>
              <AlertDescription>
                {embeddingQuery.data?.vectorConfigured
                  ? `Provider ${embeddingQuery.data.configuredProvider ?? "configuré"}. Vérifiez la politique de confidentialité avant la réindexation.`
                  : "Aucune source n’est envoyée à un fournisseur d’embeddings. Les PDF scannés nécessitent un OCR pour chercher leur texte."}
              </AlertDescription>
            </Alert>

            <Tabs defaultValue="sources">
              <TabsList>
                <TabsTrigger value="sources">Sources</TabsTrigger>
                <TabsTrigger value="search">Recherche</TabsTrigger>
              </TabsList>
              <TabsContent value="sources" className="pt-4">
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
        title="Projets d’étude"
        subtitle="Vos notebooks scolaires, sources et recherches"
      />
      <PageActions>
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Nouveau projet
        </Button>
      </PageActions>

      {listQuery.isLoading ? (
        <ProjectSkeleton />
      ) : listQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Les projets ne peuvent pas être chargés</AlertTitle>
          <AlertDescription>{listQuery.error.message}</AlertDescription>
        </Alert>
      ) : live.length === 0 && trashed.length === 0 ? (
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanbanIcon />
            </EmptyMedia>
            <EmptyTitle>Créez votre premier projet d’étude</EmptyTitle>
            <EmptyDescription>
              Regroupez cours, fiches, notes et enregistrements sans déplacer
              les originaux.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setEditorOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Nouveau projet
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live">Actifs ({live.length})</TabsTrigger>
            <TabsTrigger value="trash">
              Corbeille ({trashed.length})
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
  if (projects.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderKanbanIcon />
          </EmptyMedia>
          <EmptyTitle>Rien ici</EmptyTitle>
          <EmptyDescription>
            Cette section ne contient aucun projet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
              {project.description || "Aucune description."}
            </CardDescription>
            <CardAction>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Actions pour ${project.title}`}
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
                      {project.starredAt ? "Retirer des favoris" : "Favori"}
                    </DropdownMenuItem>
                    {project.deletedAt ? (
                      <DropdownMenuItem onClick={() => onRestore(project.id)}>
                        <ArchiveRestoreIcon />
                        Restaurer
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onTrash(project)}
                      >
                        <Trash2Icon />
                        Mettre à la corbeille
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {project.starredAt ? <Badge>Favori</Badge> : null}
            <Badge variant="outline">
              {project.subjectId ? "Matière ciblée" : "Toutes matières"}
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
              Ouvrir
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
  return (
    <AlertDialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mettre ce projet à la corbeille ?</AlertDialogTitle>
          <AlertDialogDescription>
            Les sources originales ne seront ni déplacées ni supprimées. Le
            projet pourra être restauré.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => project && onConfirm(project.id)}
          >
            Mettre à la corbeille
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ProjectSkeleton() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2"
      aria-label="Chargement des projets"
    >
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  )
}
