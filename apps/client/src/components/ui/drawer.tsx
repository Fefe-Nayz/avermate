"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"

// Global manager to coordinate nested drawers on mobile.
let __drawerNextId = 1
const __drawerOpenStack: number[] = [] // stack of open drawer ids
const __drawerCloseFromBack = new Map<number, () => void>()
let __drawerPopListenerInitialized = false
let __drawerSuppressNextPop = false

function __ensureGlobalPopListener() {
  if (typeof window === "undefined") return
  if (__drawerPopListenerInitialized) return
  const onPop = (ev: PopStateEvent) => {
    if (__drawerSuppressNextPop) {
      // Ignore programmatic pops triggered to consume our own pushState
      __drawerSuppressNextPop = false
      return
    }
    // User-initiated back: close the top-most open drawer, if any
    const topId = __drawerOpenStack[__drawerOpenStack.length - 1]
    if (topId != null) {
      const close = __drawerCloseFromBack.get(topId)
      if (close) close()
    }
  }
  window.addEventListener("popstate", onPop)
  __drawerPopListenerInitialized = true
}

// Intercept mobile back gesture to close the drawer first.
// Works by pushing a history entry when open, then consuming it on close or back.
const Drawer = ({
  shouldScaleBackground = true,
  open: controlledOpen,
  defaultOpen,
  onOpenChange: userOnOpenChange,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => {
  const isMobile = useIsMobile()

  // Support controlled and uncontrolled usage
  const isControlled = controlledOpen !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    () => defaultOpen ?? false
  )
  const open = isControlled ? controlledOpen! : uncontrolledOpen

  // History + nesting management
  const idRef = React.useRef<number>(0)
  if (idRef.current === 0) {
    idRef.current = __drawerNextId++
  }
  const drawerId = idRef.current
  const hasPushedRef = React.useRef(false)
  const skipProgrammaticPopOnCloseRef = React.useRef(false)
  const wasOpenRef = React.useRef(false)

  const registerOpen = React.useCallback(() => {
    if (!isMobile) return
    if (typeof window === "undefined") return
    if (hasPushedRef.current) return
    __ensureGlobalPopListener()
    try {
      window.history.pushState({ __drawer: true, id: drawerId }, "", window.location.href)
      hasPushedRef.current = true
      __drawerOpenStack.push(drawerId)
      __drawerCloseFromBack.set(drawerId, () => {
        // Mark that this close originates from a back gesture
        skipProgrammaticPopOnCloseRef.current = true
        if (isControlled) {
          userOnOpenChange?.(false)
        } else {
          setUncontrolledOpen(false)
        }
      })
    } catch {
      // ignore
    }
  }, [drawerId, isControlled, isMobile, userOnOpenChange])

  const unregisterCloseHandlerAndStack = React.useCallback(() => {
    // Remove id from stack wherever it is
    const idx = __drawerOpenStack.lastIndexOf(drawerId)
    if (idx !== -1) __drawerOpenStack.splice(idx, 1)
    __drawerCloseFromBack.delete(drawerId)
  }, [drawerId])

  const consumeHistoryIfNeeded = React.useCallback(() => {
    if (!isMobile) return
    if (typeof window === "undefined") return
    if (!hasPushedRef.current) return
    if (skipProgrammaticPopOnCloseRef.current) {
      // Closed due to user back: history already popped
      hasPushedRef.current = false
      return
    }
    // Closed programmatically: consume the pushed entry and suppress global handler
    __drawerSuppressNextPop = true
    try {
      window.history.back()
    } catch {
      // ignore
    } finally {
      hasPushedRef.current = false
    }
  }, [isMobile])

  // Sync side effects when open changes (mobile only)
  React.useEffect(() => {
    if (!isMobile) return
    if (open && !wasOpenRef.current) {
      registerOpen()
    }
    if (!open && wasOpenRef.current) {
      // Closing path
      unregisterCloseHandlerAndStack()
      consumeHistoryIfNeeded()
      // Reset the back-origin flag after handling close
      skipProgrammaticPopOnCloseRef.current = false
    }
    wasOpenRef.current = open
  }, [open, isMobile, registerOpen, unregisterCloseHandlerAndStack, consumeHistoryIfNeeded])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      // First, forward to user's handler
      userOnOpenChange?.(next)
      // Then, update internal state if uncontrolled
      if (!isControlled) {
        setUncontrolledOpen(next)
      }
      // Side effects are handled by the effect watching `open`
    },
    [isControlled, userOnOpenChange]
  )

  return (
    <DrawerPrimitive.Root
      shouldScaleBackground={shouldScaleBackground}
      open={open}
      onOpenChange={handleOpenChange}
      defaultOpen={defaultOpen}
      {...props}
    />
  )
}
Drawer.displayName = "Drawer"

const DrawerTrigger = DrawerPrimitive.Trigger

const DrawerPortal = DrawerPrimitive.Portal

const DrawerClose = DrawerPrimitive.Close

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
))
DrawerOverlay.displayName = DrawerPrimitive.Overlay.displayName

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
        className
      )}
      {...props}
    >
      <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
))
DrawerContent.displayName = "DrawerContent"

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)}
    {...props}
  />
)
DrawerHeader.displayName = "DrawerHeader"

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mt-auto flex flex-col gap-2 p-4", className)}
    {...props}
  />
)
DrawerFooter.displayName = "DrawerFooter"

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DrawerTitle.displayName = DrawerPrimitive.Title.displayName

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DrawerDescription.displayName = DrawerPrimitive.Description.displayName

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
