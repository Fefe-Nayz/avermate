import { describe, expect, test } from "bun:test"
import {
  guessDelimiter,
  isNumericColumn,
  parseDelimited,
} from "./delimited-text"

describe("guessing the delimiter", () => {
  test("finds the semicolon a French Excel writes", () => {
    // The locale uses the comma as its decimal separator, so Excel moves the
    // field separator out of the way. Assuming commas shows one column.
    const csv =
      "Matière;Note;Coefficient\nMathématiques;15,5;4\nPhysique;12,0;3"
    expect(guessDelimiter(csv)).toBe(";")
  })

  test("ignores delimiters inside quotes", () => {
    const csv = 'Nom\tVille\n"Dupont, Jean"\tLyon\n"Martin, Léa"\tParis'
    expect(guessDelimiter(csv)).toBe("\t")
  })

  test("defaults to the comma when nothing is decisive", () => {
    expect(guessDelimiter("une seule colonne\nsans séparateur")).toBe(",")
  })
})

describe("parsing", () => {
  test("keeps a quoted delimiter inside its cell", () => {
    const table = parseDelimited('Nom,Ville\n"Dupont, Jean",Lyon')
    expect(table.header).toEqual(["Nom", "Ville"])
    expect(table.rows).toEqual([["Dupont, Jean", "Lyon"]])
  })

  test("keeps a newline inside a quoted cell", () => {
    const table = parseDelimited('Titre,Note\n"Ligne un\nLigne deux",12')
    expect(table.rows).toEqual([["Ligne un\nLigne deux", "12"]])
  })

  test("reads a doubled quote as one quote", () => {
    const table = parseDelimited('Citation\n"Il a dit ""oui"""')
    expect(table.rows).toEqual([['Il a dit "oui"']])
  })

  test("drops the byte-order mark rather than naming a column with it", () => {
    const table = parseDelimited("﻿Matière,Note\nMaths,15")
    expect(table.header[0]).toBe("Matière")
  })

  test("pads ragged rows to the widest one", () => {
    const table = parseDelimited("a,b,c\n1,2\n3,4,5")
    expect(table.rows).toEqual([
      ["1", "2", ""],
      ["3", "4", "5"],
    ])
  })

  test("a trailing newline is not a row", () => {
    const table = parseDelimited("a,b\n1,2\n")
    expect(table.rows).toHaveLength(1)
  })

  test("caps the body rows and says how many it left out", () => {
    // A header and fifty rows; the cap is on the body, and what did not fit is
    // counted rather than dropped silently — a table that quietly shows the
    // first ten of fifty rows is a table that lies.
    const csv = ["a"]
      .concat(Array.from({ length: 50 }, (_, i) => `${i}`))
      .join("\n")
    const table = parseDelimited(csv, { maxRows: 10 })
    expect(table.rows).toHaveLength(10)
    expect(table.truncated).toBe(40)
  })
})

describe("aligning numbers", () => {
  test("recognises a French decimal with a thousands space", () => {
    const rows = [["1 234,56"], ["7,5"], ["12"]]
    expect(isNumericColumn(rows, 0)).toBe(true)
  })

  test("a column with any prose in it is not numeric", () => {
    expect(isNumericColumn([["12"], ["absent"]], 0)).toBe(false)
  })

  test("an empty column is not numeric", () => {
    expect(isNumericColumn([[""], [""]], 0)).toBe(false)
  })
})
