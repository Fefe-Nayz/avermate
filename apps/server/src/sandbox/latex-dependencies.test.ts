import { describe, expect, test } from "bun:test";
import {
  createLatexBundleProposal,
  detectLatexDependencies,
  detectMissingLatexDependenciesFromLog,
} from "./latex-dependencies";

const catalog = [
  { kind: "document-class", latexName: "article", bundleId: "latex-base", bundleDigest: `sha256:${"1".repeat(64)}`, lockedVersion: "2026.1", source: "tectonic-base", reviewed: true },
  { kind: "package", latexName: "amsmath", bundleId: "latex-math", bundleDigest: `sha256:${"2".repeat(64)}`, lockedVersion: "2026.1", source: "reviewed-ctan-cache", reviewed: true },
  { kind: "package", latexName: "graphicx", bundleId: "latex-base", bundleDigest: `sha256:${"1".repeat(64)}`, lockedVersion: "2026.1", source: "tectonic-base", reviewed: true },
  { kind: "font", latexName: "TeX Gyre Pagella", bundleId: "fonts-pagella", bundleDigest: `sha256:${"3".repeat(64)}`, lockedVersion: "2.501", source: "bundled-font", reviewed: true },
] as const;

describe("LaTeX dependency analysis", () => {
  test("detects reviewed packages, classes, fonts, and ignores comments", () => {
    const analysis = detectLatexDependencies(
      String.raw`
        \documentclass{article}
        % \usepackage{not-real}
        \usepackage{amsmath, graphicx} % comment
        \setmainfont{TeX Gyre Pagella}
        \addbibresource{sources.bib}
      `,
      catalog,
    );
    expect(analysis.status).toBe("current");
    expect(analysis.packages).toEqual(["amsmath", "graphicx"]);
    expect(analysis.requiredBundles).toEqual(["fonts-pagella", "latex-base", "latex-math"]);
    expect(createLatexBundleProposal({
      sourceImageDigest: `sha256:${"a".repeat(64)}`,
      profileVersion: "latex-v2",
      analysis,
    })).toMatchObject({
      status: "review-required",
      profileVersion: "latex-v2",
      bundles: [
        { bundleId: "fonts-pagella", bundleDigest: `sha256:${"3".repeat(64)}` },
        { bundleId: "latex-base", bundleDigest: `sha256:${"1".repeat(64)}` },
        { bundleId: "latex-math", bundleDigest: `sha256:${"2".repeat(64)}` },
      ],
    });
  });

  test("does not auto-install unknown dependencies or shell escape", () => {
    expect(detectLatexDependencies(String.raw`\usepackage{mystery}`, catalog)).toMatchObject({
      status: "needs-extension",
      missing: ["package:mystery"],
    });
    const unsafe = detectLatexDependencies(String.raw`\immediate\write18{curl example.com}`, catalog);
    expect(unsafe.status).toBe("unsupported");
    expect(() =>
      createLatexBundleProposal({
        sourceImageDigest: `sha256:${"a".repeat(64)}`,
        profileVersion: "v2",
        analysis: unsafe,
      }),
    ).toThrow();
  });

  test("parses missing dependency diagnostics", () => {
    expect(
      detectMissingLatexDependenciesFromLog(
        "LaTeX Error: File `chemformula.sty' not found\nI couldn't open database file refs.bib",
      ),
    ).toEqual(["chemformula.sty", "refs.bib"]);
  });
});
