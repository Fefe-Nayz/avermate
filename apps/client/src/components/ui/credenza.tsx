"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "./use-media-query";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

interface BaseProps {
  children: React.ReactNode;
}

interface RootCredenzaProps extends BaseProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Content that should preserve its React state across desktop/mobile viewport changes.
   * This is rendered into a stable portal that survives the Dialog↔Drawer switch.
   */
  reparentableContent?: React.ReactNode;
}

interface CredenzaProps extends BaseProps {
  className?: string;
  asChild?: true;
}

const desktop = "(min-width: 768px)";

// Context to share state between Credenza components
interface CredenzaContextValue {
  isDesktop: boolean;
  open: boolean;
  /** Stable DOM element for reparenting form content */
  stableHost: HTMLDivElement | null;
  /** Register a slot where the stable host should be attached */
  registerSlot: (element: HTMLDivElement | null) => void;
}

const CredenzaContext = React.createContext<CredenzaContextValue | null>(null);

/**
 * Hook to access Credenza context. Returns null if used outside a Credenza.
 * Use this in forms to access the `open` state for reset-on-close behavior.
 */
function useCredenzaContext() {
  return React.useContext(CredenzaContext);
}

/**
 * Hook to access Credenza context with required check.
 * Throws if used outside a Credenza - use for Credenza sub-components only.
 */
function useRequiredCredenzaContext() {
  const context = React.useContext(CredenzaContext);
  if (!context) {
    throw new Error("Credenza components must be used within a Credenza");
  }
  return context;
}

/**
 * Hook that creates a stable DOM host element that persists across re-renders.
 */
function useStableHost() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  if (hostRef.current === null && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = "contents"; // Don't affect layout
    // Mark this as a credenza stable host for detection by parent components
    hostRef.current.setAttribute("data-credenza-stable-host", "true");

    // Prevent clicks inside the stable host from propagating to parent overlays
    // This fixes issues with nested dialogs/dropdowns closing unexpectedly
    hostRef.current.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    hostRef.current.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  return hostRef.current;
}

/**
 * Credenza - A responsive dialog/drawer component that can preserve form state
 * when switching between desktop (Dialog) and mobile (Drawer) modes.
 *
 * For state preservation, use the `reparentableContent` prop to provide content
 * that should survive viewport changes. Use `<CredenzaFormSlot />` to mark where
 * this content should appear in the dialog/drawer.
 *
 * @example
 * ```tsx
 * <Credenza
 *   open={open}
 *   onOpenChange={setOpen}
 *   reparentableContent={<MyForm onClose={() => setOpen(false)} />}
 * >
 *   <CredenzaTrigger>Open</CredenzaTrigger>
 *   <CredenzaContent>
 *     <CredenzaHeader>
 *       <CredenzaTitle>Title</CredenzaTitle>
 *     </CredenzaHeader>
 *     <CredenzaBody>
 *       <CredenzaFormSlot />
 *     </CredenzaBody>
 *   </CredenzaContent>
 * </Credenza>
 * ```
 */
const Credenza = ({
  children,
  open = false,
  onOpenChange,
  reparentableContent,
}: RootCredenzaProps) => {
  const isDesktop = useMediaQuery(desktop);
  const stableHost = useStableHost();
  const [currentSlot, setCurrentSlot] = React.useState<HTMLDivElement | null>(null);

  // Track viewport changes to detect transitions (skip initial hydration)
  const hasMountedRef = React.useRef(false);
  const prevIsDesktopRef = React.useRef(isDesktop);
  const isTransitioningRef = React.useRef(false);

  // Mark as mounted after first render
  React.useEffect(() => {
    hasMountedRef.current = true;
  }, []);

  // Detect viewport transitions (only after mount to skip hydration)
  if (hasMountedRef.current && prevIsDesktopRef.current !== isDesktop && open) {
    isTransitioningRef.current = true;
  }
  prevIsDesktopRef.current = isDesktop;

  // Reset transition flag after a delay
  React.useEffect(() => {
    if (isTransitioningRef.current) {
      const timer = setTimeout(() => {
        isTransitioningRef.current = false;
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isDesktop]);

  // Keep-alive: once opened, keep content mounted until Credenza unmounts
  // This preserves form state across open/close cycles and avoids animation issues
  const [hasBeenOpened, setHasBeenOpened] = React.useState(false);

  React.useEffect(() => {
    if (open && !hasBeenOpened) {
      setHasBeenOpened(true);
    }
  }, [open, hasBeenOpened]);

  // Move the stable host to the current slot when it changes
  React.useEffect(() => {
    if (!stableHost || !currentSlot) return;

    if (stableHost.parentElement !== currentSlot) {
      currentSlot.appendChild(stableHost);

      // After moving the host, focus the first focusable element in the form
      // This ensures focus goes to the form input instead of the close button
      requestAnimationFrame(() => {
        const firstFocusable = stableHost.querySelector<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-dialog-close])'
        );
        if (firstFocusable && open) {
          firstFocusable.focus();
        }
      });
    }
  }, [stableHost, currentSlot, open]);

  const registerSlot = React.useCallback((element: HTMLDivElement | null) => {
    if (element) {
      setCurrentSlot(element);
    }
  }, []);

  // Handle open change - ignore close events during viewport transitions
  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      // Ignore close events during viewport transitions
      if (!newOpen && isTransitioningRef.current) {
        return;
      }
      onOpenChange?.(newOpen);
    },
    [onOpenChange]
  );

  const Root = isDesktop ? Dialog : Drawer;

  return (
    <CredenzaContext.Provider
      value={{ isDesktop, open, stableHost, registerSlot }}
    >
      <Root open={open} onOpenChange={handleOpenChange}>
        {children}
      </Root>

      {/*
        Render reparentable content into the stable host via portal.
        Uses keep-alive pattern: content stays mounted once opened, preserving
        form state across open/close cycles and avoiding animation glitches.
        The stable host DOM element is moved between Dialog and Drawer slots.
      */}
      {stableHost && hasBeenOpened && reparentableContent && createPortal(reparentableContent, stableHost)}
    </CredenzaContext.Provider>
  );
};

const CredenzaTrigger = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useRequiredCredenzaContext();
  const Trigger = isDesktop ? DialogTrigger : DrawerTrigger;

  return (
    <Trigger className={className} {...props}>
      {children}
    </Trigger>
  );
};

const CredenzaClose = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useRequiredCredenzaContext();
  const Close = isDesktop ? DialogClose : DrawerClose;

  return (
    <Close className={className} {...props}>
      {children}
    </Close>
  );
};

const CredenzaContent = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop, stableHost } = useRequiredCredenzaContext();
  const Content = isDesktop ? DialogContent : DrawerContent;

  // Prevent dialog from closing when clicking on our portal content (stable host)
  const handleInteractOutside = React.useCallback(
    (e: Event) => {
      if (stableHost && stableHost.contains(e.target as Node)) {
        e.preventDefault();
      }
    },
    [stableHost]
  );

  return (
    <Content
      className={className}
      onInteractOutside={handleInteractOutside}
      onPointerDownOutside={handleInteractOutside}
      {...props}
    >
      {children}
    </Content>
  );
};

const CredenzaDescription = ({
  className,
  children,
  ...props
}: CredenzaProps) => {
  const { isDesktop } = useRequiredCredenzaContext();
  const Description = isDesktop ? DialogDescription : DrawerDescription;

  return (
    <Description className={className} {...props}>
      {children}
    </Description>
  );
};

const CredenzaHeader = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useRequiredCredenzaContext();
  const Header = isDesktop ? DialogHeader : DrawerHeader;

  return (
    <Header className={className} {...props}>
      {children}
    </Header>
  );
};

const CredenzaTitle = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useRequiredCredenzaContext();
  const Title = isDesktop ? DialogTitle : DrawerTitle;

  return (
    <Title className={className} {...props}>
      {children}
    </Title>
  );
};

const CredenzaBody = ({ className, children, ...props }: CredenzaProps) => {
  return (
    <div className={cn("px-4 md:px-0", className)} {...props}>
      {children}
    </div>
  );
};

/**
 * CredenzaFormSlot - Marks where `reparentableContent` should appear in the dialog/drawer.
 *
 * Use this inside CredenzaBody to indicate where the form (passed via reparentableContent
 * prop to Credenza) should be rendered. The form's React state will be preserved when
 * the viewport changes between desktop and mobile.
 */
const CredenzaFormSlot = ({ className, ...props }: Omit<CredenzaProps, "children">) => {
  const { registerSlot } = useRequiredCredenzaContext();
  const slotRef = React.useRef<HTMLDivElement>(null);

  // Register this slot when it mounts
  React.useEffect(() => {
    registerSlot(slotRef.current);
  }, [registerSlot]);

  return (
    <div
      ref={slotRef}
      className={cn("px-4 py-6 md:px-0 overflow-y-auto", className)}
      {...props}
    />
  );
};

const CredenzaFooter = ({ className, children, ...props }: CredenzaProps) => {
  const { isDesktop } = useRequiredCredenzaContext();
  const Footer = isDesktop ? DialogFooter : DrawerFooter;

  return (
    <Footer className={className} {...props}>
      {children}
    </Footer>
  );
};

export {
  Credenza,
  CredenzaTrigger,
  CredenzaClose,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaBody,
  CredenzaFormSlot,
  CredenzaFooter,
  useCredenzaContext,
};
