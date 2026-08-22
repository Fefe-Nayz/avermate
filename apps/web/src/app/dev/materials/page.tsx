import { dehydrate } from "@tanstack/react-query"
import { notFound } from "next/navigation"
import { getServerOrpc } from "@/lib/orpc/server"
import { createQueryClient } from "@/lib/query-client"
import {
  FIXTURE_NOW,
  FIXTURE_YEAR_ID,
  fixtureSnapshot,
  fixtureYear,
} from "@/components/cards/card-matrix-fixture"
import {
  lectureRecordingsInput,
  materialTagsInput,
  materialsDocumentsInput,
  materialsFoldersInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"
import { DevMaterialsPage } from "./dev-materials-page"

/** Materials on a fixture, outside the authenticated tree. Development only. */
export default async function DevMaterialsRoute() {
  if (process.env.NODE_ENV === "production") notFound()

  const queryClient = createQueryClient()
  const orpc = getServerOrpc()
  const seed = (key: readonly unknown[], value: unknown) => {
    queryClient.setQueryData(
      key as Parameters<typeof queryClient.setQueryData>[0],
      value as never
    )
  }
  const snapshot = fixtureSnapshot()
  const subjectId = snapshot.subjects[0]?.id ?? null

  seed(orpc.years.list.queryKey(), [fixtureYear])
  seed(
    orpc.snapshot.get.queryKey({ input: { yearId: FIXTURE_YEAR_ID } }),
    snapshot
  )
  seed(
    orpc.materials.folders.list.queryKey({
      input: materialsFoldersInput(FIXTURE_YEAR_ID),
    }),
    [
      {
        id: "f-1",
        starredAt: FIXTURE_NOW,
        deletedAt: null,
        tagIds: ["t-1"],
        name: "Chapitre 1 — Les suites",
        parentId: null,
        sortOrder: 0,
        subjectId,
        origin: "manual",
      },
      {
        id: "f-2",
        starredAt: null,
        deletedAt: null,
        tagIds: [],
        name: "Travaux pratiques",
        parentId: null,
        sortOrder: 1,
        subjectId,
        origin: "manual",
      },
      {
        id: "f-3",
        starredAt: null,
        deletedAt: null,
        tagIds: [],
        name: "Corrigés",
        parentId: "f-1",
        sortOrder: 0,
        subjectId,
        origin: "manual",
      },
      {
        id: "f-4",
        starredAt: null,
        deletedAt: null,
        tagIds: ["t-3"],
        name: "Cours Moodle",
        parentId: null,
        sortOrder: 2,
        subjectId,
        origin: "moodle",
      },
    ]
  )
  // Enough rows that the list has to scroll *and* has to virtualise: a pane
  // that fits its contents proves nothing about one that does not, and a
  // hundred rows proves nothing about the thousand a synced year holds.
  const filler = Array.from({ length: 400 }, (_, index) => ({
    document: {
      id: `d-fill-${index}`,
      title: `TD ${index + 1} — exercices corrigés.pdf`,
      folderId: "f-1",
      sourceType: "file" as const,
      sourceUrl: null,
      origin: index % 4 === 0 ? ("moodle" as const) : ("manual" as const),
      // A handful starred and a handful tagged, so Favoris and a tag are not
      // empty lists the moment you click them.
      starredAt: index % 37 === 0 ? FIXTURE_NOW : null,
      deletedAt: null,
      tagIds: index % 11 === 0 ? ["t-2"] : [],
      createdAt: new Date(FIXTURE_NOW.getTime() - index * 86_400_000),
    },
    file: {
      id: `file-fill-${index}`,
      mimeType: "application/pdf",
      byteSize: 400_000 + index * 90_000,
      status: "ready",
      previewStatus: "unsupported" as const,
    },
  }))

  seed(
    orpc.materials.documents.list.queryKey({
      input: materialsDocumentsInput(FIXTURE_YEAR_ID),
    }),
    [
      {
        document: {
          id: "d-1",
          title: "Polycopié — suites numériques.pdf",
          folderId: "f-1",
          sourceType: "file",
          sourceUrl: null,
          origin: "moodle",
          starredAt: FIXTURE_NOW,
          deletedAt: null,
          tagIds: ["t-1", "t-2", "t-3"],
          createdAt: FIXTURE_NOW,
        },
        file: {
          id: "file-1",
          mimeType: "application/pdf",
          byteSize: 2_400_000,
          status: "ready",
        },
      },
      {
        document: {
          id: "d-2",
          title: "Vidéo du cours de mardi",
          folderId: null,
          sourceType: "link",
          sourceUrl: "https://example.org/cours",
          origin: "manual",
          starredAt: null,
          deletedAt: null,
          tagIds: ["t-2"],
          createdAt: FIXTURE_NOW,
        },
        file: null,
      },
      {
        document: {
          id: "d-3",
          title: "Notes prises en TD",
          folderId: "f-2",
          sourceType: "text",
          sourceUrl: null,
          origin: "manual",
          starredAt: null,
          deletedAt: null,
          tagIds: [],
          createdAt: FIXTURE_NOW,
        },
        file: null,
      },
      ...filler,
    ]
  )
  seed(
    orpc.documents.list.queryKey({
      input: studyDocumentsInput(FIXTURE_YEAR_ID),
    }),
    [
      {
        id: "s-1",
        kind: "fiche",
        title: "Fiche de révision — récurrence",
        bodyMarkdown: "# Récurrence",
        revision: 3,
        metaVersion: 1,
        metaJson: { emoji: "📐" },
        folderId: "f-1",
        subjectId,
        yearId: FIXTURE_YEAR_ID,
        starredAt: FIXTURE_NOW,
        deletedAt: null,
        deletedFrom: null,
        deletedBy: null,
        deletedBatchId: null,
        tagIds: ["t-1"],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ]
  )
  seed(
    orpc.recordings.list.queryKey({
      input: lectureRecordingsInput(FIXTURE_YEAR_ID),
    }),
    [
      {
        id: "r-1",
        title: "Cours du 18 août",
        status: "ready",
        recordedAt: FIXTURE_NOW,
        durationMs: 52 * 60 * 1000,
        error: null,
        subjectId,
        folderId: "f-2",
        planningLocator: null,
        yearId: FIXTURE_YEAR_ID,
        starredAt: null,
        deletedAt: null,
        deletedFrom: null,
        deletedBy: null,
        tagIds: [],
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ]
  )

  // Three tags, one of them bound to a subject, so the rail section, the chips
  // and the filter all have something to show.
  seed(
    orpc.materials.tags.list.queryKey({
      input: materialTagsInput(FIXTURE_YEAR_ID),
    }),
    [
      {
        id: "t-1",
        name: "À relire",
        color: "amber",
        subjectId: null,
        yearId: FIXTURE_YEAR_ID,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
      {
        id: "t-2",
        name: "Révisions partiel",
        color: "emerald",
        subjectId,
        yearId: FIXTURE_YEAR_ID,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
      {
        id: "t-3",
        name: "TD corrigé",
        color: "violet",
        subjectId: null,
        yearId: FIXTURE_YEAR_ID,
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ]
  )

  // The bin, so Corbeille is a place with rows in it rather than an empty
  // screen that proves nothing.
  seed(
    orpc.materials.folders.list.queryKey({
      input: materialsFoldersInput(FIXTURE_YEAR_ID, "trashed"),
    }),
    [
      {
        id: "f-old",
        name: "Ancien chapitre",
        parentId: null,
        sortOrder: 9,
        subjectId,
        origin: "manual",
        starredAt: null,
        deletedAt: new Date(FIXTURE_NOW.getTime() - 3 * 86_400_000),
        deletedFrom: null,
        deletedBy: "user",
        tagIds: [],
      },
    ]
  )
  seed(
    orpc.materials.documents.list.queryKey({
      input: materialsDocumentsInput(FIXTURE_YEAR_ID, "trashed"),
    }),
    [
      {
        document: {
          id: "d-trash-1",
          title: "Brouillon.pdf",
          folderId: null,
          sourceType: "file" as const,
          sourceUrl: null,
          origin: "manual" as const,
          starredAt: null,
          deletedAt: new Date(FIXTURE_NOW.getTime() - 86_400_000),
          deletedFrom: "f-1",
          deletedBy: "user" as const,
          tagIds: [],
          createdAt: FIXTURE_NOW,
        },
        file: {
          id: "file-trash-1",
          mimeType: "application/pdf",
          byteSize: 120_000,
          status: "ready",
          previewStatus: "unsupported" as const,
        },
      },
      {
        // Removed upstream rather than by the reader: restoring it would only
        // bring it back until the next sync, so the menu offers one action.
        document: {
          id: "d-trash-2",
          title: "Support retiré de Moodle.pdf",
          folderId: null,
          sourceType: "file" as const,
          sourceUrl: null,
          origin: "moodle" as const,
          starredAt: null,
          deletedAt: new Date(FIXTURE_NOW.getTime() - 2 * 86_400_000),
          deletedFrom: "f-4",
          deletedBy: "provider" as const,
          tagIds: [],
          createdAt: FIXTURE_NOW,
        },
        file: {
          id: "file-trash-2",
          mimeType: "application/pdf",
          byteSize: 980_000,
          status: "ready",
          previewStatus: "unsupported" as const,
        },
      },
    ]
  )
  seed(
    orpc.documents.list.queryKey({
      input: studyDocumentsInput(FIXTURE_YEAR_ID, "trashed"),
    }),
    []
  )
  seed(
    orpc.recordings.list.queryKey({
      input: lectureRecordingsInput(FIXTURE_YEAR_ID, "trashed"),
    }),
    []
  )
  seed(orpc.materials.documents.uploadsEnabled.queryKey(), {
    enabled: true,
    maxBytes: 50 * 1024 * 1024,
    mimeTypes: ["application/pdf", "image/png"],
    extensions: [".pdf", ".png"],
  })

  return <DevMaterialsPage dehydratedState={dehydrate(queryClient)} />
}
