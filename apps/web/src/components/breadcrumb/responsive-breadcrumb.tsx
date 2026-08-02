"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * A breadcrumb that measures itself.
 *
 * The naive approach — hide the middle below a breakpoint — is wrong twice
 * over: a deep path still overflows on a wide screen, and a shallow one gets
 * collapsed on a narrow one for no reason. So the crumbs are laid out once
 * off-screen, the real widths are read back, and only as many as actually fit
 * are shown. Whatever does not fit moves into a menu rather than disappearing.
 *
 * Separators are navigation too: each one opens the siblings of the crumb to
 * its right, which turns the trail into a way to move sideways through the
 * tree instead of only back up it.
 */

export interface Crumb {
  key: string;
  label: string;
  href?: string;
  icon?: ReactNode;
  /** Siblings reachable from the separator that precedes this crumb. */
  siblings?: Array<{ key: string; label: string; href: string }>;
}

interface Props {
  items: Crumb[];
  className?: string;
}

/** Never collapse the first crumb or the last one: they carry the context. */
function collapsible(index: number, count: number): boolean {
  return index > 0 && index < count - 1;
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ResponsiveBreadcrumb({ items, className }: Props) {
  const t = useExtracted();
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const [available, setAvailable] = useState(0);
  const [widths, setWidths] = useState<number[]>([]);
  const [separatorWidth, setSeparatorWidth] = useState(0);
  const [ellipsisWidth, setEllipsisWidth] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const measurer = measureRef.current;
    if (!container || !measurer) return;

    setAvailable(container.getBoundingClientRect().width);
    setWidths(
      Array.from(measurer.querySelectorAll("[data-measure-item]")).map(
        (node) => node.getBoundingClientRect().width,
      ),
    );
    setSeparatorWidth(
      measurer
        .querySelector("[data-measure-separator]")
        ?.getBoundingClientRect().width ?? 20,
    );
    setEllipsisWidth(
      measurer
        .querySelector("[data-measure-ellipsis]")
        ?.getBoundingClientRect().width ?? 32,
    );
  }, []);

  useIsomorphicLayoutEffect(() => {
    measure();
  }, [measure, items]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(container);
    return () => observer.disconnect();
  }, [measure]);

  /**
   * Keep the outer crumbs and drop from the middle outwards, because the ends
   * are what orient you: where you are, and what you are inside of.
   */
  const visible = useMemo(() => {
    const count = items.length;
    if (count === 0) return { indices: [] as number[], hidden: [] as number[] };
    if (widths.length !== count || available === 0) {
      return { indices: items.map((_, index) => index), hidden: [] };
    }

    const total = (indices: number[]) =>
      indices.reduce((sum, index) => sum + (widths[index] ?? 0), 0) +
      Math.max(0, indices.length - 1) * separatorWidth;

    const all = items.map((_, index) => index);
    if (total(all) <= available) return { indices: all, hidden: [] };

    const kept = new Set(all);
    const hidden: number[] = [];

    // Give up the crumb closest to the middle first, then widen outwards.
    const order = all
      .filter((index) => collapsible(index, count))
      .sort(
        (a, b) =>
          Math.abs(a - (count - 1) / 2) - Math.abs(b - (count - 1) / 2),
      );

    for (const index of order) {
      const indices = all.filter((candidate) => kept.has(candidate));
      if (total(indices) + (hidden.length > 0 ? ellipsisWidth : 0) <= available) {
        break;
      }
      kept.delete(index);
      hidden.push(index);
    }

    return {
      indices: all.filter((index) => kept.has(index)),
      hidden: hidden.sort((a, b) => a - b),
    };
  }, [items, widths, available, separatorWidth, ellipsisWidth]);

  const renderCrumb = (item: Crumb, index: number, isLast: boolean) => {
    const content = (
      <span className="flex min-w-0 items-center gap-1.5">
        {item.icon}
        <span className="truncate">{item.label}</span>
      </span>
    );

    if (isLast || !item.href) {
      return (
        <span
          key={item.key}
          aria-current={isLast ? "page" : undefined}
          className={cn(
            "min-w-0 max-w-[16rem] truncate text-sm",
            isLast ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {content}
        </span>
      );
    }

    return (
      <Link
        key={item.key}
        href={item.href}
        className="min-w-0 max-w-[12rem] truncate rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {content}
      </Link>
    );
  };

  const separator = (nextItem: Crumb | undefined, key: string) => {
    const siblings = nextItem?.siblings ?? [];
    if (siblings.length === 0) {
      return (
        <ChevronRightIcon
          key={key}
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground/50"
        />
      );
    }

    return (
      <DropdownMenu key={key}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={t("Show related pages")}
              className="-mx-0.5 shrink-0 rounded-sm px-0.5 py-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
          }
        >
          <ChevronRightIcon aria-hidden className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {siblings.map((sibling) => (
            <DropdownMenuItem
              key={sibling.key}
              render={<Link href={sibling.href} />}
            >
              {sibling.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const nodes: ReactNode[] = [];
  visible.indices.forEach((index, position) => {
    const item = items[index] as Crumb;
    const isLast = index === items.length - 1;

    if (position > 0) {
      const previous = visible.indices[position - 1] as number;
      const skipped = visible.hidden.filter(
        (hiddenIndex) => hiddenIndex > previous && hiddenIndex < index,
      );

      nodes.push(separator(item, `sep-${index}`));

      if (skipped.length > 0) {
        nodes.push(
          <DropdownMenu key={`ellipsis-${index}`}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={t("Show hidden pages")}
                  className="shrink-0 rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                />
              }
            >
              <MoreHorizontalIcon aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {skipped.map((hiddenIndex) => {
                const hidden = items[hiddenIndex] as Crumb;
                return (
                  <DropdownMenuItem
                    key={hidden.key}
                    render={hidden.href ? <Link href={hidden.href} /> : <span />}
                  >
                    {hidden.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>,
          separator(item, `sep-after-ellipsis-${index}`),
        );
      }
    }

    nodes.push(renderCrumb(item, index, isLast));
  });

  return (
    <div ref={containerRef} className={cn("relative min-w-0 flex-1", className)}>
      <nav aria-label={t("Breadcrumb")} className="flex min-w-0 items-center gap-1.5">
        {nodes}
      </nav>

      {/* Laid out but not painted: this is where the real widths come from. */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 -z-10 flex h-0 items-center gap-1.5 overflow-hidden opacity-0"
        style={{ visibility: "hidden", contain: "layout style" }}
      >
        {items.map((item) => (
          <span
            key={item.key}
            data-measure-item
            className="flex items-center gap-1.5 whitespace-nowrap text-sm"
          >
            {item.icon}
            {item.label}
          </span>
        ))}
        <ChevronRightIcon data-measure-separator className="size-3.5" />
        <MoreHorizontalIcon data-measure-ellipsis className="size-4" />
      </div>
    </div>
  );
}
