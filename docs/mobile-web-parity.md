# Mobile ↔ Web parity matrix

Working ledger for the MOBILE_WEB_PARITY.md goal (web-parity-first phase).
Statuses: ✅ done · 🟡 partial · ❌ missing · ➖ intentionally different (justified).
"Visual" means matches the web's phone-width presentation; "behavior" covers
interactions, states and data flow.

## Baseline

- ✅ Startup: bun store corruption purged, Expo SDK-aligned, route-dir tests
  moved; dev-server entry bundles HTTP 200 (see commit 0253987).
- ✅ Design tokens: web `globals.css` palette/radius/type mirrored in
  `lib/theme.ts`; kit (`components/ui.tsx`) reshaped (commit 90e10da).
- ✅ Shell: 3 preference-driven tabs + quick-add + More, insights/social as
  tab routes, uniform slide transitions, iOS full-screen back
  (commit 90e10da).

## Route matrix

| Web route | Mobile route | Status | Notes |
|---|---|---|---|
| `/` landing | — | ➖ | Marketing page; app opens to auth/dashboard. |
| `/auth/sign-in` | `/sign-in` | ✅ | Structure verified side-by-side (expo-web vs web @393px): title 30/600, OAuth Google+Microsoft, email/password, forgot + create links. |
| `/auth/sign-up` | `/sign-up` | ✅ | Verified: name/email/password + OAuth + submit, FR copy. |
| `/auth/forgot-password` | `/forgot-password` | 🟡 | Reset link lands on web (`/auth/reset-password`) — document deep-link story. |
| `/auth/reset-password` | — | ➖ | Email links target the web app; acceptable, verify copy mentions it. |
| `/auth/verify` | `/verify-email` | 🟡 | |
| `/auth/consent` | — | ➖ | OAuth consent renders in browser. |
| `/legal/*` | About links out | ➖ | External links in Settings → About. |
| `/onboarding` (+`/new-year`, `/year/*`) | `/onboarding`, `/year/new`, `/year/[id]/setup` | 🟡 | Flow works; visual/state pass pending. |
| `/dashboard` | `/(tabs)/index` | ✅ | Web sections incl. the radar; card management (order by drag) lives in settings/cards on mobile. |
| `/dashboard/cards/new` (gallery+builder) | `/settings/cards` → gallery + card-edit | ✅ | Gallery + slots shipped; IA differs (settings entry) — acceptable, note. |
| `/dashboard/cards/[cardId]` | `/settings/card-edit?id` | ✅ | |
| `/insights` (+cards) | `/(tabs)/insights` | ✅ | Widget surface + editor + gallery. |
| `/grades` | `/(tabs)/grades` | ✅ | Search/sort/month groups + the web's three views: result-band calendar (day detail below grid, latest month first) and hierarchical table (horizontal scroll in card, general + custom average footer). View persisted per account. |
| `/grades/new`, `[id]`, `[id]/edit` | `/grade/*` | ✅ | Detail: loading gate, subject link, weight phrasing, full dates, filtered impact grid, single edit affordance; hosts read the year graph with the web's snapshot invalidation; ?subjectId prefill and period intro line. |
| `/subjects` | `/(tabs)/subjects` | ✅ | Hierarchy + per-sibling-level drag reorder (web payload), custom-averages section aligned. |
| `/subjects/[subjectId]` | `/subject/[id]` | ✅ | Charts, search+5 sorts, child sort, impact, patterns. |
| `/subjects/new`, `[id]/edit` | `/subject/new`, `/subject/edit` | ✅ | Web field order/copy/validation, ?kind=category honoured, delete decided on the server impact (keep children vs whole branch). |
| `/averages/[averageId]` | `/average/[id]` | ✅ | Web section order (scope bar, hero, event-sampled chart, Subjects, stat tiles, impact grid, grades), honest empty states, pencil edit. |
| `/goals` (+new/[id]/edit) | `/(tabs)/goals`, `/goal/*` | ✅ | Reorder mode with overlay grips, web persistence. |
| `/review` | `/review` | 🟡 | Story exists; recent web refinements unaudited. |
| `/announcements` | `/announcements` | 🟡 | |
| `/more` | `/(tabs)/more` | ✅ | Mirrors web More + admin gating. |
| `/settings` | `/(tabs)/settings` | 🟡 | |
| `/settings/appearance` | `/settings/appearance` | ✅ | Incl. lineStyle + connectGrades. |
| `/settings/navigation` | `/settings/navigation` | ✅ | 3 tab slots, shared preference. |
| `/settings/year` | `/settings/year` (+`/settings/periods`) | ✅ | Web field set + truthful destructive copy; periods drag with always-on grips. |
| `/settings/averages` (+new/[id]) | `/settings/averages`, `/settings/average-edit` | ✅ | Always-on grips, web persistence and error copy. |
| `/settings/account` | `/settings/account` | ✅ | Email change, credential linking, session sign-out, export/delete framing. |
| `/settings/integrations` | `/settings/integrations` | ✅ | Full MCP story: server address, discovery metadata, grants with revocation, optional public client. |
| `/settings/preset` | `/settings/preset` | ✅ | Web decision states (up to date / update ready / customized / blocked) with change summaries. |
| `/settings/about` | `/settings/about` | ✅ | Legal links out. |
| `/social/*` (friends, groups, sharing, notifications, invitations) | `/(tabs)/social`, `/social/*` | ✅ | Full alignment: invitation management + revocation, year-state badges, named-year adopt flow, always-visible sharing with disabled reason, comparisons vocabulary, leaderboard reasons, notification filter, server sentences surfaced. |
| `/admin` | `/admin` | 🟡 | |
| `/admin/users` (+[userId]) | `/admin/users`, `/admin/user/[id]` | 🟡 | |
| `/admin/announcements` | `/admin/announcements` | 🟡 | |
| `/admin/feedback` | `/admin/feedback` (+[id]) | 🟡 | |
| `/admin/presets` (+editor) | `/admin/presets`, `/admin/preset/*` | 🟡 | Web visual editor uses drag — port after sortable primitive lands. |
| `/admin/card-templates` | `/admin/card-templates` | ✅ | Curation screen: draft-from-card, live previews (WidgetResultRenderer + slot substitution), metadata editing, publish/archive — web payload parity. From-scratch builder (web `/new`) intentionally deferred: mobile builder-with-submission-override is a follow-up; no dead button shipped. |
| `/admin/social/*` | `/admin/social/*` | 🟡 | |
| — | `/settings/system-widget`, `/settings/widget-library`, `/settings/feedback`, `/social/blocks`, `/social/report` | ➖ | Legitimate mobile-only capabilities (§17) — preserve. |

## Cross-cutting

| Area | Status | Notes |
|---|---|---|
| Charts: curves/dots/tooltip/presets/y-frame | ✅ | Commit 073164b, geometry unit-tested. |
| Charts: trend line, passing-line exact style, tooltip order, axis formats, legend restyle, wipe entrance | ✅ | Segmented trend via the same core function (dashed 5 4, muted, framed); tooltip = web layout (shared-day header, bold values, per-row dates); axes 5 ticks/1 digit; legend rests as web's dotted list, toggle kept; 800ms wipe respecting reduced motion. Remaining sub-pixel deltas of the single-series web chart documented in the agent report. |
| Radar chart (dashboard "Main subjects at a glance") | ✅ | Web spec geometry ported (folded spoke labels, polygon rings, tap tooltip), unit-tested; mounted on the home tab. |
| Drag & drop: goals, averages | ✅ | Reusable touch sortable (200ms hold, closest-centre projection, velocity settle, autoscroll, reduced-motion, a11y move actions; 21 math tests). Goals = web reorder mode with overlay grips; averages = always-on grips + web persistence/error copy. |
| Drag & drop: subjects, year periods, cards grid | ✅ | Subjects reorder per sibling level (web's exact subjects.move payload, reorder toggle); periods carry always-on grips committing via periods.reorder; widget cards drag with the full-visible-order cards.reorder payload. All optimistic with rollback. |
| Drag & drop: admin preset visual editor | 🟡 | Admin-only editor; adopt the primitive in a dedicated admin-parity pass. |
| Rewind / timeline scrubbing | ✅ | Scope-bar timeline panel now uses the web's day-per-tick scrubber (month-start ticks, drag previews, commit on release) instead of a slider. Gaussian tick magnify (decorative CSS) intentionally not ported. |
| Localization FR/EN | ✅ | Catalogue tests enforce 1:1; keep green per slice. |
| Themes light/dark/system + presets + seasonal | ✅ | Web base tokens mirrored; presets/seasonal already wired via theme-presets. Custom theme studio parity to verify. |
| Loading/empty/error states | 🟡 | Web has 3 skeleton files only; audit per screen during visual pass. |
| Toasts/confirmation feedback | 🟡 | Mobile uses Alert + haptics; web uses sonner. Map per action during screen passes. |
| Microinteractions (pressed states, sheet motion, chart transitions) | 🟡 | Pressed states exist in kit; sweep after structural parity. |
| Auth flows end-to-end | 🟡 | Session/secure-store preserved; exercise flows in validation phase. |
| Visual validation at 360/393/412, FR/EN, light/dark | ❌ | Planned: expo web (react-native-web) in Browser pane vs web app side-by-side. |

## Validation log

- Mobile: check-types clean · 107 tests green · entry bundle HTTP 200 (last: after parity slice 34cc795).
- Web/core/server: all suites green after template-slots move to core.

(Each completed slice updates this file.)
