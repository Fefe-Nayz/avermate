"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  BookOpenTextIcon,
  CalendarDaysIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  ClipboardPasteIcon,
  Columns3Icon,
  CopyIcon,
  CornerLeftUpIcon,
  DownloadIcon,
  GitForkIcon,
  LayoutGridIcon,
  ListIcon,
  LinkIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PresentationIcon,
  RefreshCwIcon,
  NotebookPenIcon,
  ScanTextIcon,
  ScissorsIcon,
  SearchIcon,
  StarIcon,
  StarOffIcon,
  TagIcon,
  Trash2Icon,
  Undo2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import { SelectControl } from "@/components/forms/controls"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { env } from "@/lib/env"
import { uploadBrowserFile } from "@/lib/file-upload"
import { orpc, rpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingsInput,
  materialTagsInput,
  materialsDocumentsInput,
  materialsFoldersInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"
import { cn } from "@/lib/utils"
import { LinkIngestionBadge, LinkProvenance } from "./link-ingestion-status"
import {
  MaterialDeleteDialog,
  MaterialAllTranscribeDialog,
  MaterialDocumentDialog,
  MaterialFolderDialog,
  MaterialFolderTranscribeDialog,
} from "./material-dialogs"
import {
  MaterialTranscriptionProgress,
  type MaterialTranscriptionBatchProgress,
} from "./material-transcription-progress"
import { MaterialViewer } from "./material-viewer"
import {
  MATERIALS_FOLDER_PARAM,
  MATERIALS_MODE_PARAM,
  MATERIALS_OPEN_PARAM,
  MATERIALS_TAB_PARAM,
  MATERIALS_TAG_PARAM,
  materialsOpenHref,
  ROOT_MATERIALS,
  locationFolderId,
  locationHolds,
  locationShowsFolder,
  materialsLocationHref,
  materialsSearchScope,
  parseMaterialsLocation,
  resolveMaterialsLocation,
  scopeHolds,
  type MaterialsLocation,
} from "./materials-location"
import {
  filterMaterialRowsByLocation,
  filterMaterialRowsByOrigin,
  filterMaterialRowsByTag,
  filterMaterialRowsByType,
  formatBytes,
  materialRows,
  searchMaterialRows,
  sortMaterialRows,
  type MaterialRow,
  type MaterialSort,
} from "./materials-rows"
import {
  materialTagChipClass,
  materialTagCounts,
  materialTagDotClass,
  resolveMaterialTags,
} from "./materials-tags"
import {
  MaterialDocumentPane,
  type MaterialPaneTab,
} from "./material-document-pane"
import type { MaterialRenderMode } from "./renderers"
import { useMaterialPreviews } from "./use-material-previews"
import { MaterialsGrid } from "./materials-grid"
import {
  OPTIONAL_MATERIAL_COLUMNS,
  type MaterialRowPresentation,
  type MaterialsView,
} from "./materials-presentation"
import { MaterialsTable } from "./materials-table"
import { MaterialsFolderTree } from "./materials-tree"
import type { StudyDocument } from "@/components/documents/document-types"
import { formatRecordingTimestamp } from "@/components/recordings/recording-model"
import type { LectureRecordingView } from "@/components/recordings/recording-types"
import { canMoveMaterialFolder, materialFolderBranch } from "./materials-model"
import { MaterialMoveDialog } from "./material-move-dialog"
import {
  contextMenuKit,
  dropdownMenuKit,
  type MaterialMenuKit,
} from "./materials-menu"
import type {
  MaterialDeleteTarget,
  MaterialDocumentDialogState,
  MaterialDocumentView,
  MaterialFolderDialogState,
  MaterialFolderView,
  MaterialOrigin,
  MaterialTagView,
} from "./materials-types"

const MAX_FILES_PER_UPLOAD_BATCH = 10
const MAX_POLLED_LINKS = 40

const DEFAULT_COURSE_MATERIAL_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".odt",
  ".odp",
  ".ods",
] as const

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot < 0 ? "" : name.slice(dot).toLowerCase()
}

/**
 * The materials browser.
 *
 * Two panes that fill the window: a folder tree on the left, the contents of
 * the selected folder on the right, as a table. Both are the project's own
 * components — `Tree` and the data grid — rather than the hand-built lists that
 * were here, so keyboard navigation, sortable and resizable columns, the sticky
 * header and the fold state come from the components.
 *
 * Where you are lives in the address (`?folder=…`), which is what lets the app's
 * header breadcrumb say it, a folder be linked to, and the back button go back
 * a folder.
 */
export function MaterialsClient() {
  const t = useExtracted()
  const locale = useLocale()
  const { yearId, subjects } = useYear()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const fileInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dropActive, setDropActive] = useState(false)
  const [uploadingBatch, setUploadingBatch] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [folderDialog, setFolderDialog] =
    useState<MaterialFolderDialogState | null>(null)
  const [documentDialog, setDocumentDialog] =
    useState<MaterialDocumentDialogState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MaterialDeleteTarget | null>(
    null
  )
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [originFilter, setOriginFilter] = useState("")
  const [tagFilter, setTagFilter] = useState("")
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<{
    ids: readonly string[]
    label: string | null
  } | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  const [clipboard, setClipboard] = useState<readonly string[]>([])
  const [view, setView] = useState<MaterialsView>("table")
  const [sort, setSort] = useState<MaterialSort>({
    key: "modified",
    direction: "desc",
  })
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [viewer, setViewer] = useState<{
    row: MaterialDocumentView
    initialTab: "source" | "transcript"
  } | null>(null)
  const [folderTranscribe, setFolderTranscribe] = useState<{
    folder: MaterialFolderView
    candidates: number
    skipped: number
  } | null>(null)
  const [allTranscribe, setAllTranscribe] = useState<{
    candidates: number
    skipped: number
  } | null>(null)
  const [batchStreamConnection, setBatchStreamConnection] = useState<{
    batchId: string
    state: "live" | "fallback" | "idle"
  } | null>(null)
  const [folderJobIds, setFolderJobIds] = useState<string[]>([])

  /**
   * Where you are, before anything is known about what is there.
   *
   * The bin is the same four lists read with `include: "trashed"`, so the
   * location has to be parsed ahead of the queries that depend on it. It is
   * resolved against the real folders further down — a link to a folder that
   * no longer exists falls back to the root, and that cannot be decided yet.
   */
  const rawLocation = parseMaterialsLocation(
    searchParams.get(MATERIALS_FOLDER_PARAM),
    searchParams.get(MATERIALS_TAG_PARAM)
  )
  const inTrash = rawLocation.kind === "trash"
  const deferredSearchQuery = useDeferredValue(query.trim())

  const foldersQuery = useQuery({
    ...orpc.materials.folders.list.queryOptions({
      input: materialsFoldersInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const documentsQuery = useQuery({
    ...orpc.materials.documents.list.queryOptions({
      input: materialsDocumentsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const documentContentSearchQuery = useQuery({
    ...orpc.materials.documents.search.queryOptions({
      input: {
        yearId: yearId ?? "",
        query: deferredSearchQuery || "_",
        include: inTrash ? "trashed" : "live",
      },
    }),
    enabled: Boolean(yearId && deferredSearchQuery),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const studyDocumentsQuery = useQuery({
    ...orpc.documents.list.queryOptions({
      input: studyDocumentsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const recordingsQuery = useQuery({
    ...orpc.recordings.list.queryOptions({
      input: lectureRecordingsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.some(
        (recording) =>
          recording.status === "transcribing" || recording.status === "deleting"
      )
        ? 1_500
        : false,
  })
  const tagsQuery = useQuery({
    ...orpc.materials.tags.list.queryOptions({
      input: materialTagsInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  /**
   * The bin.
   *
   * Four more reads, and they only run once you are actually looking at it:
   * a deleted row is not something the browser ever needs in the background,
   * and paying for it on every visit to Supports would double the screen's
   * cost to show a count almost nobody is waiting on.
   */
  const trashEnabled = Boolean(yearId) && inTrash
  const trashFoldersQuery = useQuery({
    ...orpc.materials.folders.list.queryOptions({
      input: materialsFoldersInput(yearId ?? "", "trashed"),
    }),
    enabled: trashEnabled,
  })
  const trashDocumentsQuery = useQuery({
    ...orpc.materials.documents.list.queryOptions({
      input: materialsDocumentsInput(yearId ?? "", "trashed"),
    }),
    enabled: trashEnabled,
  })
  const trashStudyDocumentsQuery = useQuery({
    ...orpc.documents.list.queryOptions({
      input: studyDocumentsInput(yearId ?? "", "trashed"),
    }),
    enabled: trashEnabled,
  })
  const trashRecordingsQuery = useQuery({
    ...orpc.recordings.list.queryOptions({
      input: lectureRecordingsInput(yearId ?? "", "trashed"),
    }),
    enabled: trashEnabled,
  })

  const availability = useQuery({
    ...orpc.materials.documents.uploadsEnabled.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const activeBatchOptions = useMemo(
    () =>
      orpc.materials.documents.activeTranscriptionBatch.queryOptions({
        input: { yearId: yearId ?? "" },
      }),
    [yearId]
  )
  const activeTranscriptionBatch = useQuery({
    ...activeBatchOptions,
    enabled: Boolean(yearId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "running" ? 10_000 : false
    },
  })
  const folderJobs = useQueries({
    queries: folderJobIds.map((jobId) => ({
      ...orpc.jobs.get.queryOptions({ input: { jobId } }),
      refetchInterval: (query: { state: { data?: { status?: string } } }) =>
        query.state.data?.status === "queued" ||
        query.state.data?.status === "running"
          ? 1_500
          : false,
    })),
  })

  const batchProgress = activeTranscriptionBatch.data as
    MaterialTranscriptionBatchProgress | null | undefined
  const batchIsActive = batchProgress?.status === "running"
  const activeBatchId = batchProgress?.id ?? null

  useEffect(() => {
    if (!activeBatchId || !batchIsActive) return
    if (typeof EventSource === "undefined") return
    const source = new EventSource(
      `${env.apiUrl}/api/materials/transcription-batches/${encodeURIComponent(activeBatchId)}/events`,
      { withCredentials: true }
    )
    source.onopen = () =>
      setBatchStreamConnection({ batchId: activeBatchId, state: "live" })
    source.onerror = () =>
      setBatchStreamConnection({ batchId: activeBatchId, state: "fallback" })
    source.addEventListener("progress", (event) => {
      try {
        const next = JSON.parse(
          (event as MessageEvent<string>).data
        ) as MaterialTranscriptionBatchProgress
        if (next.id !== activeBatchId) return
        queryClient.setQueryData(activeBatchOptions.queryKey, next)
        setBatchStreamConnection({
          batchId: activeBatchId,
          state: next.status === "running" ? "live" : "idle",
        })
      } catch {
        setBatchStreamConnection({
          batchId: activeBatchId,
          state: "fallback",
        })
      }
    })
    source.addEventListener("stream-error", () => {
      setBatchStreamConnection({ batchId: activeBatchId, state: "fallback" })
    })
    return () => source.close()
  }, [activeBatchOptions.queryKey, activeBatchId, batchIsActive, queryClient])
  const batchStreamState = !batchIsActive
    ? "idle"
    : typeof EventSource === "undefined"
      ? "fallback"
      : batchStreamConnection?.batchId === activeBatchId
        ? batchStreamConnection.state
        : "connecting"

  const folders = useMemo<readonly MaterialFolderView[]>(
    () => foldersQuery.data ?? [],
    [foldersQuery.data]
  )
  const documents = useMemo<readonly MaterialDocumentView[]>(
    () => documentsQuery.data ?? [],
    [documentsQuery.data]
  )
  const studyDocuments = useMemo(
    () => (studyDocumentsQuery.data ?? []) as StudyDocument[],
    [studyDocumentsQuery.data]
  )
  const recordings = useMemo(
    () => (recordingsQuery.data ?? []) as LectureRecordingView[],
    [recordingsQuery.data]
  )
  const tags = useMemo(
    () => (tagsQuery.data ?? []) as MaterialTagView[],
    [tagsQuery.data]
  )
  const documentContentMatches = useMemo(
    () => new Set(documentContentSearchQuery.data ?? []),
    [documentContentSearchQuery.data]
  )
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))

  const location = resolveMaterialsLocation(
    rawLocation,
    new Set(folderById.keys()),
    new Set(tagById.keys())
  )

  /**
   * What the pane reads.
   *
   * The rail always shows the live folder tree — a bin you cannot leave by
   * clicking a folder is a trap — so the deleted rows are a second set of
   * lists rather than a replacement for the first.
   */
  const paneFolders: readonly MaterialFolderView[] = inTrash
    ? (trashFoldersQuery.data ?? [])
    : folders
  const paneDocuments: readonly MaterialDocumentView[] = inTrash
    ? (trashDocumentsQuery.data ?? [])
    : documents
  const paneStudyDocuments = (
    inTrash ? (trashStudyDocumentsQuery.data ?? []) : studyDocuments
  ) as StudyDocument[]
  const paneRecordings = (
    inTrash ? (trashRecordingsQuery.data ?? []) : recordings
  ) as LectureRecordingView[]
  const selectedFolder =
    location.kind === "folder"
      ? (folderById.get(location.folderId) ?? null)
      : null
  const destinationFolderId = locationFolderId(location)

  /**
   * Moving between folders rewrites the address without going back to the
   * server: nothing on this screen is rendered there, and a round trip per
   * folder is what makes a browser feel like a website. `useSearchParams` picks
   * the change up, so the pane, the rail and the header trail all follow.
   */
  const selectLocation = useCallback((next: MaterialsLocation) => {
    haptic("selection")
    window.history.pushState(null, "", materialsLocationHref(next))
  }, [])
  const locationLink = useCallback(
    (next: MaterialsLocation) => ({
      href: materialsLocationHref(next),
      // Nothing to prefetch: the destination is this same screen.
      prefetch: false,
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return
        }
        event.preventDefault()
        setRailOpen(false)
        selectLocation(next)
      },
    }),
    [selectLocation]
  )

  const newStudyDocumentHref = destinationFolderId
    ? `/materials/fiches/new?folderId=${encodeURIComponent(destinationFolderId)}`
    : "/materials/fiches/new"
  const newRecordingHref = destinationFolderId
    ? `/materials/recordings/new?folderId=${encodeURIComponent(destinationFolderId)}`
    : "/materials/recordings/new"

  /**
   * Searching looks through the whole branch below you, not just the folder you
   * happen to be standing in — a search that only reads the current folder
   * cannot find anything you have filed, which is the only time you need one.
   */
  const searching = query.trim().length > 0
  const searchScope = materialsSearchScope(
    location,
    (folderId) => materialFolderBranch(folders, folderId),
    folders.map((folder) => folder.id)
  )
  const holds = (folderId: string | null) =>
    searching
      ? scopeHolds(searchScope, folderId)
      : locationHolds(location, folderId)

  const visibleDocuments = paneDocuments.filter(({ document }) =>
    holds(document.folderId)
  )
  const visibleStudyDocuments = paneStudyDocuments.filter((document) =>
    holds(document.folderId)
  )
  const visibleRecordings = paneRecordings.filter((recording) =>
    holds(recording.folderId)
  )
  // The folders you can walk into from here — or, while searching, every folder
  // in scope, so a folder can be found by name too.
  const visibleFolders = paneFolders.filter((folder) =>
    searching && !inTrash
      ? searchScope.folderIds.has(folder.id) &&
        folder.id !== destinationFolderId
      : locationShowsFolder(location, folder.parentId)
  )

  /**
   * Import status is polled per link, so a flat view of a whole year would open
   * one query per link and keep them all alive. The cap is generous for a
   * folder and firm enough that "everything" cannot melt: past it, the badge
   * stops reporting rather than the screen stopping.
   */
  const visibleLinkDocuments = visibleDocuments
    .filter(({ document }) => document.sourceType === "link")
    .slice(0, MAX_POLLED_LINKS)
  const linkTranscripts = useQueries({
    queries: visibleLinkDocuments.map(({ document }) => ({
      ...orpc.materials.documents.transcript.queryOptions({
        input: { documentId: document.id },
      }),
      staleTime: COMMON_QUERY_STALE_TIME,
      refetchInterval: (query: { state: { data?: { status?: string } } }) =>
        query.state.data?.status === "pending" ? 1_500 : false,
    })),
  })
  const linkTranscriptById = new Map(
    visibleLinkDocuments.map(({ document }, index) => [
      document.id,
      linkTranscripts[index],
    ])
  )
  const linkStatusSnapshot = JSON.stringify(
    visibleLinkDocuments.map(({ document }, index) => [
      document.id,
      linkTranscripts[index]?.data?.status ?? "loading",
    ])
  )
  const previousLinkStatuses = useRef(new Map<string, string>())

  useEffect(() => {
    const next = new Map<string, string>(JSON.parse(linkStatusSnapshot))
    const reachedTerminal = [...next].some(
      ([documentId, status]) =>
        previousLinkStatuses.current.get(documentId) === "pending" &&
        (status === "ready" || status === "failed")
    )
    previousLinkStatuses.current = next
    if (reachedTerminal) {
      void queryClient.invalidateQueries({
        queryKey: orpc.materials.documents.list.key(),
      })
    }
  }, [linkStatusSnapshot, queryClient])

  /**
   * How many things sit in each folder.
   *
   * Two maps, built once per data change rather than per render: the rail
   * shows one number per folder and the table shows another per row, and
   * rebuilding both while somebody types in the search box is work nothing
   * asked for.
   */
  const directCounts = useMemo(() => {
    const counts = new Map<string | null, number>()
    const add = (folderId: string | null) =>
      counts.set(folderId, (counts.get(folderId) ?? 0) + 1)
    for (const { document } of documents) add(document.folderId)
    for (const document of studyDocuments) add(document.folderId)
    for (const recording of recordings) add(recording.folderId)
    return counts
  }, [documents, recordings, studyDocuments])

  const folderCounts = useMemo(() => {
    const children = new Map<string | null, number>()
    for (const folder of folders) {
      children.set(folder.parentId, (children.get(folder.parentId) ?? 0) + 1)
    }
    const counts = new Map<string, number>()
    for (const folder of folders) {
      counts.set(
        folder.id,
        (directCounts.get(folder.id) ?? 0) + (children.get(folder.id) ?? 0)
      )
    }
    return counts
  }, [directCounts, folders])

  /**
   * One list, from every source, asked the same questions.
   *
   * The pane could not become a table while a subfolder, an upload, a revision
   * sheet and a recording each wrote their own sentence of metadata: a column
   * needs every row to answer the same question.
   */
  const rowLabels = useMemo(
    () => ({
      folder: t("Folder"),
      link: t("Link"),
      note: t("Note"),
      file: t("File"),
      fiche: t("Sheet"),
      mindmap: t("Map"),
      slides: t("Slides"),
      studyNote: t("Note"),
      quiz: t("Quiz"),
      latex: t("LaTeX document"),
      recording: t("Audio"),
    }),
    [t]
  )
  const rows = materialRows({
    folders: visibleFolders,
    documents: visibleDocuments,
    studyDocuments: visibleStudyDocuments,
    recordings: visibleRecordings,
    folderCounts,
    labels: rowLabels,
  })
  // The location is an object rebuilt on every render, so the memos below key
  // off what actually distinguishes one from another.
  const locationKind = location.kind
  const locationTagId = location.kind === "tag" ? location.tagId : null
  const typeOptions = (() => {
    const byBadge = new Map<string, string>()
    for (const row of rows) {
      if (row.kind === "folder") continue
      byBadge.set(row.badge, row.typeLabel)
    }
    return [
      { value: "", label: t("All types") },
      ...[...byBadge]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([badge, label]) => ({ value: badge, label })),
    ]
  })()
  // Ordered here rather than inside either view, so switching between the
  // table and the grid keeps the order, and so the comparison stays
  // locale-aware: a byte-by-byte sort puts "École" after "Zèbre".
  const visibleRows = sortMaterialRows(
    // The location filter runs first: Favoris and a tag are decided by the row
    // rather than by the folder it sits in, so until it has run the list is
    // still the whole year.
    filterMaterialRowsByTag(
      filterMaterialRowsByOrigin(
        filterMaterialRowsByType(
          searchMaterialRows(
            filterMaterialRowsByLocation(rows, location),
            query,
            documentContentMatches
          ),
          typeFilter || null
        ),
        (originFilter || null) as MaterialOrigin | null
      ),
      tagFilter || null
    ),
    sort,
    locale
  )
  /**
   * How many rows wear each tag, across the year rather than this folder.
   *
   * A count that changed as you walked into a folder would be a count of what
   * happens to be on screen, which is not what a tag is: the rail is offering
   * a place to go, and the number has to say what is waiting there.
   */
  const yearRows = useMemo(
    () =>
      materialRows({
        folders,
        documents,
        studyDocuments,
        recordings,
        labels: rowLabels,
      }),

    [documents, folders, recordings, rowLabels, studyDocuments]
  )
  const tagCounts = useMemo(() => materialTagCounts(yearRows), [yearRows])
  const starredTotal = yearRows.filter((row) => row.starred).length
  const tagOptions = useMemo(
    () => [
      { value: "", label: t("Every tag") },
      ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
    ],
    [tags, t]
  )

  const originOptions = useMemo(
    () => [
      { value: "", label: t("Every source") },
      { value: "manual", label: t("Added by me") },
      { value: "moodle", label: t("From Moodle") },
      { value: "onedrive", label: t("From OneDrive") },
      { value: "googledrive", label: t("From Google Drive") },
    ],
    [t]
  )
  // Only worth offering where something actually came from elsewhere.
  const hasImported = rows.some((row) => row.origin !== "manual")

  /**
   * Arriving with a source named in the address opens it.
   *
   * The command palette can then point at an upload, which has no page of its
   * own, and the viewer is where it lands. The parameter is dropped once it has
   * been honoured, so closing the viewer does not immediately re-open it.
   */
  /**
   * The document being read, from the address.
   *
   * It is looked up across the whole year rather than the current folder: a
   * link to a document is a link to that document, and refusing to open it
   * because you happen to be standing somewhere else would make every shared
   * link conditional on where the reader was last.
   */
  const openParam = searchParams.get(MATERIALS_OPEN_PARAM)
  const openMode: MaterialRenderMode =
    searchParams.get(MATERIALS_MODE_PARAM) === "edit" ? "edit" : "read"
  const openTab: MaterialPaneTab =
    searchParams.get(MATERIALS_TAB_PARAM) === "transcript"
      ? "transcript"
      : "source"
  const openRow = useMemo(
    () =>
      openParam ? (yearRows.find((row) => row.id === openParam) ?? null) : null,
    [openParam, yearRows]
  )

  const openDocument = useCallback(
    (
      row: MaterialRow,
      options: { mode?: MaterialRenderMode; tab?: MaterialPaneTab } = {}
    ) => {
      haptic("selection")
      window.history.pushState(
        null,
        "",
        materialsOpenHref(location, row.id, options)
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locationKind, locationTagId, destinationFolderId]
  )
  const closeDocument = useCallback(() => {
    window.history.pushState(null, "", materialsLocationHref(location))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKind, locationTagId, destinationFolderId])

  /**
   * A selection belongs to the list it was made in. Carrying it into another
   * folder would leave "9 selected" acting on rows nobody can see.
   */
  const locationKey = materialsLocationHref(location)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selection is scoped to this URL-backed location
    setSelectedIds(new Set())
  }, [locationKey])

  const rowById = new Map(visibleRows.map((row) => [row.id, row]))
  const selectedRows = [...selectedIds].flatMap((id) => {
    const row = rowById.get(id)
    return row ? [row] : []
  })
  // Only an uploaded file has anything to download; a link, a note, a revision
  // sheet and a recording have no stored file behind them.
  const downloadableSelection = selectedRows.filter(
    (row) => row.source.kind === "material" && row.source.row.file !== null
  )

  // A recording has no folder to move it to — the API has never had one — so
  // it is left out of a move rather than silently failing inside one.
  const movableSelection = selectedRows.filter(
    (row) => row.kind !== "recording"
  )
  // A row a sync deleted upstream comes back only until the next sync notices
  // it is gone, so restoring one is a button that undoes itself.
  const restorableSelection = selectedRows.filter((row) => !row.tombstone)

  const invalidateFolders = () =>
    queryClient.invalidateQueries({ queryKey: orpc.materials.folders.key() })
  const invalidateDocuments = () =>
    queryClient.invalidateQueries({ queryKey: orpc.materials.documents.key() })
  const invalidateStudyDocuments = () =>
    queryClient.invalidateQueries({ queryKey: orpc.documents.list.key() })
  const mutationError = (error: Error) => {
    haptic("error")
    toast.error(error.message || t("The material could not be saved."))
  }

  const previewAllTranscription = useMutation({
    ...orpc.materials.documents.transcribeAll.mutationOptions(),
    onSuccess: (result) => {
      setAllTranscribe({
        candidates: result.candidates,
        skipped: result.skipped,
      })
    },
    onError: mutationError,
  })
  const transcribeAll = useMutation({
    ...orpc.materials.documents.transcribeAll.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setAllTranscribe(null)
      toast.success(
        result.alreadyRunning
          ? t("The transcription batch is already running.")
          : t("{count} transcription jobs queued.", {
              count: String(result.enqueued),
            })
      )
      await queryClient.invalidateQueries({
        queryKey: activeBatchOptions.queryKey,
      })
    },
    onError: mutationError,
  })

  const createFolder = useMutation({
    ...orpc.materials.folders.create.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setFolderDialog(null)
      toast.success(t("Folder created."))
      await invalidateFolders()
    },
    onError: mutationError,
  })
  const renameFolder = useMutation({
    ...orpc.materials.folders.rename.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setFolderDialog(null)
      toast.success(t("Folder renamed."))
      await invalidateFolders()
    },
    onError: mutationError,
  })
  const moveFolder = useMutation({
    ...orpc.materials.folders.move.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setFolderDialog(null)
      toast.success(t("Folder moved."))
      await invalidateFolders()
    },
    onError: mutationError,
  })
  const deleteFolder = useMutation({
    ...orpc.materials.folders.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDeleteTarget(null)
      selectLocation(ROOT_MATERIALS)
      toast.success(t("Folder deleted."))
      await Promise.all([
        invalidateFolders(),
        invalidateDocuments(),
        invalidateStudyDocuments(),
      ])
    },
    onError: mutationError,
  })

  const upload = useMutation({
    ...orpc.materials.documents.upload.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Material uploaded."))
      await invalidateDocuments()
    },
    onError: mutationError,
  })
  const createText = useMutation({
    ...orpc.materials.documents.createText.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDocumentDialog(null)
      toast.success(t("Note saved."))
      await invalidateDocuments()
    },
    onError: mutationError,
  })
  const createLink = useMutation({
    ...orpc.materials.documents.createLink.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setDocumentDialog(null)
      queryClient.setQueryData(
        orpc.materials.documents.transcript.queryKey({
          input: { documentId: result.document.id },
        }),
        { status: "pending", content: null, meta: null, error: null }
      )
      toast.success(t("Link added. Content import started."))
      await invalidateDocuments()
    },
    onError: mutationError,
  })
  const reingestLink = useMutation({
    ...orpc.materials.documents.reingest.mutationOptions(),
    onSuccess: (result, input) => {
      haptic("success")
      queryClient.setQueryData(
        orpc.materials.documents.transcript.queryKey({
          input: { documentId: input.documentId },
        }),
        { status: result.status, content: null, meta: null, error: null }
      )
      toast.success(t("Link import queued."))
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The link could not be imported."))
    },
  })
  const renameDocument = useMutation({
    ...orpc.materials.documents.rename.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDocumentDialog(null)
      toast.success(t("Material renamed."))
      await invalidateDocuments()
    },
    onError: mutationError,
  })
  const moveDocument = useMutation({
    ...orpc.materials.documents.move.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDocumentDialog(null)
      toast.success(t("Material moved."))
      await invalidateDocuments()
    },
    onError: mutationError,
  })
  const deleteDocument = useMutation({
    ...orpc.materials.documents.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDeleteTarget(null)
      toast.success(t("Material deleted."))
      await invalidateDocuments()
    },
    onError: mutationError,
  })
  const previewFolderTranscription = useMutation({
    ...orpc.materials.documents.transcribeFolder.mutationOptions(),
    onSuccess: (result, input) => {
      const folder = folderById.get(input.folderId)
      if (!folder) return
      setFolderTranscribe({
        folder,
        candidates: result.candidates,
        skipped: result.skipped,
      })
    },
    onError: mutationError,
  })
  const transcribeFolder = useMutation({
    ...orpc.materials.documents.transcribeFolder.mutationOptions(),
    onSuccess: (result) => {
      haptic("success")
      setFolderTranscribe(null)
      setFolderJobIds(result.jobIds)
      toast.success(
        t("{count} transcription jobs queued.", {
          count: String(result.enqueued),
        })
      )
    },
    onError: mutationError,
  })

  /**
   * Acting on several rows at once.
   *
   * The per-row mutations each raise their own toast, and nine of them would be
   * nine toasts on top of each other. These call the procedures directly, run
   * them one at a time so a failure cannot take the rest down, and report once.
   */
  const refreshEverything = () =>
    Promise.all([
      invalidateFolders(),
      invalidateDocuments(),
      invalidateStudyDocuments(),
      queryClient.invalidateQueries({ queryKey: orpc.recordings.list.key() }),
    ])

  /**
   * Marking something a favourite.
   *
   * One procedure for all four kinds of row, which is why `MaterialRow` carries
   * a `target`: the alternative is four mutations that differ only in the name
   * of the id, and a fifth bug the day a fifth kind appears.
   */
  const star = useMutation({
    ...orpc.materials.star.mutationOptions(),
    onSuccess: async () => {
      haptic("selection")
      await refreshEverything()
    },
    onError: mutationError,
  })
  const toggleStar = useCallback(
    (row: MaterialRow) => {
      star.mutate({ ...row.target, starred: !row.starred })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [star.mutate]
  )

  /**
   * Getting something back.
   *
   * `deletedFrom` is what makes this worth having: the server puts a row back
   * in the folder it was deleted from rather than at the root, so undoing a
   * mistake leaves the tree as it was rather than as a pile at the top.
   */
  const restore = useMutation({
    ...orpc.materials.restore.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Restored."))
      await refreshEverything()
    },
    onError: mutationError,
  })
  const purge = useMutation({
    ...orpc.materials.purge.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await refreshEverything()
    },
    onError: mutationError,
  })
  const emptyTrash = useMutation({
    ...orpc.materials.emptyTrash.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setEmptyTrashOpen(false)
      toast.success(
        t("{count, plural, one {# item deleted} other {# items deleted}}", {
          count: (result as { purged: number }).purged,
        })
      )
      await refreshEverything()
    },
    onError: mutationError,
  })

  const assignTag = useMutation({
    ...orpc.materials.tags.assign.mutationOptions(),
    onSuccess: async () => {
      haptic("selection")
      await refreshEverything()
    },
    onError: mutationError,
  })
  // Creating, renaming and deleting a tag are screens of their own now —
  // /materials/tags — so the browser only ever assigns them.

  /** Runs a batch one at a time, so one failure cannot take the rest down. */
  const runJobs = async (jobs: readonly (() => Promise<unknown>)[]) => {
    setBulkPending(true)
    let done = 0
    let failed = 0
    for (const job of jobs) {
      try {
        await job()
        done += 1
      } catch {
        failed += 1
      }
    }
    setBulkPending(false)
    setSelectedIds(new Set())
    await refreshEverything()
    if (failed > 0) {
      haptic("error")
      toast.error(
        t("{done} done, {failed} could not be completed.", {
          done: String(done),
          failed: String(failed),
        })
      )
      return
    }
    haptic("success")
    return done
  }

  const runOnSelection = async (
    targets: readonly MaterialRow[],
    run: (row: MaterialRow) => Promise<unknown>
  ) => {
    setBulkPending(true)
    let done = 0
    let failed = 0
    for (const row of targets) {
      try {
        await run(row)
        done += 1
      } catch {
        failed += 1
      }
    }
    setBulkPending(false)
    setSelectedIds(new Set())
    await refreshEverything()
    if (failed > 0) {
      haptic("error")
      toast.error(
        t("{done} done, {failed} could not be completed.", {
          done: String(done),
          failed: String(failed),
        })
      )
      return
    }
    haptic("success")
    return done
  }

  const bulkDelete = async () => {
    // Folders last: deleting one takes its contents with it, so a file that is
    // already gone would be counted as a failure it is not.
    const ordered = [
      ...selectedRows.filter((row) => row.kind !== "folder"),
      ...selectedRows.filter((row) => row.kind === "folder"),
    ]
    const done = await runOnSelection(ordered, (row) => {
      switch (row.source.kind) {
        case "folder":
          return rpc.materials.folders.delete({ folderId: row.id })
        case "material":
          return rpc.materials.documents.delete({ documentId: row.id })
        case "study":
          return rpc.documents.delete({ documentId: row.id })
        default:
          return rpc.recordings.delete({ recordingId: row.id })
      }
    })
    setBulkDeleteOpen(false)
    if (done !== undefined) {
      toast.success(
        t("{count, plural, one {# item deleted} other {# items deleted}}", {
          count: done,
        })
      )
    }
  }

  /**
   * Saving several files at once.
   *
   * Each URL is minted on demand and points at storage, not at this origin, so
   * an anchor with `download` cannot be trusted to save rather than navigate.
   * Fetching the bytes and handing over a blob does save — and where the fetch
   * is refused, the anchor is still better than nothing.
   */
  const downloadRows = async (targets: readonly MaterialRow[]) => {
    if (targets.length === 0) return
    setBulkPending(true)
    let done = 0
    let failed = 0
    for (const row of targets) {
      try {
        const file = await rpc.materials.documents.download({
          documentId: row.id,
        })
        const anchor = window.document.createElement("a")
        anchor.download = file.title
        anchor.rel = "noreferrer"
        let objectUrl: string | null = null
        try {
          const response = await fetch(file.url)
          if (!response.ok) throw new Error("unavailable")
          objectUrl = URL.createObjectURL(await response.blob())
          anchor.href = objectUrl
        } catch {
          anchor.href = file.url
          anchor.target = "_blank"
        }
        anchor.click()
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        done += 1
      } catch {
        failed += 1
      }
    }
    setBulkPending(false)
    if (failed > 0) {
      haptic("error")
      toast.error(
        t("{done} downloaded, {failed} could not be.", {
          done: String(done),
          failed: String(failed),
        })
      )
      return
    }
    haptic("success")
    toast.success(
      t("{count, plural, one {# file downloaded} other {# files downloaded}}", {
        count: done,
      })
    )
  }

  const bulkDownload = () => downloadRows(downloadableSelection)

  const bulkRestore = async () => {
    const done = await runOnSelection(restorableSelection, (row) =>
      rpc.materials.restore(row.target)
    )
    if (done !== undefined) {
      toast.success(
        t("{count, plural, one {# item restored} other {# items restored}}", {
          count: done,
        })
      )
    }
  }

  const bulkPurge = async () => {
    // Folders last, as with the recoverable delete: purging one takes its
    // contents with it, and a row already gone is not a failure.
    const ordered = [
      ...selectedRows.filter((row) => row.kind !== "folder"),
      ...selectedRows.filter((row) => row.kind === "folder"),
    ]
    const done = await runOnSelection(ordered, (row) =>
      rpc.materials.purge(row.target)
    )
    if (done !== undefined) {
      toast.success(
        t("{count, plural, one {# item deleted} other {# items deleted}}", {
          count: done,
        })
      )
    }
  }

  /** Cutting one row, or the whole selection when that row is part of it. */
  const cutRow = (row: MaterialRow) => {
    const ids = selectedIds.has(row.id) ? [...selectedIds] : [row.id]
    setClipboard(ids)
    setSelectedIds(new Set())
    toast.success(
      t("{count, plural, one {# item cut} other {# items cut}}", {
        count: ids.length,
      })
    )
  }

  /**
   * Filing things, whatever asked for it: the menu, a drag onto a folder, or a
   * paste. Ids rather than rows, because a paste happens in a different folder
   * from the cut — by then the rows it named are no longer on screen.
   */
  const moveIds = async (ids: readonly string[], target: string | null) => {
    const studyById = new Map(
      studyDocuments.map((document) => [document.id, document])
    )
    const documentIds = new Set(documents.map((row) => row.document.id))
    let skipped = 0
    const jobs: (() => Promise<unknown>)[] = []

    for (const id of ids) {
      if (folderById.has(id)) {
        // The server refuses a folder moved inside itself; refusing it here
        // keeps the count honest rather than reporting a failure.
        if (!canMoveMaterialFolder(folders, id, target)) {
          skipped += 1
          continue
        }
        jobs.push(() =>
          rpc.materials.folders.move({ folderId: id, parentId: target })
        )
        continue
      }
      if (documentIds.has(id)) {
        jobs.push(() =>
          rpc.materials.documents.move({ documentId: id, folderId: target })
        )
        continue
      }
      const study = studyById.get(id)
      if (study) {
        jobs.push(() =>
          rpc.documents.update({
            documentId: id,
            // The server refuses a stale write; this is the revision the list
            // was read at.
            revision: study.revision,
            folderId: target,
          })
        )
        continue
      }
      // A recording has no folder to move it to — the API has never had one.
      skipped += 1
    }

    const done = await runJobs(jobs)
    if (done === undefined) return
    toast.success(
      skipped > 0
        ? t("{count} moved. {skipped} recordings cannot be moved.", {
            count: String(done),
            skipped: String(skipped),
          })
        : t("{count, plural, one {# item moved} other {# items moved}}", {
            count: done,
          })
    )
  }

  const uploadsEnabled = availability.data?.enabled ?? false
  const maxBytes = availability.data?.maxBytes ?? 50 * 1024 * 1024
  const maxDocumentBytes =
    availability.data?.maxDocumentBytes ?? 50 * 1024 * 1024
  const maxMediaBytes = availability.data?.maxMediaBytes ?? maxBytes
  const mimeTypes = availability.data?.mimeTypes ?? [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.presentation",
    "application/vnd.oasis.opendocument.spreadsheet",
  ]
  const extensions: readonly string[] =
    availability.data?.extensions ?? DEFAULT_COURSE_MATERIAL_EXTENSIONS
  const onPickFile = async (file: File | undefined) => {
    if (!file || !yearId) return false
    const isMedia =
      /^(audio|video)\//.test(file.type) ||
      /\.(?:mp3|m4a|wav|ogg|mp4|webm|mov)$/i.test(file.name)
    const fileMaxBytes = isMedia ? maxMediaBytes : maxDocumentBytes
    if (file.size > fileMaxBytes) {
      haptic("error")
      toast.error(
        t("Choose a file smaller than {size}.", {
          size: formatBytes(fileMaxBytes),
        })
      )
      return false
    }
    const declaredMime = file.type.trim().toLowerCase()
    const supportedByMime = mimeTypes.includes(declaredMime)
    const supportedByExtension =
      (declaredMime === "" || declaredMime === "application/octet-stream") &&
      extensions.includes(fileExtension(file.name))
    if (!supportedByMime && !supportedByExtension) {
      haptic("error")
      toast.error(
        t("Choose a supported document, image, spreadsheet or text file.")
      )
      return false
    }
    try {
      let uploaded: Awaited<ReturnType<typeof uploadBrowserFile>>
      try {
        uploaded = await uploadBrowserFile(
          isMedia ? "courseMedia" : "courseMaterial",
          file
        )
      } catch (error) {
        mutationError(
          error instanceof Error ? error : new Error(t("The upload failed."))
        )
        return false
      }
      await upload.mutateAsync({
        yearId,
        folderId: destinationFolderId,
        fileId: uploaded.fileId,
        fileName: file.name,
      })
      return true
    } catch {
      // The mutation's shared error handler already reports this file. Keep
      // the FIFO moving so one bad file does not strand the remaining picks.
      return false
    }
  }
  const onPickFiles = async (files: FileList | readonly File[]) => {
    if (uploadingBatch) return
    const picked = Array.from(files)
    if (picked.length > MAX_FILES_PER_UPLOAD_BATCH) {
      haptic("error")
      toast.error(
        t("Upload at most {count} files at a time.", {
          count: String(MAX_FILES_PER_UPLOAD_BATCH),
        })
      )
      return
    }
    setUploadingBatch(true)
    try {
      // The oRPC transport materializes each File server-side. A small FIFO
      // avoids holding several 50 MiB payloads in memory concurrently.
      for (const file of picked) {
        await onPickFile(file)
      }
    } finally {
      setUploadingBatch(false)
    }
  }
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    if (!uploadsEnabled) return
    dragDepth.current += 1
    setDropActive(true)
  }
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dropActive) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDropActive(false)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    if (!uploadsEnabled) return
    dragDepth.current = 0
    setDropActive(false)
    void onPickFiles(event.dataTransfer.files)
  }

  const folderPending =
    createFolder.isPending || renameFolder.isPending || moveFolder.isPending
  const documentPending =
    createText.isPending ||
    createLink.isPending ||
    renameDocument.isPending ||
    moveDocument.isPending
  const loading =
    foldersQuery.isLoading ||
    documentsQuery.isLoading ||
    studyDocumentsQuery.isLoading ||
    recordingsQuery.isLoading
  const queryError =
    foldersQuery.error ??
    documentsQuery.error ??
    documentContentSearchQuery.error ??
    studyDocumentsQuery.error ??
    recordingsQuery.error
  const polledJobStatuses = folderJobs.flatMap((job) =>
    job.data ? [job.data.status] : []
  )
  const activeFolderJobs =
    polledJobStatuses.filter(
      (status) => status === "queued" || status === "running"
    ).length + folderJobs.filter((job) => job.isPending).length
  const failedFolderJobs =
    polledJobStatuses.filter(
      (status) => status === "failed" || status === "cancelled"
    ).length + folderJobs.filter((job) => job.isError).length
  const completedFolderJobs = polledJobStatuses.filter(
    (status) => status === "succeeded"
  ).length

  const subjectName = (subjectId: string | null) =>
    subjectId
      ? (subjects.find((subject) => subject.id === subjectId)?.name ?? null)
      : null

  /** What a row is, in words and in one glyph. The table draws the geometry. */
  const present = useCallback(
    (row: MaterialRow): MaterialRowPresentation => {
      switch (row.source.kind) {
        case "folder": {
          const folder = row.source.folder
          return {
            icon: <FolderIcon className="size-4" />,
            detail: subjectName(folder.subjectId) ?? undefined,
            link: locationLink({ kind: "folder", folderId: folder.id }),
          }
        }
        case "recording": {
          const recording = row.source.recording
          const statusLabel =
            recording.status === "recording"
              ? t("Interrupted recording")
              : recording.status === "uploaded"
                ? t("Ready to transcribe")
                : recording.status === "transcribing"
                  ? t("Transcribing")
                  : recording.status === "ready"
                    ? t("Transcript ready")
                    : recording.status === "failed"
                      ? t("Transcription failed")
                      : t("Deleting recording")
          return {
            icon: <MicIcon className="size-4" />,
            tone: "accent",
            link: { href: `/materials/recordings/${recording.id}` },
            detail: (
              <>
                {statusLabel}
                <span aria-hidden> · </span>
                {formatRecordingTimestamp(recording.durationMs)}
                {recording.planningLocator ? (
                  <>
                    <span aria-hidden> · </span>
                    <span className="inline-flex items-center gap-1 text-primary">
                      <CalendarDaysIcon className="size-3" />
                      {t("Linked to Planning")}
                    </span>
                  </>
                ) : null}
              </>
            ),
          }
        }
        case "study": {
          const document = row.source.document
          const Icon =
            document.kind === "mindmap"
              ? GitForkIcon
              : document.kind === "slides"
                ? PresentationIcon
                : BookOpenTextIcon
          return {
            icon: <Icon className="size-4" />,
            tone: "accent",
            detail: row.typeLabel,
            link: { href: `/materials/fiches/${document.id}` },
          }
        }
        default: {
          const { document, file } = row.source.row
          const transcript = linkTranscriptById.get(document.id)
          const retrying =
            reingestLink.isPending &&
            reingestLink.variables?.documentId === document.id
          if (document.sourceType === "link") {
            return {
              icon: <LinkIcon className="size-4" />,
              adornment: (
                <LinkIngestionBadge
                  status={retrying ? "pending" : transcript?.data?.status}
                  loading={transcript?.isLoading}
                  error={transcript?.isError}
                />
              ),
              detail: (
                <LinkProvenance
                  meta={transcript?.data?.meta}
                  sourceUrl={document.sourceUrl}
                />
              ),
            }
          }
          return {
            icon:
              document.sourceType === "file" ? (
                <FileIcon className="size-4" />
              ) : (
                <FileTextIcon className="size-4" />
              ),
            detail:
              document.sourceType === "file" && file
                ? `${file.mimeType} · ${formatBytes(file.byteSize)}`
                : t("Pasted note"),
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkStatusSnapshot, locationLink, reingestLink.variables, subjects, t]
  )

  /**
   * What a row lets you do.
   *
   * Written once against the menu slots, so the button on the row and the right
   * click offer exactly the same things. An action added to one and forgotten
   * in the other is how a menu starts lying about what is possible.
   */
  const rowMenuItems = useCallback(
    (kit: MaterialMenuKit, row: MaterialRow) => {
      // Deleting one thing borrows the confirmation the selection already has,
      // rather than a second dialog saying the same sentence.
      const confirmDelete = () => {
        setSelectedIds(new Set([row.id]))
        setBulkDeleteOpen(true)
      }

      /**
       * A deleted row offers two things and neither of them is Rename.
       *
       * Everything else in this menu acts on a row that is still in the tree;
       * offering "Move to…" for something in the bin would be a control that
       * either fails or quietly resurrects it.
       */
      if (row.trashed) {
        return (
          <>
            {row.tombstone ? null : (
              <kit.Item
                disabled={restore.isPending}
                onClick={() => restore.mutate(row.target)}
              >
                <Undo2Icon /> {t("Restore")}
              </kit.Item>
            )}
            {row.tombstone ? (
              <kit.Item disabled>
                <RefreshCwIcon /> {t("Removed by the sync")}
              </kit.Item>
            ) : null}
            <kit.Separator />
            <kit.Item
              variant="destructive"
              disabled={purge.isPending}
              onClick={() => purge.mutate(row.target)}
            >
              <Trash2Icon /> {t("Delete permanently")}
            </kit.Item>
          </>
        )
      }

      /**
       * The star and the tags, offered on every kind of row.
       *
       * Written once and dropped into each branch rather than repeated four
       * times: a menu whose entries differ between a folder and a recording
       * for no reason is a menu you have to learn twice.
       */
      const markers = (
        <>
          <kit.Item onClick={() => toggleStar(row)}>
            {row.starred ? <StarOffIcon /> : <StarIcon />}
            {row.starred ? t("Remove from favourites") : t("Add to favourites")}
          </kit.Item>
          {tags.length > 0 ? (
            <kit.Sub>
              <kit.SubTrigger>
                <TagIcon /> {t("Tags")}
              </kit.SubTrigger>
              <kit.SubContent className="min-w-48">
                {tags.map((tag) => (
                  <kit.CheckboxItem
                    key={tag.id}
                    checked={row.tagIds.includes(tag.id)}
                    disabled={assignTag.isPending}
                    // Tagging is done in bursts: a menu that shuts after each
                    // tick turns three tags into three right clicks.
                    closeOnClick={false}
                    onCheckedChange={(checked) =>
                      assignTag.mutate({
                        tagId: tag.id,
                        targets: [row.target],
                        assigned: checked,
                      })
                    }
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        materialTagDotClass(tag.color)
                      )}
                    />
                    {tag.name}
                  </kit.CheckboxItem>
                ))}
                <kit.Separator />
                <kit.Item render={<Link href="/materials/tags" />}>
                  <TagIcon /> {t("Manage tags")}
                </kit.Item>
              </kit.SubContent>
            </kit.Sub>
          ) : (
            <kit.Item render={<Link href="/materials/tags" />}>
              <TagIcon /> {t("Manage tags")}
            </kit.Item>
          )}
        </>
      )

      if (row.source.kind === "folder") {
        const folder = row.source.folder
        return (
          <>
            <kit.Item
              onClick={() =>
                selectLocation({ kind: "folder", folderId: folder.id })
              }
            >
              <FolderOpenIcon /> {t("Open folder")}
            </kit.Item>
            <kit.Item
              onClick={() =>
                setFolderDialog({ mode: "create", parentId: folder.id })
              }
            >
              <FolderPlusIcon /> {t("New folder")}
            </kit.Item>
            <kit.Separator />
            <kit.Item
              onClick={() => setFolderDialog({ mode: "rename", folder })}
            >
              <PencilIcon /> {t("Rename")}
            </kit.Item>
            <kit.Item onClick={() => setFolderDialog({ mode: "move", folder })}>
              <FolderInputIcon /> {t("Move to…")}
            </kit.Item>
            <kit.Item onClick={() => cutRow(row)}>
              <ScissorsIcon /> {t("Cut")}
            </kit.Item>
            <kit.Item
              disabled={previewFolderTranscription.isPending}
              onClick={() =>
                previewFolderTranscription.mutate({
                  folderId: folder.id,
                  dryRun: true,
                })
              }
            >
              <ScanTextIcon /> {t("Transcribe folder")}
            </kit.Item>
            <kit.Separator />
            {markers}
            <kit.Separator />
            <kit.Item
              variant="destructive"
              onClick={() => setDeleteTarget({ kind: "folder", folder })}
            >
              <Trash2Icon /> {t("Move to the bin")}
            </kit.Item>
          </>
        )
      }

      if (row.source.kind === "study") {
        const document = row.source.document
        return (
          <>
            <kit.Item
              render={<Link href={`/materials/fiches/${document.id}`} />}
            >
              <BookOpenTextIcon /> {t("Read")}
            </kit.Item>
            <kit.Item
              render={<Link href={`/materials/fiches/${document.id}/edit`} />}
            >
              <PencilIcon /> {t("Edit")}
            </kit.Item>
            <kit.Item
              onClick={() =>
                setMoveTarget({ ids: [document.id], label: document.title })
              }
            >
              <FolderInputIcon /> {t("Move to…")}
            </kit.Item>
            <kit.Item onClick={() => cutRow(row)}>
              <ScissorsIcon /> {t("Cut")}
            </kit.Item>
            <kit.Separator />
            {markers}
            <kit.Separator />
            <kit.Item variant="destructive" onClick={confirmDelete}>
              <Trash2Icon /> {t("Move to the bin")}
            </kit.Item>
          </>
        )
      }

      if (row.source.kind === "recording") {
        const recording = row.source.recording
        return (
          <>
            <kit.Item
              render={<Link href={`/materials/recordings/${recording.id}`} />}
            >
              <MicIcon /> {t("Open recording")}
            </kit.Item>
            <kit.Separator />
            {markers}
            <kit.Separator />
            <kit.Item variant="destructive" onClick={confirmDelete}>
              <Trash2Icon /> {t("Move to the bin")}
            </kit.Item>
          </>
        )
      }

      const materialRow = row.source.row
      const { document } = materialRow
      const transcript = linkTranscriptById.get(document.id)
      const retrying =
        reingestLink.isPending &&
        reingestLink.variables?.documentId === document.id
      const linkStatus = retrying ? "pending" : transcript?.data?.status

      return (
        <>
          <kit.Item onClick={() => openDocument(row)}>
            <FileIcon /> {t("Open document")}
          </kit.Item>
          {document.sourceType === "link" ? (
            <kit.Item
              disabled={
                retrying ||
                transcript?.isLoading ||
                transcript?.isFetching ||
                linkStatus === "pending"
              }
              onClick={() => {
                if (transcript?.isError) {
                  void transcript.refetch()
                  return
                }
                reingestLink.mutate({ documentId: document.id })
              }}
            >
              <RefreshCwIcon />
              {transcript?.isError
                ? t("Retry")
                : linkStatus === "ready"
                  ? t("Import again")
                  : linkStatus === "pending"
                    ? t("Import in progress")
                    : t("Retry import")}
            </kit.Item>
          ) : null}
          <kit.Item onClick={() => openDocument(row, { tab: "transcript" })}>
            <ScanTextIcon /> {t("Transcription")}
          </kit.Item>
          {materialRow.file ? (
            <kit.Item onClick={() => void downloadRows([row])}>
              <DownloadIcon /> {t("Download")}
            </kit.Item>
          ) : null}
          {document.sourceType === "link" && document.sourceUrl ? (
            <kit.Item
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(document.sourceUrl ?? "")
                  .then(() => toast.success(t("Address copied.")))
              }}
            >
              <CopyIcon /> {t("Copy address")}
            </kit.Item>
          ) : null}
          <kit.Separator />
          <kit.Item
            onClick={() =>
              setDocumentDialog({ mode: "rename", row: materialRow })
            }
          >
            <PencilIcon /> {t("Rename")}
          </kit.Item>
          <kit.Item onClick={() => cutRow(row)}>
            <ScissorsIcon /> {t("Cut")}
          </kit.Item>
          <kit.Item
            onClick={() =>
              setDocumentDialog({ mode: "move", row: materialRow })
            }
          >
            <FolderInputIcon /> {t("Move to…")}
          </kit.Item>
          <kit.Separator />
          {markers}
          <kit.Separator />
          <kit.Item
            variant="destructive"
            onClick={() =>
              setDeleteTarget({ kind: "document", row: materialRow })
            }
          >
            <Trash2Icon /> {t("Move to the bin")}
          </kit.Item>
        </>
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      assignTag,
      folders,
      openDocument,
      linkStatusSnapshot,
      moveDocument,
      moveFolder,
      previewFolderTranscription.isPending,
      purge,
      reingestLink,
      restore,
      selectLocation,
      t,
      tags,
      toggleStar,
    ]
  )

  const rowActions = useCallback(
    (row: MaterialRow) => (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Actions for {name}", { name: row.title })}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {rowMenuItems(dropdownMenuKit, row)}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [rowMenuItems, t]
  )

  /** The same actions, opened by a right click. */
  const rowContextMenu = useCallback(
    (row: MaterialRow) => rowMenuItems(contextMenuKit, row),
    [rowMenuItems]
  )

  /**
   * A folder in the rail offers what a folder in the list offers.
   *
   * The rail knows folders, the menu is written against rows, so the folder is
   * dressed as the row it would be — rather than a second copy of the same six
   * actions that could drift from the first.
   */
  const folderContextMenu = useCallback(
    (folder: MaterialFolderView) =>
      rowMenuItems(contextMenuKit, {
        id: folder.id,
        kind: "folder",
        title: folder.name,
        badge: "",
        typeLabel: "",
        bytes: null,
        durationMs: null,
        itemCount: null,
        origin: folder.origin,
        modifiedAt: null,
        target: { kind: "folder", id: folder.id },
        starred: folder.starredAt !== null,
        trashed: folder.deletedAt !== null,
        tombstone: false,
        tagIds: folder.tagIds ?? [],
        previewStatus: null,
        source: { kind: "folder", folder },
      }),
    [rowMenuItems]
  )

  /** A right click on a tag in the rail: the two things you do to a tag. */
  /** A right click on a tag in the rail: the two things you do to a tag. */
  const tagContextMenu = useCallback(
    (tag: MaterialTagView) => (
      <>
        <contextMenuKit.Item
          render={<Link href={`/materials/tags/${tag.id}/edit`} />}
        >
          <PencilIcon /> {t("Edit tag")}
        </contextMenuKit.Item>
        <contextMenuKit.Separator />
        <contextMenuKit.Item render={<Link href="/materials/tags" />}>
          <TagIcon /> {t("Manage tags")}
        </contextMenuKit.Item>
      </>
    ),
    [t]
  )

  /**
   * The tags a row wears, beside its name.
   *
   * Two at most, then a count. Three chips and a filename is a name you cannot
   * read, and the row menu is one right click away for the rest — the chips are
   * there to be recognised in passing, not to be the authoritative list.
   */
  const tagChips = useCallback(
    (row: MaterialRow) => {
      const own = resolveMaterialTags(row.tagIds, tags)
      if (own.length === 0) return null
      const shown = own.slice(0, 2)
      const hidden = own.length - shown.length
      return (
        <>
          {shown.map((tag) => (
            <span
              key={tag.id}
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[0.65rem] leading-none font-medium",
                materialTagChipClass(tag.color)
              )}
            >
              {tag.name}
            </span>
          ))}
          {hidden > 0 ? (
            <span
              className="shrink-0 text-[0.65rem] text-muted-foreground"
              title={own.map((tag) => tag.name).join(", ")}
            >
              +{hidden}
            </span>
          ) : null}
        </>
      )
    },
    [tags]
  )

  /**
   * Where a row came from, when that is worth a word.
   *
   * Only what an integration brought in wears a chip: a badge on every single
   * row saying "mine" would be noise on a screen where nearly everything is.
   * The filter beside the search offers both sides of the distinction.
   */
  const originBadge = useCallback(
    (row: MaterialRow) =>
      row.origin === "manual" ? null : (
        <Badge variant="secondary" className="shrink-0 text-[0.6rem]">
          {row.origin === "onedrive"
            ? t("OneDrive")
            : row.origin === "googledrive"
              ? t("Google Drive")
              : t("Moodle")}
        </Badge>
      ),
    [t]
  )

  /**
   * Cut and paste, the way a file browser does it.
   *
   * There is no copy: duplicating a source would need a server-side copy that
   * does not exist, and a Ctrl+C that silently did nothing would be worse than
   * no Ctrl+C at all. Cut is a move, which the API does have.
   */
  const canPaste = clipboard.length > 0 && location.kind !== "all"
  const paste = async () => {
    if (!canPaste) return
    const ids = clipboard
    setClipboard([])
    await moveIds(ids, destinationFolderId)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // Never steal a shortcut from something being typed into.
      if (
        target?.isContentEditable ||
        (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return
      }
      if (event.key === "Escape") {
        setSelectedIds(new Set())
        setClipboard([])
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return

      const key = event.key.toLowerCase()
      if (key === "a") {
        event.preventDefault()
        setSelectedIds(new Set(visibleRows.map((row) => row.id)))
        return
      }
      if (key === "x" && selectedIds.size > 0) {
        event.preventDefault()
        setClipboard([...selectedIds])
        setSelectedIds(new Set())
        toast.success(
          t("{count, plural, one {# item cut} other {# items cut}}", {
            count: selectedIds.size,
          })
        )
        return
      }
      if (key === "v" && canPaste) {
        event.preventDefault()
        void paste()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPaste, clipboard, destinationFolderId, selectedIds, visibleRows])

  // Thumbnails are only worth minting for the view that shows them.
  const previews = useMaterialPreviews(visibleRows, view === "grid")

  /** A drag carries the whole selection when it starts on part of it. */
  const dragPayload = useCallback(
    (row: MaterialRow) =>
      selectedIds.has(row.id) ? [...selectedIds] : [row.id],
    [selectedIds]
  )

  const onOpenRow = useCallback(
    (row: MaterialRow) => {
      if (row.kind === "folder") return
      openDocument(row)
    },
    [openDocument]
  )

  const empty = (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileTextIcon />
        </EmptyMedia>
        <EmptyTitle>
          {query || typeFilter || originFilter
            ? t("Nothing matches")
            : t("No materials here")}
        </EmptyTitle>
        <EmptyDescription>
          {query || typeFilter || originFilter
            ? t("Try another word, or clear the filters.")
            : t(
                "Create a study document, record a lecture, upload a file, paste a note or add a link to get started."
              )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  const rail = (
    <MaterialsFolderTree
      folders={folders}
      counts={directCounts}
      totals={{
        root:
          (directCounts.get(null) ?? 0) +
          folders.filter((folder) => folder.parentId === null).length,
        all: documents.length + studyDocuments.length + recordings.length,
        starred: starredTotal,
        // Known only once the bin has been read, which is when you are in it.
        trash: inTrash ? rows.length : undefined,
      }}
      location={location}
      onSelect={(next) => {
        setRailOpen(false)
        selectLocation(next)
      }}
      onCreateFolder={(parentId) =>
        setFolderDialog({ mode: "create", parentId })
      }
      onDropInto={(folderId, ids) => void moveIds(ids, folderId)}
      contextMenu={folderContextMenu}
      tags={tags}
      tagCounts={tagCounts}
      manageTagsHref="/materials/tags/new"
      tagContextMenu={tagContextMenu}
    />
  )

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" />}>
        {uploadingBatch ? <Spinner /> : <PlusIcon />}
        <span className="hidden sm:inline">{t("Add material")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {/* A folder was something you could only make from a small "+" in the
            rail, which is invisible on a phone and easy to miss anywhere. */}
        <DropdownMenuItem
          onClick={() =>
            setFolderDialog({ mode: "create", parentId: destinationFolderId })
          }
        >
          <FolderPlusIcon /> {t("New folder")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href={newStudyDocumentHref} />}>
          <NotebookPenIcon /> {t("New study document")}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href={newRecordingHref} />}>
          <MicIcon /> {t("Record a lecture")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!uploadsEnabled || uploadingBatch}
          onClick={() => fileInput.current?.click()}
        >
          <UploadIcon /> {t("Upload a file")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            setDocumentDialog({ mode: "text", folderId: destinationFolderId })
          }
        >
          <FileTextIcon /> {t("Paste a note")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            setDocumentDialog({ mode: "link", folderId: destinationFolderId })
          }
        >
          <LinkIcon /> {t("Add a link")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <PageMeta
        title={t("Materials")}
        subtitle={t("Files, links and study documents for this school year")}
      />
      <PageActions>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            render={<Link href="/materials/studio" />}
          >
            <PresentationIcon data-icon="inline-start" />
            {t("Studio")}
          </Button>
          {addMenu}
        </div>
      </PageActions>

      <input
        ref={fileInput}
        type="file"
        accept={[...mimeTypes, ...extensions].join(",")}
        multiple
        className="sr-only"
        onChange={(event) => {
          if (event.currentTarget.files) {
            void onPickFiles(event.currentTarget.files)
          }
          event.currentTarget.value = ""
        }}
      />

      {/* The browser fills the pane rather than sitting in a card in the middle
          of one: a file list is the screen, not an item on it. */}
      <div
        className={cn(
          "relative flex min-h-0 flex-col md:h-full",
          dropActive && "ring-2 ring-primary ring-inset"
        )}
        onDragEnter={onDragEnter}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          if (!uploadsEnabled) return
          event.dataTransfer.dropEffect = "copy"
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dropActive ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/95"
          >
            <div className="flex flex-col items-center gap-2 px-6 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
                <UploadIcon className="size-5" />
              </span>
              <p className="text-sm font-medium">
                {t("Drop files in this folder")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("Documents, images and text, up to {size} each.", {
                  size: formatBytes(maxBytes),
                })}
              </p>
            </div>
          </div>
        ) : null}

        {/* Capped and centred: a file list stretched across an ultrawide
            display puts the name at one end of the screen and its date at the
            other, and the eye has to travel the whole way. */}
        <div className="mx-auto flex min-h-0 w-full max-w-[110rem] flex-1 md:h-full">
          {/* The rail, at the width every file browser uses. */}
          <aside className="hidden w-64 shrink-0 flex-col border-e md:flex">
            {rail}
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            {/* Reading replaces the list and nothing else: the rail, the header
                trail and the year picker are all still there, which is the
                whole difference between reading a document and leaving for
                it. */}
            {openRow ? (
              <MaterialDocumentPane
                key={`${openRow.id}:${openMode}`}
                row={openRow}
                relatedRows={yearRows}
                mode={openMode}
                tab={openTab}
                onTabChange={(next) =>
                  openDocument(openRow, { mode: openMode, tab: next })
                }
                onModeChange={(next) =>
                  openDocument(openRow, { mode: next, tab: openTab })
                }
                onClose={closeDocument}
                actions={rowActions(openRow)}
                badges={
                  <>
                    {originBadge(openRow)}
                    {tagChips(openRow)}
                  </>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 md:px-4">
                  <Sheet open={railOpen} onOpenChange={setRailOpen}>
                    <SheetTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="md:hidden"
                        />
                      }
                    >
                      <FolderOpenIcon />
                      <span className="max-w-32 truncate">
                        {selectedFolder
                          ? selectedFolder.name
                          : location.kind === "all"
                            ? t("Everything")
                            : location.kind === "starred"
                              ? t("Favourites")
                              : location.kind === "trash"
                                ? t("Bin")
                                : location.kind === "tag"
                                  ? (tagById.get(location.tagId)?.name ??
                                    t("Tag"))
                                  : t("My materials")}
                      </span>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-72 p-0">
                      <SheetHeader className="px-4 pt-4 pb-0">
                        <SheetTitle>{t("Folders")}</SheetTitle>
                      </SheetHeader>
                      {rail}
                    </SheetContent>
                  </Sheet>

                  {/* Up one level. A tree in the rail is not a substitute: it is
                  on the other side of the screen, and hidden on a phone. */}
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={t("Up one level")}
                    disabled={location.kind !== "folder"}
                    onClick={() =>
                      selectLocation(
                        selectedFolder?.parentId
                          ? {
                              kind: "folder",
                              folderId: selectedFolder.parentId,
                            }
                          : ROOT_MATERIALS
                      )
                    }
                  >
                    <CornerLeftUpIcon />
                  </Button>

                  <div className="relative min-w-40 flex-1 md:max-w-64">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("Search materials…")}
                      aria-label={t("Search materials…")}
                      className="h-9 pl-8"
                    />
                  </div>

                  {typeOptions.length > 2 ? (
                    <SelectControl
                      value={typeFilter}
                      onValueChange={setTypeFilter}
                      options={typeOptions}
                      aria-label={t("Type")}
                      className="h-9 w-32"
                    />
                  ) : null}

                  {hasImported ? (
                    <SelectControl
                      value={originFilter}
                      onValueChange={setOriginFilter}
                      options={originOptions}
                      aria-label={t("Source")}
                      className="h-9 w-36"
                    />
                  ) : null}

                  {/* Only where a tag would narrow anything: a filter offering one
                  choice is a control that does nothing, and standing inside a
                  tag already is the filter. */}
                  {tags.length > 0 && location.kind !== "tag" ? (
                    <SelectControl
                      value={tagFilter}
                      onValueChange={setTagFilter}
                      options={tagOptions}
                      aria-label={t("Tag")}
                      className="h-9 w-36"
                    />
                  ) : null}

                  {/* How much each row says, and which columns say it. Both belong
                  in the toolbar: they are about the list, not about one
                  column, which is why the per-column menu was the wrong place
                  for the second. */}
                  <ButtonGroup className="hidden sm:flex">
                    {(
                      [
                        {
                          value: "table",
                          icon: ListIcon,
                          label: t("List view"),
                        },
                        {
                          value: "grid",
                          icon: LayoutGridIcon,
                          label: t("Grid view"),
                        },
                      ] as const
                    ).map((option) => (
                      <Button
                        key={option.value}
                        size="sm"
                        variant={
                          view === option.value ? "secondary" : "outline"
                        }
                        aria-pressed={view === option.value}
                        aria-label={option.label}
                        onClick={() => setView(option.value)}
                      >
                        <option.icon />
                      </Button>
                    ))}
                  </ButtonGroup>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="hidden md:inline-flex"
                        />
                      }
                    >
                      <Columns3Icon />
                      <span className="hidden xl:inline">{t("Columns")}</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      {/* The label is a group label in Base UI, so it only works
                      inside the group it names. */}
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>
                          {t("Columns shown")}
                        </DropdownMenuLabel>
                        {OPTIONAL_MATERIAL_COLUMNS.map((column) => (
                          <DropdownMenuCheckboxItem
                            key={column}
                            checked={!hiddenColumns.has(column)}
                            onCheckedChange={(checked) =>
                              setHiddenColumns((current) => {
                                const next = new Set(current)
                                if (checked) next.delete(column)
                                else next.add(column)
                                return next
                              })
                            }
                          >
                            {column === "type"
                              ? t("Type")
                              : column === "size"
                                ? t("Size")
                                : t("Modified")}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <span className="ms-auto hidden text-xs text-muted-foreground lg:inline">
                    {t(
                      "{count, plural, =0 {No items} one {# item} other {# items}}",
                      {
                        count: visibleRows.length,
                      }
                    )}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t("Transcribe all")}
                    disabled={
                      !yearId ||
                      batchIsActive ||
                      previewAllTranscription.isPending ||
                      transcribeAll.isPending
                    }
                    onClick={() =>
                      previewAllTranscription.mutate({
                        yearId: yearId ?? "",
                        dryRun: true,
                      })
                    }
                  >
                    {previewAllTranscription.isPending ? (
                      <Spinner />
                    ) : (
                      <ScanTextIcon />
                    )}
                    <span className="hidden xl:inline">
                      {t("Transcribe all")}
                    </span>
                  </Button>
                  <div className="hidden md:block">{addMenu}</div>
                </div>

                {!uploadsEnabled && !availability.isLoading ? (
                  <p
                    role="status"
                    className="border-b px-4 py-2 text-xs text-muted-foreground"
                  >
                    {t(
                      "File uploads are turned off on this server. You can still add links and notes."
                    )}
                  </p>
                ) : null}

                {batchProgress ? (
                  <div className="border-b p-3">
                    <MaterialTranscriptionProgress
                      progress={batchProgress}
                      streamState={batchStreamState}
                      retrying={previewAllTranscription.isPending}
                      onRetry={() =>
                        previewAllTranscription.mutate({
                          yearId: yearId ?? "",
                          dryRun: true,
                        })
                      }
                    />
                  </div>
                ) : null}

                {folderJobIds.length > 0 ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground"
                  >
                    {activeFolderJobs > 0 ? (
                      <Spinner className="size-3.5" />
                    ) : null}
                    {activeFolderJobs > 0
                      ? t(
                          "Transcribing folder: {done} finished, {active} in progress.",
                          {
                            done: String(completedFolderJobs),
                            active: String(activeFolderJobs),
                          }
                        )
                      : t(
                          "Folder transcription finished: {done} succeeded, {failed} failed.",
                          {
                            done: String(completedFolderJobs),
                            failed: String(failedFolderJobs),
                          }
                        )}
                  </p>
                ) : null}

                {inTrash ? (
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm">
                    <Trash2Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {t("Deleted items are kept for 30 days, then removed.")}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ms-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={rows.length === 0 || emptyTrash.isPending}
                      onClick={() => setEmptyTrashOpen(true)}
                    >
                      {emptyTrash.isPending ? <Spinner /> : <Trash2Icon />}
                      {t("Empty the bin")}
                    </Button>
                  </div>
                ) : null}

                {clipboard.length > 0 && !inTrash ? (
                  <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2 text-sm">
                    <ScissorsIcon className="size-4 shrink-0 text-primary" />
                    <span>
                      {t(
                        "{count, plural, one {# item ready to move} other {# items ready to move}}",
                        { count: clipboard.length }
                      )}
                    </span>
                    <div className="ms-auto flex items-center gap-1">
                      <Button
                        size="sm"
                        disabled={!canPaste || bulkPending}
                        onClick={() => void paste()}
                      >
                        {bulkPending ? <Spinner /> : <ClipboardPasteIcon />}
                        {t("Paste here")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setClipboard([])}
                      >
                        <XIcon /> {t("Cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {selectedRows.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2">
                    <span className="text-sm font-medium">
                      {t(
                        "{count, plural, one {# selected} other {# selected}}",
                        {
                          count: selectedRows.length,
                        }
                      )}
                    </span>
                    <div className="ms-auto flex items-center gap-1">
                      {/* In the bin the only two questions are whether it comes
                      back and whether it goes for good; everything else here
                      acts on a row that is still in the tree. */}
                      {inTrash ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              bulkPending || restorableSelection.length === 0
                            }
                            onClick={() => void bulkRestore()}
                          >
                            {bulkPending ? <Spinner /> : <Undo2Icon />}
                            {t("Restore")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={bulkPending}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void bulkPurge()}
                          >
                            {bulkPending ? <Spinner /> : <Trash2Icon />}
                            {t("Delete permanently")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedIds(new Set())}
                          >
                            <XIcon /> {t("Clear")}
                          </Button>
                        </>
                      ) : (
                        <>
                          {/* Always offered, so it is not a control that appears and
                      disappears depending on what happens to be ticked; only a
                      stored file has anything to download. */}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              bulkPending || downloadableSelection.length === 0
                            }
                            onClick={() => void bulkDownload()}
                          >
                            {bulkPending ? <Spinner /> : <DownloadIcon />}
                            {t("Download")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              bulkPending || movableSelection.length === 0
                            }
                            onClick={() =>
                              setMoveTarget({
                                ids: [...selectedIds],
                                label: null,
                              })
                            }
                          >
                            {bulkPending ? <Spinner /> : <FolderInputIcon />}
                            {t("Move to…")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={bulkPending}
                            onClick={() => {
                              setClipboard([...selectedIds])
                              setSelectedIds(new Set())
                            }}
                          >
                            <ScissorsIcon /> {t("Cut")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={bulkPending}
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setBulkDeleteOpen(true)}
                          >
                            <Trash2Icon /> {t("Delete")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedIds(new Set())}
                          >
                            <XIcon /> {t("Clear")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                {queryError ? (
                  <div role="alert" className="p-6 text-sm text-destructive">
                    {t("Materials could not be loaded. Try again.")}
                  </div>
                ) : (
                  <div className="flex min-h-[24rem] flex-1 flex-col md:min-h-0">
                    {view === "grid" ? (
                      <MaterialsGrid
                        rows={visibleRows}
                        present={present}
                        onOpen={onOpenRow}
                        actions={rowActions}
                        originBadge={originBadge}
                        selectedIds={selectedIds}
                        onSelectedIdsChange={setSelectedIds}
                        contextMenu={rowContextMenu}
                        previews={previews}
                        tagChips={tagChips}
                        emptyMessage={empty}
                      />
                    ) : (
                      <MaterialsTable
                        rows={visibleRows}
                        loading={loading}
                        present={present}
                        onOpen={onOpenRow}
                        actions={rowActions}
                        originBadge={originBadge}
                        selectedIds={selectedIds}
                        onSelectedIdsChange={setSelectedIds}
                        hiddenColumns={hiddenColumns}
                        sort={sort}
                        onSortChange={setSort}
                        dragPayload={inTrash ? undefined : dragPayload}
                        rowDrop={
                          inTrash
                            ? undefined
                            : {
                                accepts: (row) => row.kind === "folder",
                                onDrop: (row, ids) => void moveIds(ids, row.id),
                              }
                        }
                        contextMenu={rowContextMenu}
                        onToggleStar={inTrash ? undefined : toggleStar}
                        tagChips={tagChips}
                        emptyMessage={empty}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {folderDialog && yearId ? (
        <MaterialFolderDialog
          key={`${folderDialog.mode}:${
            folderDialog.mode === "create"
              ? folderDialog.parentId
              : folderDialog.folder.id
          }`}
          state={folderDialog}
          folders={folders}
          subjects={subjects}
          pending={folderPending}
          onClose={() => setFolderDialog(null)}
          onCreate={(input) => createFolder.mutate({ yearId, ...input })}
          onRename={(input) => renameFolder.mutate(input)}
          onMove={(input) => moveFolder.mutate(input)}
        />
      ) : null}
      {documentDialog && yearId ? (
        <MaterialDocumentDialog
          key={`${documentDialog.mode}:${
            documentDialog.mode === "text" || documentDialog.mode === "link"
              ? documentDialog.folderId
              : documentDialog.row.document.id
          }`}
          state={documentDialog}
          folders={folders}
          pending={documentPending}
          onClose={() => setDocumentDialog(null)}
          onCreateText={(input) => createText.mutate({ yearId, ...input })}
          onCreateLink={(input) => createLink.mutate({ yearId, ...input })}
          onRename={(input) => renameDocument.mutate(input)}
          onMove={(input) => moveDocument.mutate(input)}
        />
      ) : null}
      {deleteTarget ? (
        <MaterialDeleteDialog
          target={deleteTarget}
          pending={deleteFolder.isPending || deleteDocument.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (deleteTarget.kind === "folder") {
              deleteFolder.mutate({ folderId: deleteTarget.folder.id })
            } else {
              deleteDocument.mutate({
                documentId: deleteTarget.row.document.id,
              })
            }
          }}
        />
      ) : null}
      {folderTranscribe ? (
        <MaterialFolderTranscribeDialog
          folderName={folderTranscribe.folder.name}
          candidates={folderTranscribe.candidates}
          skipped={folderTranscribe.skipped}
          pending={transcribeFolder.isPending}
          onClose={() => setFolderTranscribe(null)}
          onConfirm={() =>
            transcribeFolder.mutate({
              folderId: folderTranscribe.folder.id,
              dryRun: false,
            })
          }
        />
      ) : null}
      {allTranscribe && yearId ? (
        <MaterialAllTranscribeDialog
          candidates={allTranscribe.candidates}
          skipped={allTranscribe.skipped}
          pending={transcribeAll.isPending}
          onClose={() => setAllTranscribe(null)}
          onConfirm={() =>
            transcribeAll.mutate({
              yearId,
              dryRun: false,
            })
          }
        />
      ) : null}
      {moveTarget ? (
        <MaterialMoveDialog
          folders={folders}
          count={moveTarget.ids.length}
          label={moveTarget.label}
          pending={bulkPending}
          onClose={() => setMoveTarget(null)}
          onConfirm={(folderId) => {
            const ids = moveTarget.ids
            setMoveTarget(null)
            void moveIds(ids, folderId)
          }}
        />
      ) : null}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t(
                "{count, plural, one {Move # item to the bin?} other {Move # items to the bin?}}",
                { count: selectedRows.length }
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* It goes to the bin and stays there for thirty days, so the
                  sentence that said "this cannot be undone" was simply
                  false — and it was the most frightening thing on the
                  screen. */}
              {selectedRows.some((row) => row.kind === "folder")
                ? t(
                    "A folder goes to the bin with everything inside it. You can get it back for 30 days."
                  )
                : t("It goes to the bin. You can get it back for 30 days.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulkPending}
              onClick={() => void bulkDelete()}
            >
              {bulkPending ? <Spinner /> : null}
              {t("Move to the bin")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={emptyTrashOpen} onOpenChange={setEmptyTrashOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("Empty the bin?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Everything in the bin is removed for good, files included. This one really cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emptyTrash.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={emptyTrash.isPending}
              onClick={() => emptyTrash.mutate({ yearId: yearId ?? "" })}
            >
              {emptyTrash.isPending ? <Spinner /> : null}
              {t("Empty the bin")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {viewer ? (
        <MaterialViewer
          key={`${viewer.row.document.id}:${viewer.initialTab}`}
          row={viewer.row}
          initialTab={viewer.initialTab}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </>
  )
}
