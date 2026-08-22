/**
 * Reading what the compiler said.
 *
 * A TeX log is the least readable output of any tool a student will ever meet:
 * a few thousand lines of font loading and package banners with, somewhere in
 * the middle, one line that says a brace is missing. Handing that to somebody
 * whole and calling it an error message is not showing them the error.
 *
 * So the log is parsed down to the handful of lines that are actually about
 * their document, each with the line number it happened on — which is what
 * makes a message clickable and the editor able to jump there. Everything else
 * stays available behind a disclosure, because when the parse misses something
 * the raw log is the only thing that can help.
 */

export type LatexProblemKind = "error" | "warning"

export interface LatexProblem {
  kind: LatexProblemKind
  /** 1-based line in the source, or `null` when the compiler did not say. */
  line: number | null
  message: string
  /** The file the compiler was reading, when it named one. */
  file: string | null
}

/**
 * TeX errors start with `!` and name their line on a following `l.<n>` line.
 * LaTeX warnings are one line and carry their own `on input line <n>`.
 */
const ERROR = /^!\s*(.*)$/
const ERROR_LINE = /^l\.(\d+)\s?(.*)$/
const WARNING = /^(?:LaTeX|Package|Class)(?:\s+(\S+))?\s+Warning:\s*(.*)$/
const ON_LINE = /on input line (\d+)/
const FILE_LINE = /^(?:\.\/)?(\S+\.tex):(\d+):\s*(.*)$/

/** Noise every run produces, which is never about the document. */
const IGNORED = [
  /^LaTeX Font Warning: Font shape/,
  /^Package hyperref Warning: Token not allowed/,
  /^LaTeX Warning: Font shape/,
]

export function parseLatexLog(log: string): LatexProblem[] {
  const lines = log.split(/\r?\n/)
  const problems: LatexProblem[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""

    // `file.tex:12: Undefined control sequence` — the -file-line-error form,
    // which is the easiest to read and the one worth preferring.
    const fileLine = FILE_LINE.exec(line)
    if (fileLine) {
      problems.push({
        kind: "error",
        file: fileLine[1] ?? null,
        line: Number(fileLine[2]),
        message: (fileLine[3] ?? "").trim() || line.trim(),
      })
      continue
    }

    const error = ERROR.exec(line)
    if (error) {
      const message = (error[1] ?? "").trim()
      // `! ` with nothing after it is the start of a continuation, not an error.
      if (!message) continue
      // The line number arrives a few lines later, after the context TeX
      // prints; looking ahead is the only way to attach the two.
      let found: number | null = null
      for (
        let ahead = index + 1;
        ahead < Math.min(index + 8, lines.length);
        ahead += 1
      ) {
        const match = ERROR_LINE.exec(lines[ahead] ?? "")
        if (match) {
          found = Number(match[1])
          break
        }
      }
      problems.push({ kind: "error", line: found, message, file: null })
      continue
    }

    const warning = WARNING.exec(line)
    if (warning) {
      if (IGNORED.some((pattern) => pattern.test(line))) continue
      // A warning's text often continues on the next line, and the line number
      // is as likely to be there as here.
      const continued = `${warning[2] ?? ""} ${lines[index + 1] ?? ""}`.trim()
      const onLine = ON_LINE.exec(continued)
      problems.push({
        kind: "warning",
        line: onLine ? Number(onLine[1]) : null,
        message: (warning[2] ?? "").trim(),
        file: warning[1] ?? null,
      })
    }
  }

  return dedupe(problems)
}

/**
 * The same missing brace is reported once per pass, and there are two passes.
 * Showing it twice makes the reader look for a second mistake that is not
 * there.
 */
function dedupe(problems: readonly LatexProblem[]): LatexProblem[] {
  const seen = new Set<string>()
  const result: LatexProblem[] = []
  for (const problem of problems) {
    const key = `${problem.kind}:${problem.line}:${problem.message}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(problem)
  }
  return result
}

/** Errors first: a warning below a fatal error is not what to read next. */
export function orderLatexProblems(
  problems: readonly LatexProblem[]
): LatexProblem[] {
  return [...problems].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "error" ? -1 : 1
    return (left.line ?? Infinity) - (right.line ?? Infinity)
  })
}
