"use client"

import { useMemo, useState, type DragEvent, type ReactNode } from "react"
import Link from "next/link"
import { useExtracted, useFormatter } from "next-intl"
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid"
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header"
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area"
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table"
import { DataGridTableVirtual } from "@/components/reui/data-grid/data-grid-table-virtual"
import {
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { StarIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { formatRecordingTimestamp } from "@/components/recordings/recording-model"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import {
  formatBytes,
  materialSortFromState,
  type MaterialRow,
  type MaterialSort,
} from "./materials-rows"
import {
  MATERIALS_DRAG_TYPE,
  readMaterialsDrag,
  type PresentMaterialRow,
} from "./materials-presentation"

/**
 * The list of a folder's contents, as a table.
 *
 * It was a stack of hand-built rows in a bordered card: no sortable heads, no
 * resizable columns, no keyboard story, nothing to select, and a different shape
 * for each kind of thing it held. This is the project's data grid instead — the
 * same one the rest of the app will use — so sorting, column widths, hiding a
 * column, selection and the sticky header all come from the component.
 *
 * What stays here is what the grid cannot know: that folders sort above files,
 * that "École" belongs with the E's, and what a row is called in words.
 */

/** Above this many rows the table renders only what is on screen. */
const VIRTUAL_ROW_THRESHOLD = 150

export interface MaterialsTableProps {
  rows: readonly MaterialRow[]
  loading?: boolean
  emptyMessage?: ReactNode
  present: PresentMaterialRow
  /** Opening a row that has no link of its own — an upload, say. */
  onOpen: (row: MaterialRow) => void
  actions?: (row: MaterialRow) => ReactNode
  /** Rows currently ticked. Passing the setter is what turns selection on. */
  selectedIds?: ReadonlySet<string>
  onSelectedIdsChange?: (ids: Set<string>) => void
  /** The chip that says where a row came from, when it is worth saying. */
  originBadge?: (row: MaterialRow) => ReactNode
  /** Columns the reader has switched off, by id. */
  hiddenColumns?: ReadonlySet<string>
  /** The column the list is ordered by. Owned above, so it survives a view switch. */
  sort: MaterialSort
  onSortChange: (sort: MaterialSort) => void
  /** The rows a drag should carry, given the row it started on. */
  dragPayload?: (row: MaterialRow) => string[]
  /** Rows that can receive a drop — a folder in the list, filed into directly. */
  rowDrop?: {
    accepts: (row: MaterialRow) => boolean
    onDrop: (row: MaterialRow, ids: readonly string[]) => void
  }
  /** What a right click on a row offers. */
  contextMenu?: (row: MaterialRow) => ReactNode
  /**
   * Marking a row a favourite from the row itself.
   *
   * The star lives in the name cell rather than only in the menu because
   * marking something is a thing you do while scanning a list, and a gesture
   * that costs two clicks and a menu is one you stop making.
   */
  onToggleStar?: (row: MaterialRow) => void
  /** The tags a row wears, drawn beside its name. */
  tagChips?: (row: MaterialRow) => ReactNode
}

export function MaterialsTable({
  rows,
  loading = false,
  emptyMessage,
  present,
  onOpen,
  actions,
  selectedIds,
  onSelectedIdsChange,
  originBadge,
  hiddenColumns,
  sort,
  onSortChange,
  dragPayload,
  rowDrop,
  contextMenu,
  onToggleStar,
  tagChips,
}: MaterialsTableProps) {
  const t = useExtracted()
  const format = useFormatter()
  const sorting = useMemo<SortingState>(
    () => [{ id: sort.key, desc: sort.direction === "desc" }],
    [sort]
  )

  /**
   * Which columns there is room for.
   *
   * Six columns on a phone is four columns of nothing and a name too narrow to
   * read. The narrow layouts drop what the name already implies, and the
   * columns are left out of the definition rather than hidden through the
   * table's visibility state: a column that is not there cannot claim width.
   */
  const wide = useMediaQuery("(min-width: 1024px)")
  const medium = useMediaQuery("(min-width: 768px)")

  // The rows arrive sorted: the screen owns the order so it survives a switch
  // between this view and the grid, and so the comparison stays locale-aware —
  // the table would put "École" after "Zèbre" and scatter the folders among
  // the files.
  const data = useMemo(() => [...rows], [rows])

  const virtualised = data.length > VIRTUAL_ROW_THRESHOLD
  const selectable = Boolean(onSelectedIdsChange)
  // v9 types the slice as `Record<string, true>`: an unticked row is absent,
  // not present-and-false.
  const rowSelection = useMemo(
    () =>
      Object.fromEntries(
        [...(selectedIds ?? [])].map((id) => [id, true as const])
      ) as Record<string, true>,
    [selectedIds]
  )

  const columns = useMemo<ColumnDef<DataGridFeatures, MaterialRow>[]>(() => {
    const select: ColumnDef<DataGridFeatures, MaterialRow> = {
      id: "select",
      size: 44,
      enableSorting: false,
      enableResizing: false,
      enableHiding: false,
      meta: { headerClassName: "pe-0", cellClassName: "pe-0" },
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
          aria-label={t("Select every row")}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(checked)}
          aria-label={t("Select {name}", { name: row.original.title })}
        />
      ),
    }

    const rest: ColumnDef<DataGridFeatures, MaterialRow>[] = [
      {
        id: "name",
        accessorFn: (row) => row.title,
        header: ({ column }) => (
          <DataGridColumnHeader title={t("Name")} column={column} />
        ),
        // The phone layout retains selection and row actions. Keeping the
        // desktop width here made that three-column table 516 px wide, so the
        // primary action and favourite control started off-screen on a
        // 390 px viewport. Let the fixed-layout table distribute a compact
        // name column instead; the title and detail already truncate safely.
        size: medium ? 420 : 240,
        meta: { headerTitle: "Name" },
        cell: ({ row }) => (
          <NameCell
            row={row.original}
            present={present}
            onOpen={onOpen}
            originBadge={originBadge}
            dragPayload={dragPayload}
            rowDrop={rowDrop}
            contextMenu={contextMenu}
            onToggleStar={onToggleStar}
            tagChips={tagChips}
          />
        ),
      },
      {
        id: "type",
        accessorFn: (row) => row.badge,
        header: ({ column }) => (
          <DataGridColumnHeader title={t("Type")} column={column} />
        ),
        size: 96,
        meta: { headerTitle: "Type", cellClassName: "whitespace-nowrap" },
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono text-xs">
            {row.original.badge}
          </Badge>
        ),
      },
      {
        id: "size",
        accessorFn: (row) => row.bytes ?? row.durationMs ?? row.itemCount ?? 0,
        header: ({ column }) => (
          <DataGridColumnHeader title={t("Size")} column={column} />
        ),
        size: 108,
        meta: { headerTitle: "Size", cellClassName: "whitespace-nowrap" },
        cell: ({ row }) => {
          const material = row.original
          if (material.kind === "folder") {
            return (
              <span className="text-xs text-muted-foreground">
                {t(
                  "{count, plural, =0 {No items} one {# item} other {# items}}",
                  { count: material.itemCount ?? 0 }
                )}
              </span>
            )
          }
          if (material.bytes !== null) {
            return (
              <span className="numeric text-xs text-muted-foreground">
                {formatBytes(material.bytes)}
              </span>
            )
          }
          if (material.durationMs !== null) {
            return (
              <span className="numeric text-xs text-muted-foreground">
                {formatRecordingTimestamp(material.durationMs)}
              </span>
            )
          }
          // Nothing to measure. An em dash says so; a zero would read as an
          // empty file.
          return <span className="text-xs text-muted-foreground">—</span>
        },
      },
      {
        id: "modified",
        accessorFn: (row) => row.modifiedAt?.getTime() ?? 0,
        header: ({ column }) => (
          <DataGridColumnHeader title={t("Modified")} column={column} />
        ),
        size: 124,
        meta: { headerTitle: "Modified", cellClassName: "whitespace-nowrap" },
        cell: ({ row }) => {
          const modifiedAt = row.original.modifiedAt
          if (!modifiedAt) {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <time
              dateTime={modifiedAt.toISOString()}
              className="text-xs whitespace-nowrap text-muted-foreground"
            >
              {format.dateTime(modifiedAt, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </time>
          )
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("Actions")}</span>,
        size: 52,
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        meta: { headerClassName: "px-1", cellClassName: "px-1" },
        cell: ({ row }) => (
          <div className="flex justify-end">{actions?.(row.original)}</div>
        ),
      },
    ]

    const dropped = new Set([
      ...(medium ? (wide ? [] : ["size"]) : ["size", "type", "modified"]),
      ...(hiddenColumns ?? []),
    ])
    const kept = rest.filter((column) => !dropped.has(column.id as string))
    return selectable ? [select, ...kept] : kept
  }, [
    actions,
    contextMenu,
    dragPayload,
    rowDrop,
    format,
    hiddenColumns,
    medium,
    onOpen,
    originBadge,
    onToggleStar,
    present,
    selectable,
    t,
    tagChips,
    wide,
  ])

  // `manualSorting` and `manualPagination` are both deliberate: this list is
  // already sorted, and it is already whole. Without the second, the grid's own
  // paginated row model would quietly show the first ten rows of a folder.
  const table = useTable({
    features: dataGridFeatures,
    columns,
    data,
    getRowId: (row: MaterialRow) => row.id,
    manualSorting: true,
    manualPagination: true,
    enableRowSelection: selectable,
    state: { sorting, rowSelection },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater
      onSortChange(materialSortFromState(next))
    },
    onRowSelectionChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater
      onSelectedIdsChange?.(new Set(Object.keys(next)))
    },
  })

  return (
    <DataGrid
      table={table}
      recordCount={data.length}
      isLoading={loading}
      emptyMessage={emptyMessage}
      /**
       * Fixed layout, and deliberately no column resizing.
       *
       * Resizing makes the grid size its viewport to the sum of the columns in
       * pixels, so the table stopped following the window: too narrow a window
       * scrolled sideways, too wide a one left a dead strip at the end of every
       * row. A fixed table at full width scales its columns to whatever room
       * there is, which is what lets a long file name truncate instead of
       * pushing the date off the screen.
       */
      tableLayout={{
        width: "fixed",
        headerSticky: true,
        headerBackground: false,
        // The toolbar owns which columns are shown. The per-column menu wrote
        // to a state this table does not read, so the entries in it did
        // nothing — one control that works beats two that disagree.
        columnsVisibility: false,
        rowBorder: true,
      }}
      tableClassNames={{
        bodyRow: "hover:bg-accent/40 transition-colors",
        edgeCell: "first:ps-4 last:pe-3",
      }}
    >
      {/* `*:` reaches the scroll area's own wrapper, which the component
          renders around it and takes no class of its own. Without it that
          wrapper sizes to its content, the scroll area never claims the height
          left in the pane, and a folder with thirty files simply overflowed
          with nothing to scroll. */}
      {/* Past a few hundred rows, laying out every one of them is what makes
          "everything" crawl: a thousand files is a thousand rows, each with an
          icon, a badge and a menu. Beyond the threshold only the rows in view
          are rendered, and the virtual body owns its own scrolling — handing it
          the scroll area's viewport instead leaves it reading an offset that
          never moves, so the window stays on the first rows while the list
          scrolls past them. Below the threshold the plain table keeps the
          shared scroll area: virtual rows cost a measured height each, which is
          not worth paying for a folder holding twelve things. */}
      <DataGridContainer
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          !virtualised && "*:flex *:min-h-0 *:flex-1 *:flex-col"
        )}
      >
        {virtualised ? (
          <DataGridTableVirtual height="100%" estimateSize={57} overscan={12} />
        ) : (
          <DataGridScrollArea className="min-h-0 flex-1" orientation="both">
            <DataGridTable />
          </DataGridScrollArea>
        )}
      </DataGridContainer>
    </DataGrid>
  )
}

function NameCell({
  row,
  present,
  onOpen,
  originBadge,
  dragPayload,
  rowDrop,
  contextMenu,
  onToggleStar,
  tagChips,
}: {
  row: MaterialRow
  present: PresentMaterialRow
  onOpen: (row: MaterialRow) => void
  originBadge?: (row: MaterialRow) => ReactNode
  dragPayload?: (row: MaterialRow) => string[]
  rowDrop?: MaterialsTableProps["rowDrop"]
  contextMenu?: (row: MaterialRow) => ReactNode
  onToggleStar?: (row: MaterialRow) => void
  tagChips?: (row: MaterialRow) => ReactNode
}) {
  const t = useExtracted()
  const presentation = present(row)
  const [over, setOver] = useState(false)
  const body = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          presentation.tone === "accent"
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {presentation.icon}
      </span>
      <span className="min-w-0 flex-1">
        {/*
         * Wraps, because the file name outranks everything beside it.
         * On one fixed line the title was the only shrinkable item, so a
         * long status badge squeezed it to zero width — a file browser row
         * showing a badge and no file name. Measured at 390px: 0px title
         * before, 163px after.
         */}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
          <span className="truncate text-sm font-medium">{row.title}</span>
          {originBadge?.(row)}
          {tagChips?.(row)}
          {presentation.adornment}
        </span>
        {presentation.detail ? (
          <span className="block truncate text-xs text-muted-foreground">
            {presentation.detail}
          </span>
        ) : null}
      </span>
    </>
  )

  // Named explicitly, or the accessible name is every span in the cell run
  // together: the title and the detail share no whitespace, so this control
  // announced itself as "Polycopié.pdfapplication/pdf · 2.3 MiB".
  const className =
    "flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

  // Filing something by dragging it onto a folder is how every file browser
  // works, and it is the shortest path there is between a file and a folder.
  const drag = dragPayload
    ? {
        draggable: true,
        onDragStart: (event: DragEvent<HTMLElement>) => {
          const ids = dragPayload(row)
          if (ids.length === 0) return
          event.dataTransfer.setData(MATERIALS_DRAG_TYPE, JSON.stringify(ids))
          event.dataTransfer.effectAllowed = "move"
        },
      }
    : {}

  // A folder in the list takes a drop as well as the one in the rail: the row
  // in front of you is the shorter path of the two.
  const accepts = rowDrop?.accepts(row) ?? false
  const dropZone = accepts
    ? {
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (!event.dataTransfer.types.includes(MATERIALS_DRAG_TYPE)) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = "move"
          setOver(true)
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent<HTMLElement>) => {
          const payload = event.dataTransfer.getData(MATERIALS_DRAG_TYPE)
          if (!payload) return
          event.preventDefault()
          event.stopPropagation()
          setOver(false)
          const ids = readMaterialsDrag(payload).filter((id) => id !== row.id)
          if (ids.length > 0) rowDrop?.onDrop(row, ids)
        },
      }
    : {}
  const zoneClassName = cn(
    className,
    over && "bg-primary/5 ring-2 ring-primary"
  )

  const control = presentation.link ? (
    <Link
      {...drag}
      {...dropZone}
      href={presentation.link.href}
      prefetch={presentation.link.prefetch}
      onClick={presentation.link.onClick}
      aria-label={row.title}
      className={zoneClassName}
    >
      {body}
    </Link>
  ) : (
    <button
      {...drag}
      {...dropZone}
      type="button"
      aria-label={row.title}
      className={zoneClassName}
      onClick={() => onOpen(row)}
    >
      {body}
    </button>
  )

  /**
   * The star, beside the name.
   *
   * Hidden until the name cell is pointed at, and always drawn once a row is
   * starred: a control on every row of a four-hundred-row list is four hundred
   * pieces of chrome, and the mark itself is the one thing that has to be
   * readable without hovering anything.
   *
   * It sits outside the name control rather than inside it — a button inside a
   * link is invalid, and the click would have to fight the navigation.
   */
  const star = onToggleStar ? (
    <button
      type="button"
      aria-pressed={row.starred}
      aria-label={
        row.starred
          ? t("Remove {name} from favourites", { name: row.title })
          : t("Add {name} to favourites", { name: row.title })
      }
      onClick={(event) => {
        event.stopPropagation()
        onToggleStar(row)
      }}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50",
        row.starred ? "opacity-100" : "opacity-0 group-hover/name:opacity-100"
      )}
    >
      <StarIcon
        aria-hidden
        className={cn(
          "size-3.5",
          row.starred && "fill-amber-400 text-amber-500"
        )}
      />
    </button>
  ) : null

  const cell = (
    <span className="group/name flex min-w-0 flex-1 items-center gap-1">
      {control}
      {star}
    </span>
  )

  if (!contextMenu) return cell
  // The trigger wraps the name cell rather than the row: the grid renders the
  // <tr> itself, and the name is where the pointer is anyway.
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex min-w-0">{cell}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        {contextMenu(row)}
      </ContextMenuContent>
    </ContextMenu>
  )
}
