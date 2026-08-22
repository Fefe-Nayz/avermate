"use client"

import type { ComponentType, ReactElement, ReactNode } from "react"
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"

/**
 * One set of actions, two menus.
 *
 * A file browser offers the same things from the row's own button and from a
 * right click, and the two must not drift: an action added to one and forgotten
 * in the other is how a menu starts lying about what is possible. The actions
 * are written once against these slots, and the slots decide which menu is
 * being drawn.
 */
export interface MaterialMenuKit {
  Item: ComponentType<{
    children?: ReactNode
    disabled?: boolean
    variant?: "default" | "destructive"
    onClick?: () => void
    /** Renders the item as something else — a link, usually. */
    render?: ReactElement
    className?: string
  }>
  Separator: ComponentType<{ className?: string }>
  /**
   * A branch of the menu. Tagging needs one — a checkbox per tag, of which
   * there can be a dozen, does not belong in the flat list beside Rename.
   */
  Sub: ComponentType<{ children?: ReactNode }>
  SubTrigger: ComponentType<{ children?: ReactNode; className?: string }>
  SubContent: ComponentType<{ children?: ReactNode; className?: string }>
  /**
   * An item that is on or off rather than an action.
   *
   * `closeOnClick={false}` is what makes tagging bearable: a menu that shuts
   * after each tick turns three tags into three right clicks.
   */
  CheckboxItem: ComponentType<{
    children?: ReactNode
    checked?: boolean
    disabled?: boolean
    closeOnClick?: boolean
    onCheckedChange?: (checked: boolean) => void
    className?: string
  }>
}

export const dropdownMenuKit: MaterialMenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  CheckboxItem: DropdownMenuCheckboxItem,
}

export const contextMenuKit: MaterialMenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  CheckboxItem: ContextMenuCheckboxItem,
}
