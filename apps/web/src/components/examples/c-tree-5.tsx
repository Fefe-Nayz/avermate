"use client"

import { Tree, TreeItem, TreeItemLabel } from "@/components/reui/tree"
import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import {
  FolderOpenIcon,
  FolderIcon,
  FileCodeIcon,
  PaletteIcon,
  BracesIcon,
  FileTextIcon,
  FileIcon,
} from "lucide-react"

interface FileItem {
  name: string
  children?: string[]
  type?: "folder" | "ts" | "tsx" | "css" | "json" | "md" | "config"
}

const items: Record<string, FileItem> = {
  root: {
    name: "my-project",
    children: ["src", "public", "package-json", "readme", "tsconfig"],
  },
  src: {
    name: "src",
    children: ["app", "components", "lib", "globals-css"],
    type: "folder",
  },
  app: {
    name: "app",
    children: ["page-tsx", "layout-tsx", "loading-tsx"],
    type: "folder",
  },
  "page-tsx": { name: "page.tsx", type: "tsx" },
  "layout-tsx": { name: "layout.tsx", type: "tsx" },
  "loading-tsx": { name: "loading.tsx", type: "tsx" },
  components: {
    name: "components",
    children: ["button-tsx", "card-tsx", "dialog-tsx"],
    type: "folder",
  },
  "button-tsx": { name: "button.tsx", type: "tsx" },
  "card-tsx": { name: "card.tsx", type: "tsx" },
  "dialog-tsx": { name: "dialog.tsx", type: "tsx" },
  lib: { name: "lib", children: ["utils-ts", "api-ts"], type: "folder" },
  "utils-ts": { name: "utils.ts", type: "ts" },
  "api-ts": { name: "api.ts", type: "ts" },
  "globals-css": { name: "globals.css", type: "css" },
  public: { name: "public", children: ["favicon"], type: "folder" },
  favicon: { name: "favicon.ico", type: "config" },
  "package-json": { name: "package.json", type: "json" },
  readme: { name: "README.md", type: "md" },
  tsconfig: { name: "tsconfig.json", type: "json" },
}

const getFileIcon = (type?: string, isExpanded?: boolean) => {
  if (!type || type === "folder") {
    return isExpanded ? (
      <FolderOpenIcon className="pointer-events-none size-4 text-amber-500" />
    ) : (
      <FolderIcon className="pointer-events-none size-4 text-amber-500" />
    )
  }
  if (type === "tsx" || type === "ts") {
    return <FileCodeIcon className="pointer-events-none size-4 text-blue-500" />
  }
  if (type === "css") {
    return (
      <PaletteIcon className="pointer-events-none size-4 text-purple-500" />
    )
  }
  if (type === "json") {
    return <BracesIcon className="pointer-events-none size-4 text-yellow-500" />
  }
  if (type === "md") {
    return (
      <FileTextIcon className="pointer-events-none size-4 text-muted-foreground" />
    )
  }
  return (
    <FileIcon className="pointer-events-none size-4 text-muted-foreground" />
  )
}

const indent = 20

export function Pattern() {
  const tree = useTree<FileItem>({
    initialState: {
      expandedItems: ["src", "app", "components"],
    },
    indent,
    rootItemId: "root",
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => (item.getItemData()?.children?.length ?? 0) > 0,
    dataLoader: {
      getItem: (itemId) => items[itemId],
      getChildren: (itemId) => items[itemId].children ?? [],
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  })

  return (
    <div className="mx-auto w-full grow place-self-start lg:w-xs">
      <Tree indent={indent} tree={tree}>
        {tree.getItems().map((item) => (
          <TreeItem key={item.getId()} item={item}>
            <TreeItemLabel className="relative before:absolute before:inset-x-0 before:-inset-y-0.5 before:-z-10 before:bg-background">
              <span className="flex items-center gap-2">
                {getFileIcon(item.getItemData().type, item.isExpanded())}
                {item.getItemName()}
              </span>
            </TreeItemLabel>
          </TreeItem>
        ))}
      </Tree>
    </div>
  )
}
