import { createHash } from "node:crypto";

export interface LatexDependencyCatalogEntry {
  kind: "package" | "document-class" | "font" | "bibliography-tool";
  latexName: string;
  bundleId: string;
  bundleDigest: string;
  lockedVersion: string;
  source: "tectonic-base" | "reviewed-ctan-cache" | "bundled-font";
  reviewed: true;
}

export interface LatexResolvedBundle {
  readonly bundleId: string;
  readonly bundleDigest: string;
  readonly lockedVersion: string;
  readonly source: LatexDependencyCatalogEntry["source"];
}

export interface LatexDependencyAnalysis {
  status: "current" | "needs-extension" | "unsupported";
  documentClasses: readonly string[];
  packages: readonly string[];
  fonts: readonly string[];
  bibliographyFiles: readonly string[];
  requiredBundles: readonly string[];
  resolvedBundles: readonly LatexResolvedBundle[];
  missing: readonly string[];
  unsupported: readonly string[];
}

export interface LatexBundleProposal {
  schemaVersion: 1;
  sourceImageDigest: string;
  profileVersion: string;
  dependencyLockDigest: string;
  bundleIds: readonly string[];
  bundles: readonly LatexResolvedBundle[];
  status: "review-required";
}

const PROHIBITED_TEX = /\\(?:immediate\s*)?(?:write18|openout|read|usepackage\s*\{shellesc\})/iu;

/** Parses declarations only. It never installs packages or executes TeX. */
export function detectLatexDependencies(
  source: string,
  catalog: readonly LatexDependencyCatalogEntry[],
): LatexDependencyAnalysis {
  const clean = stripLatexComments(source);
  const documentClasses = matches(clean, /\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/giu);
  const packages = matches(clean, /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/giu).flatMap(
    commaSeparated,
  );
  const fonts = [
    ...matches(clean, /\\(?:setmainfont|setsansfont|setmonofont)\s*(?:\[[^\]]*\])?\{([^}]+)\}/giu),
    ...matches(clean, /\\newfontfamily\\[A-Za-z@]+\s*(?:\[[^\]]*\])?\{([^}]+)\}/giu),
  ];
  const bibliographyFiles = [
    ...matches(clean, /\\addbibresource(?:\[[^\]]*\])?\{([^}]+)\}/giu),
    ...matches(clean, /\\bibliography\{([^}]+)\}/giu).flatMap(commaSeparated),
  ];

  const requested = [
    ...documentClasses.map((latexName) => ({ kind: "document-class" as const, latexName })),
    ...packages.map((latexName) => ({ kind: "package" as const, latexName })),
    ...fonts.map((latexName) => ({ kind: "font" as const, latexName })),
  ];
  const requiredBundles = new Set<string>();
  const resolvedBundles = new Map<string, LatexResolvedBundle>();
  const missing: string[] = [];
  for (const dependency of requested) {
    const found = catalog.find(
      (entry) =>
        entry.kind === dependency.kind &&
        entry.latexName.toLocaleLowerCase("en-US") ===
          dependency.latexName.toLocaleLowerCase("en-US"),
    );
    if (found && /^sha256:[a-f0-9]{64}$/u.test(found.bundleDigest)) {
      const existing = resolvedBundles.get(found.bundleId);
      if (
        existing &&
        (existing.bundleDigest !== found.bundleDigest ||
          existing.lockedVersion !== found.lockedVersion ||
          existing.source !== found.source)
      ) {
        missing.push(`conflicting-bundle:${found.bundleId}`);
        continue;
      }
      requiredBundles.add(found.bundleId);
      resolvedBundles.set(found.bundleId, {
        bundleId: found.bundleId,
        bundleDigest: found.bundleDigest,
        lockedVersion: found.lockedVersion,
        source: found.source,
      });
    } else missing.push(`${dependency.kind}:${dependency.latexName}`);
  }

  const unsupported = PROHIBITED_TEX.test(clean)
    ? ["Source requests prohibited shell/file primitives; shell escape is never enabled."]
    : [];
  return Object.freeze({
    status: unsupported.length > 0 ? "unsupported" : missing.length > 0 ? "needs-extension" : "current",
    documentClasses: unique(documentClasses),
    packages: unique(packages),
    fonts: unique(fonts),
    bibliographyFiles: unique(bibliographyFiles),
    requiredBundles: [...requiredBundles].sort(),
    resolvedBundles: Object.freeze(
      [...resolvedBundles.values()].sort((a, b) => a.bundleId.localeCompare(b.bundleId)),
    ),
    missing: unique(missing),
    unsupported,
  });
}

export function detectMissingLatexDependenciesFromLog(log: string): readonly string[] {
  const missing = [
    ...matches(log, /LaTeX Error:\s*File [`']([^`']+\.(?:sty|cls))[`'] not found/giu),
    ...matches(log, /font(?:spec)? error:\s*(?:the )?font [`']?([^`'\r\n]+)[`']? (?:cannot be found|not found)/giu),
    ...matches(log, /I couldn't open database file\s+([^\s]+\.bib)/giu),
  ];
  return unique(missing);
}

export function createLatexBundleProposal(input: {
  sourceImageDigest: string;
  profileVersion: string;
  analysis: LatexDependencyAnalysis;
}): LatexBundleProposal {
  if (input.analysis.status === "unsupported" || input.analysis.missing.length > 0) {
    throw new Error("Only fully mapped, reviewed dependencies can form an image proposal.");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.sourceImageDigest)) {
    throw new Error("A pinned source image digest is required.");
  }
  const lock = JSON.stringify({
    profileVersion: input.profileVersion,
    bundles: input.analysis.resolvedBundles,
  });
  return Object.freeze({
    schemaVersion: 1,
    sourceImageDigest: input.sourceImageDigest,
    profileVersion: input.profileVersion,
    dependencyLockDigest: `sha256:${createHash("sha256").update(lock).digest("hex")}`,
    bundleIds: Object.freeze([...input.analysis.requiredBundles].sort()),
    bundles: Object.freeze(input.analysis.resolvedBundles.map((bundle) => Object.freeze({ ...bundle }))),
    status: "review-required",
  });
}

export function stripLatexComments(source: string): string {
  return source
    .split(/\r?\n/u)
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] !== "%") continue;
        let slashes = 0;
        for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
          slashes += 1;
        }
        if (slashes % 2 === 0) return line.slice(0, index);
      }
      return line;
    })
    .join("\n");
}

function matches(value: string, expression: RegExp): string[] {
  return [...value.matchAll(expression)].map((match) => match[1].trim()).filter(Boolean);
}

function commaSeparated(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort((a, b) => a.localeCompare(b)));
}
