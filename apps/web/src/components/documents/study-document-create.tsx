"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  FileTextIcon,
  NetworkIcon,
  NotebookPenIcon,
  PresentationIcon,
  ListChecksIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  ChoiceField,
  SelectField,
  TextField,
} from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { useYear } from "@/components/year/year-provider"
import { flattenMaterialFolders } from "@/components/materials/materials-model"
import type { MaterialFolderView } from "@/components/materials/materials-types"
import { haptic } from "@/lib/haptics"
import { randomId } from "@/lib/id"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { materialsFoldersInput } from "@/lib/route-query-inputs"
import { createMindmapContent } from "./mindmap-model"
import type {
  EditableStudyDocumentResult,
  StudyDocumentKind,
} from "./document-types"

const ROOT_FOLDER = "__study_document_root__"

export function StudyDocumentCreate({
  initialFolderId,
}: {
  initialFolderId: string | null
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, graph } = useYear()
  const foldersQuery = useQuery({
    ...orpc.materials.folders.list.queryOptions({
      input: materialsFoldersInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const folders = (foldersQuery.data ?? []) as MaterialFolderView[]
  const [kind, setKind] = useState<StudyDocumentKind>("fiche")
  const [title, setTitle] = useState("")
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [titleError, setTitleError] = useState("")
  const kindLabel =
    kind === "fiche"
      ? t("Revision sheet")
      : kind === "note"
        ? t("Note")
        : kind === "mindmap"
          ? t("Mind map")
          : kind === "slides"
            ? t("Slide deck")
            : t("Quiz")

  const folderIds = new Set(folders.map((folder) => folder.id))
  const safeFolderId = folderId && folderIds.has(folderId) ? folderId : null
  const folderOptions = [
    { value: ROOT_FOLDER, label: t("No folder") },
    ...flattenMaterialFolders(folders).map(({ folder, depth }) => ({
      value: folder.id,
      label: `${"— ".repeat(depth)}${folder.name}`,
    })),
  ]
  const subjectOptions: PickerOption[] = useMemo(
    () => [
      { value: "__none__", label: t("No subject") },
      ...graph.flatten().map((subject) => ({
        value: subject.id,
        label: subject.name,
        depth: graph.depthOf(subject.id),
        hint: subject.kind === "category" ? t("group") : undefined,
        disabled: subject.kind === "category",
        keywords: subject.shortName ?? "",
      })),
    ],
    [graph, t]
  )

  const create = useMutation({
    ...orpc.documents.create.mutationOptions(),
    onSuccess: async (created) => {
      const result = created as EditableStudyDocumentResult
      haptic("success")
      queryClient.setQueryData(
        orpc.documents.getForEdit.queryKey({
          input: { documentId: result.document.id },
        }),
        result
      )
      await queryClient.invalidateQueries({
        queryKey: orpc.documents.list.key(),
        refetchType: "all",
      })
      toast.success(t("Document created."))
      router.push(`/materials/fiches/${result.document.id}/edit`)
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The document could not be created."))
    },
  })

  const validateTitle = () => {
    const clean = title.trim()
    const error = !clean
      ? t("Give this document a title.")
      : clean.length > 160
        ? t("Keep the title under 160 characters.")
        : ""
    setTitleError(error)
    return !error
  }

  const steps: FlowStep[] = [
    {
      id: "details",
      title: t("What are you creating?"),
      summary: (
        <span>
          {kindLabel} · {title || t("Untitled")}
        </span>
      ),
      validate: validateTitle,
      content: (
        <div className="flex flex-col gap-4">
          <ChoiceField
            label={t("Document type")}
            value={kind}
            onValueChange={setKind}
            columns={2}
            choices={[
              {
                value: "fiche",
                label: t("Revision sheet"),
                description: t("A structured sheet for learning and review"),
                icon: <NotebookPenIcon className="size-4" />,
              },
              {
                value: "note",
                label: t("Note"),
                description: t("A free-form study document"),
                icon: <FileTextIcon className="size-4" />,
              },
              {
                value: "mindmap",
                label: t("Mind map"),
                description: t("A structured outline with a visual map"),
                icon: <NetworkIcon className="size-4" />,
              },
              {
                value: "slides",
                label: t("Slide deck"),
                description: t("Markdown slides for presenting or exporting"),
                icon: <PresentationIcon className="size-4" />,
              },
              {
                value: "quiz",
                label: t("Quiz"),
                description: t("Questions with saved attempts and scoring"),
                icon: <ListChecksIcon className="size-4" />,
              },
            ]}
          />
          <TextField
            label={t("Title")}
            value={title}
            required
            maxLength={160}
            error={titleError}
            autoFocus
            placeholder={t("Linear algebra essentials")}
            onChange={(event) => {
              setTitle(event.target.value)
              setTitleError("")
            }}
          />
        </div>
      ),
    },
    {
      id: "location",
      title: t("Where does it belong?"),
      description: t("Both links are optional."),
      summary: (
        <span>
          {folderOptions.find(
            (option) => option.value === (safeFolderId ?? ROOT_FOLDER)
          )?.label ?? t("No folder")}
          {subjectId
            ? ` · ${
                subjectOptions.find((option) => option.value === subjectId)
                  ?.label ?? t("Subject")
              }`
            : ""}
        </span>
      ),
      content: (
        <div className="flex flex-col gap-5">
          <SelectField
            label={t("Folder")}
            value={safeFolderId ?? ROOT_FOLDER}
            options={folderOptions}
            onValueChange={(value) =>
              setFolderId(value === ROOT_FOLDER ? null : value)
            }
          />
          <PickerField
            layout="page"
            label={t("Subject")}
            value={subjectId ?? "__none__"}
            options={subjectOptions}
            onValueChange={(value) =>
              setSubjectId(value === "__none__" ? null : value)
            }
          />
        </div>
      ),
    },
  ]

  return (
    <FormFlow
      title={t("New study document")}
      backHref="/materials"
      steps={steps}
      submitLabel={t("Create and start editing")}
      submitting={create.isPending}
      disabled={!yearId || foldersQuery.isPending}
      onSubmit={() => {
        if (!yearId || !validateTitle()) return
        create.mutate({
          yearId,
          kind,
          title: title.trim(),
          bodyMarkdown: kind === "slides" ? `# ${title.trim()}` : "",
          metaJson:
            kind === "mindmap"
              ? createMindmapContent(title, `node:${randomId()}`)
              : kind === "slides"
                ? { version: 1 }
                : kind === "quiz"
                  ? {
                      version: 1,
                      questions: [
                        {
                          kind: "open",
                          prompt: t("First question"),
                          expected: t("Expected answer"),
                        },
                      ],
                    }
                  : null,
          folderId: safeFolderId,
          subjectId,
        })
      }}
    />
  )
}
