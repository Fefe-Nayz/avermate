"use client";

import { CalendarRangeIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { useFormatter, useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useYear } from "@/components/year/year-provider";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * Which stretch of the year the numbers cover.
 *
 * Present in both shells, because "what is my average" is meaningless without
 * it — a trimester average and a year average are different questions.
 */
export function PeriodSwitcher({
  className,
  variant = "outline",
}: {
  className?: string;
  variant?: "outline" | "ghost";
}) {
  const t = useExtracted();
  const format = useFormatter();
  const { periods, period, selectPeriod } = useYear();

  if (periods.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={variant}
            size="sm"
            className={cn("gap-1.5 font-normal", className)}
          />
        }
      >
        <CalendarRangeIcon className="size-4 opacity-70" />
        <span className="max-w-32 truncate">{period.name}</span>
        <ChevronDownIcon className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {/* The label names the group, so it has to live inside one — Base UI
            reads its association from the group's context, not from proximity. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("Period")}</DropdownMenuLabel>
          {periods.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onClick={() => {
                haptic("selection");
                selectPeriod(item.id);
              }}
            >
              <div className="flex flex-col">
                <span>{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(item.startAt), {
                    day: "numeric",
                    month: "short",
                  })}
                  {" → "}
                  {format.dateTime(new Date(item.endAt), {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </div>
              {item.id === period.id ? (
                <CheckIcon className="ml-auto size-4" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Horizontal rail used on mobile, where a dropdown costs an extra tap. */
export function PeriodRail({ className }: { className?: string }) {
  const { periods, period, selectPeriod } = useYear();
  if (periods.length <= 1) return null;

  return (
    <div className={cn("snap-rail px-4", className)}>
      {periods.map((item) => {
        const active = item.id === period.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              haptic("selection");
              selectPeriod(item.id);
            }}
            className={cn(
              "flex min-h-10 items-center rounded-full border px-3.5 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground active:bg-accent",
            )}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
}
