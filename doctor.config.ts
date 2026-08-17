import { defineConfig } from "react-doctor/api";

/**
 * React Doctor: the deep pass over the two React projects (apps/web,
 * apps/mobile). It owns everything oxlint can't see on its own — dead code,
 * architecture, per-framework rules (Next.js vs Expo), supply-chain scoring.
 *
 * The fast pass lives in oxlint.config.ts, which carries a curated slice of
 * the same react-doctor rules so the editor and `bun lint:slop` flag the
 * high-signal ones without waiting for a full scan.
 *
 * Severity is a ratchet, not a verdict — the same convention as
 * oxlint.config.ts. Rules the codebase already satisfies keep their shipped
 * severity; rules with a pre-existing backlog are pinned to "warn" with the
 * count at adoption so `blocking: "error"` stays green. Tighten each one back
 * to its default as the count reaches zero.
 */
export default defineConfig({
  // Scan every React workspace project (apps/web, apps/mobile) and score them
  // separately, so a bare `bun run doctor` needs no flags. apps/server and
  // packages/core carry no React runtime and are skipped automatically.
  projects: ["*"],

  // Only errors fail the run; warnings stay advisory and visible.
  blocking: "error",

  // Left at the tool's default: each run posts project shape and rule
  // names/counts (never source) to react.doctor to compute the 0–100 score and
  // a share URL. Set `noScore: true` here, or pass --no-telemetry, to opt out.

  rules: {
    // Pre-existing error backlog (counts at adoption, 2026-08-16).
    "react-doctor/no-layout-property-animation": "warn", // 15
    "react-doctor/no-ref-current-in-render": "warn", // 4
    "react-doctor/effect-needs-cleanup": "warn", // 3
    "react-doctor/no-hydration-branch-on-browser-global": "warn", // 1
    "react-doctor/three-shader-no-invalid-smoothstep-edges": "warn", // 1
  },
});
