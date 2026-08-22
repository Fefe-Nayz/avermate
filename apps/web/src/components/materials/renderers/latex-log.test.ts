import { describe, expect, test } from "bun:test"
import { orderLatexProblems, parseLatexLog } from "./latex-log"

describe("reading a TeX log", () => {
  test("finds an error and the line it happened on", () => {
    // TeX prints the message, then some context, then `l.<n>` — the two are
    // several lines apart and only mean something together.
    const log = [
      "This is pdfTeX, Version 3.14",
      "! Undefined control sequence.",
      "<recently read> \\includegrahics",
      "                              ",
      "l.42 \\includegrahics{figure.png}",
      "                                ",
    ].join("\n")

    expect(parseLatexLog(log)).toEqual([
      {
        kind: "error",
        line: 42,
        message: "Undefined control sequence.",
        file: null,
      },
    ])
  })

  test("prefers the file:line form when the compiler used it", () => {
    const log = "./rapport.tex:17: Missing $ inserted."
    expect(parseLatexLog(log)).toEqual([
      {
        kind: "error",
        line: 17,
        message: "Missing $ inserted.",
        file: "rapport.tex",
      },
    ])
  })

  test("reads a warning and the line it names", () => {
    const log = [
      "LaTeX Warning: Reference `fig:courbe' on page 3 undefined on input line 88.",
    ].join("\n")
    const problems = parseLatexLog(log)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.kind).toBe("warning")
    expect(problems[0]?.line).toBe(88)
  })

  test("attributes a package warning to its package", () => {
    const log =
      "Package biblatex Warning: No bibliography found on input line 5."
    expect(parseLatexLog(log)[0]?.file).toBe("biblatex")
  })

  test("drops the font noise every run prints", () => {
    const log = [
      "LaTeX Font Warning: Font shape `OT1/cmr/bx/sc' undefined on input line 9.",
      "LaTeX Warning: Reference `x' undefined on input line 12.",
    ].join("\n")
    expect(parseLatexLog(log)).toHaveLength(1)
  })

  test("reports a repeated error once", () => {
    // Two passes report the same missing brace; showing it twice sends the
    // reader looking for a second mistake that is not there.
    const one = ["! Missing } inserted.", "l.7 \\end{document}"].join("\n")
    expect(parseLatexLog(`${one}\n${one}`)).toHaveLength(1)
  })

  test("an error with no line is still an error", () => {
    const log = "! Emergency stop."
    expect(parseLatexLog(log)).toEqual([
      { kind: "error", line: null, message: "Emergency stop.", file: null },
    ])
  })

  test("a clean log has nothing to say", () => {
    expect(parseLatexLog("Output written on rapport.pdf (3 pages).")).toEqual(
      []
    )
  })
})

describe("ordering", () => {
  test("errors first, then by line", () => {
    const problems = parseLatexLog(
      [
        "LaTeX Warning: Reference `a' undefined on input line 3.",
        "! Missing $ inserted.",
        "l.90 x^2",
      ].join("\n")
    )
    expect(orderLatexProblems(problems).map((p) => p.kind)).toEqual([
      "error",
      "warning",
    ])
  })
})
