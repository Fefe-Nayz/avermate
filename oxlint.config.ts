import { defineConfig } from "oxlint";

/**
 * Anti-slop: vendored Oxlint rules (tools/oxlint/anti-slop, from
 * dmmulroy/anti-slop) that reject low-evidence type patterns. Oxlint runs as
 * a fast second pass beside ESLint and owns only these rules.
 *
 * Severity is a ratchet, not a verdict: rules the codebase already satisfies
 * start at "error"; rules with a pre-existing backlog start at "warn" so the
 * gate stays green while the backlog burns down — tighten them as it does.
 */
export default defineConfig({
  ignorePatterns: [
    "**/node_modules/**",
    "**/.next/**",
    "**/.expo/**",
    "**/dist/**",
    "**/drizzle/**",
    ".claude/**",
    "plans/**",
    "docs/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  rules: {
    // Held at zero today — these are the gate.
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-widen-then-assert": "error",
    // Pre-existing backlog (counts at adoption) — tighten as it burns down.
    "anti-slop/no-chained-type-assertions": "warn", // 41
    "anti-slop/no-conditional-empty-object-spread": "warn", // 61
    "anti-slop/no-known-value-widening": "warn", // 109
    "anti-slop/no-runtime-typeof": "warn", // 195
    "anti-slop/no-unknown-parameters": "warn", // 76
    "anti-slop/no-unknown-returns": "warn", // 10
    "anti-slop/no-unsafe-dictionary-type": "warn", // 32
    "anti-slop/require-safety-comment-for-type-assertion": "warn", // 548
    // "themeShape" is this product's own preference field, not slop; renaming
    // it across server schema and both clients would trade clarity for a word.
    "anti-slop/no-shape-in-symbol-names": "off",
  },
});
