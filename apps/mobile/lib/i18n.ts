import { getLocales } from "expo-localization";

/**
 * Translation, without a framework.
 *
 * The web app extracts its strings at build time; a native bundle has no such
 * step, and pulling a whole i18n runtime in for two languages and a few
 * hundred strings would cost more than it returns. The English source string
 * is the key, so a missing translation degrades to readable English rather
 * than to a blank.
 */

export type Locale = "fr" | "en";

const fr: Record<string, string> = {
  // ------------------------------------------------------------------- auth
  "Sign in": "Se connecter",
  "Signing in…": "Connexion…",
  "Pick up where you left off.": "Reprenez où vous en étiez.",
  "Create your account": "Créer votre compte",
  "Create account": "Créer le compte",
  "Create an account": "Créer un compte",
  "Free, and your grades stay yours.":
    "Gratuit, et vos notes restent les vôtres.",
  "No account yet?": "Pas encore de compte ?",
  Email: "E-mail",
  Password: "Mot de passe",
  Name: "Nom",
  "That email and password do not match.":
    "Cet e-mail et ce mot de passe ne correspondent pas.",
  "Sign-in failed. Try again.": "La connexion a échoué. Réessayez.",
  "That account could not be created.": "Impossible de créer ce compte.",
  "Use at least 8 characters.": "Utilisez au moins 8 caractères.",

  // ------------------------------------------------------------------ shell
  Home: "Accueil",
  Subjects: "Matières",
  Grades: "Notes",
  Goals: "Objectifs",
  Settings: "Réglages",
  Back: "Retour",
  Cancel: "Annuler",
  Save: "Enregistrer",
  Delete: "Supprimer",
  Continue: "Continuer",
  Search: "Rechercher",
  Today: "Aujourd'hui",
  of: "sur",
  now: "actuellement",
  "This cannot be undone.": "C'est définitif.",

  // -------------------------------------------------------------- dashboard
  Hello: "Bonjour",
  "Hello, {name}": "Bonjour {name}",
  "General average": "Moyenne générale",
  "Whole year": "Année complète",
  Watching: "À surveiller",
  "Latest results": "Derniers résultats",
  "See all": "Tout voir",
  "over this period": "sur cette période",
  "How the year is going": "Comment se passe l'année",
  "Grades recorded": "Notes saisies",
  "Pass rate": "Taux de réussite",
  "Strongest subject": "Meilleure matière",
  "Weakest subject": "Matière la plus faible",
  "Nothing recorded yet.": "Rien de saisi pour l'instant.",
  "Add your first grade and the year starts drawing itself.":
    "Ajoutez votre première note et l'année commence à se dessiner.",
  "Nothing matches.": "Aucun résultat.",
  "Name or subject": "Nom ou matière",
  "Add a year": "Ajouter une année",

  // --------------------------------------------------------------- subjects
  Subject: "Matière",
  Category: "Catégorie",
  "Add a subject": "Ajouter une matière",
  "Add subject": "Ajouter la matière",
  "New subject": "Nouvelle matière",
  "Edit subject": "Modifier la matière",
  "Delete subject": "Supprimer la matière",
  "Subject not found.": "Matière introuvable.",
  "This year has no subjects yet.": "Cette année n'a encore aucune matière.",
  "Add them one by one, or start from a template on the web.":
    "Ajoutez-les une par une, ou partez d'un modèle depuis le web.",
  "This subject is not in the current period.":
    "Cette matière n'existe pas sur la période affichée.",
  "Inside this one": "Ce qu'elle contient",
  "Add a grade here": "Ajouter une note ici",
  "Effect on the general average": "Effet sur la moyenne générale",
  "Without this subject you would be lower.":
    "Sans cette matière, vous seriez plus bas.",
  "Without this subject you would be higher.":
    "Sans cette matière, vous seriez plus haut.",
  "No grade recorded here yet.": "Aucune note ici pour l'instant.",
  Patterns: "Tendances",
  Consistency: "Régularité",
  "How tightly your results cluster": "À quel point vos résultats se ressemblent",
  "Second half vs first": "Seconde moitié vs première",
  "1 grade": "1 note",
  "{count} grades": "{count} notes",
  "{count} subjects": "{count} matières",

  // ----------------------------------------------------------- subject form
  "Short name": "Nom court",
  "Used where space is tight": "Utilisé quand la place manque",
  "Mathematics, Philosophy…": "Mathématiques, Philosophie…",
  "Give this subject a name.": "Donnez un nom à cette matière.",
  "How does it count?": "Comment compte-t-elle ?",
  "Counts once, with its own average and weight":
    "Compte une fois, avec sa propre moyenne et son coefficient",
  "Just a grouping — its children are weighed one by one":
    "Simple regroupement — ses matières sont pondérées une à une",
  Inside: "Dans",
  "Top level": "Premier niveau",
  "Show on the dashboard": "Afficher sur l'accueil",
  "Keeps this one in front of you all year.":
    "La garde sous les yeux toute l'année.",
  "The subject could not be saved.": "Impossible d'enregistrer la matière.",
  "Delete {name}?": "Supprimer {name} ?",
  "Its {count} grades go with it. This cannot be undone.":
    "Ses {count} notes disparaissent avec elle. C'est définitif.",
  "Keep what is inside": "Garder ce qu'elle contient",

  // ----------------------------------------------------------------- grades
  "New grade": "Nouvelle note",
  "Add grade": "Ajouter une note",
  "Edit grade": "Modifier la note",
  "Delete grade": "Supprimer la note",
  "Delete this grade?": "Supprimer cette note ?",
  "Mock exam, chapter 4, oral…": "Bac blanc, chapitre 4, oral…",
  Result: "Résultat",
  "Out of": "Sur",
  Weight: "Coefficient",
  Date: "Date",
  "Which subject is this for?": "Pour quelle matière ?",
  "Give this grade a name.": "Donnez un nom à cette note.",
  "Pick the subject it belongs to.": "Choisissez la matière concernée.",
  "Enter the result you were given.": "Saisissez le résultat obtenu.",
  "A grade cannot be worth more than its maximum.":
    "Une note ne peut pas dépasser son maximum.",
  "The grade could not be saved.": "Impossible d'enregistrer la note.",
  "If you save this": "Si vous enregistrez",
  "general average": "moyenne générale",
  "This grade is made of several parts": "Cette note se décompose en plusieurs parties",
  "Use a single result": "Revenir à une seule note",
  Parts: "Parties",
  Part: "Partie",
  "Part {number}": "Partie {number}",
  "Add a part": "Ajouter une partie",
  "Written, oral…": "Écrit, oral…",
  "Rolls up to": "Donne au total",

  // ------------------------------------------------------------------ goals
  "New goal": "Nouvel objectif",
  "Create goal": "Créer l'objectif",
  "Edit goal": "Modifier l'objectif",
  "Delete goal": "Supprimer l'objectif",
  "Delete this goal?": "Supprimer cet objectif ?",
  "Goal not found.": "Objectif introuvable.",
  "No goals yet": "Aucun objectif",
  "Set a target and Avermate works out what it takes.":
    "Fixez une cible et Avermate calcule ce qu'il faut pour l'atteindre.",
  "Give this goal a name.": "Donnez un nom à cet objectif.",
  "Pass the year, get honours, 14 in maths…":
    "Passer l'année, avoir une mention, 14 en maths…",
  "What is it about?": "Sur quoi porte-t-il ?",
  "The whole year": "Toute l'année",
  "One subject": "Une matière",
  "A custom average": "Une moyenne personnalisée",
  "Custom average": "Moyenne personnalisée",
  "Choose a subject": "Choisissez une matière",
  "Pick what this goal is about.": "Choisissez ce que vise cet objectif.",
  Target: "Cible",
  Period: "Période",
  "A goal you cannot see is a goal you forget.":
    "Un objectif qu'on ne voit pas est un objectif qu'on oublie.",
  "The goal could not be saved.": "Impossible d'enregistrer l'objectif.",
  Reached: "Atteint",
  "Locked in": "Acquis",
  "On track": "En bonne voie",
  "Needs work": "À travailler",
  "Out of reach": "Hors d'atteinte",
  "No data yet": "Pas encore de données",
  "Still to go": "Reste à combler",
  "How to get there": "Comment y arriver",
  "What your next result has to be": "Ce que doit valoir votre prochain résultat",
  "Or a steady run": "Ou une série régulière",
  "1 more result": "1 résultat de plus",
  "{count} more results": "{count} résultats de plus",
  "Where effort pays off most": "Où l'effort paie le plus",
  "Worth up to {gain} on this average":
    "Jusqu'à {gain} sur cette moyenne",
  "The range still open": "Ce qui reste possible",
  "At worst": "Au pire",
  "At best": "Au mieux",

  // ------------------------------------------------------------- goal advice
  "You are there. From here it is about holding it.":
    "Vous y êtes. À partir d'ici, il s'agit de tenir.",
  "Locked in — nothing left this period can take it away.":
    "Acquis — plus rien sur cette période ne peut vous l'enlever.",
  "Even with perfect results from here you would land at {ceiling}. Worth adjusting the target.":
    "Même avec un sans-faute, vous finiriez à {ceiling}. Mieux vaut revoir la cible.",
  "Record a few grades and this will fill in.":
    "Saisissez quelques notes et ceci se remplira.",
  "You are within a rounding error. One decent result does it.":
    "Il vous manque à peine un arrondi. Un bon résultat suffit.",
  "{subject} is where a point moves the most. Getting it to {target} would do it on its own.":
    "C'est en {subject} qu'un point pèse le plus. La monter à {target} suffirait à elle seule.",
  "One more result at {target} gets you there.":
    "Un résultat de plus à {target} et c'est fait.",
  "{count} more results at {target} get you there.":
    "{count} résultats de plus à {target} et c'est fait.",
  "{subject} carries the most weight — a slip there costs you the most.":
    "{subject} pèse le plus lourd — un accroc là vous coûte le plus cher.",
  "{subject} has been slipping. Worth a look.":
    "{subject} recule. Ça vaut le coup d'y regarder.",

  // --------------------------------------------------------------- settings
  Account: "Compte",
  Appearance: "Apparence",
  "Sign out": "Se déconnecter",
  "You will need your password to come back.":
    "Il vous faudra votre mot de passe pour revenir.",
  "Haptic feedback": "Retour haptique",
  "Small taps as you move through the app":
    "De petites vibrations quand vous naviguez",
  Language: "Langue",
  "The app follows your device's light or dark setting.":
    "L'application suit le thème clair ou sombre de votre appareil.",
  "Made for students": "Fait pour les élèves",
  "School year": "Année scolaire",
  "Current year": "Année en cours",
  Periods: "Périodes",
  "1 year": "1 année",
  "{count} years": "{count} années",

  // ------------------------------------------------------------- onboarding
  "Set up your year": "Configurez votre année",
  "You can change all of this later.": "Tout cela reste modifiable ensuite.",
  "Year name": "Nom de l'année",
  Starts: "Début",
  Ends: "Fin",
  "Grades are out of": "Les notes sont sur",
  France: "France",
  Percentage: "Pourcentage",
  Germany: "Allemagne",
  GPA: "GPA",
  "Create year": "Créer l'année",
  "New school year": "Nouvelle année scolaire",
  "The year could not be created.": "Impossible de créer l'année.",

  "How is your year split?": "Comment votre année est-elle découpée ?",
  "Grades will fall into the right one on their own.":
    "Vos notes se rangeront toutes seules dans la bonne.",
  "Three terms": "Trois trimestres",
  "The usual French layout": "Le découpage français habituel",
  "Two semesters": "Deux semestres",
  "Two semesters, cumulative": "Deux semestres, cumulatifs",
  "The second one includes the first": "Le second inclut le premier",
  "Four quarters": "Quatre quadrimestres",
  "No split": "Pas de découpage",
  "One average for the whole year": "Une seule moyenne pour toute l'année",

  "What do you study?": "Qu'étudiez-vous ?",
  "Pick the closest one — you can rename and reweigh everything after.":
    "Prenez le plus proche — tout se renomme et se repondère ensuite.",
  "Start from scratch": "Partir de zéro",
  "Add your own subjects": "Ajoutez vos propres matières",

  "Term 1": "1er trimestre",
  "Term 2": "2e trimestre",
  "Term 3": "3e trimestre",
  "Semester 1": "1er semestre",
  "Semester 2": "2e semestre",
  "Quarter 1": "1er quadrimestre",
  "Quarter 2": "2e quadrimestre",
  "Quarter 3": "3e quadrimestre",
  "Quarter 4": "4e quadrimestre",
};

const dictionaries: Record<Locale, Record<string, string>> = { fr, en: {} };

function detect(): Locale {
  const tag = getLocales()[0]?.languageCode ?? "fr";
  return tag === "en" ? "en" : "fr";
}

let active: Locale = detect();

/**
 * Changing the language has to repaint screens that are mounted but not
 * focused — the tab bar's labels, most visibly. `t()` is a plain function
 * rather than a hook, so nothing subscribes to it; this is the one place that
 * does, and the root layout remounts the tree when it fires.
 */
const listeners = new Set<() => void>();
let revision = 0;

export function setLocale(locale: Locale): void {
  if (locale === active) return;
  active = locale;
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function localeRevision(): number {
  return revision;
}

export function locale(): Locale {
  return active;
}

/** `t("Hello {name}", { name })` — the source string is the key. */
export function t(
  message: string,
  values?: Record<string, string | number>,
): string {
  const translated = dictionaries[active][message] ?? message;
  if (!values) return translated;

  return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
