"use client"

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from "react"
import Link from "next/link"
import { useExtracted } from "next-intl"
import {
  hotkeysCoreFeature,
  syncDataLoaderFeature,
  selectionFeature,
} from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import {
  FolderIcon,
  FolderOpenIcon,
  HardDriveIcon,
  LayersIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  MATERIAL_TREE_ROOT,
  materialFolderTrail,
  materialTreeItems,
  type MaterialTreeItem,
} from "./materials-model"
import {
  ALL_MATERIALS,
  ROOT_MATERIALS,
  STARRED_MATERIALS,
  TRASH_MATERIALS,
  type MaterialsLocation,
} from "./materials-location"
import { materialTagDotClass } from "./materials-tags"
import {
  MATERIALS_DRAG_TYPE,
  readMaterialsDrag,
} from "./materials-presentation"
import type { MaterialFolderView, MaterialTagView } from "./materials-types"

const INDENT = 20

const MISSING: MaterialTreeItem = { name: "", childIds: [], issue: null }

/**
 * The folder rail.
 *
 * It used to be a hand-rolled list with a hand-rolled fold: no arrow keys, no
 * type-ahead, no roving focus, and an expansion state this screen had to keep
 * in sync with the folder being read. It is a real tree widget now — the
 * project's `Tree`, over a headless tree instance — so keyboard navigation,
 * `role="tree"` and the collapse state come from the component.
 *
 * The two fixed views sit above it, apart from the tree: the root of the tree
 * and the flat everything-at-once view are not folders, and listing them among
 * folders is what made the rail read as a pile of unrelated rows.
 */
export function MaterialsFolderTree({
  folders,
  counts,
  totals,
  location,
  onSelect,
  onCreateFolder,
  onDropInto,
  contextMenu,
  tags = [],
  tagCounts,
  manageTagsHref,
  tagContextMenu,
  className,
}: {
  folders: readonly MaterialFolderView[]
  /** How many things sit directly in each folder; `null` keys the root ones. */
  counts: ReadonlyMap<string | null, number>
  /**
   * `trash` is optional because the bin is not read until you open it: showing
   * a confident 0 beside Corbeille while twenty things sit in it would be a
   * lie, so the count is simply absent until the list has actually been read.
   */
  totals: { root: number; all: number; starred: number; trash?: number }
  location: MaterialsLocation
  onSelect: (location: MaterialsLocation) => void
  onCreateFolder: (parentId: string | null) => void
  /** Filing dragged rows into a folder — `null` being the root. */
  onDropInto?: (folderId: string | null, ids: readonly string[]) => void
  /** What a right click on a folder offers. */
  contextMenu?: (folder: MaterialFolderView) => ReactNode
  /** The tags in this year; each one is a place in the rail. */
  tags?: readonly MaterialTagView[]
  tagCounts?: ReadonlyMap<string, number>
  /**
   * Where "new tag" goes. A link rather than a callback so the control behaves
   * like every other navigation in the app — middle click, open in a new tab,
   * and no router call from a screen that navigates by rewriting its own
   * address.
   */
  manageTagsHref?: string
  /** What a right click on a tag offers — rename, recolour, delete. */
  tagContextMenu?: (tag: MaterialTagView) => ReactNode
  className?: string
}) {
  const t = useExtracted()
  const headingId = useId()
  const items = useMemo(() => materialTreeItems(folders), [folders])
  const byId = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  )
  const selectedId = location.kind === "folder" ? location.folderId : null

  const tree = useTree<MaterialTreeItem>({
    rootItemId: MATERIAL_TREE_ROOT,
    indent: INDENT,
    // Selection mirrors the address, not the other way round: arriving on a
    // folder link, or going back to one, has to light the same row a click does.
    state: { selectedItems: selectedId ? [selectedId] : [] },
    setSelectedItems: () => {},
    getItemName: (item) => item.getItemData()?.name ?? "",
    isItemFolder: (item) => (item.getItemData()?.childIds.length ?? 0) > 0,
    onPrimaryAction: (item) =>
      onSelect({ kind: "folder", folderId: item.getId() }),
    dataLoader: {
      getItem: (itemId) => items[itemId] ?? MISSING,
      getChildren: (itemId) => items[itemId]?.childIds ?? [],
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })

  // Renaming, creating and deleting all change the shape of the tree, and the
  // instance only re-reads it when asked.
  const shape = useMemo(
    () =>
      Object.entries(items)
        .map(([id, item]) => `${id}:${item.name}:${item.childIds.join(",")}`)
        .join("|"),
    [items]
  )
  useEffect(() => {
    tree.rebuildTree()
  }, [shape, tree])

  // The folder being read has to be reachable in the rail. Collapsing one of
  // its parents — or landing on a deep link — would otherwise leave the pane
  // showing a folder the rail cannot point at.
  const trail = useMemo(
    () =>
      selectedId
        ? materialFolderTrail(folders, selectedId)
            .slice(0, -1)
            .map((folder) => folder.id)
            .join("/")
        : "",
    [folders, selectedId]
  )
  useEffect(() => {
    if (!trail) return
    for (const id of trail.split("/")) {
      const item = tree.getItemInstance(id)
      // `expand()` appends without checking, so an already-open folder would
      // collect duplicate ids.
      if (item && !item.isExpanded()) item.expand()
    }
  }, [trail, tree])

  /**
   * Dropping rows onto a folder.
   *
   * The only ways to file something were a menu and a dialog with a flat list
   * of every folder in the year. Dragging it onto the folder is the shortest
   * path there is, and the one every file browser has taught people to expect.
   */
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(
    undefined
  )
  // Hovering over a closed folder mid-drag opens it, so a drop can go somewhere
  // that was not on screen when the drag started. The active target is state,
  // so changing or leaving it cancels the old timer through effect cleanup.
  useEffect(() => {
    if (dropTarget == null) return
    const hoverTimer = setTimeout(() => {
      const item = tree.getItemInstance(dropTarget)
      if (item && item.isFolder() && !item.isExpanded()) item.expand()
    }, 600)
    return () => clearTimeout(hoverTimer)
  }, [dropTarget, tree])
  const dropProps = (folderId: string | null) =>
    onDropInto
      ? {
          onDragOver: (event: DragEvent<HTMLElement>) => {
            if (!event.dataTransfer.types.includes(MATERIALS_DRAG_TYPE)) return
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = "move"
            setDropTarget(folderId)
          },
          onDragLeave: () =>
            setDropTarget((current) =>
              current === folderId ? undefined : current
            ),
          onDrop: (event: DragEvent<HTMLElement>) => {
            const payload = event.dataTransfer.getData(MATERIALS_DRAG_TYPE)
            if (!payload) return
            event.preventDefault()
            event.stopPropagation()
            setDropTarget(undefined)
            const ids = readMaterialsDrag(payload)
            if (ids.length > 0) onDropInto(folderId, ids)
          },
        }
      : {}

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex flex-col gap-0.5 p-2">
        <ViewRow
          selected={location.kind === "root"}
          dropping={dropTarget === null}
          dropProps={dropProps(null)}
          onClick={() => onSelect(ROOT_MATERIALS)}
          icon={<HardDriveIcon className="size-4 shrink-0" aria-hidden />}
          label={t("My materials")}
          count={totals.root}
        />
        {/* Every source at once, folders flattened away. Useful to search
            across the year; a poor place to land, which is why it is not
            where you start. */}
        <ViewRow
          selected={location.kind === "all"}
          onClick={() => onSelect(ALL_MATERIALS)}
          icon={<LayersIcon className="size-4 shrink-0" aria-hidden />}
          label={t("Everything")}
          count={totals.all}
        />
        {/* Two more views over the same rows: the ones you marked, and the
            ones you deleted. Both are places in the address like any folder,
            so they can be linked to and the header trail can name them. */}
        <ViewRow
          selected={location.kind === "starred"}
          onClick={() => onSelect(STARRED_MATERIALS)}
          icon={<StarIcon className="size-4 shrink-0" aria-hidden />}
          label={t("Favourites")}
          count={totals.starred}
        />
        <ViewRow
          selected={location.kind === "trash"}
          onClick={() => onSelect(TRASH_MATERIALS)}
          icon={<Trash2Icon className="size-4 shrink-0" aria-hidden />}
          label={t("Bin")}
          count={totals.trash}
        />
      </div>

      <div className="flex min-h-9 items-center justify-between gap-1 border-t px-3 pt-2">
        <span
          id={headingId}
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {t("Folders")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("New folder")}
          onClick={() => onCreateFolder(selectedId)}
        >
          <PlusIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {folders.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-balance text-muted-foreground">
            {t("No folders yet. Create one to group a subject's sources.")}
          </p>
        ) : (
          <Tree
            indent={INDENT}
            tree={tree}
            aria-labelledby={headingId}
            className="gap-0.5"
          >
            {tree.getItems().map((item) => {
              const count = counts.get(item.getId()) ?? 0
              const folder = byId.get(item.getId())
              const row = (
                <TreeItem
                  key={item.getId()}
                  item={item}
                  // A tree item is a <button>, and a button centres its text.
                  // That is what pushed every folder name into the middle of
                  // its row — the box started in the right place, the words
                  // inside it did not.
                  className="text-start"
                  {...dropProps(item.getId())}
                >
                  <TreeItemLabel
                    className={cn(
                      // `ps-2!` beats the component's own rule, which indents
                      // a row with nothing inside it by the width of the
                      // chevron it does not draw — leaving empty folders
                      // sitting further right than the ones above them. The
                      // spacer below takes that job instead, so every name in a
                      // branch starts on the same vertical line whether or not
                      // it can be opened.
                      "min-h-8 gap-2 rounded-lg ps-2!",
                      dropTarget === item.getId() &&
                        "bg-primary/5 ring-2 ring-primary",
                      item.isSelected() &&
                        "bg-primary/10 font-medium text-primary in-data-[selected=true]:bg-primary/10 in-data-[selected=true]:text-primary"
                    )}
                  >
                    {item.isFolder() ? null : (
                      <span className="size-4 shrink-0" aria-hidden />
                    )}
                    {item.isFolder() && item.isExpanded() ? (
                      <FolderOpenIcon className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <FolderIcon className="size-4 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {item.getItemName()}
                    </span>
                    {count > 0 ? (
                      <span className="numeric text-xs text-muted-foreground">
                        {count}
                      </span>
                    ) : null}
                  </TreeItemLabel>
                </TreeItem>
              )
              if (!contextMenu || !folder) return row
              return (
                <ContextMenu key={item.getId()}>
                  {/* `contents` keeps the trigger out of the layout, so the
                      tree still lays its rows out itself, and `role="none"`
                      keeps the tree/treeitem relationship intact. */}
                  <ContextMenuTrigger role="none" className="contents">
                    {row}
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-48">
                    {contextMenu(folder)}
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </Tree>
        )}
      </div>

      {manageTagsHref ? (
        <TagSection
          tags={tags}
          counts={tagCounts}
          location={location}
          onSelect={onSelect}
          manageHref={manageTagsHref}
          contextMenu={tagContextMenu}
        />
      ) : null}
    </div>
  )
}

/**
 * Tags, under the folders.
 *
 * `origin` says where a file came from and `folderId` says where it sits;
 * nothing said what it is *about* when that crosses folders — "révisions
 * partiel", "à relire", "TD corrigé". A tag is the missing axis, so it is a
 * place in the rail beside the folders rather than a filter buried in a
 * toolbar: you go to it the same way you go to a folder.
 *
 * It does not scroll with the tree. The folder list can be a hundred rows deep
 * and the tags would sit below all of them, which is the same as not having
 * them; a fixed strip at the bottom is reachable whatever the tree is doing.
 */
function TagSection({
  tags,
  counts,
  location,
  onSelect,
  manageHref,
  contextMenu,
}: {
  tags: readonly MaterialTagView[]
  counts?: ReadonlyMap<string, number>
  location: MaterialsLocation
  onSelect: (location: MaterialsLocation) => void
  manageHref: string
  contextMenu?: (tag: MaterialTagView) => ReactNode
}) {
  const t = useExtracted()
  const headingId = useId()
  return (
    <div className="flex max-h-56 shrink-0 flex-col border-t">
      <div className="flex min-h-9 items-center justify-between gap-1 px-3 pt-2">
        <span
          id={headingId}
          className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {t("Tags")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("New tag")}
          render={<Link href={manageHref} />}
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tags.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-balance text-muted-foreground">
            {t(
              "No tags yet. A tag says what something is about, across folders."
            )}
          </p>
        ) : (
          <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
            {tags.map((tag) => {
              const selected =
                location.kind === "tag" && location.tagId === tag.id
              const count = counts?.get(tag.id) ?? 0
              const row = (
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "tag", tagId: tag.id })}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors hover:bg-accent",
                    selected && "bg-primary/10 font-medium text-primary"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 shrink-0 rounded-full",
                      materialTagDotClass(tag.color)
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="numeric text-xs text-muted-foreground">
                    {count}
                  </span>
                </button>
              )
              return (
                <li key={tag.id}>
                  {contextMenu ? (
                    <ContextMenu>
                      <ContextMenuTrigger className="contents">
                        {row}
                      </ContextMenuTrigger>
                      <ContextMenuContent className="min-w-48">
                        {contextMenu(tag)}
                      </ContextMenuContent>
                    </ContextMenu>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

/** One of the two fixed views. Not a folder, so not a tree item. */
function ViewRow({
  selected,
  onClick,
  icon,
  label,
  count,
  dropping,
  dropProps,
}: {
  selected: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
  dropping?: boolean
  dropProps?: Record<string, unknown>
}) {
  const t = useExtracted()
  return (
    <button
      type="button"
      {...dropProps}
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      aria-label={
        count === undefined
          ? label
          : `${label} — ${t(
              "{count, plural, =0 {No items} one {# item} other {# items}}",
              { count }
            )}`
      }
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors hover:bg-accent",
        dropping && "bg-primary/5 ring-2 ring-primary",
        selected && "bg-primary/10 font-medium text-primary"
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : (
        <span className="numeric text-xs text-muted-foreground">{count}</span>
      )}
    </button>
  )
}
