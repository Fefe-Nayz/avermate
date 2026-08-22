# Design system

Avermate has one semantic language and platform-specific rendering. Shared
data lives in `packages/core/src/design-tokens.ts`; it has no React, CSS or
platform dependency. It owns preset palettes, token and season IDs, result
bands, radius steps and font names/stacks.

## Adapters

- Web imports Core through `apps/web/src/lib/theme-presets.ts` and
  `apps/web/src/lib/theme.ts`. CSS in `src/app/theme.css` maps semantic colours
  to variables; `globals.css` exposes them to Tailwind.
- React Native still projects a parallel palette in
  `apps/mobile/lib/theme-presets.ts`. The application is excluded from the
  current delivery, so this adapter was audited read-only and its Core
  migration is explicitly deferred.
- Platform adapters may change representation (OKLCH versus sRGB, CSS
  variables versus native objects), not meaning. An intentional divergence
  needs an inline comment naming the platform reason.

## Platform idioms

- Mobile navigation follows native stacks, sheets, safe areas and touch
  targets. Feature parity does not mean reproducing desktop chrome.
- Web on a phone keeps the same visual hierarchy and thumb-friendly controls
  as the native experience.
- Desktop Web must not inherit phone density. Controls default to touch-safe
  values and become compact only inside
  `@media (hover: hover) and (pointer: fine)`.
- Width decides layout, never input density. A wide touchscreen remains
  tactile; a narrow pointer window remains compact.
- Focus rings, disabled states and invalid states remain properties of the
  shared primitive at every density.

## Control density

`apps/web/src/app/app.css` owns `--control-h`, `--control-px` and
`--control-text`, plus size variants. The `form`, `comfortable` and `search`
height variants preserve the larger targets of shared form wrappers. `Button`,
`Input`, `SelectTrigger`, `Textarea` and `InputGroup` consume the tokens.
Screens must not add a breakpoint merely to make those primitives smaller.

## Change protocol

1. Change a shared preset or token in Core once.
2. Update a platform representation only when its adapter requires it.
3. Extend the exhaustiveness and adapter-contract tests in the same change.
4. Verify light/dark/custom themes, keyboard focus and touch/pointer density.
5. Document any deliberate platform difference beside the adapter.

Fluid typography is a separate expressive-surface convention. Follow
`docs/design-notes.md`: it is allowed for landing, auth/onboarding heroes and
the year-review story, not app chrome, tables, forms or dashboards.
