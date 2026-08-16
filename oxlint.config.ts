import { defineConfig } from "oxlint";

/**
 * Two vendored rule sets ride along with Oxlint's own defaults, in a fast
 * second pass beside ESLint:
 *
 * - anti-slop (tools/oxlint/anti-slop, from dmmulroy/anti-slop) rejects
 *   low-evidence type patterns.
 * - react-doctor (oxlint-plugin-react-doctor) carries the correctness,
 *   security and accessibility slice of React Doctor's rules — the ones worth
 *   seeing in the editor on every keystroke. The full 880-rule surface,
 *   dead-code and architecture analysis stays in the `bun run doctor` scan
 *   configured by doctor.config.ts; nothing here duplicates it.
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
    { name: "react-doctor", specifier: "oxlint-plugin-react-doctor" },
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

    // react-doctor — held at zero today, these are the gate.
    "react-doctor/alt-text": "error",
    "react-doctor/anchor-is-valid": "error",
    "react-doctor/aria-props": "error",
    "react-doctor/aria-proptypes": "error",
    "react-doctor/aria-role": "error",
    "react-doctor/auth-token-in-web-storage": "error",
    "react-doctor/dangerous-html-sink": "error",
    "react-doctor/debounce-no-cleanup": "error",
    "react-doctor/effect-listener-cleanup-mismatch": "error",
    "react-doctor/effect-observer-needs-disconnect": "error",
    "react-doctor/effect-raf-loop-needs-cancel": "error",
    "react-doctor/jsx-no-undef": "error",
    "react-doctor/no-derived-state": "error",
    "react-doctor/no-fetch-in-effect": "error",
    "react-doctor/no-redundant-roles": "error",
    // react-doctor — pre-existing backlog (counts at adoption).
    "react-doctor/no-array-index-as-key": "warn", // 20
    "react-doctor/js-set-map-lookups": "warn", // 16
    "react-doctor/no-layout-property-animation": "warn", // 15
    "react-doctor/no-loading-flag-reset-outside-finally": "warn", // 10
    "react-doctor/button-has-type": "warn", // 6
    "react-doctor/no-ref-current-in-render": "warn", // 4
    "react-doctor/effect-needs-cleanup": "warn", // 3
    "react-doctor/prefer-use-effect-event": "warn", // 3
    "react-doctor/control-has-associated-label": "warn", // 2
    "react-doctor/jsx-no-constructed-context-values": "warn", // 2
    "react-doctor/no-pass-data-to-parent": "warn", // 2
    "react-doctor/no-pass-live-state-to-parent": "warn", // 2
    "react-doctor/no-prop-callback-in-effect": "warn", // 2
    "react-doctor/prefer-tag-over-role": "warn", // 2
    "react-doctor/click-events-have-key-events": "warn", // 1
    "react-doctor/js-index-maps": "warn", // 1
    "react-doctor/no-fetch-response-used-without-status-check": "warn", // 1
    "react-doctor/no-hydration-branch-on-browser-global": "warn", // 1
    "react-doctor/no-initialize-state": "warn", // 1
    "react-doctor/no-mirror-prop-effect": "warn", // 1
    "react-doctor/no-static-element-interactions": "warn", // 1
    "react-doctor/no-transition-all": "warn", // 1
    // Architecture and maintainability (no-giant-component, display-name,
    // only-export-components, unused exports) belong to `bun run doctor`,
    // where the whole-project view makes them actionable — 280+ warnings here
    // would bury the rules above.
  },
});
