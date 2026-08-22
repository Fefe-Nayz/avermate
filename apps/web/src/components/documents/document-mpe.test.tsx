import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import rehypeSlug from "rehype-slug"
import remarkFrontmatter from "remark-frontmatter"
import { remarkDocumentToc } from "./document-toc"
import {
  codeFenceMeta,
  embeddedFenceKind,
  isPythonRunFence,
  MAX_VEGA_DATA_ROWS,
  parseDatacardReference,
  parseSafeVegaLiteSpec,
} from "./markdown-fences/model"

function mpeMarkup(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkFrontmatter, remarkDocumentToc]}
      rehypePlugins={[
        rehypeSlug,
        [
          rehypeAutolinkHeadings,
          {
            behavior: "append",
            content: { type: "text", value: "#" },
          },
        ],
      ]}
    >
      {markdown}
    </ReactMarkdown>
  )
}

describe("Markdown Preview Enhanced compatibility", () => {
  test("hides frontmatter and expands a nested TOC with stable duplicate anchors", () => {
    const html = mpeMarkup(
      "---\ntitle: Secret metadata\n---\n\n[TOC]\n\n# Énergie\n\n## Formule\n\n# Énergie"
    )
    expect(html).not.toContain("Secret metadata")
    expect(html).toContain('href="#énergie"')
    expect(html).toContain('href="#formule"')
    expect(html).toContain('href="#énergie-1"')
    expect(html).toContain('<h1 id="énergie">')
    expect(html).toContain('<h1 id="énergie-1">')
    expect(html).not.toContain("[TOC]")
  })

  test("recognises the three executable-looking fences without executing them", () => {
    expect(embeddedFenceKind("mermaid")).toBe("mermaid")
    expect(embeddedFenceKind("VEGALITE")).toBe("vega-lite")
    expect(embeddedFenceKind("graphviz")).toBe("dot")
    expect(embeddedFenceKind("datacard")).toBe("datacard")
    expect(embeddedFenceKind("python")).toBeNull()
    expect(isPythonRunFence("python", "run")).toBe(true)
    expect(isPythonRunFence("PY", "linenums run")).toBe(true)
    expect(isPythonRunFence("python", "")).toBe(false)
    expect(isPythonRunFence("javascript", "run")).toBe(false)
    expect(
      codeFenceMeta({
        children: [{ type: "element", data: { meta: "run" } }],
      })
    ).toBe("run")
  })

  test("accepts compact and JSON datacard references with bounded ids", () => {
    expect(parseDatacardReference("card_01ABC")).toEqual({
      ok: true,
      id: "card_01ABC",
    })
    expect(parseDatacardReference('{ "id": "card_02DEF" }')).toEqual({
      ok: true,
      id: "card_02DEF",
    })
    expect(parseDatacardReference('{ "id": "../../another-year" }').ok).toBe(
      false
    )
    expect(parseDatacardReference(" ").ok).toBe(false)
  })

  test("accepts bounded inline Vega-Lite and refuses authored network URLs", () => {
    expect(
      parseSafeVegaLiteSpec(
        JSON.stringify({ mark: "bar", data: { values: [{ x: 1 }] } })
      ).ok
    ).toBe(true)
    expect(
      parseSafeVegaLiteSpec(
        JSON.stringify({
          mark: "bar",
          data: { url: "https://example.test/a.csv" },
        })
      )
    ).toEqual({
      ok: false,
      issue: "Remote URLs are not allowed in embedded Vega-Lite charts.",
    })
    expect(
      parseSafeVegaLiteSpec(
        JSON.stringify({
          mark: { type: "image" },
          data: { values: [{ image: "https://example.test/image.png" }] },
        })
      )
    ).toEqual({
      ok: false,
      issue: "External resources are not allowed in embedded Vega-Lite charts.",
    })
    expect(
      parseSafeVegaLiteSpec(
        JSON.stringify({
          data: { values: Array(MAX_VEGA_DATA_ROWS + 1).fill(0) },
        })
      ).ok
    ).toBe(false)
  })

  test("keeps heavyweight renderers behind client-only dynamic boundaries", () => {
    const directory = import.meta.dir
    const boundaries = readFileSync(
      `${directory}/markdown-fences/lazy-fences.tsx`,
      "utf8"
    )
    expect(boundaries.match(/ssr:\s*false/g)?.length).toBe(6)
    expect(boundaries).toContain('import("./datacard-fence")')
    expect(boundaries).toContain('import("./python-run-fence")')
    for (const file of [
      "mermaid-fence.tsx",
      "vega-lite-fence.tsx",
      "dot-fence.tsx",
      "shiki-fence.tsx",
    ]) {
      const source = readFileSync(
        `${directory}/markdown-fences/${file}`,
        "utf8"
      )
      expect(source).toContain("await import(")
      expect(source).not.toMatch(/dangerouslySetInnerHTML/)
    }
    const vega = readFileSync(
      `${directory}/markdown-fences/vega-lite-fence.tsx`,
      "utf8"
    )
    expect(vega).toContain("loader.load = async")
    expect(vega).toContain("tooltip: false")
    const datacard = readFileSync(
      `${directory}/markdown-fences/datacard-fence.tsx`,
      "utf8"
    )
    expect(datacard).toContain("EmbeddedDashboardCard")
  })
})
