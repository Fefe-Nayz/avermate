# Goal: rebuild Avermate Mobile as a near pixel-perfect, feature-complete React Native implementation of the current web app

Repository: `Fefe-Nayz/avermate`

Primary surfaces:

* `apps/web` — **authoritative product/UI/UX reference**
* `apps/mobile` — React Native / Expo application to rebuild
* `apps/server` — backend/API
* shared packages such as `@avermate/core`

The current working tree is the source of truth. The expected development line is the `rewrite` work, but **do not blindly reset, checkout, clean, overwrite or discard local changes**. Inspect the current worktree first and preserve anything not authored by you.

---

# THE MOST IMPORTANT INTERPRETATION OF THIS GOAL

This is **NOT yet the “make it more native / Apple-like / platform-specific” pass**.

That will happen in a separate goal **after this one**.

For this goal, the priority is:

> **Rebuild `apps/mobile` so that it reproduces the current web application on a phone-sized viewport as faithfully as technically possible, in real React Native/Expo code, with complete feature parity and essentially no missing interaction or detail.**

The web app is the reference.

The existing mobile app is **not** the reference.

You are explicitly allowed — and expected — to rewrite large parts or almost all of `apps/mobile` when that is the cleanest way to achieve parity.

Do not preserve bad mobile architecture, layouts, navigation or components simply to minimize the diff.

At the end of this goal, putting:

1. the web app in a phone-sized browser viewport, and
2. the Expo application on an equivalent device

side-by-side should reveal **no meaningful unexplained difference** in layout, information architecture, styling, features, states or interactions.

This includes details that are easy to dismiss as “polish”.

**Nothing is considered too small to matter.**

---

# 0. MANDATORY: READ AND USE THE REPOSITORY SKILLS FIRST

Before implementing anything, recursively inspect the working tree for instructions and skills, including at minimum:

* `.agents/**`
* `.claude/**`
* every relevant `SKILL.md`
* `AGENTS.md`
* `CLAUDE.md`
* nested agent instructions
* repository-specific development instructions

The worktree may contain skills that are not present on the remote branch. **The local filesystem wins.**

You MUST actively use every skill relevant to this task.

In particular, search for skills concerning areas such as:

* React Native
* Expo
* Expo Router
* UI engineering
* UI/UX
* design systems
* responsive design
* animation
* gesture handling
* drag and drop
* navigation
* charts/data visualization
* performance
* accessibility
* testing
* visual review
* design review
* frontend engineering

Do not merely acknowledge that the skills exist.

Read them and follow them.

If the same or related skill appears under both `.agents` and `.claude`, inspect the applicable copies and follow the most relevant/current instructions.

In the final report, explicitly list the skill files you actually read and applied.

**Do not start coding before this inspection.**

Do not stop and ask me for confirmation after the inspection. Continue directly into the work.

---

# 1. FIRST FIX THE MOBILE APP SO IT ACTUALLY RUNS

The React Native application currently does not reliably start.

Before judging UI parity, establish a trustworthy baseline.

Diagnose the real cause rather than papering over errors.

Inspect:

* monorepo/workspace resolution
* Bun dependencies
* Expo configuration
* Expo Router configuration
* Metro configuration
* React Native package compatibility
* native modules
* Babel/config plugins if applicable
* environment handling
* auth initialization
* API initialization
* imports from shared packages
* circular imports
* runtime exceptions
* route initialization
* fonts/assets
* development build requirements
* Android-specific failures
* iOS-specific failures where testable

Keep Expo.

Do **not** eject the application from Expo.

Do not replace the application with a WebView.

Do not solve startup problems by deleting functionality.

Once repaired, establish that the application genuinely boots before moving on.

---

# 2. AUDIT THE CURRENT PRODUCT, NOT YOUR MEMORY OF IT

Do not make a list of features from assumptions.

Systematically derive it from the repository.

## Inspect the current web application

Inventory every user-facing web route, nested route, feature, component family and important interaction.

Include authenticated and unauthenticated surfaces.

Examples include, but are absolutely not limited to:

* sign in
* sign up
* password recovery
* onboarding
* dashboard
* grades
* grade details
* subjects
* subject details
* averages
* custom averages
* goals
* insights
* reviews
* announcements
* settings
* account/profile
* themes
* chart settings
* admin surfaces
* card/widget/template systems
* social features
* every modal
* every drawer/sheet
* every context action
* every editor
* every chart
* every timeline
* every filter
* every selector
* every empty state
* every loading state
* every error state
* every destructive confirmation
* every toast/notification
* every responsive mobile-only presentation

Do not assume an existing mobile screen means parity already exists.

Compare the actual implementations.

---

# 3. AUDIT RECENT COMMITS SO NOTHING NEW IS MISSED

The web product has changed significantly while mobile has lagged behind.

Inspect the Git history in detail.

At minimum:

* inspect the commits from the last several days on the current rewrite line
* inspect commits touching `apps/web`
* inspect relevant commits touching shared packages/server contracts
* inspect the history of `apps/mobile`
* identify approximately where mobile last had parity
* inspect actual diffs, not only commit titles

Useful approaches include variants of:

`git log --since="10 days ago" -- apps/web apps/server packages`

and comparisons between the current web implementation and the point where the corresponding mobile feature was last updated.

The commit audit is a **safety net**, not the primary source of truth.

The final current state of `apps/web` is authoritative even if the feature predates the recent commit window.

Build a comprehensive parity matrix.

For every web feature, record internally:

* source route/component
* corresponding mobile route/component
* visual parity
* behavioral parity
* data/API parity
* loading parity
* empty/error parity
* interaction parity
* test/verification status

You may maintain this as something like:

`docs/mobile-web-parity.md`

but producing a document is **not** the task.

The task is to eliminate every unchecked row.

---

# 4. REBUILD MOBILE FROM THE WEB DESIGN, NOT FROM THE CURRENT MOBILE DESIGN

Treat the current `apps/mobile` UI as disposable where necessary.

For each surface, start by studying the corresponding web implementation.

Recover the actual web design language:

* spacing
* typography
* font weights
* line heights
* card sizes
* card hierarchy
* border widths
* border colors
* corner radii
* shadows
* backgrounds
* translucency
* opacity
* muted colors
* semantic colors
* icon choices
* icon sizes
* icon stroke widths
* section spacing
* heading hierarchy
* control heights
* horizontal padding
* page padding
* grid gaps
* list gaps
* chart dimensions
* button hierarchy
* destructive styles
* disabled styles
* pressed styles
* active styles
* focus/selected styles
* skeletons
* placeholders
* dividers
* separators
* badges
* pills
* tooltips
* popovers
* sheets
* menus
* dialogs
* transitions
* animations

Do not create a second “mobile design system” by eye.

Derive values from the web implementation and centralize equivalent React Native tokens/primitives where useful.

The app must very clearly look like **the same Avermate design system**, not an unrelated React Native interpretation of Avermate.

---

# 5. RESPONSIVE LAYOUT PARITY IS REQUIRED

The primary visual reference is **the web application at mobile breakpoints**, not its desktop layout squeezed onto a phone.

Run the web app and inspect it at realistic phone widths.

At minimum verify representative layouts around:

* 360 logical px
* 393 logical px
* 412 logical px

Use the actual web responsive behavior as reference.

Match:

* component order
* wrapping
* stacking
* width behavior
* horizontal scrolling where intentional
* sticky/fixed elements
* bottom spacing
* viewport-relative elements
* page headers
* toolbar behavior
* card reflow
* chart sizing
* responsive text
* hidden/expanded content
* mobile drawers
* compact controls

If a web feature is intentionally presented differently on mobile, reproduce the **mobile web variant**.

If a feature exists on desktop web but is simply inaccessible on narrow web widths and therefore has no true mobile design, **do not silently omit the feature**.

Feature completeness is mandatory.

In that exceptional case, design the narrow-screen presentation using the existing web design language with the smallest possible adaptation.

Document these exceptional cases.

---

# 6. FEATURE PARITY MEANS ACTUAL FEATURE PARITY

A screen that “looks similar” but cannot do the same things is not complete.

Every relevant capability from the web app must work in React Native.

This includes:

* create
* edit
* delete
* duplicate
* reorder
* drag
* resize where applicable
* filtering
* sorting
* searching
* navigation
* drill-down
* selection
* multi-selection if applicable
* forms
* validation
* date selection
* number editing
* toggles
* segmented controls
* dropdown/select equivalents
* menus
* confirmations
* image/media actions
* sharing/exporting if present
* state restoration
* user preferences
* custom themes
* localization
* auth/session behavior
* role-based access
* admin functionality
* deep links where appropriate

Do not produce read-only mockups of interactive web features.

Do not leave buttons disconnected because “the layout is done”.

Do not leave `TODO` implementations.

Do not use placeholder data where the web uses live data.

---

# 7. CHARTS REQUIRE A DEDICATED, DEEP REIMPLEMENTATION

The current React Native charts are far too different from the web implementation.

Treat chart parity as a major sub-project, not a styling task.

Study every current web chart in detail.

Reproduce:

* identical datasets
* series selection
* calculation semantics
* scale semantics
* domains
* axis placement
* tick generation
* tick formatting
* label formatting
* grid lines
* curves
* paths
* line widths
* points/symbols
* fills
* gradients
* reference lines
* target lines
* current-value markers
* legends
* tooltip content
* tooltip grouping
* tooltip ordering
* tooltip styling
* selected state
* hover/touch equivalent behavior
* series toggles
* child-series behavior
* zoom presets where present
* zoom limits
* panning
* gesture semantics
* rewind/history scrubbing
* scrubber appearance
* scrubber ticks
* selection indicators
* animations
* empty/error/loading states
* responsive sizing

Recent web behaviors and visual refinements must not be missed merely because the mobile chart predates them.

Do not approximate a complex web chart with a generic line chart.

Do not replace charts with screenshots.

Do not embed the web chart in a WebView.

Implement a genuine React Native equivalent, using SVG/Skia/gesture primitives or another well-maintained Expo-compatible solution as appropriate.

If choosing or adding a chart-related dependency, research its:

* maintenance status
* Expo compatibility
* React Native compatibility
* gesture support
* animation support
* accessibility implications
* performance

Prefer sharing **pure calculation/domain logic** with the web app where possible rather than duplicating algorithms.

The pixels may be rendered differently, but the visual result and interaction model must match.

---

# 8. DRAG AND DROP / DIRECT MANIPULATION MUST BE REAL

The web application uses interactions that do not translate automatically from DOM libraries such as `dnd-kit`.

Do not remove those capabilities from mobile.

Reimplement equivalent interactions using appropriate React Native primitives, likely involving the existing gesture/animation stack or another compatible solution.

For every draggable/reorderable item reproduce:

* pickup behavior
* touch target
* visual lift/selected state
* drag preview
* movement
* collision/reorder semantics
* autoscroll if needed
* drop target feedback
* cancellation
* final animation
* persisted order
* disabled states

The visual treatment must still match web.

Touch is not an excuse to replace drag-and-drop with a completely different feature in this phase unless there is a genuine technical impossibility.

---

# 9. MICROINTERACTIONS ARE PART OF PARITY

Audit and reproduce the small behaviors.

Examples:

* button pressed states
* card pressed states
* hover-derived states translated sensibly to touch
* accordion motion
* sheet opening/closing
* dialog entrance/exit
* dropdown behavior
* tab indicator movement
* toggles
* counters
* animated values
* chart transitions
* loading transitions
* selection transitions
* reorder animations
* scrubbers
* progress indicators
* disclosure icons
* opacity transitions
* scale transitions
* success/error feedback
* toast timing
* toast placement

Match the web duration/easing/visual intent where applicable.

Animations must remain smooth and must not block the JS thread unnecessarily.

---

# 10. NAVIGATION MUST MATCH PRODUCT STRUCTURE AND MUST NOT FEEL BROKEN

The existing Android navigation/return transitions have previously felt particularly poor.

For this goal, do **not** invent a new native navigation concept.

Instead:

1. reproduce the web information architecture,
2. reproduce its page hierarchy,
3. reproduce expected back behavior,
4. remove visibly inappropriate default transitions if they make the native application feel unlike the web reference,
5. ensure modal vs page semantics match the web product.

If the web navigation is effectively instantaneous, an intrusive default Android page animation is **not** considered parity.

Expo Router may remain the routing foundation.

Navigation must correctly handle:

* tabs if the web mobile design uses them
* pushes
* back
* replacement
* authentication redirects
* onboarding redirects
* modal routes
* deep links
* nested pages
* state preservation
* scroll restoration where appropriate

No duplicate screens should accumulate from incorrect router usage.

Android's system back gesture/button must behave correctly.

---

# 11. FORMS, MENUS, DIALOGS AND OVERLAYS MUST MATCH

Do not substitute every web control with a stock platform control merely because this is React Native.

**The native-platform redesign comes later.**

During this phase, visual parity wins.

Forms must match:

* input dimensions
* typography
* labels
* descriptions
* errors
* leading/trailing icons
* number fields
* password visibility
* textarea behavior
* disabled state
* loading state
* validation behavior

Overlays must match:

* sheet vs dialog semantics
* size
* spacing
* backdrop
* corners
* drag handle if present
* heading hierarchy
* close behavior
* keyboard behavior
* scroll behavior
* action placement

Use real React Native components, not HTML/WebViews.

---

# 12. REUSE THE RIGHT THINGS

Do not duplicate domain logic unnecessarily.

Prefer sharing or extracting pure cross-platform logic for:

* schemas
* API contracts
* queries
* calculations
* grade mathematics
* averages
* goal calculations
* date logic
* number formatting rules
* chart data transformations
* permissions
* constants
* design tokens where practical
* translations

Use `@avermate/core` and other shared packages where they are intended to be shared.

But do not force DOM components into React Native.

Do not build an abstraction layer so complicated that parity becomes harder.

Share **logic and tokens**, not platform-specific rendering code unless it is genuinely universal.

---

# 13. DATA AND SERVER BEHAVIOR MUST MATCH WEB

For every migrated screen compare actual network/data behavior with web.

Check:

* ORPC calls
* TanStack Query keys
* cache invalidation
* optimistic updates
* mutations
* error handling
* retries
* permissions
* authentication
* session refresh
* offline/reconnect behavior where already supported
* initial loading
* subsequent loading
* refresh
* stale data handling

The mobile app must not invent a second data model.

A feature is not complete if it only works after a full restart or if a mutation does not update related views.

---

# 14. AUTHENTICATION MUST BE COMPLETE

Verify all supported auth flows end-to-end.

At minimum inspect:

* sign in
* sign up
* OAuth/social login if supported
* forgot password
* email verification flows if applicable
* session restoration
* logout
* expired sessions
* unauthorized API responses
* deep-link callbacks
* onboarding gating
* authenticated route gating
* admin gating

Do not break secure storage while restructuring the app.

Do not work around auth problems by disabling route protection.

---

# 15. LOCALIZATION AND FORMATTING MUST MATCH

The web application supports localization.

React Native must use the same translations and semantics wherever possible.

Audit:

* French
* English
* plurals
* date formatting
* number formatting
* decimal separators
* percentages
* grade formatting
* relative time
* labels
* button copy
* error strings
* empty states
* accessibility labels

Do not leave English hardcoded in newly ported components.

---

# 16. LIGHT/DARK/THEME PARITY

Reproduce every currently supported appearance mode and theme behavior exposed by the web product.

Verify:

* light
* dark
* system
* custom theme values if still supported
* semantic colors
* chart colors
* overlay colors
* status/navigation backgrounds necessary to avoid visual seams

Theme changes should update the app without requiring a restart unless the web feature explicitly behaves otherwise.

---

# 17. DO NOT REGRESS EXISTING MOBILE-ONLY FUNCTIONALITY

Although the visual reference is the web application, inspect any existing legitimate mobile-only capabilities before deleting code.

If `apps/mobile` already has useful functionality such as:

* native widgets
* share integration
* media integration
* secure persistence
* deep-link infrastructure

preserve it unless it conflicts with this goal.

However, such extras must not dictate the primary application design.

---

# 18. RESEARCH COMPONENTS WHEN NECESSARY

If React Native lacks an equivalent primitive, you may research maintained universal/React Native components.

Do this carefully.

Prefer:

* maintained libraries
* Expo-compatible libraries
* libraries supporting the current React Native generation
* libraries compatible with the repository's animation/gesture stack
* accessible implementations
* libraries with clear source code and active maintenance

Do not add abandoned dependencies to save an hour.

Do not replace a high-quality existing implementation with a dependency that produces visibly worse parity.

Repository skills should guide these choices.

---

# 19. WEB CHANGES ARE ALLOWED, BUT THIS IS NOT A WEB REDESIGN

While comparing implementations, you may discover genuine bugs or inconsistencies in the web version.

You may fix an objectively broken web behavior when:

* it is clearly a bug,
* it blocks a shared implementation,
* or it is an obvious inconsistency encountered during parity work.

If you fix the web version, the React Native version must reproduce the corrected behavior.

Do **not** use this task as an excuse to redesign the web UI.

The upcoming native-design pass is also not part of this task.

Stay focused.

---

# 20. VISUAL VALIDATION IS MANDATORY

Do not evaluate parity from source code alone.

Actually run both applications.

Use the available browser/device/emulator/screenshot tooling and any relevant repository skill.

Capture corresponding states.

Compare them side-by-side.

Where possible use screenshot overlays/diffs.

Test representative devices such as approximately:

* 360×800
* 393×852
* 412×915

Check at least:

* light theme
* dark theme
* French
* English
* populated data
* sparse data
* empty data
* loading
* error states

For every major screen verify:

* top offset
* page padding
* header position
* card width
* card height
* component order
* gaps
* typography
* wrapping
* icon alignment
* chart geometry
* bottom spacing
* scroll extent
* overlays
* keyboard avoidance
* safe-area behavior

“Looks close enough” is not sufficient if the discrepancy can reasonably be fixed.

---

# 21. TEST INTERACTIONS, NOT JUST SCREENSHOTS

For every major user flow exercise the functionality.

Examples:

* create a grade
* edit it
* delete it
* navigate to its details
* update a subject
* manipulate averages
* manipulate goals
* interact with all relevant charts
* zoom/pan/scrub where supported
* reorder draggable UI
* change settings
* change language
* change theme
* log out/in
* complete onboarding
* use announcements
* exercise admin features with the appropriate account/data
* test destructive confirmations
* test errors
* test refresh/reload behavior

Use representative data.

Do not call a feature “ported” merely because its screen renders.

---

# 22. PERFORMANCE MATTERS DURING THE REWRITE

Even before the dedicated native-polish pass, the parity implementation must be performant.

Avoid:

* unnecessary rerenders
* giant unvirtualized lists
* layout thrashing
* work performed every animation frame in JS when avoidable
* excessive React state during gestures
* recreating heavy chart structures unnecessarily
* expensive synchronous calculations during render
* giant images
* repeated network queries
* animation work on the JS thread when it can remain on the UI thread

Interactions should remain smooth on realistic Android hardware, not only a desktop simulator.

Do not sacrifice correctness for premature optimization, but do not knowingly ship obviously poor architecture.

---

# 23. ACCESSIBILITY MUST NOT BE DESTROYED FOR VISUAL PARITY

Preserve or improve:

* accessible names
* roles
* disabled states
* selected states
* logical reading order
* touch targets
* screen reader semantics
* sufficient contrast
* text scaling resilience where practical
* reduced-motion handling if the app supports it

Visual parity does not justify inaccessible controls.

---

# 24. FORBIDDEN SHORTCUTS

Do NOT:

* wrap the website in a WebView
* iframe/embed the web application
* use screenshots as UI
* ship placeholder charts
* replace complicated features with static cards
* remove features because they are difficult on mobile
* leave buttons disconnected
* leave fake data
* leave commented-out substitutes
* leave `TODO` functionality
* ignore recent web changes
* approximate chart semantics without inspecting the real implementation
* claim parity based only on TypeScript passing
* preserve broken existing mobile architecture merely to minimize changes
* redesign the app into an unrelated “native-looking” product during this goal
* switch away from Expo
* silently drop Android support
* silently drop iOS support
* silently delete existing user-facing features
* reset or discard unrelated local work

No feature may be declared impossible simply because its web dependency is DOM-specific.

Reimplement the behavior using React Native primitives.

---

# 25. ENGINEERING QUALITY

The result should feel like a deliberate rewrite, not a pile of patches.

Aim for:

* clear component boundaries
* reusable primitives
* centralized design tokens
* consistent state handling
* typed APIs
* no unnecessary `any`
* no duplicated business logic
* no dead compatibility layers
* no stale alternative implementations
* no large commented-out old UI trees
* no console noise
* useful tests for important pure logic
* maintainable chart architecture
* maintainable gesture architecture

Delete obsolete mobile implementation code once the replacement is proven.

Do not keep two competing UI systems alive indefinitely.

---

# 26. VALIDATION / QUALITY GATES

Discover and use the repository's actual scripts rather than guessing them.

At minimum, before considering the goal complete, run everything applicable for the changed workspace:

* install/dependency validation
* TypeScript checks
* tests
* lint/format checks where configured
* Expo diagnostics
* mobile tests
* web tests affected by shared changes
* server/shared tests affected by shared changes
* an actual Expo startup
* Android runtime/build validation when the environment supports it
* iOS validation when the environment supports it
* production/export/build checks where meaningful

Resolve relevant warnings and errors.

A successful `tsc --noEmit` alone is not evidence that the application works.

The app must actually launch.

---

# 27. DEFINITION OF DONE

This task is complete only when all of the following are true:

* `apps/mobile` reliably starts.
* The application is still Expo-based.
* The current web product has been exhaustively inventoried.
* Recent relevant commits have been audited.
* Every meaningful web feature has a functioning mobile implementation.
* No major route is absent.
* No important action is a placeholder.
* The mobile information architecture matches the web product.
* Mobile layouts closely match the responsive web implementation.
* Typography closely matches.
* Spacing closely matches.
* Colors closely match.
* Component hierarchy closely matches.
* Dialogs/sheets closely match.
* Menus closely match.
* Loading states match.
* Error states match.
* Empty states match.
* Charts closely match visually.
* Charts match semantically.
* Chart interactions work.
* Drag-and-drop/reordering works where required.
* Forms and validation work.
* Authentication works.
* Localization works.
* themes work.
* Recent web features are present.
* Android navigation/back behavior is correct and no longer visibly broken.
* There are no known startup crashes.
* There are no known major runtime crashes.
* Relevant tests pass.
* Actual major flows have been manually/automatically exercised.
* Representative screenshots have been compared with web.
* There are no remaining unchecked parity items except a genuinely external/environmental blocker that you can demonstrate precisely.

Do not stop at “90%”.

Do not stop after the dashboard.

Do not stop after the most visible screens.

Do not stop after a first UI pass.

Continue through the entire product.

---

# 28. IMPORTANT SCOPE BOUNDARY FOR THE NEXT GOAL

Once this goal is finished, **then** we will perform a second dedicated pass whose purpose will be to take advantage of React Native/Expo and native platform capabilities:

* native navigation refinement
* platform-specific interaction refinements
* deeper Android/iOS integration
* premium native components
* Apple-quality polish
* native menus
* native sheets where appropriate
* better haptics
* platform-specific transitions
* richer system integration
* other “best of native” improvements

**Do not prematurely perform that redesign now if it would cause the UI to diverge from the web reference.**

First establish an extremely high-quality, feature-complete, visually faithful React Native baseline.

Parity first.

Native reinterpretation second.

---

# 29. FINAL REPORT

Do not give me a vague completion message.

When the implementation is genuinely finished, report:

1. the root cause(s) that prevented the mobile app from starting;
2. the major parts of `apps/mobile` that were rebuilt;
3. the web features that were newly ported;
4. the chart work performed;
5. the interaction/drag-and-drop work performed;
6. navigation changes;
7. shared logic extracted/reused;
8. any legitimate web bugs fixed during comparison;
9. the exact skills from `.agents` / `.claude` that you read and applied;
10. tests/checks/builds actually executed and their results;
11. platforms/devices actually exercised;
12. visual parity validation performed;
13. any remaining limitation, with concrete evidence.

If you discover unfinished parity work while preparing that report, **go back and finish it instead of listing it as a casual follow-up**.

The expected outcome is not “a better mobile app”.

The expected outcome is:

> **Avermate's complete current web product, faithfully rebuilt in React Native/Expo for a mobile form factor, with essentially every visible detail, interaction, feature and state reproduced, tested and working — providing a clean baseline for a separate native-specific polish pass afterward.**
