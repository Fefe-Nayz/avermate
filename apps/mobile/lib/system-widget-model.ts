export type SystemWidgetMode = "average" | "activity" | "balanced";

/**
 * Device-local consent for the operating-system widget.
 *
 * This deliberately has no social/group option. A home-screen extension is a
 * poor boundary for data shared by another person, so its payload is limited
 * to aggregates computed from the signed-in student's own local snapshot.
 */
export interface SystemWidgetPreference {
  enabled: boolean;
  mode: SystemWidgetMode;
}

export const DEFAULT_SYSTEM_WIDGET_PREFERENCE: SystemWidgetPreference = {
  enabled: false,
  mode: "balanced",
};

export interface SystemWidgetSource {
  averageRatio: number | null;
  scale: number;
  decimals: number;
  gradeCount: number;
  activityStreak: number;
  updatedAt: Date;
}

/** JSON-only: this is the complete value crossing into the app-group store. */
export interface SystemWidgetPayload {
  state: "disabled" | "empty" | "ready";
  mode: SystemWidgetMode;
  eyebrow: string;
  primary: string;
  primaryLabel: string;
  secondary: string;
  secondaryLabel: string;
  updatedLabel: string;
  /** The extension marks these strings privacy-sensitive for lock redaction. */
  containsAcademicData: boolean;
}

export function parseSystemWidgetPreference(
  value: string | null,
): SystemWidgetPreference {
  if (!value) return DEFAULT_SYSTEM_WIDGET_PREFERENCE;
  try {
    const parsed = JSON.parse(value) as Partial<SystemWidgetPreference>;
    const mode: SystemWidgetMode =
      parsed.mode === "average" ||
      parsed.mode === "activity" ||
      parsed.mode === "balanced"
        ? parsed.mode
        : "balanced";
    return { enabled: parsed.enabled === true, mode };
  } catch {
    return DEFAULT_SYSTEM_WIDGET_PREFERENCE;
  }
}

function formatAverage(
  ratio: number | null,
  scale: number,
  decimals: number,
  locale: "fr" | "en",
): string | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.max(0, Math.min(3, decimals)),
    minimumFractionDigits: Math.max(0, Math.min(3, decimals)),
  }).format(ratio * scale)}/${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(scale)}`;
}

function updatedLabel(date: Date, locale: "fr" | "en"): string {
  if (!Number.isFinite(date.getTime())) return locale === "fr" ? "À jour" : "Up to date";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildSystemWidgetPayload(
  preference: SystemWidgetPreference,
  source: SystemWidgetSource | null,
  locale: "fr" | "en",
): SystemWidgetPayload {
  const copy =
    locale === "fr"
      ? {
          app: "Avermate",
          disabled: "Ouvrez Avermate pour activer ce widget",
          noData: "Ajoutez une première note",
          average: "Moyenne générale",
          grades: "Notes enregistrées",
          streak: "Jours d’activité",
          upToDate: "À jour",
        }
      : {
          app: "Avermate",
          disabled: "Open Avermate to enable this widget",
          noData: "Add your first grade",
          average: "General average",
          grades: "Grades recorded",
          streak: "Active days",
          upToDate: "Up to date",
        };

  if (!preference.enabled) {
    return {
      state: "disabled",
      mode: preference.mode,
      eyebrow: copy.app,
      primary: copy.disabled,
      primaryLabel: "",
      secondary: "",
      secondaryLabel: "",
      updatedLabel: copy.upToDate,
      containsAcademicData: false,
    };
  }

  const average = source
    ? formatAverage(source.averageRatio, source.scale, source.decimals, locale)
    : null;
  if (!source || (source.gradeCount === 0 && average === null)) {
    return {
      state: "empty",
      mode: preference.mode,
      eyebrow: copy.app,
      primary: copy.noData,
      primaryLabel: "",
      secondary: "",
      secondaryLabel: "",
      updatedLabel: copy.upToDate,
      containsAcademicData: false,
    };
  }

  const count = new Intl.NumberFormat(locale).format(source.gradeCount);
  const streak = new Intl.NumberFormat(locale).format(source.activityStreak);
  const primaryIsActivity = preference.mode === "activity";
  const secondaryIsStreak = preference.mode === "balanced";

  return {
    state: "ready",
    mode: preference.mode,
    eyebrow: copy.app,
    primary: primaryIsActivity ? count : (average ?? "—"),
    primaryLabel: primaryIsActivity ? copy.grades : copy.average,
    secondary: secondaryIsStreak ? streak : count,
    secondaryLabel: secondaryIsStreak ? copy.streak : copy.grades,
    updatedLabel: updatedLabel(source.updatedAt, locale),
    containsAcademicData: true,
  };
}

/**
 * A defensive allow-list at the final serialization boundary. Even if the
 * source model grows later, friend names, class names and grade rows cannot be
 * accidentally spread into the extension payload.
 */
export function serializeSystemWidgetPayload(
  payload: SystemWidgetPayload,
): SystemWidgetPayload {
  return {
    state: payload.state,
    mode: payload.mode,
    eyebrow: payload.eyebrow,
    primary: payload.primary,
    primaryLabel: payload.primaryLabel,
    secondary: payload.secondary,
    secondaryLabel: payload.secondaryLabel,
    updatedLabel: payload.updatedLabel,
    containsAcademicData: payload.containsAcademicData,
  };
}
