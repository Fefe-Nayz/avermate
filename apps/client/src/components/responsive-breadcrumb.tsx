"use client";

import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbEllipsis,
} from "@/components/ui/breadcrumb";
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerGroup,
  DropDrawerItem,
  DropDrawerTrigger,
} from "@/components/ui/dropdrawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface BreadcrumbData {
  key: string;
  label: string;
  href: string;
  clickable: boolean;
}

interface ResponsiveBreadcrumbProps {
  items: BreadcrumbData[];
  renderSeparator?: (prevKey: string) => React.ReactNode;
  renderFinalNavigation?: () => React.ReactNode;
}

// Collapse order: center-first, alternating left/right, never include last item
function getCollapseOrder(count: number): number[] {
  if (count <= 1) return [];
  const order: number[] = [];
  const lastIndex = count - 1;
  const center = Math.floor(count / 2);
  let left = center;
  let right = center + 1;
  while (order.length < count - 1) {
    if (left >= 0 && left !== lastIndex) {
      order.push(left);
      left--;
    }
    if (right < count && right !== lastIndex && order.length < count - 1) {
      order.push(right);
      right++;
    }
  }
  return order;
}

export function ResponsiveBreadcrumb({
  items,
  renderSeparator,
  renderFinalNavigation,
}: ResponsiveBreadcrumbProps) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const [collapsedIndices, setCollapsedIndices] = useState<Set<number>>(
    new Set()
  );
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const collapseOrderRef = useRef<number[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const itemWidthsRef = useRef<Map<string, number>>(new Map());
  const measurementPhaseRef = useRef<boolean>(false);

  // Prepare collapse order when items length changes
  useEffect(() => {
    collapseOrderRef.current = getCollapseOrder(items.length);
    // Reset collapse and cached widths when items change; re-measure after
    setCollapsedIndices(new Set());
    itemWidthsRef.current.clear();
  }, [items.length, items]);

  // Measure and cache widths of items/separators/ellipsis using a hidden container
  const measureItemWidths = useCallback(() => {
    if (measurementPhaseRef.current) return;
    if (itemWidthsRef.current.size > 0) return; // already measured
    measurementPhaseRef.current = true;

    const tempContainer = document.createElement("div");
    // Hidden but measurable
    Object.assign(tempContainer.style, {
      position: "absolute",
      visibility: "hidden",
      pointerEvents: "none",
      inset: "-9999px",
      whiteSpace: "nowrap",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(tempContainer);

    const tempBreadcrumb = document.createElement("nav");
    const tempList = document.createElement("ol");
    tempList.className = "text-sm flex items-center gap-1.5";
    (tempList.style as any).display = "flex";
    (tempList.style as any).flexWrap = "nowrap";
    tempBreadcrumb.appendChild(tempList);
    tempContainer.appendChild(tempBreadcrumb);

    // Build temp items + separators
    items.forEach((item, index) => {
      const tempItem = document.createElement("li");
      tempItem.className = "inline-flex items-center gap-1.5";
      tempItem.innerHTML = `<a class="inline-flex items-center rounded-md outline-none p-1">${item.label}</a>`;
      tempList.appendChild(tempItem);
      const width = tempItem.getBoundingClientRect().width;
      itemWidthsRef.current.set(`item-${index}`, width);

      if (index < items.length - 1) {
        const tempSep = document.createElement("li");
        tempSep.className = "[&>svg]:size-3.5";
        // approximate separator width similar to chevron button width
        tempSep.innerHTML =
          '<span style="display:inline-block;width:28px;height:1px;"></span>';
        tempList.appendChild(tempSep);
        const sepWidth = tempSep.getBoundingClientRect().width || 28;
        itemWidthsRef.current.set(`sep-${index}`, sepWidth);
      }
    });

    // Measure ellipsis width similarly
    const tempEllipsis = document.createElement("li");
    tempEllipsis.innerHTML =
      '<button class="h-auto p-1"><span style="display:flex;width:20px;height:20px;"></span></button>';
    tempList.appendChild(tempEllipsis);
    const ellipsisWidth = tempEllipsis.getBoundingClientRect().width || 20;
    itemWidthsRef.current.set("ellipsis", ellipsisWidth);

    // Measure final navigation arrow width if it exists
    if (renderFinalNavigation) {
      const tempFinalNav = document.createElement("li");
      tempFinalNav.innerHTML =
        '<button class="size-7"><span style="display:flex;width:14px;height:14px;"></span></button>';
      tempList.appendChild(tempFinalNav);
      const finalNavWidth = tempFinalNav.getBoundingClientRect().width || 28;
      itemWidthsRef.current.set("finalNavigation", finalNavWidth);
    } else {
      itemWidthsRef.current.delete("finalNavigation");
    }

    document.body.removeChild(tempContainer);
    measurementPhaseRef.current = false;
  }, [items, renderFinalNavigation]);

  // Get current total width and available width
  const getCurrentWidth = useCallback((): {
    current: number;
    available: number;
    gap: number;
    childCount: number;
  } => {
    const container = containerRef.current;
    const list =
      (container?.querySelector(
        '[data-slot="breadcrumb-list"]'
      ) as HTMLOListElement | null) || listRef.current;
    if (!container || !list)
      return { current: 0, available: 0, gap: 0, childCount: 0 };
    const children = Array.from(list.children) as HTMLElement[];
    let current = 0;
    for (const child of children) {
      current += child.offsetWidth;
    }
    const styles = window.getComputedStyle(list);
    const gap = parseFloat(styles.gap) || 0;
    if (children.length > 1) current += gap * (children.length - 1);

    // Add final navigation width if it exists
    if (renderFinalNavigation) {
      const finalNavWidth = itemWidthsRef.current.get("finalNavigation") || 28;
      current += finalNavWidth;
      if (children.length > 0) current += gap; // gap before final nav
    }

    return {
      current,
      available: container.offsetWidth,
      gap,
      childCount: children.length,
    };
  }, [renderFinalNavigation]);

  // Predict width delta if we uncollapse a specific index
  const calculateUncollapseWidth = useCallback(
    (indexToRestore: number, gap: number) => {
      let deltaChildren = 0;
      let additionalWidth = 0;
      const itemWidth =
        itemWidthsRef.current.get(`item-${indexToRestore}`) || 0;
      additionalWidth += itemWidth;
      deltaChildren += 1; // adding an item child

      if (indexToRestore < items.length - 1) {
        const sepWidth =
          itemWidthsRef.current.get(`sep-${indexToRestore}`) || 28;
        additionalWidth += sepWidth;
        deltaChildren += 1; // adding a separator child
      }

      // If this would remove the ellipsis (restoring the last collapsed)
      const wouldRemoveEllipsis =
        collapsedIndices.size === 1 && collapsedIndices.has(indexToRestore);
      if (wouldRemoveEllipsis) {
        const ellipsisWidth = itemWidthsRef.current.get("ellipsis") || 20;
        additionalWidth -= ellipsisWidth;
        deltaChildren -= 1; // remove ellipsis child
        // also remove separator immediately after ellipsis
        const ellipsisSepWidth = 28; // approximate
        additionalWidth -= ellipsisSepWidth;
        deltaChildren -= 1;
      }

      // account for gap change resulting from child count change
      additionalWidth += gap * deltaChildren;
      return additionalWidth;
    },
    [collapsedIndices, items.length]
  );

  const adjustOnce = useCallback(() => {
    const { current, available, gap } = getCurrentWidth();
    const hasOverflow = current > available + 0.5;

    if (hasOverflow) {
      const order = collapseOrderRef.current;
      const nextToCollapse = order.find((idx) => !collapsedIndices.has(idx));
      if (nextToCollapse !== undefined) {
        setCollapsedIndices((prev) => new Set([...prev, nextToCollapse]));
      }
      return;
    }

    if (collapsedIndices.size > 0) {
      const order = collapseOrderRef.current;
      const reversed = [...order].reverse();
      const lastCollapsed = reversed.find((idx) => collapsedIndices.has(idx));
      if (lastCollapsed !== undefined) {
        const additionalWidth = calculateUncollapseWidth(lastCollapsed, gap);
        const space = available - current;
        if (additionalWidth + 5 < space) {
          setCollapsedIndices((prev) => {
            const next = new Set(prev);
            next.delete(lastCollapsed);
            return next;
          });
        }
      }
    }
  }, [calculateUncollapseWidth, collapsedIndices, getCurrentWidth]);

  const scheduleAdjust = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      adjustOnce();
    });
  }, [adjustOnce]);

  // Resize observation (container + parent for sidebar resize) with tiny debounce
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const parent = container.parentElement;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => scheduleAdjust(), 10);
    };
    const ro = new ResizeObserver(debounced);
    ro.observe(container);
    if (parent) ro.observe(parent);
    window.addEventListener("resize", debounced);
    // First measure then adjust
    measureItemWidths();
    scheduleAdjust();
    return () => {
      ro.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", debounced);
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [measureItemWidths, scheduleAdjust]);

  // Also re-check when items themselves change
  useEffect(() => {
    measureItemWidths();
    scheduleAdjust();
  }, [items, measureItemWidths, scheduleAdjust]);

  // Trigger re-check when collapsed set changes
  useEffect(() => {
    scheduleAdjust();
  }, [collapsedIndices, scheduleAdjust]);

  // Collapsed items list (in order)
  const collapsedItems = useMemo(() => {
    if (collapsedIndices.size === 0) return [] as BreadcrumbData[];
    const arr = Array.from(collapsedIndices).sort((a, b) => a - b);
    return arr.map((i) => items[i]).filter(Boolean);
  }, [collapsedIndices, items]);

  // Ellipsis position is the first collapsed index
  const ellipsisPosition = useMemo(() => {
    if (collapsedIndices.size === 0) return -1;
    return Math.min(...Array.from(collapsedIndices));
  }, [collapsedIndices]);

  // For separator after ellipsis, use the logical last collapsed item's key
  const lastCollapsedKey = useMemo(() => {
    if (collapsedIndices.size === 0) return undefined as string | undefined;
    const lastIdx = Math.max(...Array.from(collapsedIndices));
    return items[lastIdx]?.key;
  }, [collapsedIndices, items]);

  return (
    <div ref={containerRef} className="min-w-0">
      <Breadcrumb>
        <BreadcrumbList
          ref={listRef}
          className="!flex-nowrap whitespace-nowrap min-w-0"
          style={{ flexWrap: "nowrap" }}
        >
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            const isCollapsed = collapsedIndices.has(index);
            const showEllipsisHere = index === ellipsisPosition;

            if (isCollapsed && !showEllipsisHere) {
              return null;
            }

            return (
              <Fragment key={item.key}>
                {showEllipsisHere && (
                  <>
                    <BreadcrumbItem
                      className="-mx-0.5 sm:-mx-1 shrink-0" /* Ellipsis button */
                    >
                      {isMobile ? (
                        <DropDrawer
                          open={isPopoverOpen}
                          onOpenChange={setIsPopoverOpen}
                        >
                          <DropDrawerTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-0.5"
                              aria-label="Show collapsed items"
                            >
                              <BreadcrumbEllipsis />
                            </Button>
                          </DropDrawerTrigger>
                          <DropDrawerContent>
                            <DropDrawerGroup>
                              {collapsedItems.map((collapsedItem) =>
                                collapsedItem.clickable ? (
                                  <Link
                                    key={collapsedItem.key}
                                    href={collapsedItem.href}
                                  >
                                    <DropDrawerItem>
                                      {collapsedItem.label}
                                    </DropDrawerItem>
                                  </Link>
                                ) : (
                                  <DropDrawerItem
                                    key={collapsedItem.key}
                                    disabled={true}
                                  >
                                    {collapsedItem.label}
                                  </DropDrawerItem>
                                )
                              )}
                            </DropDrawerGroup>
                          </DropDrawerContent>
                        </DropDrawer>
                      ) : (
                        <Popover
                          open={isPopoverOpen}
                          onOpenChange={setIsPopoverOpen}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-0.5"
                              aria-label="Show collapsed items"
                            >
                              <BreadcrumbEllipsis />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-1" align="center">
                            <div className="flex flex-col gap-1">
                              {collapsedItems.map((collapsedItem) => (
                                <Button
                                  key={collapsedItem.key}
                                  variant="ghost"
                                  size="sm"
                                  className="justify-start"
                                  asChild={collapsedItem.clickable}
                                  disabled={!collapsedItem.clickable}
                                >
                                  {collapsedItem.clickable ? (
                                    <Link href={collapsedItem.href}>
                                      {collapsedItem.label}
                                    </Link>
                                  ) : (
                                    <span>{collapsedItem.label}</span>
                                  )}
                                </Button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </BreadcrumbItem>
                    {/* Separator after ellipsis should remain clickable */}
                    {!isLast && renderSeparator && (
                      <>{renderSeparator(lastCollapsedKey ?? item.key)}</>
                    )}
                  </>
                )}

                {!isCollapsed && (
                  <>
                    <BreadcrumbItem data-index={index}>
                      {isLast || !item.clickable ? (
                        <BreadcrumbPage className="text-foreground font-normal p-1">
                          {item.label}
                        </BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <Link
                            href={item.href}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {item.label}
                          </Link>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {!isLast && renderSeparator && renderSeparator(item.key)}
                  </>
                )}
              </Fragment>
            );
          })}
          {renderFinalNavigation && renderFinalNavigation()}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
