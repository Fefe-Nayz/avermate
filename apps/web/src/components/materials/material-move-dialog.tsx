"use client"

import { useState } from "react"
import { useExtracted } from "next-intl"
import { FolderInputIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import {
  MaterialFolderPicker,
  ROOT_FOLDER_VALUE,
} from "./materials-folder-picker"
import type { MaterialFolderView } from "./materials-types"

/**
 * Moving several things at once.
 *
 * The single-target moves reuse the dialogs those things already have — a
 * folder's carries its subject, a document's its title — and both now pick a
 * destination with the cascader. A selection has no such dialog, and a nested
 * menu was the wrong shape for one anyway: a submenu cannot be searched, and by
 * the third level it is a wall of folders opening sideways off the screen.
 */
export function MaterialMoveDialog({
  folders,
  count,
  label,
  pending,
  onClose,
  onConfirm,
}: {
  folders: readonly MaterialFolderView[]
  /** How many things are being moved; 1 shows the name instead. */
  count: number
  label: string | null
  pending: boolean
  onClose: () => void
  onConfirm: (folderId: string | null) => void
}) {
  const t = useExtracted()
  const [folderId, setFolderId] = useState(ROOT_FOLDER_VALUE)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {count === 1 && label
              ? t("Move {name}", { name: label })
              : t("{count, plural, one {Move # item} other {Move # items}}", {
                  count,
                })}
          </DialogTitle>
          <DialogDescription>
            {t("Pick where it goes. Recordings stay where they are.")}
          </DialogDescription>
        </DialogHeader>

        <MaterialFolderPicker
          label={t("Destination")}
          folders={folders}
          value={folderId}
          onValueChange={setFolderId}
          disabled={pending}
        />

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onConfirm(folderId === ROOT_FOLDER_VALUE ? null : folderId)
            }
          >
            {pending ? <Spinner /> : <FolderInputIcon />}
            {t("Move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
