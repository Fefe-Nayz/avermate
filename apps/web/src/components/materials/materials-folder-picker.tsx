"use client"

import { useId, useMemo } from "react"
import { useExtracted } from "next-intl"
import { FolderIcon, HardDriveIcon } from "lucide-react"
import {
  Cascader,
  CascaderContent,
  CascaderEmpty,
  CascaderList,
  CascaderPanel,
  CascaderStatus,
  CascaderTrigger,
} from "@/components/reui/cascader/cascader"
import { CascaderItems } from "@/components/reui/cascader/cascader-item"
import {
  CascaderBreadcrumb,
  CascaderInput,
  CascaderNav,
  CascaderValue,
} from "@/components/reui/cascader/cascader-nav"
import type { CascaderNode } from "@/components/reui/cascader/cascader-types"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  buildMaterialFolderTree,
  type MaterialFolderTreeNode,
} from "./materials-model"
import type { MaterialFolderView } from "./materials-types"

/** The value that means "not in any folder" — a select cannot hold `null`. */
export const ROOT_FOLDER_VALUE = "__root__"

/**
 * Choosing a folder, as the tree it is.
 *
 * Every folder field in the app was a flat `<select>` with the depth faked by
 * leading dashes — "— — Corrigés" — which is unreadable past two levels, gives
 * no way to search, and asks the reader to reconstruct the shape of the tree
 * from punctuation. A cascader drills one level at a time, shows the trail it
 * came down, and puts the whole path in the trigger, which is the difference
 * between knowing you picked "Corrigés" and knowing which "Corrigés".
 *
 * The root is a node rather than a special case, so "not in any folder" is
 * picked the same way any folder is.
 */
export function MaterialFolderPicker({
  folders,
  value,
  onValueChange,
  label,
  description,
  error,
  rootLabel,
  disabled,
  /** Folders that cannot be chosen — a folder cannot be moved inside itself. */
  isDisabled,
  className,
}: {
  folders: readonly MaterialFolderView[]
  /** `ROOT_FOLDER_VALUE` for "no folder". */
  value: string
  onValueChange: (value: string) => void
  label?: string
  description?: string
  error?: string
  rootLabel?: string
  disabled?: boolean
  isDisabled?: (folderId: string) => boolean
  className?: string
}) {
  const t = useExtracted()
  const fieldId = useId()

  const items = useMemo<CascaderNode[]>(() => {
    const toNode = (
      node: MaterialFolderTreeNode<MaterialFolderView>
    ): CascaderNode => ({
      value: node.folder.id,
      label: node.folder.name,
      icon: <FolderIcon />,
      disabled: isDisabled?.(node.folder.id) ?? false,
      children: node.children.map(toNode),
      // Without this the count reads as the number of subfolders, which is not
      // what the row is counting anywhere else on this screen.
      count: node.children.length || undefined,
    })

    return [
      {
        value: ROOT_FOLDER_VALUE,
        label: rootLabel ?? t("My materials"),
        icon: <HardDriveIcon />,
      },
      ...buildMaterialFolderTree(folders).map(toNode),
    ]
  }, [folders, isDisabled, rootLabel, t])

  const picker = (
    <Cascader
      items={items}
      value={value}
      onValueChange={onValueChange}
      // Any folder is a destination, not only the deepest ones: filing
      // something in "Physique" rather than in one of its chapters is a normal
      // thing to want.
      selectable="any"
      searchScope="deep"
      disabled={disabled}
      invalid={Boolean(error)}
      id={fieldId}
      labels={{
        search: (parent) =>
          parent
            ? t("Search in {folder}…", { folder: parent })
            : t("Search a folder…"),
        empty: t("No folder matches."),
        back: t("Back"),
        rootLevel: t("My materials"),
        panelLabel: t("Folders"),
        breadcrumbLabel: t("Folder path"),
      }}
    >
      <CascaderTrigger
        aria-label={label ?? t("Folder")}
        render={<Button variant="outline" className="w-full justify-between" />}
      >
        <CascaderValue placeholder={t("Choose a folder")} />
      </CascaderTrigger>

      <CascaderContent className="w-(--anchor-width) min-w-64">
        <CascaderPanel>
          <CascaderNav>
            <CascaderInput />
          </CascaderNav>
          <CascaderBreadcrumb />
          <CascaderEmpty />
          <CascaderList>
            <CascaderItems />
          </CascaderList>
          <CascaderStatus />
        </CascaderPanel>
      </CascaderContent>
    </Cascader>
  )

  if (!label) return <div className={className}>{picker}</div>

  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      {picker}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
