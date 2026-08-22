import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import ReactMarkdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { remarkCallouts } from "./callouts"

describe("study document markdown pipeline", () => {
  test("turns a fiche callout into safe semantic HTML", () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkCallouts]}>
        {"> [!THM]\n> For every $x$, the statement holds."}
      </ReactMarkdown>
    )
    expect(html).toContain('<aside data-callout="THM" role="note">')
    expect(html).toContain("For every $x$, the statement holds.")
    expect(html).not.toContain("[!THM]")
  })

  test("renders GFM tables and KaTeX without raw user HTML", () => {
    const html = renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {
          "| A | B |\n| - | - |\n| 1 | 2 |\n\n$\\int_0^1 x\\,dx$\n\n<script>alert(1)</script>"
        }
      </ReactMarkdown>
    )
    expect(html).toContain("<table>")
    expect(html).toContain('class="katex"')
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  })
})
