"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * Hook that creates a stable DOM host element that persists across re-renders.
 * This is the foundation for preserving React state when moving content between containers.
 */
function useStableHost() {
  // Create once; never recreated => subtree stays mounted
  const host = React.useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.createElement("div");
  }, []);
  return host;
}

interface ReparentableProps {
  /** The DOM element to attach the stable host into */
  target: HTMLElement | null;
  /** The content to render (will preserve state when target changes) */
  children: React.ReactNode;
}

/**
 * Reparentable - Renders children into a stable portal host that can be moved
 * between different DOM parents without causing React to remount the children.
 *
 * This is useful for responsive dialogs/drawers where you want to swap the
 * container type (Dialog <-> Drawer) without losing form state.
 */
export function Reparentable({ target, children }: ReparentableProps) {
  const host = useStableHost();

  React.useEffect(() => {
    if (!target || !host) return;

    // Move the host to the target if not already there
    if (host.parentElement !== target) {
      target.appendChild(host);
    }

    // Cleanup: remove host when component unmounts
    return () => {
      if (host.parentElement) {
        host.parentElement.removeChild(host);
      }
    };
  }, [target, host]);

  // SSR safety: don't render portal until host exists
  if (!host) return null;

  // Children are rendered into a stable host div
  return createPortal(children, host);
}

export { useStableHost };
