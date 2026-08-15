# Design notes

## Fluid sizing (tailwind-clamp)

Fluid type and spacing use [`tailwind-clamp`](https://github.com/nicolas-cusan/tailwind-clamp)
(v4-native, registered via `@plugin "tailwind-clamp";` in
`apps/web/src/app/globals.css`). Syntax: `clamp-[text,4xl,7xl]`,
`clamp-[py,4,8]` — values scale linearly between 375px and 1440px viewports.

**Allowed** on expressive surfaces only: the public landing
(`app/page.tsx`), the year-review story (`components/review/`), and
auth/onboarding heroes. **Forbidden** on app chrome — tables, forms, cards,
settings, dashboards — where fixed sizes are deliberate.

When converting a breakpoint ladder (`text-3xl sm:text-4xl`), the clamp pair
must equal the old endpoints (smallest breakpoint value → min, largest →
max) so nothing changes at the extremes. An explicit `leading-*` /
`tracking-*` utility beside the clamp keeps winning; only add one when the
ladder had one.

Watch item: `@jalendport/tailwindcss-fluid` is the spiritual successor —
reconsider if it ships on npm.
