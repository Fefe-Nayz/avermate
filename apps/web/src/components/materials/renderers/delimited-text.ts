/**
 * Reading a spreadsheet export.
 *
 * A CSV is not a file you can split on commas. A cell may be quoted, a quoted
 * cell may contain the delimiter, a newline, or a doubled quote standing for
 * one — and every one of those appears in real exports, which is why a naive
 * split turns one row of prose into six broken columns.
 *
 * The delimiter is guessed rather than assumed, because a French Excel writes
 * semicolons: the locale uses the comma as its decimal separator, so Excel
 * moves the field separator out of the way. A reader that assumes commas shows
 * a one-column table and looks broken to exactly the people it was built for.
 */

export const DELIMITERS = [",", ";", "\t", "|"] as const
export type Delimiter = (typeof DELIMITERS)[number]

/**
 * Which delimiter this file uses.
 *
 * Counted outside quotes only, over the first few lines: a comma inside
 * `"Dupont, Jean"` is not evidence of anything, and a file whose tenth line is
 * prose should not out-vote the header that names the columns.
 */
export function guessDelimiter(sample: string): Delimiter {
  const head = sample.slice(0, 64 * 1024)
  let best: Delimiter = ","
  let bestScore = -1

  for (const delimiter of DELIMITERS) {
    let quoted = false
    let count = 0
    let lines = 0
    for (let index = 0; index < head.length; index += 1) {
      const character = head[index]
      if (character === '"') {
        // A doubled quote inside a quoted field is an escaped quote, not a
        // close followed by an open.
        if (quoted && head[index + 1] === '"') {
          index += 1
          continue
        }
        quoted = !quoted
        continue
      }
      if (quoted) continue
      if (character === "\n") {
        lines += 1
        if (lines >= 20) break
        continue
      }
      if (character === delimiter) count += 1
    }
    if (count > bestScore) {
      bestScore = count
      best = delimiter
    }
  }
  return best
}

export interface DelimitedTable {
  header: string[]
  rows: string[][]
  delimiter: Delimiter
  /** Rows beyond the cap, which were not parsed. */
  truncated: number
}

/**
 * A table, capped.
 *
 * The cap is not an optimisation but a correctness choice: a 200 000-row export
 * rendered into the DOM is a tab that stops responding, and a reader who wanted
 * all 200 000 rows wanted a spreadsheet, not a preview. The count of what was
 * left out is returned rather than hidden, so the screen can say so.
 */
export function parseDelimited(
  source: string,
  options: { maxRows?: number; delimiter?: Delimiter } = {}
): DelimitedTable {
  const maxRows = options.maxRows ?? 2_000
  const delimiter = options.delimiter ?? guessDelimiter(source)

  // A byte-order mark at the start of an Excel export would otherwise become
  // part of the first column's name.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source

  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  let seen = 0
  let truncated = 0

  const endCell = () => {
    row.push(cell)
    cell = ""
  }
  const endRow = () => {
    endCell()
    seen += 1
    // A trailing newline produces one final empty row, which is not a row.
    const empty = row.length === 1 && row[0] === ""
    if (!empty) {
      if (rows.length < maxRows + 1) rows.push(row)
      else truncated += 1
    }
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character !== '"') {
        cell += character
        continue
      }
      if (text[index + 1] === '"') {
        cell += '"'
        index += 1
        continue
      }
      quoted = false
      continue
    }
    if (character === '"' && cell === "") {
      quoted = true
      continue
    }
    if (character === delimiter) {
      endCell()
      continue
    }
    if (character === "\r") continue
    if (character === "\n") {
      endRow()
      continue
    }
    cell += character
  }
  if (cell !== "" || row.length > 0) endRow()
  void seen

  const [header = [], ...body] = rows
  // Ragged rows are normal in exports; padding here means the table never has
  // to guess mid-render how many cells a row should have had.
  const width = Math.max(header.length, ...body.map((line) => line.length), 0)
  const pad = (line: string[]) =>
    line.length === width
      ? line
      : [...line, ...Array<string>(width - line.length).fill("")]

  return {
    header: pad(header),
    rows: body.map(pad),
    delimiter,
    truncated,
  }
}

/** Whether a column holds numbers, so the table can align it to the right. */
export function isNumericColumn(
  rows: readonly string[][],
  column: number
): boolean {
  let seen = 0
  for (const row of rows.slice(0, 50)) {
    const value = row[column]?.trim()
    if (!value) continue
    seen += 1
    // French exports write 1 234,56 — a space (often non-breaking) for
    // thousands and a comma for the decimal point.
    const normalized = value.replace(/[\s ]/g, "").replace(",", ".")
    if (!/^[-+]?\d*\.?\d+(?:e[-+]?\d+)?%?$/i.test(normalized)) return false
  }
  return seen > 0
}
