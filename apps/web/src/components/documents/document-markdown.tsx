"use client"

import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import rehypeKatex from "rehype-katex"
import rehypeSlug from "rehype-slug"
import remarkFrontmatter from "remark-frontmatter"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { useExtracted } from "next-intl"
import { cn } from "@/lib/utils"
import { remarkCallouts } from "./callouts"
import { remarkDocumentToc } from "./document-toc"
import type { DocumentCalloutKind } from "./document-model"
import {
  codeFenceMeta,
  embeddedFenceKind,
  isPythonRunFence,
} from "./markdown-fences/model"
import {
  LazyDatacardFence,
  LazyDotFence,
  LazyMermaidFence,
  LazyPythonRunFence,
  LazyShikiFence,
  LazyVegaLiteFence,
} from "./markdown-fences/lazy-fences"
import "./document-styles.css"

const CALLOUT_CLASS: Record<DocumentCalloutKind, string> = {
  DEF: "border-l-primary bg-primary/5",
  THM: "border-l-chart-3 bg-chart-3/8",
  METH: "border-l-band-good bg-band-good/8",
  PIEGE: "border-l-band-poor bg-band-poor/8",
  CHECK: "border-l-band-fair bg-band-fair/8",
}

function calloutKindFromNode(node: unknown): DocumentCalloutKind | null {
  if (!node || typeof node !== "object" || !("properties" in node)) {
    return null
  }
  const properties = (node as { properties?: Record<string, unknown> })
    .properties
  const value = properties?.["data-callout"] ?? properties?.dataCallout
  return value === "DEF" ||
    value === "THM" ||
    value === "METH" ||
    value === "PIEGE" ||
    value === "CHECK"
    ? value
    : null
}

export function DocumentMarkdown({
  markdown,
  className,
  ariaLabel,
  empty,
}: {
  markdown: string
  className?: string
  ariaLabel?: string
  empty?: ReactNode
}) {
  const t = useExtracted()
  const labels: Record<DocumentCalloutKind, string> = {
    DEF: t("Definition"),
    THM: t("Theorem"),
    METH: t("Method"),
    PIEGE: t("Common pitfall"),
    CHECK: t("Check point"),
  }
  const components: Components = {
    pre({ node, children, ...props }) {
      const child = Children.toArray(children).find(isValidElement) as
        ReactElement<{ className?: string; children?: ReactNode }> | undefined
      const language = /(?:^|\s)language-([^\s]+)/.exec(
        child?.props.className ?? ""
      )?.[1]
      if (!child || !language) return <pre {...props}>{children}</pre>

      const source = String(child.props.children ?? "").replace(/\n$/, "")
      if (isPythonRunFence(language, codeFenceMeta(node))) {
        return <LazyPythonRunFence source={source} />
      }
      const embedded = embeddedFenceKind(language)
      if (embedded === "mermaid") return <LazyMermaidFence source={source} />
      if (embedded === "vega-lite") {
        return <LazyVegaLiteFence source={source} />
      }
      if (embedded === "dot") return <LazyDotFence source={source} />
      if (embedded === "datacard") {
        return <LazyDatacardFence source={source} />
      }
      return <LazyShikiFence source={source} language={language} />
    },
    aside({ node, children, className: asideClassName, ...props }) {
      const kind = calloutKindFromNode(node)
      if (!kind) {
        return (
          <aside className={asideClassName} {...props}>
            {children}
          </aside>
        )
      }
      return (
        <aside
          {...props}
          role="note"
          aria-label={labels[kind]}
          className={cn("study-callout", CALLOUT_CLASS[kind], asideClassName)}
        >
          <div className="study-callout-label">{labels[kind]}</div>
          {children}
        </aside>
      )
    },
    table({ node, children, ...props }) {
      void node
      return (
        <div className="study-markdown-table" tabIndex={0}>
          <table {...props}>{children}</table>
        </div>
      )
    },
    a({ node, children, href, ...props }) {
      void node
      const local = href?.startsWith("#")
      return (
        <a
          {...props}
          href={href}
          {...(local ? {} : { target: "_blank", rel: "noreferrer" })}
        >
          {children}
        </a>
      )
    },
  }

  if (!markdown.trim()) return empty ? <>{empty}</> : null

  return (
    <article aria-label={ariaLabel} className={cn("study-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[
          remarkFrontmatter,
          remarkGfm,
          remarkMath,
          remarkCallouts,
          remarkDocumentToc,
        ]}
        rehypePlugins={[
          rehypeKatex,
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: "append",
              content: { type: "text", value: "#" },
              properties: {
                className: ["heading-anchor"],
                ariaHidden: true,
                tabIndex: -1,
              },
            },
          ],
        ]}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
