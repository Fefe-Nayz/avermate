# Chart architecture

This document records the chart migration in the `rewrite` application. It is
the implementation companion to the shorter overview in the README.

## Version decision

The capability audit tested upstream `@tanstack/charts` `0.11.0` (upstream
commit `4b5ae62a2b996c335cdd3f9e614f65d2171eaad1`). No Avermate-specific fork or
library patch is required. The package is therefore pinned to exactly `0.11.0`:
it is pre-alpha software, so upgrades should be deliberate and should run the
consumer integration tests before the version changes.

The audit also found that the built-in X zoom owns a separate hover path. For
time-series views Avermate instead sets `pointer: false` and combines inspection
and semantic-domain gestures in one application controller, using TanStack
Charts' public `resolvePointer` and `setControlledFocus` APIs. Marks, scales,
focus grouping, tooltips, scene projection, and SVG rendering remain native
TanStack primitives; the controller is not a compatibility layer that mimics
Recharts components.

## Inventory

The rewrite branch previously had six Recharts visualization forms in five
direct import sites plus a shared Recharts-specific wrapper.

| Surface                | Used by                             | Before                                                                           | Current behavior                                                                                                                                                              |
| ---------------------- | ----------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Average over time      | Dashboard, insights, subject detail | Responsive area, optional trend line and points, passing rule, formatted tooltip | TanStack area/line/dot/rule marks, localized axes and tooltip, independent focus resolver, semantic X viewport, wheel/trackpad/drag/touch/pinch/keyboard navigation and reset |
| Result distribution    | Insights                            | Responsive colored bar chart with no tooltip                                     | TanStack band/linear scales and bar mark; pointer/focus disabled; exact bucket values remain available in a visually hidden semantic list                                     |
| Admin activity         | Admin overview                      | Responsive area chart with browser-fetched data and a default tooltip            | TanStack area/line marks with keyboard focus and formatted tooltip; data is prefetched on the server and hydrated                                                             |
| Average card sparkline | Dashboard card grid                 | Tiny area sparkline                                                              | TanStack area/line marks; pointer, focus, tooltip, and keyboard disabled because the chart is decorative                                                                      |
| Distribution card      | Dashboard card grid                 | Tiny bar chart                                                                   | TanStack bar mark; decorative interactions disabled                                                                                                                           |
| Landing preview        | Public landing page                 | Static responsive area preview                                                   | Deterministic TanStack area/line scene rendered as accessible-hidden decoration without browser data fetching                                                                 |

`apps/web/src/components/ui/chart.tsx`, its Recharts context, CSS selectors,
tooltip wrapper, and legend wrapper were deleted. `recharts` and its transitive
runtime package were removed from the application dependency graph.

## Nearest-point focus

`time-series-interaction.ts` contains a reusable `ChartFocusStrategy` adapter.
For each enabled series it selects the independently nearest projected point on
the X axis. It never assumes that series share timestamps. Equal-distance ties
choose the earlier semantic timestamp and then a stable series/datum identity.
The closest selected point in two dimensions becomes the primary tooltip
anchor; every selected series retains its own actual projected point, so active
markers do not drift onto an invented shared X value.

The calculation receives the currently rendered TanStack scene points. A zoom
or pan therefore changes projection first, after which focus resolves against
the transformed and clipped scene. Sparse samples, missing samples, disabled
series, and irregular timestamps do not clear unrelated series.

## Viewport and input

The canonical viewport is an X-domain tuple, never a CSS transform or stored
pixel offset. Pixel positions are temporary inputs interpreted through the
resolved TanStack scale.

- Mouse drag and one-finger touch pan the domain.
- Wheel and precision trackpad deltas zoom around the pointer; horizontal
  trackpad deltas pan. Pixel, line, and page wheel units are normalized.
- A non-passive native listener is used because React delegates wheel events
  passively. Ordinary page scrolling and browser Ctrl+wheel zoom remain
  available until a pointer engages the plot or keyboard focus is inside it;
  after engagement, precision-trackpad pinch drives the chart viewport.
- Two-pointer pinch uses one fixed gesture baseline for both distance and
  midpoint. This preserves pure two-finger translation and combines translation
  with zoom without event-order drift.
- `+`/`-` zoom, `Alt+Arrow` pans, and `0` resets. Plain arrows and Home/End are
  left to TanStack's datum navigation.
- Viewport proposals are coalesced with `requestAnimationFrame`. A changed data
  extent cancels stale proposals and clears gesture/focus state.
- Focus-marker transitions respect reduced motion. Viewport updates themselves
  are immediate, so direct manipulation does not chase tweened geometry.

The maximum zoom is derived from the time extent and bounded. The reset button
and visible-domain live status are localized in English and French.

## Tests and remaining manual gates

The focused test suite covers aligned, partially aligned, irregular, sparse,
missing and disabled series; boundaries and tie cases; projected marker
locations; zoom/pan domain constraints; fixed-baseline pinch; rapid inspection;
pointer leave; keyboard arbitration; active wheel installation and wheel unit/
arming behavior. A scene integration test checks clipping and markers after a
transformed viewport and verifies deterministic server SVG output.

Automated tests do not replace hands-on WebKit, high-resolution trackpad,
multi-touch, VoiceOver/NVDA, reduced-motion, and narrow-layout checks. Those are
release gates whenever the chart package or controller changes.
