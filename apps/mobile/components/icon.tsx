import { Icon } from "@expo/ui";
import { usePalette } from "@/lib/theme";

/**
 * Icons, named for what they mean rather than what they look like.
 *
 * Every entry resolves to an SF Symbol on iOS and a Material Symbols vector
 * drawable on Android — the platforms' own icon sets, so a chevron matches the
 * chevrons the OS draws everywhere else. `Icon.select` is what keeps the unused
 * half out of each bundle, and hoisting the calls to module scope means the
 * dynamic import fires once rather than on every render.
 *
 * The one rule: a name here describes a role in this app ("subjects",
 * "locked"), never a shape. That is what makes it safe to change either side
 * without hunting through screens.
 */
const GLYPHS = {
  // Navigation
  home: Icon.select({
    ios: "house",
    android: import("@expo/material-symbols/home.xml"),
  }),
  subjects: Icon.select({
    ios: "square.stack",
    android: import("@expo/material-symbols/stacks.xml"),
  }),
  grades: Icon.select({
    ios: "list.bullet",
    android: import("@expo/material-symbols/list.xml"),
  }),
  goals: Icon.select({
    ios: "flag",
    android: import("@expo/material-symbols/flag.xml"),
  }),
  profile: Icon.select({
    ios: "person.crop.circle",
    android: import("@expo/material-symbols/account_circle.xml"),
  }),
  insights: Icon.select({
    ios: "chart.bar",
    android: import("@expo/material-symbols/query_stats.xml"),
  }),
  review: Icon.select({
    ios: "sparkles",
    android: import("@expo/material-symbols/celebration.xml"),
  }),

  // Structure
  chevronRight: Icon.select({
    ios: "chevron.right",
    android: import("@expo/material-symbols/chevron_right.xml"),
  }),
  chevronDown: Icon.select({
    ios: "chevron.down",
    android: import("@expo/material-symbols/keyboard_arrow_down.xml"),
  }),
  chevronUp: Icon.select({
    ios: "chevron.up",
    android: import("@expo/material-symbols/keyboard_arrow_up.xml"),
  }),
  arrowRight: Icon.select({
    ios: "arrow.right",
    android: import("@expo/material-symbols/arrow_forward.xml"),
  }),

  // Actions
  add: Icon.select({
    ios: "plus",
    android: import("@expo/material-symbols/add.xml"),
  }),
  check: Icon.select({
    ios: "checkmark",
    android: import("@expo/material-symbols/check.xml"),
  }),
  close: Icon.select({
    ios: "xmark.circle.fill",
    android: import("@expo/material-symbols/cancel.xml"),
  }),
  edit: Icon.select({
    ios: "pencil",
    android: import("@expo/material-symbols/edit.xml"),
  }),
  remove: Icon.select({
    ios: "trash",
    android: import("@expo/material-symbols/delete.xml"),
  }),
  search: Icon.select({
    ios: "magnifyingglass",
    android: import("@expo/material-symbols/search.xml"),
  }),
  reorder: Icon.select({
    ios: "line.3.horizontal",
    android: import("@expo/material-symbols/drag_handle.xml"),
  }),
  more: Icon.select({
    ios: "ellipsis",
    android: import("@expo/material-symbols/more_horiz.xml"),
  }),
  settings: Icon.select({
    ios: "slider.horizontal.3",
    android: import("@expo/material-symbols/tune.xml"),
  }),
  refresh: Icon.select({
    ios: "arrow.clockwise",
    android: import("@expo/material-symbols/refresh.xml"),
  }),
  export: Icon.select({
    ios: "square.and.arrow.down",
    android: import("@expo/material-symbols/download.xml"),
  }),
  signOut: Icon.select({
    ios: "rectangle.portrait.and.arrow.right",
    android: import("@expo/material-symbols/logout.xml"),
  }),

  // Domain
  year: Icon.select({
    ios: "graduationcap",
    android: import("@expo/material-symbols/school.xml"),
  }),
  grade: Icon.select({
    ios: "doc.text",
    android: import("@expo/material-symbols/description.xml"),
  }),
  calendar: Icon.select({
    ios: "calendar",
    android: import("@expo/material-symbols/calendar_today.xml"),
  }),
  period: Icon.select({
    ios: "calendar.badge.clock",
    android: import("@expo/material-symbols/date_range.xml"),
  }),
  average: Icon.select({
    ios: "function",
    android: import("@expo/material-symbols/functions.xml"),
  }),
  card: Icon.select({
    ios: "square.grid.2x2",
    android: import("@expo/material-symbols/dashboard_customize.xml"),
  }),
  pinned: Icon.select({
    ios: "pin.fill",
    android: import("@expo/material-symbols/pin.xml"),
  }),

  // Goal advice — each one carries a distinct piece of reasoning
  achieved: Icon.select({
    ios: "checkmark.circle.fill",
    android: import("@expo/material-symbols/check_circle.xml"),
  }),
  locked: Icon.select({
    ios: "lock.fill",
    android: import("@expo/material-symbols/lock.xml"),
  }),
  unreachable: Icon.select({
    ios: "exclamationmark.triangle.fill",
    android: import("@expo/material-symbols/warning.xml"),
  }),
  waiting: Icon.select({
    ios: "hourglass",
    android: import("@expo/material-symbols/hourglass_empty.xml"),
  }),
  close_call: Icon.select({
    ios: "bolt.fill",
    android: import("@expo/material-symbols/bolt.xml"),
  }),
  rising: Icon.select({
    ios: "chart.line.uptrend.xyaxis",
    android: import("@expo/material-symbols/trending_up.xml"),
  }),
  falling: Icon.select({
    ios: "chart.line.downtrend.xyaxis",
    android: import("@expo/material-symbols/trending_down.xml"),
  }),
  steady: Icon.select({
    ios: "repeat",
    android: import("@expo/material-symbols/repeat.xml"),
  }),
  protect: Icon.select({
    ios: "checkmark.shield.fill",
    android: import("@expo/material-symbols/verified_user.xml"),
  }),

  // Settings and chrome
  appearance: Icon.select({
    ios: "paintpalette",
    android: import("@expo/material-symbols/palette.xml"),
  }),
  language: Icon.select({
    ios: "globe",
    android: import("@expo/material-symbols/language.xml"),
  }),
  account: Icon.select({
    ios: "person.text.rectangle",
    android: import("@expo/material-symbols/person.xml"),
  }),
  password: Icon.select({
    ios: "key",
    android: import("@expo/material-symbols/key.xml"),
  }),
  email: Icon.select({
    ios: "envelope",
    android: import("@expo/material-symbols/mail.xml"),
  }),
  feedback: Icon.select({
    ios: "bubble.left",
    android: import("@expo/material-symbols/feedback.xml"),
  }),
  announcement: Icon.select({
    ios: "megaphone",
    android: import("@expo/material-symbols/campaign.xml"),
  }),
  info: Icon.select({
    ios: "info.circle",
    android: import("@expo/material-symbols/info.xml"),
  }),
  legal: Icon.select({
    ios: "doc.plaintext",
    android: import("@expo/material-symbols/gavel.xml"),
  }),
  danger: Icon.select({
    ios: "trash.fill",
    android: import("@expo/material-symbols/delete_forever.xml"),
  }),
  reset: Icon.select({
    ios: "arrow.counterclockwise",
    android: import("@expo/material-symbols/restart_alt.xml"),
  }),
  external: Icon.select({
    ios: "arrow.up.right.square",
    android: import("@expo/material-symbols/open_in_new.xml"),
  }),
  visibility: Icon.select({
    ios: "eye",
    android: import("@expo/material-symbols/visibility.xml"),
  }),
  empty: Icon.select({
    ios: "tray",
    android: import("@expo/material-symbols/widgets.xml"),
  }),
  help: Icon.select({
    ios: "questionmark.circle",
    android: import("@expo/material-symbols/help.xml"),
  }),
} as const;

export type Glyph = keyof typeof GLYPHS;

/**
 * `tone` picks a colour from the palette so call sites never hard-code one;
 * pass `color` only for the band colours, which are computed from a result.
 */
export function Sign({
  glyph,
  size = 20,
  tone = "muted",
  color,
}: {
  glyph: Glyph;
  size?: number;
  tone?: "text" | "muted" | "faint" | "accent" | "positive" | "negative" | "onAccent";
  color?: string;
}) {
  const palette = usePalette();

  const tones = {
    text: palette.text,
    muted: palette.textMuted,
    faint: palette.textFaint,
    accent: palette.accent,
    positive: palette.positive,
    negative: palette.negative,
    onAccent: palette.accentText,
  };

  return <Icon name={GLYPHS[glyph]} size={size} color={color ?? tones[tone]} />;
}
