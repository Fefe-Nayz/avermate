import { describe, expect, test } from "bun:test";
import { parseStudyDocumentFrontMatter } from "./study-document-frontmatter";

describe("study document front matter", () => {
  test("reads the supported metadata subset and de-duplicates tags", () => {
    expect(
      parseStudyDocumentFrontMatter(`---
title: "Suites numériques"
subject: Maths
tags:
  - Révision
  - révision
  - oral
---
# Cours`),
    ).toEqual({
      title: "Suites numériques",
      subject: "Maths",
      tags: ["Révision", "oral"],
    });
  });

  test("accepts an inline list but never scans a body as metadata", () => {
    expect(
      parseStudyDocumentFrontMatter("---\ntags: [bac, oral]\n---\nTexte").tags,
    ).toEqual(["bac", "oral"]);
    expect(parseStudyDocumentFrontMatter("tags: [not metadata]")).toEqual({
      tags: [],
    });
  });
});
