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

  // Get the appropriate CSS classes for the size
  const getSizeClasses = (size: number) => {
    switch (size) {
      case 256:
        return "size-32 lg:size-64";
      case 32:
        return "size-8";
      case 128:
        return "size-32";
      case 40:
        return "size-10";
      case 80:
        return "size-20";
      default:
        return `w-[${size}px] h-[${size}px]`;
    }
  };

  const sizeClasses = getSizeClasses(size);

  return (
    <div className={cn("relative", sizeClasses, className)}>
      {/* Skeleton - fades out when image loads */}
      <Skeleton
        className={cn(
          "absolute inset-0 rounded-full ",
          loaded ? "opacity-0" : "opacity-100"
        )}
      />

      {/* Image - fades in when loaded */}
      <img
        src={src}
        alt="User avatar"
        width={size}
        height={size}
        className={cn(
          "rounded-full object-cover  absolute inset-0 w-full h-full",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}
