"use client";

import * as React from "react";
import { createPortal } from "react-dom";

// Portal component for rendering components outside vaul wrapper
export function BodyPortal({ children }: { children: React.ReactNode }) {
  const [mountNode, setMountNode] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setMountNode(document.body);
  }, []);

  return mountNode ? createPortal(children, mountNode) : null;
}
