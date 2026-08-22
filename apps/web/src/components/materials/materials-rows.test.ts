import { describe, expect, test } from "bun:test"
import {
  fileBadge,
  filterMaterialRowsByOrigin,
  filterMaterialRowsByType,
  materialRows,
  materialSortFromState,
  searchMaterialRows,
  sortMaterialRows,
  type MaterialRow,
} from "./materials-rows"

/**
 * Everything a folder holds, asked the same questions.
 *
 * Subfolders, uploads, revision sheets and recordings were blocks of markup, each
 * writing its own meta sentence — which is why the pane could never be a table: a column
 * needs every row to answer the same question, and nothing was asking them. This is
 * where the asking happens, so it is where it can be checked.
 */

const labels = {
  folder: "Dossier",
  link: "Lien",
  note: "Note",
  file: "Fichier",
  fiche: "Fiche",
  mindmap: "Carte",
  slides: "Diapos",
  studyNote: "Note",
  recording: "Audio",
}

const at = (day: number) => new Date(2026, 7, day, 12)

const build = (
  folders: { id: string; name: string }[] = [],
  folderCounts?: Map<string, number>
) =>
  materialRows({
    folders: folders.map((folder) => ({
      parentId: null,
      sortOrder: 0,
      subjectId: null,
      origin: "manual" as const,
      starredAt: null,
      deletedAt: null,
      ...folder,
    })),
    folderCounts,
    documents: [
      {
        document: {
          id: "d-pdf",
          title: "Polycopié.pdf",
          folderId: null,
          sourceType: "file",
          sourceUrl: null,
          origin: "moodle",
          starredAt: null,
          deletedAt: null,
          createdAt: at(3),
        },
        file: {
          id: "f",
          mimeType: "application/pdf",
          byteSize: 2_400_000,
          status: "ready",
        },
      },
      {
        document: {
          id: "d-link",
          title: "Cours filmé",
          folderId: null,
          sourceType: "link",
          sourceUrl: "https://example.org",
          origin: "manual",
          starredAt: at(4),
          deletedAt: null,
          tagIds: ["tag-revise"],
          createdAt: at(1),
        },
        file: null,
      },
    ],
    studyDocuments: [
      {
        id: "s-1",
        kind: "fiche",
        title: "Écoulements",
        bodyMarkdown: "",
        revision: 1,
        metaVersion: 1,
        metaJson: null,
        folderId: null,
        subjectId: null,
        yearId: "y",
        createdAt: at(2),
        updatedAt: at(5),
      },
    ] as never,
    recordings: [
      {
        id: "r-1",
        title: "Cours du 18",
        status: "ready",
        recordedAt: at(4),
        durationMs: 3_120_000,
        error: null,
        subjectId: null,
        folderId: null,
        planningLocator: null,
        yearId: "y",
        createdAt: at(4),
        updatedAt: at(4),
      },
    ] as never,
    labels,
  })

describe("the badge a row wears", () => {
  test("is the extension, which is what people recognise", () => {
    // `application/vnd.openxmlformats-officedocument…` is not a type anybody reads.
    expect(fileBadge("Polycopié.pdf", "application/pdf")).toBe("PDF")
    expect(fileBadge("Kit.zip", "application/zip")).toBe("ZIP")
  })

  test("falls back to the MIME subtype when there is no extension", () => {
    expect(fileBadge("scan", "image/png")).toBe("PNG")
  })

  test("never invents one", () => {
    expect(fileBadge("scan", null)).toBe("FILE")
  })
})

describe("one list from every source", () => {
  test("asks every row the same questions", () => {
    const rows = build()

    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.badge).sort()).toEqual([
      "AUDIO",
      "FICHE",
      "LIEN",
      "PDF",
    ])
  })

  test("measures what can be measured and says nothing otherwise", () => {
    const rows = build()
    const byId = new Map(rows.map((row) => [row.id, row]))

    expect(byId.get("d-pdf")?.bytes).toBe(2_400_000)
    expect(byId.get("r-1")?.durationMs).toBe(3_120_000)
    // A link and a revision sheet have no size; the column stays empty rather than
    // showing a zero, which would read as an empty file.
    expect(byId.get("d-link")?.bytes).toBeNull()
    expect(byId.get("s-1")?.bytes).toBeNull()
  })

  test("dates a study document by its last edit, not its creation", () => {
    // A fiche is written over weeks; the day it was started is not what a reader
    // sorting by "modified" is looking for.
    expect(build().find((row) => row.id === "s-1")?.modifiedAt).toEqual(at(5))
  })

  test("a subfolder is a row too, counted rather than measured", () => {
    // The rail was the only way into a subfolder. A folder in the list is the way
    // a file browser has always worked: you open what is in front of you.
    const rows = build(
      [{ id: "f-1", name: "Chapitre 1" }],
      new Map([["f-1", 3]])
    )
    const folder = rows.find((row) => row.id === "f-1")

    expect(folder?.kind).toBe("folder")
    expect(folder?.itemCount).toBe(3)
    // Bytes would be a lie and a date it does not have would be another.
    expect(folder?.bytes).toBeNull()
    expect(folder?.modifiedAt).toBeNull()
  })
})

describe("finding a row", () => {
  test("ignores case and accents", () => {
    // Typing "ecoulements" has to find "Écoulements", or the search is a trap.
    expect(
      searchMaterialRows(build(), "ecoulements").map((row) => row.id)
    ).toEqual(["s-1"])
  })

  test("an empty query keeps everything", () => {
    expect(searchMaterialRows(build(), "   ")).toHaveLength(4)
  })

  test("includes a material whose indexed transcript matched on the server", () => {
    expect(
      searchMaterialRows(build(), "moment cinétique", new Set(["d-pdf"])).map(
        (row) => row.id
      )
    ).toEqual(["d-pdf"])
  })
})

describe("narrowing to one type", () => {
  test("keeps only that type", () => {
    expect(
      filterMaterialRowsByType(build(), "PDF").map((row) => row.id)
    ).toEqual(["d-pdf"])
  })

  test("but never hides a folder", () => {
    // Filtering a folder away would take the only way into it out of the pane.
    const rows = filterMaterialRowsByType(
      build([{ id: "f-1", name: "Chapitre 1" }]),
      "PDF"
    )

    expect(rows.map((row) => row.id)).toEqual(["f-1", "d-pdf"])
  })

  test("no type at all keeps everything", () => {
    expect(filterMaterialRowsByType(build(), null)).toHaveLength(4)
  })
})

describe("narrowing to one origin", () => {
  test("tells what an integration brought in from what you added", () => {
    // A Moodle folder and one you built by hand looked identical, which is
    // exactly when it matters which is which.
    expect(
      filterMaterialRowsByOrigin(build(), "moodle").map((row) => row.id)
    ).toEqual(["d-pdf"])
    expect(
      filterMaterialRowsByOrigin(build(), "manual").map((row) => row.id)
    ).toEqual(["d-link", "s-1", "r-1"])
  })

  test("no origin at all keeps everything", () => {
    expect(filterMaterialRowsByOrigin(build(), null)).toHaveLength(4)
  })
})

describe("ordering", () => {
  const ids = (rows: MaterialRow[]) => rows.map((row) => row.id)

  test("by name, in the reader's locale", () => {
    expect(
      ids(sortMaterialRows(build(), { key: "name", direction: "asc" }))
      // "Cours du 18" before "Cours filmé": the two share a prefix and part at the
      // sixth letter, which is where a locale comparison decides.
    ).toEqual(["r-1", "d-link", "s-1", "d-pdf"])
  })

  test("by date, newest last when ascending", () => {
    expect(
      ids(sortMaterialRows(build(), { key: "modified", direction: "asc" }))
    ).toEqual(["d-link", "d-pdf", "r-1", "s-1"])
  })

  test("keeps the rows it cannot measure", () => {
    // Sorting by size must not quietly drop the notes and links.
    expect(
      sortMaterialRows(build(), { key: "size", direction: "desc" })
    ).toHaveLength(4)
  })

  test("folders first, whichever column is in force", () => {
    const rows = build([{ id: "f-zz", name: "Zzz" }])

    // Last by name, last by date — first anyway, because it is the way in.
    expect(
      ids(sortMaterialRows(rows, { key: "name", direction: "asc" }))[0]
    ).toBe("f-zz")
    expect(
      ids(sortMaterialRows(rows, { key: "modified", direction: "desc" }))[0]
    ).toBe("f-zz")
  })
})

describe("the sort the table asks for", () => {
  test("is the column it is sorted by", () => {
    expect(materialSortFromState([{ id: "name", desc: true }])).toEqual({
      key: "name",
      direction: "desc",
    })
  })

  test("and newest first when it is sorted by nothing", () => {
    expect(materialSortFromState([])).toEqual({
      key: "modified",
      direction: "desc",
    })
  })

  test("a column that cannot be sorted by is ignored, not obeyed", () => {
    expect(materialSortFromState([{ id: "actions", desc: false }])).toEqual({
      key: "modified",
      direction: "desc",
    })
  })
})
