"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

export function MobileSettingsAnchor({
  children,
  className,
  settingId,
}: {
  children: ReactNode;
  className?: string;
  settingId: string;
}) {
  const searchParams = useSearchParams();
  const activeSetting = searchParams.get("setting");
  const ref = useRef<HTMLDivElement | null>(null);
  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    if (activeSetting !== settingId) {
      setIsHighlighted(false);
      return;
    }

    const node = ref.current;
    if (!node) {
      return;
    }

    let highlightTimeout = 0;
    const scrollTimeout = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      setIsHighlighted(true);
      highlightTimeout = window.setTimeout(() => {
        setIsHighlighted(false);
      }, 1800);
    }, 160);

    return () => {
      window.clearTimeout(scrollTimeout);
      window.clearTimeout(highlightTimeout);
    };
  }, [activeSetting, settingId]);

  return (
    <div
      className={cn(
        "scroll-mt-28 rounded-xl transition-[background-color,box-shadow] duration-500 md:scroll-mt-0",
        isHighlighted && "bg-primary/6 ring-2 ring-primary/25",
        className
      )}
      data-setting-id={settingId}
      ref={ref}
    >
      {children}
    </div>
  );
}
