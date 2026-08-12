"use client";

import * as React from "react";
import { ChevronRight, Home, MoreHorizontal } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  BreadcrumbData,
  BreadcrumbFocusRing,
  LayoutNode,
  MeasurementMode,
  ResponsiveBreadcrumbProps,
  ResponsiveBreadcrumbStrings,
  SeparatorNavItem,
} from "./types";

type OverlayId = string | null;
export interface BreadcrumbRendererProps {
  items: BreadcrumbData[];
  layout: LayoutNode[];
  className?: string;
  mode: MeasurementMode;
  isMobile: boolean;
  openOverlay: OverlayId;
  onOpenOverlayChange: (id: OverlayId) => void;
  renderSeparator?: ResponsiveBreadcrumbProps["renderSeparator"];
  renderItem?: ResponsiveBreadcrumbProps["renderItem"];
  renderEllipsis?: ResponsiveBreadcrumbProps["renderEllipsis"];
  renderTitleOnly?: ResponsiveBreadcrumbProps["renderTitleOnly"];
  renderMenuItem?: ResponsiveBreadcrumbProps["renderMenuItem"];
  renderItemLink?: ResponsiveBreadcrumbProps["renderItemLink"];
  renderMenuLink?: ResponsiveBreadcrumbProps["renderMenuLink"];
  showHomeIcon: boolean;
  showNextArrow: boolean;
  nextItems: SeparatorNavItem[];
  separatorNavItems: Record<string, SeparatorNavItem[]>;
  onItemClick?: ResponsiveBreadcrumbProps["onItemClick"];
  titleOnlyFallback: React.ReactNode;
  titleOnlyIcon?: React.ReactNode;
  titleOnlyCustomElement?: React.ReactNode;
  customEllipsisElement?: React.ReactNode;
  lastItemClickable: boolean;
  showCollapsedCount: boolean;
  strings: ResponsiveBreadcrumbStrings;
  clickableLeftOfEllipsis: boolean;
  separatorNavSide: "right" | "left";
  overflowBehavior: "collapse" | "scroll" | "wrap";
  focusRing: BreadcrumbFocusRing;
  truncatedWidths: Record<number, number>;
  showTooltipOnTruncate: boolean;
  schema: "json-ld" | "microdata" | "none";
  showCurrentInNav: "never" | "with-others" | "always";
  debug: boolean;
  isRtl: boolean;
  measurementScope?: "full" | "ellipsis" | "title-only";
}

export function BreadcrumbRenderer({
  items,
  layout,
  className,
  mode,
  isMobile,
  openOverlay,
  onOpenOverlayChange,
  renderSeparator,
  renderItem,
  renderEllipsis,
  renderTitleOnly,
  renderMenuItem,
  renderItemLink,
  renderMenuLink,
  showHomeIcon,
  showNextArrow,
  nextItems,
  separatorNavItems,
  onItemClick,
  titleOnlyFallback,
  titleOnlyIcon,
  titleOnlyCustomElement,
  customEllipsisElement,
  lastItemClickable,
  showCollapsedCount,
  strings,
  clickableLeftOfEllipsis,
  separatorNavSide,
  overflowBehavior,
  focusRing,
  truncatedWidths,
  showTooltipOnTruncate,
  schema,
  showCurrentInNav,
  debug,
  isRtl,
  measurementScope,
}: BreadcrumbRendererProps) {
  const isMeasure = mode === "measure";
  const titleOnlyNode = layout.find((node) => node.type === "title-only");
  const focusRingClass = getFocusRingClass(focusRing);

  if (titleOnlyNode) {
    return (
      <Breadcrumb
        className={cn("min-w-0 max-w-full", className)}
        dir={isRtl ? "rtl" : "ltr"}
      >
        <BreadcrumbList
          className={cn(
            "!flex-nowrap whitespace-nowrap overflow-hidden",
            debug && "outline outline-1 outline-amber-500/60",
          )}
        >
          <BreadcrumbItem
            data-measure-title-only={
              isMeasure && measurementScope === "title-only" ? "" : undefined
            }
            className="min-w-0 max-w-full"
          >
            <BreadcrumbPage className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate">
              {renderTitleOnly?.({
                item: items.at(-1),
                fallback: titleOnlyFallback,
                mode,
              }) ?? (
                <>
                  {titleOnlyCustomElement ?? titleOnlyIcon}
                  <span className="min-w-0 truncate">{titleOnlyFallback}</span>
                </>
              )}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb
      className={cn("min-w-0 max-w-full", className)}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <BreadcrumbList
        className={cn(
          "min-w-0 max-w-full",
          overflowBehavior === "wrap"
            ? "flex-wrap whitespace-normal"
            : "!flex-nowrap whitespace-nowrap",
          overflowBehavior === "collapse" &&
            (focusRing === "clip-margin"
              ? "overflow-clip [overflow-clip-margin:4px]"
              : "overflow-hidden"),
          debug && "outline outline-1 outline-blue-500/50",
        )}
        {...(schema === "microdata"
          ? {
              itemScope: true,
              itemType: "https://schema.org/BreadcrumbList",
            }
          : {})}
        data-measure-list={
          isMeasure && measurementScope === "full" ? "full" : undefined
        }
      >
        {layout.map((node, nodeIndex) => {
          if (node.type === "item") {
            const item = items[node.index];

            if (!item) {
              return null;
            }

            return (
              <RenderedItem
                key={`item-${node.index}`}
                item={item}
                index={node.index}
                current={node.index === items.length - 1}
                mode={mode}
                isMeasure={isMeasure}
                measurementScope={measurementScope}
                renderItem={renderItem}
                renderItemLink={renderItemLink}
                showHomeIcon={showHomeIcon}
                lastItemClickable={lastItemClickable}
                onItemClick={onItemClick}
                debug={debug}
                truncatedWidth={truncatedWidths[node.index]}
                showTooltipOnTruncate={showTooltipOnTruncate}
                schema={schema}
                strings={strings}
                focusRingClass={focusRingClass}
              />
            );
          }

          if (node.type === "separator") {
            return (
              <RenderedSeparator
                key={`separator-${node.after}-${nodeIndex}`}
                node={node}
                layout={layout}
                nodeIndex={nodeIndex}
                items={items}
                mode={mode}
                isMeasure={isMeasure}
                measurementScope={measurementScope}
                isMobile={isMobile}
                openOverlay={openOverlay}
                onOpenOverlayChange={onOpenOverlayChange}
                renderSeparator={renderSeparator}
                separatorNavItems={separatorNavItems}
                onItemClick={onItemClick}
                renderMenuItem={renderMenuItem}
                renderMenuLink={renderMenuLink}
                strings={strings}
                clickableLeftOfEllipsis={clickableLeftOfEllipsis}
                separatorNavSide={separatorNavSide}
                showCurrentInNav={showCurrentInNav}
                debug={debug}
                focusRingClass={focusRingClass}
              />
            );
          }

          if (node.type === "ellipsis") {
            return (
              <RenderedEllipsis
                key={`ellipsis-${node.from}-${node.to}`}
                node={node}
                items={items}
                mode={mode}
                isMeasure={isMeasure}
                measurementScope={measurementScope}
                isMobile={isMobile}
                openOverlay={openOverlay}
                onOpenOverlayChange={onOpenOverlayChange}
                renderEllipsis={renderEllipsis}
                customEllipsisElement={customEllipsisElement}
                onItemClick={onItemClick}
                renderMenuItem={renderMenuItem}
                renderMenuLink={renderMenuLink}
                showCollapsedCount={showCollapsedCount}
                strings={strings}
                debug={debug}
                focusRingClass={focusRingClass}
              />
            );
          }

          if (node.type === "next" && showNextArrow) {
            return (
              <RenderedNext
                key="next"
                nextItems={nextItems}
                mode={mode}
                isMeasure={isMeasure}
                measurementScope={measurementScope}
                isMobile={isMobile}
                openOverlay={openOverlay}
                onOpenOverlayChange={onOpenOverlayChange}
                onItemClick={onItemClick}
                renderMenuItem={renderMenuItem}
                renderMenuLink={renderMenuLink}
                strings={strings}
                debug={debug}
                focusRingClass={focusRingClass}
              />
            );
          }

          return null;
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function getFocusRingClass(focusRing: BreadcrumbFocusRing) {
  if (focusRing === "none") {
    return "focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-none";
  }

  if (focusRing === "inset") {
    return "outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset";
  }

  return "outline-none transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
}

function RenderedItem({
  item,
  index,
  current,
  mode,
  isMeasure,
  measurementScope,
  renderItem,
  renderItemLink,
  showHomeIcon,
  lastItemClickable,
  onItemClick,
  debug,
  truncatedWidth,
  showTooltipOnTruncate,
  schema,
  strings,
  focusRingClass,
}: {
  item: BreadcrumbData;
  index: number;
  current: boolean;
  mode: MeasurementMode;
  isMeasure: boolean;
  measurementScope?: BreadcrumbRendererProps["measurementScope"];
  renderItem?: ResponsiveBreadcrumbProps["renderItem"];
  renderItemLink?: ResponsiveBreadcrumbProps["renderItemLink"];
  showHomeIcon: boolean;
  lastItemClickable: boolean;
  onItemClick?: ResponsiveBreadcrumbProps["onItemClick"];
  debug: boolean;
  truncatedWidth?: number;
  showTooltipOnTruncate: boolean;
  schema: "json-ld" | "microdata" | "none";
  strings: ResponsiveBreadcrumbStrings;
  focusRingClass: string;
}) {
  const interactive = isInteractiveItem(item, current, lastItemClickable);
  const content = renderItem?.({ item, index, mode, current }) ?? (
    <ItemContent
      item={item}
      showHomeIcon={showHomeIcon && index === 0}
      mode={mode}
    />
  );
  const contentWithSchema =
    schema === "microdata" ? <span itemProp="name">{content}</span> : content;
  const itemStyle = truncatedWidth
    ? ({ maxWidth: `${truncatedWidth}px` } satisfies React.CSSProperties)
    : undefined;
  const itemClassName = cn(
    "inline-flex min-w-0 max-w-full shrink-0 items-center gap-1.5 truncate rounded-md transition-all",
    focusRingClass,
  );
  const itemElement =
    interactive && item.href ? (
      <BreadcrumbLink
        className={itemClassName}
        style={itemStyle}
        render={
          renderItemLink?.({
            item,
            index,
            mode,
            current,
            href: item.href,
            children: contentWithSchema,
            onClick: () => onItemClick?.(item),
            ariaDisabled: item.disabled,
            itemProp: schema === "microdata" ? "item" : undefined,
          }) ?? (
            <a
              href={item.href}
              onClick={() => onItemClick?.(item)}
              aria-disabled={item.disabled || undefined}
              itemProp={schema === "microdata" ? "item" : undefined}
            >
              {contentWithSchema}
            </a>
          )
        }
      />
    ) : interactive ? (
      <button
        type="button"
        className={cn(
          "hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50",
          itemClassName,
        )}
        style={itemStyle}
        disabled={item.disabled}
        onClick={() => onItemClick?.(item)}
      >
        {contentWithSchema}
      </button>
    ) : (
      <BreadcrumbPage className={itemClassName} style={itemStyle}>
        {contentWithSchema}
      </BreadcrumbPage>
    );
  const renderedItem =
    truncatedWidth && showTooltipOnTruncate ? (
      <Tooltip>
        <TooltipTrigger render={itemElement} />
        <TooltipContent>
          {resolveLabel(
            strings.truncatedItemTooltip,
            readableLabel(item.label, resolveLabel(strings.itemLabelFallback)),
          )}
        </TooltipContent>
      </Tooltip>
    ) : (
      itemElement
    );

  return (
    <BreadcrumbItem
      data-measure-item={
        isMeasure && measurementScope === "full" ? index : undefined
      }
      itemProp={schema === "microdata" ? "itemListElement" : undefined}
      itemScope={schema === "microdata" ? true : undefined}
      itemType={
        schema === "microdata" ? "https://schema.org/ListItem" : undefined
      }
      className={cn(
        "min-w-0 max-w-full shrink-0",
        debug && "outline outline-1 outline-green-500/60",
      )}
    >
      {renderedItem}
      {schema === "microdata" ? (
        <meta itemProp="position" content={(index + 1).toString()} />
      ) : null}
    </BreadcrumbItem>
  );
}

function ItemContent({
  item,
  showHomeIcon,
  mode,
}: {
  item: BreadcrumbData;
  showHomeIcon: boolean;
  mode: MeasurementMode;
}) {
  if (mode === "measure" && item.measureElement) {
    return <>{item.measureElement}</>;
  }

  if (item.customElement) {
    return <>{item.customElement}</>;
  }

  return (
    <>
      {showHomeIcon ? <Home className="size-4 shrink-0" aria-hidden /> : null}
      {item.icon}
      <span className="min-w-0 truncate">{item.label}</span>
      {mode === "measure" ? null : null}
    </>
  );
}

function RenderedSeparator({
  node,
  layout,
  nodeIndex,
  items,
  mode,
  isMeasure,
  measurementScope,
  isMobile,
  openOverlay,
  onOpenOverlayChange,
  renderSeparator,
  separatorNavItems,
  onItemClick,
  renderMenuItem,
  renderMenuLink,
  strings,
  clickableLeftOfEllipsis,
  separatorNavSide,
  showCurrentInNav,
  debug,
  focusRingClass,
}: {
  node: Extract<LayoutNode, { type: "separator" }>;
  layout: LayoutNode[];
  nodeIndex: number;
  items: BreadcrumbData[];
  mode: MeasurementMode;
  isMeasure: boolean;
  measurementScope?: BreadcrumbRendererProps["measurementScope"];
  isMobile: boolean;
  openOverlay: OverlayId;
  onOpenOverlayChange: (id: OverlayId) => void;
  renderSeparator?: ResponsiveBreadcrumbProps["renderSeparator"];
  separatorNavItems: Record<string, SeparatorNavItem[]>;
  onItemClick?: ResponsiveBreadcrumbProps["onItemClick"];
  renderMenuItem?: ResponsiveBreadcrumbProps["renderMenuItem"];
  renderMenuLink?: ResponsiveBreadcrumbProps["renderMenuLink"];
  strings: ResponsiveBreadcrumbStrings;
  clickableLeftOfEllipsis: boolean;
  separatorNavSide: "right" | "left";
  showCurrentInNav: "never" | "with-others" | "always";
  debug: boolean;
  focusRingClass: string;
}) {
  const previousItem = items[node.after];
  const nextNode = layout[nodeIndex + 1];
  const nextIndex =
    nextNode?.type === "item"
      ? nextNode.index
      : nextNode?.type === "ellipsis"
        ? nextNode.from
        : node.after + 1;
  const nextItem = items[nextIndex];
  const anchorItem = separatorNavSide === "left" ? previousItem : nextItem;
  const leftOfEllipsis = nextNode?.type === "ellipsis";
  const baseNavItems = getSeparatorNavItems(
    separatorNavItems,
    previousItem,
    nextItem,
    separatorNavSide,
  );
  const navItems = withCurrentItem({
    navItems: baseNavItems,
    nextItem: anchorItem,
    showCurrentInNav,
  });
  const interactive =
    navItems.length > 0 && (!leftOfEllipsis || clickableLeftOfEllipsis);

  if (!interactive) {
    return renderDecorativeSeparator({
      previousKey: previousItem?.key ?? "",
      nextKey: nextItem?.key ?? "",
      renderSeparator,
      measureIndex:
        isMeasure && measurementScope === "full" ? node.after : null,
      debug,
    });
  }

  const overlayId = `separator-${anchorItem?.key ?? node.after}`;
  const nextLabel = readableLabel(
    anchorItem?.label,
    resolveLabel(strings.itemLabelFallback),
  );
  const label = resolveLabel(strings.showSiblingItems, nextLabel);

  return (
    <BreadcrumbItem
      data-measure-separator={
        isMeasure && measurementScope === "full" ? node.after : undefined
      }
      data-slot="breadcrumb-interactive-separator"
      className={cn(debug && "outline outline-1 outline-cyan-500/60")}
    >
      <ResponsiveOverlay
        title={label}
        isMobile={isMobile}
        open={openOverlay === overlayId}
        onOpenChange={(open) => onOpenOverlayChange(open ? overlayId : null)}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("group size-7 text-muted-foreground", focusRingClass)}
            tabIndex={isMeasure ? -1 : undefined}
            aria-label={label}
          >
            <ChevronRight
              className="size-4 transition-transform group-data-popup-open:rotate-90"
              aria-hidden
            />
          </Button>
        }
      >
        <MenuItems
          items={navItems}
          mode={mode}
          compact={!isMobile}
          onItemClick={onItemClick}
          renderMenuItem={renderMenuItem}
          renderMenuLink={renderMenuLink}
          onSelect={() => onOpenOverlayChange(null)}
          strings={strings}
        />
      </ResponsiveOverlay>
    </BreadcrumbItem>
  );
}

function RenderedEllipsis({
  node,
  items,
  mode,
  isMeasure,
  measurementScope,
  isMobile,
  openOverlay,
  onOpenOverlayChange,
  renderEllipsis,
  customEllipsisElement,
  onItemClick,
  renderMenuItem,
  renderMenuLink,
  showCollapsedCount,
  strings,
  debug,
  focusRingClass,
}: {
  node: Extract<LayoutNode, { type: "ellipsis" }>;
  items: BreadcrumbData[];
  mode: MeasurementMode;
  isMeasure: boolean;
  measurementScope?: BreadcrumbRendererProps["measurementScope"];
  isMobile: boolean;
  openOverlay: OverlayId;
  onOpenOverlayChange: (id: OverlayId) => void;
  renderEllipsis?: ResponsiveBreadcrumbProps["renderEllipsis"];
  customEllipsisElement?: React.ReactNode;
  onItemClick?: ResponsiveBreadcrumbProps["onItemClick"];
  renderMenuItem?: ResponsiveBreadcrumbProps["renderMenuItem"];
  renderMenuLink?: ResponsiveBreadcrumbProps["renderMenuLink"];
  showCollapsedCount: boolean;
  strings: ResponsiveBreadcrumbStrings;
  debug: boolean;
  focusRingClass: string;
}) {
  const hiddenItems = items.slice(node.from, node.to + 1);
  const overlayId = `ellipsis-${node.from}-${node.to}`;
  const label = resolveLabel(strings.showCollapsedItems, hiddenItems.length);
  const title = resolveLabel(strings.moreOptions);
  const content =
    renderEllipsis?.({ hiddenItems, mode }) ??
    customEllipsisElement ??
    defaultEllipsisContent(hiddenItems.length, showCollapsedCount);

  return (
    <BreadcrumbItem
      data-measure-ellipsis={
        isMeasure && measurementScope === "ellipsis" ? "" : undefined
      }
      className={cn(debug && "outline outline-1 outline-yellow-500/70")}
    >
      <ResponsiveOverlay
        title={title}
        isMobile={isMobile}
        open={openOverlay === overlayId}
        onOpenChange={(open) => onOpenOverlayChange(open ? overlayId : null)}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("size-8 px-0", focusRingClass)}
            aria-label={label}
            tabIndex={isMeasure ? -1 : undefined}
          >
            {content}
          </Button>
        }
      >
        <MenuItems
          items={hiddenItems}
          mode={mode}
          compact={!isMobile}
          onItemClick={onItemClick}
          renderMenuItem={renderMenuItem}
          renderMenuLink={renderMenuLink}
          onSelect={() => onOpenOverlayChange(null)}
          strings={strings}
        />
      </ResponsiveOverlay>
    </BreadcrumbItem>
  );
}

function RenderedNext({
  nextItems,
  mode,
  isMeasure,
  measurementScope,
  isMobile,
  openOverlay,
  onOpenOverlayChange,
  onItemClick,
  renderMenuItem,
  renderMenuLink,
  strings,
  debug,
  focusRingClass,
}: {
  nextItems: SeparatorNavItem[];
  mode: MeasurementMode;
  isMeasure: boolean;
  measurementScope?: BreadcrumbRendererProps["measurementScope"];
  isMobile: boolean;
  openOverlay: OverlayId;
  onOpenOverlayChange: (id: OverlayId) => void;
  onItemClick?: ResponsiveBreadcrumbProps["onItemClick"];
  renderMenuItem?: ResponsiveBreadcrumbProps["renderMenuItem"];
  renderMenuLink?: ResponsiveBreadcrumbProps["renderMenuLink"];
  strings: ResponsiveBreadcrumbStrings;
  debug: boolean;
  focusRingClass: string;
}) {
  const overlayId = "next";

  return (
    <BreadcrumbItem
      data-measure-next={
        isMeasure && measurementScope === "full" ? "" : undefined
      }
      className={cn(debug && "outline outline-1 outline-purple-500/70")}
    >
      <ResponsiveOverlay
        title={resolveLabel(strings.nextItems)}
        isMobile={isMobile}
        open={openOverlay === overlayId}
        onOpenChange={(open) => onOpenOverlayChange(open ? overlayId : null)}
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "group size-8 px-0 text-muted-foreground",
              focusRingClass,
            )}
            aria-label={resolveLabel(strings.nextItems)}
            disabled={nextItems.length === 0}
            tabIndex={isMeasure ? -1 : undefined}
          >
            <ChevronRight
              className="size-4 transition-transform group-data-popup-open:rotate-90"
              aria-hidden
            />
          </Button>
        }
      >
        <MenuItems
          items={nextItems}
          mode={mode}
          compact={!isMobile}
          onItemClick={onItemClick}
          renderMenuItem={renderMenuItem}
          renderMenuLink={renderMenuLink}
          onSelect={() => onOpenOverlayChange(null)}
          strings={strings}
        />
      </ResponsiveOverlay>
    </BreadcrumbItem>
  );
}

function ResponsiveOverlay({
  title,
  isMobile,
  open,
  onOpenChange,
  trigger,
  children,
}: {
  title: string;
  isMobile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  children: React.ReactNode;
}) {
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger render={trigger} />
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-auto min-w-40 max-w-64 p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function MenuItems({
  items,
  mode,
  compact,
  onItemClick,
  renderMenuItem,
  renderMenuLink,
  onSelect,
  strings,
}: {
  items: Array<BreadcrumbData | SeparatorNavItem>;
  mode: MeasurementMode;
  compact: boolean;
  onItemClick?: ResponsiveBreadcrumbProps["onItemClick"];
  renderMenuItem?: ResponsiveBreadcrumbProps["renderMenuItem"];
  renderMenuLink?: ResponsiveBreadcrumbProps["renderMenuLink"];
  onSelect: () => void;
  strings: ResponsiveBreadcrumbStrings;
}) {
  if (items.length === 0) {
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {resolveLabel(strings.noItemsAvailable)}
      </p>
    );
  }

  return (
    <div className={cn("grid", compact ? "gap-0.5" : "gap-1")}>
      {items.map((item) => {
        const itemLabel = readableLabel(
          item.label,
          resolveLabel(strings.itemLabelFallback),
        );
        const itemAriaLabel = resolveLabel(strings.navigateTo, itemLabel);
        const disabled = item.disabled || item.clickable === false;
        const content = renderMenuItem?.({ item, mode: "menu", disabled }) ?? (
          <>
            {item.icon}
            <span className="min-w-0 truncate">{item.label}</span>
          </>
        );

        if (item.href && !disabled) {
          return (
            <Button
              key={item.key}
              variant="ghost"
              className={cn(
                "justify-start",
                compact ? "h-7 px-2 text-sm" : "h-auto px-2 py-2",
              )}
              render={
                renderMenuLink?.({
                  item,
                  mode,
                  href: item.href,
                  children: content,
                  ariaLabel: itemAriaLabel,
                  onClick: () => {
                    onItemClick?.(item);
                    onSelect();
                  },
                }) ?? (
                  <a
                    href={item.href}
                    aria-label={itemAriaLabel}
                    onClick={() => {
                      onItemClick?.(item);
                      onSelect();
                    }}
                  >
                    {content}
                  </a>
                )
              }
              nativeButton={false}
            />
          );
        }

        return (
          <Button
            key={item.key}
            type="button"
            variant="ghost"
            className={cn(
              "justify-start",
              compact ? "h-7 px-2 text-sm" : "h-auto px-2 py-2",
            )}
            aria-label={itemAriaLabel}
            disabled={disabled}
            onClick={() => {
              onItemClick?.(item);
              onSelect();
            }}
            tabIndex={mode === "measure" ? -1 : undefined}
          >
            {content}
          </Button>
        );
      })}
    </div>
  );
}

function defaultEllipsisContent(count: number, showCollapsedCount: boolean) {
  return (
    <span className="inline-flex items-center gap-1">
      <MoreHorizontal className="size-4" aria-hidden />
      {showCollapsedCount ? (
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
          {count}
        </Badge>
      ) : null}
    </span>
  );
}

function renderDecorativeSeparator({
  previousKey,
  nextKey,
  renderSeparator,
  measureIndex,
  debug,
}: {
  previousKey: string;
  nextKey: string;
  renderSeparator?: ResponsiveBreadcrumbProps["renderSeparator"];
  measureIndex: number | null;
  debug: boolean;
}) {
  const rendered = renderSeparator?.(previousKey, nextKey);
  const debugClassName = debug ? "outline outline-1 outline-slate-500/60" : "";

  if (React.isValidElement<{ className?: string }>(rendered)) {
    return React.cloneElement(rendered, {
      "data-measure-separator": measureIndex ?? undefined,
      className: cn(rendered.props.className, debugClassName),
    } as React.HTMLAttributes<HTMLElement>);
  }

  return (
    <BreadcrumbSeparator
      data-measure-separator={measureIndex ?? undefined}
      className={debugClassName}
    >
      {rendered}
    </BreadcrumbSeparator>
  );
}

function getSeparatorNavItems(
  separatorNavItems: Record<string, SeparatorNavItem[]>,
  previousItem: BreadcrumbData | undefined,
  nextItem: BreadcrumbData | undefined,
  side: "right" | "left",
) {
  const anchorItem = side === "left" ? previousItem : nextItem;

  if (!anchorItem) {
    return [];
  }

  return (
    separatorNavItems[anchorItem.key] ??
    (previousItem && nextItem
      ? separatorNavItems[`${previousItem.key}:${nextItem.key}`]
      : undefined) ??
    []
  );
}

function withCurrentItem({
  navItems,
  nextItem,
  showCurrentInNav,
}: {
  navItems: SeparatorNavItem[];
  nextItem: BreadcrumbData | undefined;
  showCurrentInNav: "never" | "with-others" | "always";
}) {
  const shouldInclude =
    nextItem &&
    (showCurrentInNav === "always" ||
      (showCurrentInNav === "with-others" && navItems.length > 0));

  if (!shouldInclude) {
    return navItems;
  }

  if (navItems.some((item) => item.key === nextItem.key)) {
    return navItems;
  }

  return [
    {
      key: nextItem.key,
      label: nextItem.label,
      href: nextItem.href,
      icon: nextItem.icon,
      clickable: nextItem.clickable,
      disabled: nextItem.disabled,
    },
    ...navItems,
  ];
}

function isInteractiveItem(
  item: BreadcrumbData,
  current: boolean,
  lastItemClickable: boolean,
) {
  if (item.disabled || item.clickable === false) {
    return false;
  }

  if (current && !lastItemClickable) {
    return false;
  }

  return item.clickable === true || Boolean(item.href);
}

function readableLabel(label: React.ReactNode, fallback: string) {
  if (typeof label === "string" || typeof label === "number") {
    return String(label);
  }

  return fallback;
}

function resolveLabel<TArgs extends unknown[]>(
  label: ResponsiveBreadcrumbStrings[keyof ResponsiveBreadcrumbStrings],
  ...args: TArgs
) {
  return typeof label === "function"
    ? (label as (...args: TArgs) => string)(...args)
    : label;
}
