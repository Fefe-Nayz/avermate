"use client"

import type { ReactNode } from "react"

export function FenceFrame({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <figure className="my-5 overflow-auto rounded-lg border bg-muted/20 p-3">
      <figcaption className="sr-only">{label}</figcaption>
      {children}
    </figure>
  )
}

export function FenceStatus({
  children,
  error = false,
}: {
  children: ReactNode
  error?: boolean
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={
        error
          ? "rounded-md bg-destructive/8 px-3 py-6 text-center text-sm text-destructive"
          : "px-3 py-8 text-center text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  )
}
