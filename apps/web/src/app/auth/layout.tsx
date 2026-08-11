import Link from "next/link"
import type { ReactNode } from "react"
import { GraduationCapIcon } from "lucide-react"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="pt-safe flex items-center px-4">
        <Link
          href="/"
          className="flex h-14 items-center gap-2 text-sm font-semibold"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCapIcon className="size-4" />
          </span>
          Avermate
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 md:items-center md:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
