"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function Avatar({
  src,
  size,
  className,
}: {
  src: string;
  size: number;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.src = src;
    img.onload = () => setLoaded(true);
    img.onerror = () => setLoaded(true);
  }, [src]);

  return (
    <>
      {!loaded && (
        <>
          {size === 256 && (
            <Skeleton className="rounded-full size-32 lg:size-64" />
          )}
          {size === 32 && <Skeleton className="rounded-full size-8" />}
          {size === 128 && <Skeleton className="rounded-full size-32" />}
          {size === 40 && <Skeleton className="rounded-full size-10" />}
        </>
      )}

      {loaded && (
        <img
          src={src}
          alt="User avatar"
          width={size}
          height={size}
          className={cn("rounded-full object-cover!", className)}
        />
      )}
    </>
  );
}
