import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTypeScript from "eslint-config-next/typescript"

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // Registry components are vendored verbatim, so `shadcn add @reui/…` can
    // replace them in place. Editing them to satisfy our rules would guarantee
    // a conflict on the next upgrade, so the rules that would require touching
    // upstream source are off here — the rest still apply.
    files: ["src/components/reui/**"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/use-memo": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".turbo/**",
    "coverage/**",
    "out/**",
    "build/**",
    "public/vendor/**",
    "next-env.d.ts",
  ]),
])
