"use client"

import * as React from "react"
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * A menu that is a dropdown on a pointer and a drawer under a thumb.
 *
 * A dropdown on a phone is a small floating box anchored to a trigger that is
 * usually in a top corner, with rows sized for a cursor. The same choice as a
 * bottom sheet is full-width, thumb-height, and lands where the hand already
 * is. Desktop keeps the dropdown, where a floating box beside the pointer is
 * exactly right.
 *
 * Feature parity with the component on `main`, rebuilt on this app's Base UI
 * primitives. Three of its mechanisms are done differently on purpose, because
 * each of them was a source of bugs rather than a design decision:
 *
 * - **Submenus.** `main` searched the React children tree for `DropDrawerSub`
 *   by element identity, read `props.children`, recursed for the matching
 *   `SubContent`, and copied those nodes into its own render. A submenu wrapped
 *   in a fragment, a conditional, or a component of your own silently
 *   vanished. Here every panel derives its own path from where it is nested and
 *   renders as an opaque overlay when that path is active — nothing is
 *   extracted, nothing copied, and nesting works to any depth.
 * - **"Am I in a group?"** `main` answered this by walking `parentElement` for a
 *   `data-drop-drawer-group` attribute inside an effect behind a
 *   `setTimeout(0)`, so every item rendered once with the wrong styling and
 *   corrected itself a tick later. Here it is a context, known during the first
 *   render.
 * - **Submenu ids.** `main` used a module-level counter, which is not
 *   SSR-stable. Here it is `useId()`, and the prop is optional.
 *
 * `main` also tracked a forward/backward animation direction. Stacked overlays
 * do not need one: a panel slides in from the right when opened and back out to
 * the right when closed, which is already the correct motion in both
 * directions. The direction only mattered because `main` swapped content in
 * place instead of stacking it.
 */

interface RootValue {
  isMobile: boolean
}
const RootContext = React.createContext<RootValue>({ isMobile: false })
const useIsMobileMenu = () => React.useContext(RootContext).isMobile

/** The panel a subtree belongs to. `""` is the root sheet. */
const PanelContext = React.createContext("")
/** Whether the surrounding rows are cased in a group card. */
const GroupContext = React.createContext(false)
/** Inside a pushed panel a tap must not dismiss the whole sheet. */
const InSubmenuContext = React.createContext(false)

interface StackValue {
  activePath: string
  navigate: (path: string) => void
  back: () => void
}
const StackContext = React.createContext<StackValue>({
  activePath: "",
  navigate: () => undefined,
  back: () => undefined,
})

const SubContext = React.createContext<{ path: string }>({ path: "" })

/** `"/a/b"` → `"/a"`; the root's parent is the root. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf("/")
  return cut <= 0 ? "" : path.slice(0, cut)
}

export function DropDrawer({
  children,
  open,
  onOpenChange,
}: {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const value = React.useMemo(() => ({ isMobile }), [isMobile])

  return (
    <RootContext.Provider value={value}>
      {isMobile ? (
        <Drawer open={open} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      ) : (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
          {children}
        </DropdownMenu>
      )}
    </RootContext.Provider>
  )
}

/**
 * Both primitives take Base UI's `render` prop, but their own prop types
 * disagree on a branded `handle`, so the two branches are kept apart rather
 * than unioned into something uninhabitable.
 */
export function DropDrawerTrigger({
  render,
  children,
  className,
}: {
  render?: React.ReactElement
  children?: React.ReactNode
  className?: string
}) {
  const isMobile = useIsMobileMenu()
  if (isMobile) {
    return (
      <DrawerTrigger render={render} className={className}>
        {children}
      </DrawerTrigger>
    )
  }
  return (
    <DropdownMenuTrigger render={render} className={className}>
      {children}
    </DropdownMenuTrigger>
  )
}

export function DropDrawerContent({
  className,
  children,
  title,
  align,
  sideOffset,
}: {
  className?: string
  children: React.ReactNode
  /** Sheet heading. A dropdown has no room for one and ignores it. */
  title?: string
  align?: "start" | "center" | "end"
  sideOffset?: number
}) {
  const isMobile = useIsMobileMenu()
  const [activePath, setActivePath] = React.useState("")

  const navigate = React.useCallback((path: string) => {
    haptic("selection")
    setActivePath(path)
  }, [])

  const back = React.useCallback(() => {
    haptic("selection")
    setActivePath(parentOf)
  }, [])

  const stack = React.useMemo(
    () => ({ activePath, navigate, back }),
    [activePath, navigate, back]
  )

  if (!isMobile) {
    return (
      <DropdownMenuContent
        className={className}
        align={align}
        sideOffset={sideOffset}
      >
        {children}
      </DropdownMenuContent>
    )
  }

  const atRoot = activePath === ""

  return (
    <DrawerContent className={cn("max-h-[85svh]", className)}>
      <StackContext.Provider value={stack}>
        <PanelContext.Provider value="">
          {title ? (
            <DrawerHeader className="pb-1">
              <DrawerTitle className="text-base">{title}</DrawerTitle>
            </DrawerHeader>
          ) : null}
          {/* The submenu panels cover exactly this box and nothing outside it,
              so the sheet keeps one height and the grabber stays put. */}
          <div className="relative min-h-0 flex-1">
            <div
              aria-hidden={atRoot ? undefined : true}
              className={cn(
                "max-h-[70svh] overflow-y-auto overscroll-contain px-2 pb-2",
                !atRoot && "pointer-events-none"
              )}
            >
              {children}
            </div>
          </div>
        </PanelContext.Provider>
      </StackContext.Provider>
    </DrawerContent>
  )
}

/**
 * The shared sheet row: full width, thumb height, its own press state.
 *
 * Flat on purpose. `main` gave every standalone row its own filled, inset card
 * and every grouped row a different background again, which on a short menu
 * reads as a stack of buttons rather than a list. One row style, and the group
 * is the only thing that draws a container.
 */
const rowClass =
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition-colors select-none active:bg-accent disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

export function DropDrawerItem({
  className,
  children,
  onClick,
  onSelect,
  icon,
  variant = "default",
  inset,
  disabled,
}: {
  className?: string
  children: React.ReactNode
  onClick?: () => void
  /** Fires with `onClick`; kept for parity with the menu primitive's API. */
  onSelect?: () => void
  /** Trailing slot — a chevron, a shortcut, a check. */
  icon?: React.ReactNode
  variant?: "default" | "destructive"
  inset?: boolean
  disabled?: boolean
}) {
  const isMobile = useIsMobileMenu()
  const inSubmenu = React.useContext(InSubmenuContext)

  const activate = () => {
    if (disabled) return
    onClick?.()
    onSelect?.()
  }

  if (!isMobile) {
    return (
      <DropdownMenuItem
        className={className}
        onClick={activate}
        disabled={disabled}
        variant={variant}
        inset={inset}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span>{children}</span>
          {icon ? <span className="shrink-0">{icon}</span> : null}
        </span>
      </DropdownMenuItem>
    )
  }

  const row = (
    <button
      type="button"
      data-slot="drop-drawer-item"
      data-variant={variant}
      disabled={disabled}
      onClick={activate}
      className={cn(
        rowClass,
        inset && "pl-8",
        variant === "destructive" &&
          "text-destructive active:bg-destructive/15",
        className
      )}
    >
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {icon ? <span className="shrink-0">{icon}</span> : null}
    </button>
  )

  // Choosing dismisses the sheet — except inside a pushed panel, where the tap
  // is navigation and closing would throw away the level you just opened.
  return inSubmenu || disabled ? row : <DrawerClose render={row} />
}

export function DropDrawerCheckboxItem({
  className,
  children,
  checked,
  onCheckedChange,
  disabled,
}: {
  className?: string
  children: React.ReactNode
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
}) {
  const isMobile = useIsMobileMenu()

  if (!isMobile) {
    return (
      <DropdownMenuCheckboxItem
        className={className}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange?.(next === true)}
      >
        {children}
      </DropdownMenuCheckboxItem>
    )
  }
  // Never wrapped in DrawerClose: ticking several boxes in a row is the point.
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked === true}
      disabled={disabled}
      onClick={() => onCheckedChange?.(checked !== true)}
      className={cn(rowClass, className)}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <CheckIcon
        className={cn(
          "size-4 shrink-0 text-primary",
          checked === true ? "opacity-100" : "opacity-0"
        )}
      />
    </button>
  )
}

const RadioGroupContext = React.createContext<{
  value?: string
  onValueChange?: (value: string) => void
}>({})

export function DropDrawerRadioGroup({
  className,
  children,
  value,
  onValueChange,
}: {
  className?: string
  children: React.ReactNode
  value?: string
  onValueChange?: (value: string) => void
}) {
  const isMobile = useIsMobileMenu()
  const radio = React.useMemo(
    () => ({ value, onValueChange }),
    [value, onValueChange]
  )

  if (!isMobile) {
    return (
      <DropdownMenuRadioGroup
        className={className}
        value={value}
        onValueChange={(next) => onValueChange?.(String(next))}
      >
        {children}
      </DropdownMenuRadioGroup>
    )
  }
  return (
    <RadioGroupContext.Provider value={radio}>
      <div role="group" className={cn("flex flex-col", className)}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  )
}

export function DropDrawerRadioItem({
  className,
  children,
  value,
  disabled,
}: {
  className?: string
  children: React.ReactNode
  value: string
  disabled?: boolean
}) {
  const isMobile = useIsMobileMenu()
  const group = React.useContext(RadioGroupContext)
  const inSubmenu = React.useContext(InSubmenuContext)

  if (!isMobile) {
    return (
      <DropdownMenuRadioItem
        className={className}
        value={value}
        disabled={disabled}
      >
        {children}
      </DropdownMenuRadioItem>
    )
  }

  const checked = group.value === value
  const row = (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => group.onValueChange?.(value)}
      className={cn(rowClass, checked && "font-medium", className)}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <CheckIcon
        className={cn(
          "size-4 shrink-0 text-primary",
          checked ? "opacity-100" : "opacity-0"
        )}
      />
    </button>
  )

  // One radio choice settles the question, so picking closes the sheet.
  return inSubmenu || disabled ? row : <DrawerClose render={row} />
}

export function DropDrawerLabel({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const isMobile = useIsMobileMenu()
  if (!isMobile) {
    return (
      <DropdownMenuLabel className={className}>{children}</DropdownMenuLabel>
    )
  }
  return (
    <p
      data-slot="drop-drawer-label"
      className={cn(
        "px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </p>
  )
}

export function DropDrawerSeparator({ className }: { className?: string }) {
  const isMobile = useIsMobileMenu()
  const inGroup = React.useContext(GroupContext)
  // A group draws its own dividers between rows, so an explicit separator
  // inside one would double them.
  if (isMobile && inGroup) return null
  if (isMobile) {
    return (
      <div role="separator" className={cn("my-1 h-px bg-border", className)} />
    )
  }
  return <DropdownMenuSeparator className={className} />
}

export function DropDrawerGroup({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const isMobile = useIsMobileMenu()

  // Dividers between the group's own direct children, and any separator the
  // caller put inside is dropped — the card owns its rules. This inspects only
  // its immediate children, never the tree below them.
  const divided = React.useMemo(() => {
    if (!isMobile) return children
    const rows = React.Children.toArray(children).filter(
      (child) =>
        !React.isValidElement(child) || child.type !== DropDrawerSeparator
    )
    return rows.flatMap((child, index) =>
      index === rows.length - 1
        ? [child]
        : [
            child,
            <div
              key={`divider-${index}`}
              aria-hidden
              className="h-px bg-border/70"
            />,
          ]
    )
  }, [children, isMobile])

  if (!isMobile) {
    return (
      <DropdownMenuGroup className={className}>{children}</DropdownMenuGroup>
    )
  }
  return (
    <GroupContext.Provider value={true}>
      <div
        role="group"
        data-slot="drop-drawer-group"
        className={cn("overflow-hidden rounded-xl bg-muted/40", className)}
      >
        {divided}
      </div>
    </GroupContext.Provider>
  )
}

export function DropDrawerFooter({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const isMobile = useIsMobileMenu()
  if (isMobile) {
    return (
      <DrawerFooter className={cn("gap-2 p-4", className)}>
        {children}
      </DrawerFooter>
    )
  }
  // The menu primitive has no footer slot, so it is a plain block — rendering
  // nothing here would silently drop the caller's content on desktop.
  return <div className={cn("p-1", className)}>{children}</div>
}

export function DropDrawerSub({
  id,
  children,
}: {
  /** Optional; a stable generated id is used when omitted. */
  id?: string
  children: React.ReactNode
}) {
  const isMobile = useIsMobileMenu()
  const generated = React.useId()
  const parent = React.useContext(PanelContext)
  const path = `${parent}/${id ?? generated}`
  const value = React.useMemo(() => ({ path }), [path])

  if (!isMobile) return <DropdownMenuSub>{children}</DropdownMenuSub>
  return <SubContext.Provider value={value}>{children}</SubContext.Provider>
}

export function DropDrawerSubTrigger({
  className,
  children,
  icon,
  inset,
}: {
  className?: string
  children: React.ReactNode
  icon?: React.ReactNode
  inset?: boolean
}) {
  const isMobile = useIsMobileMenu()
  const { path } = React.useContext(SubContext)
  const { navigate } = React.useContext(StackContext)

  if (!isMobile) {
    return (
      <DropdownMenuSubTrigger className={className} inset={inset}>
        {children}
      </DropdownMenuSubTrigger>
    )
  }
  // Deliberately not a DrawerClose: this opens a level, it does not choose.
  return (
    <button
      type="button"
      onClick={() => navigate(path)}
      className={cn(rowClass, inset && "pl-8", className)}
    >
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {icon ?? (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  )
}

export function DropDrawerSubContent({
  className,
  children,
  title,
}: {
  className?: string
  children: React.ReactNode
  /** Heading for the pushed panel; falls back to a plain Back. */
  title?: string
}) {
  const t = useExtracted()
  const isMobile = useIsMobileMenu()
  const { path } = React.useContext(SubContext)
  const { activePath, back } = React.useContext(StackContext)

  if (!isMobile) {
    return (
      <DropdownMenuSubContent className={className}>
        {children}
      </DropdownMenuSubContent>
    )
  }

  const showing = activePath === path
  // Ancestors of the active panel stay mounted and covered, so coming back
  // reveals the level exactly as it was rather than rebuilding it.
  const onPath = activePath.startsWith(path)

  return (
    <PanelContext.Provider value={path}>
      <InSubmenuContext.Provider value={true}>
        <div
          aria-hidden={showing ? undefined : true}
          className={cn(
            "absolute inset-0 z-10 flex flex-col bg-background transition-transform duration-200 ease-out",
            onPath ? "translate-x-0" : "pointer-events-none translate-x-full",
            className
          )}
        >
          <div className="flex shrink-0 items-center gap-1 px-1 pb-1">
            <button
              type="button"
              onClick={back}
              aria-label={t("Back")}
              className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground active:bg-accent"
            >
              <ChevronLeftIcon className="size-4" />
              {title ?? t("Back")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {children}
          </div>
        </div>
      </InSubmenuContext.Provider>
    </PanelContext.Provider>
  )
}
