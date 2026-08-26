"use client"

import dynamic from "next/dynamic"
import { useExtracted } from "next-intl"
import { Spinner } from "@/components/ui/spinner"
import { type MindmapContentV1, type MindmapNodeV1 } from "./mindmap-model"

const MindmapCanvas = dynamic(
  () => import("./mindmap-canvas").then((module) => module.MindmapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-80 place-items-center bg-muted/20">
        <Spinner className="size-5" />
      </div>
    ),
  }
)

export function MindmapDocumentView({
  content,
}: {
  content: MindmapContentV1
}) {
  const t = useExtracted()

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.6fr)]">
      <section
        aria-labelledby="mindmap-outline-heading"
        className="rounded-xl border bg-card p-3 sm:p-4"
      >
        <h2 id="mindmap-outline-heading" className="mb-3 font-semibold">
          {t("Accessible outline")}
        </h2>
        <ul aria-label={t("Mind map outline")} className="space-y-1">
          <MindmapOutlineBranch node={content.root} />
        </ul>
      </section>

      <section
        aria-label={t("Interactive mind map")}
        className="h-[28rem] min-w-0 overflow-hidden rounded-xl border bg-card sm:h-[34rem]"
      >
        <MindmapCanvas content={content} />
      </section>
    </div>
  )
}

function MindmapOutlineBranch({ node }: { node: MindmapNodeV1 }) {
  const children = node.children ?? []

  return (
    <li>
      <div className="rounded-lg border border-transparent px-2 py-2">
        <p className="text-sm font-medium">{node.label}</p>
        {node.note ? (
          <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">
            {node.note}
          </p>
        ) : null}
      </div>
      {children.length > 0 ? (
        <ul className="ml-3 space-y-1 border-l border-border pl-2 sm:ml-4 sm:pl-3">
          {children.map((child) => (
            <MindmapOutlineBranch key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
