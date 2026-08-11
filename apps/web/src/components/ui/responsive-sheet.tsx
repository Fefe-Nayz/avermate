"use client"

import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

/**
 * One choice, presented the way the device expects it.
 *
 * The year picker and the quick-add menu were bottom sheets at every width, so
 * a desktop user got a panel sliding up from the bottom edge of a monitor —
 * a gesture affordance with no gesture behind it. Under `md` it stays a
 * drawer, because that is what a thumb reaches; above it, it is a dialog.
 *
 * The two are interchangeable here only because the content is a short list.
 * Anything that needs to be dragged, or that must survive a resize mid-edit,
 * belongs in one or the other on purpose rather than in this.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="pb-safe">
          <DrawerHeader className="pb-2 text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description ? (
              <DrawerDescription>{description}</DrawerDescription>
            ) : null}
          </DrawerHeader>
          <div className={cn("px-3 pb-4", className)}>{children}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <div className={className}>{children}</div>
      </DialogContent>
    </Dialog>
  )
}
