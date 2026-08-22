import { describe, expect, test } from "bun:test"
import {
  locationFolderId,
  locationHolds,
  locationShowsFolder,
  materialsLocationHref,
  materialsSearchScope,
  parseMaterialsLocation,
  scopeHolds,
  resolveMaterialsLocation,
  sameMaterialsLocation,
} from "./materials-location"

/**
 * The folder you are in belongs in the address.
 *
 * It used to live in component state, so a folder could not be linked to, the
 * back button could not go back to one, and the header breadcrumb — which is
 * built from the URL — could not say where you were.
 */

describe("reading a location from the address", () => {
  test("no parameter means the root", () => {
    // Not "everything": landing on a flat list of every source in the year is
    // what made the folder tree decorative.
    expect(parseMaterialsLocation(null)).toEqual({ kind: "root" })
    expect(parseMaterialsLocation("")).toEqual({ kind: "root" })
    expect(parseMaterialsLocation("   ")).toEqual({ kind: "root" })
  })

  test("`all` is the flat view, asked for explicitly", () => {
    expect(parseMaterialsLocation("all")).toEqual({ kind: "all" })
  })

  test("anything else is a folder", () => {
    expect(parseMaterialsLocation("f-1")).toEqual({
      kind: "folder",
      folderId: "f-1",
    })
  })
})

describe("writing one back", () => {
  test("the root is the bare route, so the address stays clean", () => {
    expect(materialsLocationHref({ kind: "root" })).toBe("/materials")
  })

  test("a folder round-trips", () => {
    const href = materialsLocationHref({ kind: "folder", folderId: "f 1/2" })
    const value = new URL(href, "https://x").searchParams.get("folder")

    expect(parseMaterialsLocation(value)).toEqual({
      kind: "folder",
      folderId: "f 1/2",
    })
  })
})

describe("what belongs where", () => {
  test("the root holds what is filed in no folder", () => {
    expect(locationHolds({ kind: "root" }, null)).toBe(true)
    expect(locationHolds({ kind: "root" }, "f-1")).toBe(false)
  })

  test("a folder holds what is filed in it", () => {
    const location = { kind: "folder", folderId: "f-1" } as const

    expect(locationHolds(location, "f-1")).toBe(true)
    expect(locationHolds(location, "f-2")).toBe(false)
    expect(locationHolds(location, null)).toBe(false)
  })

  test("the flat view holds everything", () => {
    expect(locationHolds({ kind: "all" }, null)).toBe(true)
    expect(locationHolds({ kind: "all" }, "f-1")).toBe(true)
  })
})

describe("which folders you can walk into", () => {
  test("the top ones, from the root", () => {
    expect(locationShowsFolder({ kind: "root" }, null)).toBe(true)
    expect(locationShowsFolder({ kind: "root" }, "f-1")).toBe(false)
  })

  test("its own, from inside a folder", () => {
    const location = { kind: "folder", folderId: "f-1" } as const

    expect(locationShowsFolder(location, "f-1")).toBe(true)
    expect(locationShowsFolder(location, null)).toBe(false)
  })

  test("none at all, from the flat view", () => {
    // It has already flattened the folders away; a way into one would
    // contradict the list it is showing.
    expect(locationShowsFolder({ kind: "all" }, null)).toBe(false)
  })
})

describe("what a new item would be filed into", () => {
  test("is a folder only when you are in one", () => {
    expect(locationFolderId({ kind: "folder", folderId: "f-1" })).toBe("f-1")
    // The root and the flat view are not places to put a file.
    expect(locationFolderId({ kind: "root" })).toBeNull()
    expect(locationFolderId({ kind: "all" })).toBeNull()
  })
})

describe("a folder that no longer exists", () => {
  test("falls back to the root rather than an empty room", () => {
    // A deleted folder, or a link from another school year: the pane would
    // otherwise show nothing, with a breadcrumb naming a folder that is gone.
    expect(
      resolveMaterialsLocation(
        { kind: "folder", folderId: "gone" },
        new Set(["f-1"])
      )
    ).toEqual({ kind: "root" })
  })

  test("and a folder that does exist is left alone", () => {
    expect(
      resolveMaterialsLocation(
        { kind: "folder", folderId: "f-1" },
        new Set(["f-1"])
      )
    ).toEqual({ kind: "folder", folderId: "f-1" })
  })
})

describe("comparing two locations", () => {
  test("tells folders apart", () => {
    expect(
      sameMaterialsLocation(
        { kind: "folder", folderId: "a" },
        { kind: "folder", folderId: "b" }
      )
    ).toBe(false)
    expect(
      sameMaterialsLocation(
        { kind: "folder", folderId: "a" },
        { kind: "folder", folderId: "a" }
      )
    ).toBe(true)
    expect(sameMaterialsLocation({ kind: "root" }, { kind: "all" })).toBe(false)
  })
})

describe("what a search looks through", () => {
  const branchOf = (id: string) =>
    id === "f-1" ? new Set(["f-1", "f-1-a"]) : new Set([id])
  const every = ["f-1", "f-1-a", "f-2"]

  test("from inside a folder, that folder and everything under it", () => {
    // A search that only reads the folder you are standing in cannot find
    // anything you have filed, which is the only time you need one.
    const scope = materialsSearchScope(
      { kind: "folder", folderId: "f-1" },
      branchOf,
      every
    )

    expect(scopeHolds(scope, "f-1-a")).toBe(true)
    expect(scopeHolds(scope, "f-2")).toBe(false)
    // Nothing filed at the top belongs to a search started inside a folder.
    expect(scopeHolds(scope, null)).toBe(false)
  })

  test("from the root, the whole year", () => {
    const scope = materialsSearchScope({ kind: "root" }, branchOf, every)

    expect(scopeHolds(scope, "f-2")).toBe(true)
    expect(scopeHolds(scope, null)).toBe(true)
  })
})
