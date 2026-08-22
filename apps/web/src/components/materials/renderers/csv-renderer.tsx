"use client"

import { useMemo } from "react"
import { useExtracted } from "next-intl"
import { cn } from "@/lib/utils"
import { materialFileOf } from "./row-file"
import {
  RendererBar,
  RendererError,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import { useMaterialFileText } from "./use-material-file"
import { isNumericColumn, parseDelimited } from "./delimited-text"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

const CSV_TYPES = new Set(["text/csv", "text/tab-separated-values"])
const CSV_EXTENSIONS = /\.(csv|tsv)$/i

/**
 * An export, as the table it is.
 *
 * A `.csv` shown as monospaced text is a wall of commas; the whole content of
 * the file is a table, and it is the one format where rendering it *as* the
 * thing it is costs a parser and nothing else. Numeric columns line up to the
 * right with tabular figures, because a column of marks that does not line up
 * is a column you have to read one cell at a time.
 */
function CsvReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const source = useMaterialFileText(row.id, file?.byteSize ?? null)

  const table = useMemo(
    () => (source.text ? parseDelimited(source.text) : null),
    [source.text]
  )
  const numeric = useMemo(
    () =>
      table
        ? table.header.map((_, column) => isNumericColumn(table.rows, column))
        : [],
    [table]
  )

  if (source.tooLarge) {
    return (
      <RendererNotice>
        {t("This file is too large to open here. Download it instead.")}
      </RendererNotice>
    )
  }
  if (source.isPending) return <RendererLoading />
  if (source.isError || !table) {
    return (
      <RendererError
        message={
          source.error?.message ?? t("The original source is unavailable.")
        }
        onRetry={source.refetch}
      />
    )
  }

  return (
    <>
      <RendererBar>
        <span className="text-xs text-muted-foreground">
          {t(
            "{columns, plural, one {# column} other {# columns}} · {rows, plural, one {# row} other {# rows}}",
            { columns: table.header.length, rows: table.rows.length }
          )}
        </span>
        {table.truncated > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("{count} more rows not shown", {
              count: String(table.truncated),
            })}
          </span>
        ) : null}
      </RendererBar>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              {table.header.map((cell, column) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(
                    "border-e border-b px-3 py-2 text-left font-medium whitespace-nowrap",
                    numeric[column] && "text-right"
                  )}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((line, index) => (
              <tr key={index} className="even:bg-muted/30">
                {line.map((cell, column) => (
                  <td
                    key={column}
                    className={cn(
                      "max-w-80 truncate border-e border-b px-3 py-1.5",
                      numeric[column] && "numeric text-right"
                    )}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export const csvRenderer: MaterialRenderer = {
  id: "csv",
  // Above plain text, below the Office editor: a reader who has a document
  // server gets a real spreadsheet, and everyone else gets a real table.
  priority: 60,
  accepts: (row) => {
    const file = materialFileOf(row)
    if (!file) return false
    return CSV_TYPES.has(file.mimeType) || CSV_EXTENSIONS.test(row.title)
  },
  Reader: CsvReader,
}
