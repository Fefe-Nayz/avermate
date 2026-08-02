"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled block of settings. One visual grammar across every settings page. */
export function SettingsSection({
  title,
  description,
  children,
  className,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      <header className="px-4 pt-4">
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
      {footer ? (
        <footer className="flex items-center gap-2 border-t px-4 py-3">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

/** A single labelled row with a control on the trailing edge. */
export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex min-h-11 items-center gap-4">
      <label htmlFor={htmlFor} className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </label>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
