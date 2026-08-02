import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            Avermate
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <article className="flex flex-col gap-6 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-foreground [&_li]:ml-4 [&_li]:list-disc">
          {children}
        </article>
      </main>
    </div>
  );
}
