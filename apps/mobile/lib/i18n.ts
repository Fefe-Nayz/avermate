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
  Averages: "Moyennes",
  "Edit custom averages": "Modifier les moyennes personnalisées",
  "Average not found": "Moyenne introuvable",
  "It may have been deleted, or it belongs to another year.":
    "Elle a peut-être été supprimée ou appartient à une autre année.",
  "Headline average": "Moyenne principale",
  Composition: "Composition",
  Statistics: "Statistiques",
  "Impact by subject": "Impact par matière",
  "Effect on this average": "Effet sur cette moyenne",
  "Feedback detail": "Détail du retour",
  "Social moderation": "Modération sociale",
  "Safety reports": "Signalements de sécurité",
  "Social groups": "Groupes sociaux",
  "Managed presets": "Presets administrés",
  "New managed preset": "Nouveau preset administré",
  "Managed preset": "Preset administré",
  "In progress": "En cours",
  "Feedback triage": "Traitement des retours",
  "Central feedback queue": "File centralisée des retours",
  "Forms and deduplicated automatic errors stay in one role-gated queue. Academic data is never shown here.":
    "Les formulaires et erreurs automatiques dédupliquées restent dans une même file réservée aux rôles autorisés. Aucune donnée scolaire n’y est affichée.",
  Unresolved: "Non résolus",
  Occurrences: "Occurrences",
  Urgent: "Urgent",
  Unassigned: "Non attribué",
  Filters: "Filtres",
  "Subject, route or opaque digest": "Objet, route ou empreinte opaque",
  Status: "État",
  Priority: "Priorité",
  Source: "Source",
  Forms: "Formulaires",
  "Automatic · Web": "Automatique · Web",
  "Automatic · Mobile": "Automatique · Mobile",
  "Automatic · Server": "Automatique · Serveur",
  Assignment: "Attribution",
  "Assigned to me": "Attribués à moi",
  "The feedback queue could not be loaded.":
    "Impossible de charger la file des retours.",
  "{count} items": "{count} éléments",
  "This feedback item could not be loaded.": "Impossible de charger ce retour.",
  "No route": "Aucune route",
  "Opaque error digest": "Empreinte d’erreur opaque",
  "Raw stack traces, arbitrary diagnostic context and academic records stay hidden on mobile.":
    "Les traces brutes, le contexte de diagnostic libre et les dossiers scolaires restent masqués sur mobile.",
  Triage: "Traitement",
  "Assigned administrator": "Administrateur assigné",
  "This item changed elsewhere. Refresh before trying again.":
    "Cet élément a changé ailleurs. Actualisez avant de réessayer.",
  Labels: "Étiquettes",
  "New label": "Nouvelle étiquette",
  "Add label": "Ajouter l’étiquette",
  "Internal comments": "Commentaires internes",
  "No internal comment yet": "Aucun commentaire interne",
  "Add an internal comment": "Ajouter un commentaire interne",
  "Add comment": "Ajouter le commentaire",
  "Audit timeline": "Historique d’audit",
  System: "Système",
  "Publish versioned curriculum updates without overwriting school years that users customized.":
    "Publiez des mises à jour de programme versionnées sans écraser les années scolaires personnalisées par les utilisateurs.",
  "Managed presets could not be loaded.":
    "Impossible de charger les presets administrés.",
  "No managed presets": "Aucun preset administré",
  "Create one stable subject, then publish richer versions over time.":
    "Créez une première matière stable, puis publiez des versions plus riches au fil du temps.",
  "{linked} linked · {customized} customized":
    "{linked} liés · {customized} personnalisés",
  "{count} updates": "{count} mises à jour",
  Published: "Publié",
  "Adoption is counted per school year. A user who customizes a linked preset leaves that preset until they explicitly rejoin.":
    "L’adoption est comptée par année scolaire. Un utilisateur qui personnalise un preset lié le quitte jusqu’à ce qu’il le rejoigne explicitement.",
  "Create preset": "Créer le preset",
  "Preset identity": "Identité du preset",
  "Stable ID": "Identifiant stable",
  "Letters, numbers, underscores and hyphens. This cannot change later.":
    "Lettres, chiffres, tirets bas et tirets. Cet identifiant ne pourra plus changer.",
  Tags: "Étiquettes",
  "Separate tags with commas": "Séparez les étiquettes par des virgules",
  Featured: "Mis en avant",
  "Highlight this preset during onboarding":
    "Mettre ce preset en avant pendant l’accueil",
  "The preset could not be created. Verify stable keys and references.":
    "Impossible de créer le preset. Vérifiez les clés stables et les références.",
  "Publish preset version {version}?":
    "Publier la version {version} du preset ?",
  "Linked years can then adopt this version. Customized years are never overwritten automatically.":
    "Les années liées pourront adopter cette version. Les années personnalisées ne sont jamais écrasées automatiquement.",
  "This managed preset could not be loaded.":
    "Impossible de charger ce preset administré.",
  "Publish new version": "Publier une nouvelle version",
  "Version status": "État de la version",
  "Current version": "Version actuelle",
  State: "État",
  "Restore preset": "Restaurer le preset",
  "Archive preset": "Archiver le preset",
  "Restore this preset?": "Restaurer ce preset ?",
  "Archive this preset?": "Archiver ce preset ?",
  "Existing linked years remain intact. This only changes catalogue availability.":
    "Les années déjà liées restent intactes. Seule la disponibilité dans le catalogue change.",
  Archive: "Archiver",
  Metadata: "Métadonnées",
  "Publication note": "Note de publication",
  "What changed?": "Qu’est-ce qui change ?",
  "Users see this note before deciding whether to adopt the update.":
    "Les utilisateurs voient cette note avant de décider d’adopter la mise à jour.",
  "Version history": "Historique des versions",
  "The preset changed elsewhere or could not be updated.":
    "Le preset a changé ailleurs ou n’a pas pu être mis à jour.",
  Type: "Type",
  Reports: "Signalements",
  "That stable key is already used.": "Cette clé stable est déjà utilisée.",
  "Use a valid stable key and subject name.":
    "Utilisez une clé stable valide et un nom de matière.",
  "Use a unique stable key, a name and an initial subject.":
    "Utilisez une clé stable unique, un nom et une matière initiale.",
  "Subject tree": "Arbre des matières",
  "Stable key: {key}. Keep it unchanged across versions.":
    "Clé stable : {key}. Conservez-la entre les versions.",
  Coefficient: "Coefficient",
  "Remove or move child subjects before changing this category.":
    "Supprimez ou déplacez les matières enfants avant de changer cette catégorie.",
  "Headline subject": "Matière principale",
  "Remove subject and descendants": "Supprimer la matière et ses descendants",
  "Remove this preset subject?": "Supprimer cette matière du preset ?",
  "Its descendants and matching average entries are removed from this draft.":
    "Ses descendants et les entrées de moyenne correspondantes seront retirés de ce brouillon.",
  "Add a subject node": "Ajouter un nœud de matière",
  "Stable key": "Clé stable",
  "Parent category": "Catégorie parente",
  subjects: "matières",
  "No custom averages in this preset.":
    "Aucune moyenne personnalisée dans ce preset.",
  "Coefficient override (blank inherits)":
    "Coefficient remplacé (vide pour hériter)",
  "Include descendants": "Inclure les descendants",
  "Remove custom average": "Supprimer la moyenne personnalisée",
  "Add a custom average": "Ajouter une moyenne personnalisée",
  "First subject": "Première matière",
  "Add custom average": "Ajouter la moyenne personnalisée",
  "Draft problems": "Problèmes du brouillon",
  Advanced: "Avancé",
  "Advanced JSON editor": "Éditeur JSON avancé",
  "The structured editor is safer for stable keys and references.":
    "L’éditeur structuré protège mieux les clés stables et les références.",
  "Raw configuration": "Configuration brute",
  "Apply JSON draft": "Appliquer le brouillon JSON",
  "Invalid JSON configuration.": "Configuration JSON invalide.",
  "The server validates unique keys, hierarchy, coefficients and average references again before publishing.":
    "Le serveur revalide les clés uniques, la hiérarchie, les coefficients et les références de moyenne avant publication.",
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
  "How tightly your results cluster":
    "À quel point vos résultats se ressemblent",
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
  "Give this grade a name.": "Donnez un nom à cette note.",
  "Pick the subject it belongs to.": "Choisissez la matière concernée.",
  "Enter the result you were given.": "Saisissez le résultat obtenu.",
  "A grade cannot be worth more than its maximum.":
    "Une note ne peut pas dépasser son maximum.",
  "The grade could not be saved.": "Impossible d'enregistrer la note.",
  "If you save this": "Si vous enregistrez",
  "general average": "moyenne générale",
  "This grade is made of several parts":
    "Cette note se décompose en plusieurs parties",
  "Use a single result": "Revenir à une seule note",
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
  "What your next result has to be":
    "Ce que doit valoir votre prochain résultat",
  "Or a steady run": "Ou une série régulière",
  "1 more result": "1 résultat de plus",
  "{count} more results": "{count} résultats de plus",
  "Where effort pays off most": "Où l'effort paie le plus",
  "Worth up to {gain} on this average": "Jusqu'à {gain} sur cette moyenne",
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
  "Made for students": "Fait pour les élèves",
  "School year": "Année scolaire",
  "Current year": "Année en cours",
  Periods: "Périodes",
  "1 year": "1 année",
  "{count} years": "{count} années",

  "Custom averages": "Moyennes personnalisées",
  "Dashboard cards": "Cartes du tableau de bord",
  "Profile and password": "Profil et mot de passe",
  "Send feedback": "Envoyer un retour",
  About: "À propos",

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
  "Set up school year": "Configurer l'année scolaire",
  "Finish setup": "Terminer la configuration",
  "Create and continue": "Créer et continuer",
  "Continue setup": "Continuer la configuration",
  "Configure {name}": "Configurer {name}",
  Year: "Année",
  "Step {current} of {total}: {name}": "Étape {current} sur {total} : {name}",
  "Review the dates and grading scale before continuing.":
    "Vérifiez les dates et l'échelle de notation avant de continuer.",
  "The year is created now, so the rest of setup can be resumed.":
    "L'année est créée maintenant afin que la suite puisse être reprise plus tard.",
  "The year could not be saved. Your progress is kept on this device.":
    "Impossible d'enregistrer l'année. Votre progression reste sauvegardée sur cet appareil.",

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
  "Your subjects": "Vos matières",
  "Use a preset, then adapt it, or build your own list.":
    "Utilisez un modèle puis adaptez-le, ou créez votre propre liste.",
  "This year follows a managed preset. Editing a subject makes it a protected custom configuration.":
    "Cette année suit un modèle administré. Modifier une matière la transforme en configuration personnalisée protégée.",
  "The preset could not be applied because existing data still depends on this configuration.":
    "Impossible d'appliquer le modèle, car des données existantes dépendent encore de cette configuration.",
  "This replaces the current subjects and averages. Avermate blocks the operation if any grade could be deleted.":
    "Cela remplace les matières et moyennes actuelles. Avermate bloque l'opération si une note risque d'être supprimée.",
  "Add at least one subject before continuing.":
    "Ajoutez au moins une matière avant de continuer.",
  "No subjects yet": "Aucune matière pour l'instant",
  "Apply a preset above or add the first subject yourself.":
    "Appliquez un modèle ci-dessus ou ajoutez vous-même la première matière.",
  "Weight {value}": "Coefficient {value}",
  "Continue the year setup to use a preset or add subjects yourself.":
    "Poursuivez la configuration de l'année pour utiliser un modèle ou ajouter vos matières.",

  "Your periods": "Vos périodes",
  "Start with a layout, then adjust every exact date.":
    "Partez d'un découpage, puis ajustez précisément chaque date.",
  "One average will cover the whole school year.":
    "Une seule moyenne couvrira toute l'année scolaire.",
  "Periods need a name, must stay within the year, be ordered and not overlap.":
    "Les périodes doivent avoir un nom, rester dans l'année, être ordonnées et ne pas se chevaucher.",
  "The periods could not be saved. Your progress is kept on this device.":
    "Impossible d'enregistrer les périodes. Votre progression reste sauvegardée sur cet appareil.",
  "Remove {name}": "Supprimer {name}",
  "Add another period": "Ajouter une autre période",
  "This year could not be loaded": "Impossible de charger cette année",
  "Your saved progress has not been removed.":
    "Votre progression enregistrée n'a pas été supprimée.",
  "Discard saved setup?": "Abandonner la configuration enregistrée ?",
  "The year stays in your account, but this device will stop offering to resume its setup.":
    "L'année reste dans votre compte, mais cet appareil ne proposera plus de reprendre sa configuration.",
  "Discard saved setup": "Abandonner la configuration enregistrée",
  Discard: "Abandonner",
  "Another setup is in progress": "Une autre configuration est en cours",
  "Choose which setup to continue. Nothing is discarded automatically.":
    "Choisissez la configuration à poursuivre. Rien n'est abandonné automatiquement.",
  "Saved at step {step}": "Enregistrée à l'étape {step}",
  "Resume {name}": "Reprendre {name}",
  "Configure this year instead": "Configurer plutôt cette année",
  "Replace the saved setup?": "Remplacer la configuration enregistrée ?",
  "The other year stays in your account. Only its unfinished setup progress on this device is discarded.":
    "L'autre année reste dans votre compte. Seule sa progression de configuration inachevée sur cet appareil est abandonnée.",
  Replace: "Remplacer",

  "Term 1": "1er trimestre",
  "Term 2": "2e trimestre",
  "Term 3": "3e trimestre",
  "Semester 1": "1er semestre",
  "Semester 2": "2e semestre",
  "Quarter 1": "1er quadrimestre",
  "Quarter 2": "2e quadrimestre",
  "Quarter 3": "3e quadrimestre",
  "Quarter 4": "4e quadrimestre",

  // ------------------------------------------- statistics, recap and setup
  "1 day": "1 jour",
  "1 result": "1 résultat",
  "1 subject": "1 matière",
  "A bar": "Une barre",
  "A chart": "Un graphique",
  "A custom average can be the target of a goal, so this is also how you track something the school does not compute.":
    "Une moyenne personnalisée peut servir de cible à un objectif — c'est donc aussi comme ça qu'on suit ce que l'établissement ne calcule pas.",
  "A handful of grades and this screen fills in.":
    "Quelques notes et cet écran se remplit.",
  "A list": "Une liste",
  "A question": "Une question",
  "A year that will be hard to beat — including by you.":
    "Une année difficile à battre — y compris par vous.",
  "Activity streak": "Série de jours actifs",
  "Add a period": "Ajouter une période",
  "Add one, or restore the ones the app starts with.":
    "Ajoutez-en une, ou remettez celles d'origine.",
  "All In": "Tapis",
  "All the statistics": "Toutes les statistiques",
  "An idea": "Une idée",
  "Ask away.": "Posez votre question.",
  Average: "Moyenne",
  "Avermate on the web": "Avermate sur le web",
  "Back to the year": "Retour à l'année",
  "Best result": "Meilleure note",
  "Best run this year": "Meilleure série de l'année",
  "Best this year: {count}": "Record de l'année : {count}",
  "Brilliant, then baffling. Never the same twice.":
    "Brillant, puis déroutant. Jamais deux fois pareil.",
  "Bug report": "Bug",
  "Busiest month": "Mois le plus chargé",
  By: "Avant le",
  "Cards are per year, so a new year starts from the defaults.":
    "Les cartes sont propres à chaque année ; une nouvelle année repart des cartes d'origine.",
  "Careless mistakes, missed the last question…":
    "Étourderies, dernière question ratée…",
  "Change email": "Changer l'e-mail",
  "Change password": "Changer le mot de passe",
  "Check your inbox to confirm the new address.":
    "Consultez votre boîte mail pour confirmer la nouvelle adresse.",
  "Close to the line all year, and you never fell off it.":
    "Sur le fil toute l'année, sans jamais tomber.",
  Code: "Code",
  "Consecutive days with a grade recorded":
    "Jours consécutifs avec une note saisie",
  "Consecutive results at or above the passing mark":
    "Résultats consécutifs au-dessus de la moyenne",
  "Counts everything since the start of the year, not just this span.":
    "Compte tout depuis le début de l'année, pas seulement cette période.",
  Cumulative: "Cumulative",
  "Current password": "Mot de passe actuel",
  "Decimal places": "Décimales",
  "Default maximum": "Maximum par défaut",
  "Delete this average": "Supprimer cette moyenne",
  "Delete this card": "Supprimer cette carte",
  "Delete this card?": "Supprimer cette carte ?",
  "Delete this period": "Supprimer cette période",
  Display: "Affichage",
  Done: "Terminé",
  "Edit card": "Modifier la carte",
  "Edit custom average": "Modifier la moyenne",
  Editing: "Modification",
  "Enter the code, then pick something new.":
    "Saisissez le code, puis choisissez un nouveau mot de passe.",
  "The school years could not be reordered.":
    "Impossible de réordonner les années scolaires.",
  "That year could not be archived.": "Impossible d'archiver cette année.",
  "The contents of that year could not be checked.":
    "Impossible de vérifier le contenu de cette année.",
  "This permanently deletes {subjects} subjects, {grades} grades and {periods} periods. This cannot be undone.":
    "Cette action supprime définitivement {subjects} matières, {grades} notes et {periods} périodes. C'est définitif.",
  "School years": "Années scolaires",
  "Reorder the picker, archive old years, or permanently delete one.":
    "Réordonnez le sélecteur, archivez les anciennes années ou supprimez-en une définitivement.",
  Current: "En cours",
  Archived: "Archivée",
  "Move {name} up": "Monter {name}",
  "Move {name} down": "Descendre {name}",
  "Restore {name}": "Restaurer {name}",
  "Archive {name}": "Archiver {name}",
  "Delete {name}": "Supprimer {name}",
  "Restore another year before archiving or deleting the active one.":
    "Restaurez une autre année avant d'archiver ou de supprimer l'année active.",
  "Every year, subject and grade, as JSON.":
    "Toutes vos années, matières et notes, en JSON.",
  "Export everything": "Tout exporter",
  Feedback: "Retour",
  "Fine tuning": "Ajustements",
  Friday: "Vendredi",
  "Give it a deadline": "Fixer une échéance",
  Goal: "Objectif",
  "Goal progress": "Avancement d'un objectif",
  Hidden: "Masquées",
  Hide: "Masquer",
  "High, and it stayed high. That is the hard part.":
    "Haut, et ça l'est resté. C'est ça le plus dur.",
  "How far a typical result sits from your average":
    "L'écart habituel entre un résultat et votre moyenne",
  "How far the average has moved across the period":
    "De combien la moyenne a bougé sur la période",
  "How grades are written": "Comment s'écrivent les notes",
  "How it looks": "Apparence",
  Idea: "Idée",
  "If the trend holds": "Si la tendance se maintient",
  Improvement: "Progression",
  Insights: "Statistiques",
  "It has landed. Every message gets read, even when the reply takes a while.":
    "C'est bien arrivé. Chaque message est lu, même si la réponse peut tarder.",
  "It started badly. That is not how it ended.":
    "Ça avait mal commencé. Ça ne s'est pas fini comme ça.",
  "Its own weight, ×{value}": "Son propre coefficient, ×{value}",
  "Just the number": "Le nombre seul",
  "Latest result": "Dernière note",
  "Leave it empty to use the metric's own name.":
    "Laissez vide pour reprendre le nom de la mesure.",
  "Leave one empty to keep the subject's own coefficient.":
    "Laissez vide pour garder le coefficient de la matière.",
  "Mark as reached": "Marquer comme atteint",
  "Mean result": "Note moyenne",
  "Median result": "Note médiane",
  Message: "Message",
  Metric: "Mesure",
  Monday: "Lundi",
  "Most improved": "Plus grande progression",
  "Move down": "Descendre",
  "Move up": "Monter",
  "Moving the most": "Ce qui bouge le plus",
  "Name updated.": "Nom mis à jour.",
  "New card": "Nouvelle carte",
  "New custom average": "Nouvelle moyenne personnalisée",
  "New password": "Nouveau mot de passe",
  "No cards": "Aucune carte",
  "No custom averages yet": "Aucune moyenne personnalisée",
  "Nobody recorded more than you did.": "Personne n'a saisi plus que vous.",
  "Not enough data yet": "Pas encore assez de données",
  Note: "Remarque",
  "Nothing to show yet": "Rien à afficher pour l'instant",
  "Nothing was deleted.": "Rien n'a été supprimé.",
  "Number and a line": "Le nombre et une courbe",
  Numbers: "Les chiffres",
  "One average for the whole year. Add a period to change that.":
    "Une seule moyenne pour toute l'année. Ajoutez une période pour changer ça.",
  Open: "Ouvrir",
  "Passing mark": "Seuil de réussite",
  "Passing right now": "Série en cours",
  "Passing streak": "Série de réussites",
  "Password changed. Other devices have been signed out.":
    "Mot de passe changé. Vos autres appareils ont été déconnectés.",
  "Period {number}": "Période {number}",
  "Pick a handful of subjects and weigh them your own way — useful when the official average is not the one you care about.":
    "Choisissez quelques matières et pondérez-les à votre façon — utile quand la moyenne officielle n'est pas celle qui vous intéresse.",
  Privacy: "Confidentialité",
  Question: "Question",
  "Record a few more grades and your year gets its recap.":
    "Saisissez encore quelques notes et votre année aura sa rétrospective.",
  "Reopen this goal": "Rouvrir cet objectif",
  "Reset your password": "Réinitialiser votre mot de passe",
  Restore: "Rétablir",
  "Restore the default cards": "Rétablir les cartes d'origine",
  "Restore the defaults?": "Rétablir les cartes d'origine ?",
  Saturday: "Samedi",
  "Save name": "Enregistrer le nom",
  "Saving…": "Enregistrement…",
  "Science average, mock exams…": "Moyenne scientifique, bacs blancs…",
  Scope: "Portée",
  "Second half of the period against the first":
    "Seconde moitié de la période contre la première",
  Send: "Envoyer",
  "Send me a code": "Envoyez-moi un code",
  "Set the new password": "Définir le mot de passe",
  "Slipping the most": "Plus grand recul",
  "Something else": "Autre chose",
  "Something is broken": "Quelque chose ne marche pas",
  Spread: "Dispersion",
  "Spread of results": "Répartition des notes",
  Steadiest: "Plus régulière",
  "Steadiest subjects": "Matières les plus régulières",
  Streaks: "Séries",
  Strong: "Fort",
  Structure: "Structure",
  "Subjects ranked": "Classement des matières",
  "Subjects, best first": "Matières, les meilleures d'abord",
  Sunday: "Dimanche",
  Terms: "Conditions d'utilisation",
  "Thank you": "Merci",
  "That address could not be used.": "Cette adresse n'a pas pu être utilisée.",
  "That code could not be sent. Check the address.":
    "Le code n'a pas pu être envoyé. Vérifiez l'adresse.",
  "That code did not work. It may have expired.":
    "Ce code n'a pas fonctionné. Il a peut-être expiré.",
  "That could not be saved.": "Impossible d'enregistrer.",
  "That could not be sent. Try again in a moment.":
    "L'envoi a échoué. Réessayez dans un instant.",
  "That password could not be changed.":
    "Le mot de passe n'a pas pu être changé.",
  "The Avermatian": "L'Avermatien",
  "The Comeback": "La Remontada",
  "The Legend": "La Légende",
  "The Masterclass": "Le Sans-Faute",
  "The Metronome": "Le Métronome",
  "The Tightrope Walker": "Le Funambule",
  "The Visitor": "Le Visiteur",
  "The Wildcard": "L'Imprévisible",
  "The export could not be prepared.": "L'export n'a pas pu être préparé.",
  "The grades stay; they just stop belonging to a period.":
    "Les notes restent ; elles n'appartiennent simplement plus à une période.",
  "The headline": "L'essentiel",
  "The long version": "La version longue",
  "The same result, again and again. Uncanny.":
    "Le même résultat, encore et encore. Troublant.",
  "The shape of your results": "La forme de vos résultats",
  "The story is still being written.": "L'histoire s'écrit encore.",
  "The subjects are untouched. This cannot be undone.":
    "Les matières ne sont pas touchées. C'est définitif.",
  "The turnaround": "Le redressement",
  "The year itself": "L'année elle-même",
  "This drives the colour of every result and the pass rate.":
    "C'est ce qui détermine la couleur de chaque note et le taux de réussite.",
  "This period is over": "Cette période est terminée",
  Thursday: "Jeudi",
  Title: "Titre",
  "Track your grades, understand what moves your average, and get a plan for the result you are aiming at.":
    "Suivez vos notes, comprenez ce qui fait bouger votre moyenne, et sachez quoi faire pour atteindre le résultat que vous visez.",
  Trend: "Tendance",
  Tuesday: "Mardi",
  "Unweighted — every grade counts once":
    "Sans coefficient — chaque note compte une fois",
  "Version {version}": "Version {version}",
  "We will send a six-digit code to your address.":
    "Nous enverrons un code à six chiffres à votre adresse.",
  Weak: "Faible",
  Wednesday: "Mercredi",
  "Weighted ×{value} here": "Pondérée ×{value} ici",
  "What are you trying to do that the app makes hard?":
    "Qu'essayez-vous de faire que l'application rend compliqué ?",
  "What counts as a pass": "Ce qui compte comme réussite",
  "What did you do, and what happened instead?":
    "Qu'avez-vous fait, et que s'est-il passé à la place ?",
  "What goes in": "Ce qu'elle contient",
  "What it looks at": "Ce qu'elle regarde",
  "What it measures": "Ce qu'elle mesure",
  "Where it lands": "Où ça atterrit",
  "Where the current trend puts you at the end":
    "Où la tendance actuelle vous mène à la fin",
  "Work it out from the date": "Déduire de la date",
  "Worst result": "Moins bonne note",
  "Year in review": "Rétrospective de l'année",
  "You have used this app more than the app expected.":
    "Vous avez utilisé cette application plus que prévu.",
  "You passed through. The year barely knew you were there.":
    "Vous êtes passé par là. L'année vous a à peine vu.",
  "Your current cards are replaced. Nothing else changes.":
    "Vos cartes actuelles sont remplacées. Rien d'autre ne change.",
  "Your data": "Vos données",
  "Your grades are yours. Averages are computed on this device, not on a server, and nothing identifying you is ever compared against anybody else.":
    "Vos notes vous appartiennent. Les moyennes sont calculées sur cet appareil, pas sur un serveur, et rien qui vous identifie n'est jamais comparé à qui que ce soit.",
  "Your message": "Votre message",
  "Your year, told back to you": "Votre année, racontée",
  Yours: "Les vôtres",
  "and counting": "et ça continue",
  "right now": "actuellement",
  "{count} days": "{count} jours",
  "{count} results": "{count} résultats",
  "{count} weeks left in this period":
    "{count} semaines restantes sur cette période",

  // ---------------------------------------------- charts and semantic timeline
  "A semantic date viewport: pan, zoom and inspect without changing the underlying results.":
    "Une fenêtre temporelle sémantique : déplacez, zoomez et inspectez sans modifier les résultats.",
  "Adjust time travel date": "Ajuster la date du voyage temporel",
  "Average over time": "Moyenne au fil du temps",
  "Back to today": "Revenir à aujourd'hui",
  "Drag to pan, pinch or use the wheel to zoom.":
    "Faites glisser pour vous déplacer, pincez ou utilisez la molette pour zoomer.",
  "Each visible series keeps its own nearest real result while you inspect or zoom.":
    "Chaque série visible conserve son propre résultat réel le plus proche pendant l'inspection ou le zoom.",
  Evolution: "Évolution",
  "Every subject resolves its nearest real assessment independently, even on irregular dates.":
    "Chaque matière trouve indépendamment son évaluation réelle la plus proche, même à des dates irrégulières.",
  "Grade results": "Résultats des notes",
  "Hide {name}": "Masquer {name}",
  "Next day": "Jour suivant",
  "Previous day": "Jour précédent",
  "Relevant values": "Valeurs pertinentes",
  "Reset chart view": "Réinitialiser la vue du graphique",
  "Results over time": "Résultats au fil du temps",
  "Show {name}": "Afficher {name}",
  "Showing {date}": "Affichage au {date}",
  "Time travel": "Voyage temporel",
  "Visible chart range": "Plage visible du graphique",
  "{count} grades visible": "{count} notes visibles",

  // --------------------------------------------------------- rich year recap
  "A year of results, habits and momentum — told back to you.":
    "Une année de résultats, d'habitudes et d'élan — racontée pour vous.",
  "Allow photo access to save your recap image.":
    "Autorisez l'accès aux photos pour enregistrer l'image de votre rétrospective.",
  "Close recap": "Fermer la rétrospective",
  "Could not export recap": "Impossible d'exporter la rétrospective",
  Dismiss: "Ignorer",
  "Eligible years": "Années disponibles",
  "Every square is a day you showed up":
    "Chaque case représente un jour où vous étiez là",
  "Favorite day": "Jour préféré",
  "Five grades in a year unlock its recap.":
    "Cinq notes dans une année débloquent sa rétrospective.",
  "Last slide": "Dernière page",
  "Longest streak": "Plus longue série",
  "Mute music": "Couper la musique",
  "My Avermate recap": "Ma rétrospective Avermate",
  "Next slide": "Page suivante",
  "Pause story": "Mettre l'histoire en pause",
  "Photo access needed": "Accès aux photos nécessaire",
  "Play my recap": "Lire ma rétrospective",
  "Please try again.": "Veuillez réessayer.",
  "Preparing…": "Préparation…",
  "Previous slide": "Page précédente",
  "Prime time": "Moment fort",
  "Replay the years that already have enough to tell.":
    "Rejouez les années qui ont déjà assez d'éléments à raconter.",
  "Results added up": "Résultats additionnés",
  "Resume story": "Reprendre l'histoire",
  "Save image": "Enregistrer l'image",
  Saved: "Enregistré",
  Share: "Partager",
  "Share my Avermate recap": "Partager ma rétrospective Avermate",
  "Slide {current} of {total}": "Page {current} sur {total}",
  Student: "Élève",
  "The day your running average reached its high point.":
    "Le jour où votre moyenne cumulée a atteint son sommet.",
  "The title you earned": "Le titre que vous avez obtenu",
  "This compares the habit of recording results, never anyone's grades.":
    "Ce classement compare l'habitude de saisir des résultats, jamais les notes de quiconque.",
  "Top {percent}%": "Top {percent} %",
  "Turn music on": "Activer la musique",
  "Year recap available": "Rétrospective annuelle disponible",
  "Your activity rank": "Votre classement d'activité",
  "Your biggest improvement between the two halves of the year.":
    "Votre plus forte progression entre les deux moitiés de l'année.",
  "Your longest streak": "Votre plus longue série",
  "Your recap image is in your photo library.":
    "L'image de votre rétrospective est dans votre photothèque.",
  "Your recap library": "Vos rétrospectives",
  "Your rhythm": "Votre rythme",
  "Your strongest subjects": "Vos matières les plus fortes",
  "Your year in Avermate": "Votre année dans Avermate",
  "Your {year} recap is ready": "Votre rétrospective {year} est prête",
  "active day": "jour actif",
  "active days in a row": "jours actifs d'affilée",
  "{count} grades, your strongest subjects, your best run and the title you earned.":
    "{count} notes, vos matières les plus fortes, votre meilleure série et le titre obtenu.",
  "{date}: {count} grades": "{date} : {count} notes",
  "{name}'s {year} Avermate recap: {average}, {count} grades, {streak}-day streak.":
    "Rétrospective Avermate {year} de {name} : {average}, {count} notes, série de {streak} jours.",

  "Choose a subject": "Choisissez une matière",
  "No account yet?": "Pas encore de compte ?",
  Parts: "Parties",
  "Theme, language and interaction": "Thème, langue et interactions",
  "Shared with the web app": "Synchronisé avec l'application web",
  Announcements: "Annonces",
  "{count} unread": "{count} non lues",
  "Your inbox": "Votre boîte de réception",
  Administration: "Administration",
  "Open admin console": "Ouvrir la console d'administration",
  "Users, announcements and feedback": "Utilisateurs, annonces et retours",
  "Include nested subjects": "Inclure les sous-matières",
  "Use the results inside this group as well":
    "Utiliser aussi les résultats contenus dans ce groupe",
  Width: "Largeur",
  Quarter: "Quart",
  Half: "Moitié",
  Full: "Pleine largeur",
  "Choose an image smaller than 2 MB.":
    "Choisissez une image de moins de 2 Mo.",
  "Allow photo access to choose an image.":
    "Autorisez l'accès aux photos pour choisir une image.",
  "Choose a PNG, JPEG or WebP image.":
    "Choisissez une image PNG, JPEG ou WebP.",
  "Screenshot (optional)": "Capture d'écran (facultative)",
  "PNG, JPEG or WebP, up to 2 MB.": "PNG, JPEG ou WebP, jusqu'à 2 Mo.",
  "Remove screenshot": "Retirer la capture",
  "Choose a screenshot": "Choisir une capture",
  "Forgot password?": "Mot de passe oublié ?",
  Users: "Utilisateurs",
  User: "Utilisateur",
  "Admin access required": "Accès administrateur requis",
  "This area is restricted to Avermate administrators.":
    "Cette zone est réservée aux administrateurs d'Avermate.",
  Years: "Années",
  "Weekly active": "Actifs sur 7 jours",
  "Open feedback": "Retours ouverts",
  Manage: "Gérer",
  "Name, email or user ID": "Nom, e-mail ou identifiant utilisateur",
  "{count} users": "{count} utilisateurs",
  grades: "notes",
  Banned: "Suspendu",
  Identity: "Identité",
  "User ID": "Identifiant utilisateur",
  "Email verified": "E-mail vérifié",
  Yes: "Oui",
  No: "Non",
  Created: "Créé",
  Access: "Accès",
  Role: "Rôle",
  Administrator: "Administrateur",
  Suspended: "Suspendu",
  "Suspending also signs out every session":
    "La suspension déconnecte également toutes les sessions",
  "No years": "Aucune année",
  Sessions: "Sessions",
  "Unknown device": "Appareil inconnu",
  "Danger zone": "Zone sensible",
  "Delete user permanently": "Supprimer définitivement l'utilisateur",
  "Delete this user?": "Supprimer cet utilisateur ?",
  "New announcement": "Nouvelle annonce",
  Edit: "Modifier",
  "Edit announcement": "Modifier l'annonce",
  Audience: "Audience",
  Everyone: "Tout le monde",
  "All signed-in users": "Tous les utilisateurs connectés",
  "Selected presets": "Presets sélectionnés",
  "Only active linked members": "Uniquement les membres liés actifs",
  "Target presets": "Presets ciblés",
  "Create a managed preset before targeting an announcement.":
    "Créez un preset administré avant de cibler une annonce.",
  "Select at least one preset.": "Sélectionnez au moins un preset.",
  "One preset selected": "Un preset sélectionné",
  "{count} presets selected": "{count} presets sélectionnés",
  "Targeting follows the preset across updates. Customized years leave the audience.":
    "Le ciblage suit le preset au fil des mises à jour. Les années personnalisées quittent l'audience.",
  "Inactive announcements remain drafts":
    "Les annonces inactives restent des brouillons",
  "Save changes": "Enregistrer les modifications",
  "Sent to: {presets}": "Envoyée à : {presets}",
  "Sent to everyone": "Envoyée à tout le monde",
  Tone: "Tonalité",
  Information: "Information",
  Success: "Succès",
  Warning: "Avertissement",
  Danger: "Danger",
  Publish: "Publier",
  History: "Historique",
  Active: "Active",
  Closed: "Fermés",
  All: "Tous",
  "Nothing here": "Rien ici",
  Close: "Fermer",
  Reopen: "Rouvrir",
  "No announcements": "Aucune annonce",
  "Important product messages will appear here.":
    "Les messages importants concernant le produit apparaîtront ici.",
  Inbox: "Boîte de réception",
  "Mark as read": "Marquer comme lue",
  Read: "Lecture",
  "That connection could not be started.":
    "Impossible de démarrer cette connexion.",
  Admin: "Administration",
  "Assistants authenticate with OAuth 2.1 and only receive the permissions you approve.":
    "Les assistants s'authentifient avec OAuth 2.1 et ne reçoivent que les autorisations que vous approuvez.",
  "Authorized connections": "Connexions autorisées",
  "Available scopes": "Permissions disponibles",
  "Avermate MCP": "MCP Avermate",
  "Better Auth does not expose a stable token-list API. Access tokens are therefore never serialized into this page.":
    "Better Auth ne fournit pas d'API stable pour lister les jetons. Les jetons d'accès ne sont donc jamais chargés dans cette page.",
  "Check your connection and try again.":
    "Vérifiez votre connexion et réessayez.",
  "Client ID": "Identifiant client",
  "Client name": "Nom du client",
  "Connect AI assistants with OAuth": "Connecter des assistants IA avec OAuth",
  "Connect AI assistants without sharing your password.":
    "Connectez des assistants IA sans partager votre mot de passe.",
  "Copied.": "Copié.",
  "Copy {label}": "Copier {label}",
  "Create and update academic data and preferences.":
    "Créer et modifier les données scolaires et les préférences.",
  "Create client": "Créer le client",
  "Expose administration tools when this account is an admin.":
    "Rendre disponibles les outils d'administration lorsque ce compte est administrateur.",
  "Expose confirmed destructive tools.":
    "Rendre disponibles les outils destructifs avec confirmation.",
  "Integration client created.": "Client d'intégration créé.",
  Integrations: "Intégrations",
  "Integrations could not be loaded.":
    "Impossible de charger les intégrations.",
  "Its saved grants and refresh access will be removed. Short-lived access tokens already issued expire on their own.":
    "Ses autorisations enregistrées et son accès de renouvellement seront supprimés. Les jetons à courte durée de vie déjà émis expireront d'eux-mêmes.",
  "Maximum permissions": "Autorisations maximales",
  "MCP endpoint": "Point d'accès MCP",
  "No assistant currently has an active grant.":
    "Aucun assistant ne dispose actuellement d'une autorisation active.",
  "No client secret is created.": "Aucun secret client n'est créé.",
  "No integration client has been registered yet.":
    "Aucun client d'intégration n'a encore été enregistré.",
  "OAuth metadata": "Métadonnées OAuth",
  "OAuth scope": "Permission OAuth",
  "Redirect URI": "URI de redirection",
  "Register a public client": "Enregistrer un client public",
  "Registered clients": "Clients enregistrés",
  "Revoke access": "Révoquer l'accès",
  "Revoke access grant": "Révoquer l'autorisation d'accès",
  "Revoke client": "Révoquer le client",
  "Revoke this access grant?": "Révoquer cette autorisation d'accès ?",
  "Revoke this client?": "Révoquer ce client ?",
  "Revocation failed.": "La révocation a échoué.",
  "The client could not be created.": "Impossible de créer le client.",
  "The OAuth client was not created.": "Le client OAuth n'a pas été créé.",
  "Unnamed client": "Client sans nom",
  "Use this when an assistant cannot publish a Client ID Metadata Document yet.":
    "Utilisez ceci lorsqu'un assistant ne peut pas encore publier de document de métadonnées d'identifiant client.",
  Write: "Écriture",
  "Years, subjects, grades, averages, goals and analytics.":
    "Années, matières, notes, moyennes, objectifs et analyses.",
  "Link Google": "Associer Google",
  "Continue with Google": "Continuer avec Google",
  "Link Microsoft": "Associer Microsoft",
  "Continue with Microsoft": "Continuer avec Microsoft",
  "That code is not right, or it has expired.":
    "Ce code est incorrect ou a expiré.",
  "Checking…": "Vérification…",
  "Confirm email": "Confirmer l'e-mail",
  "Enter the six-digit code sent to your inbox.":
    "Saisissez le code à six chiffres envoyé dans votre boîte mail.",
  "Check your email": "Consultez votre boîte mail",
  "No email address was provided.": "Aucune adresse e-mail n'a été fournie.",
  "Send again in {seconds}s": "Renvoyer dans {seconds} s",
  "Send the code again": "Renvoyer le code",
  "Profile photo updated.": "Photo de profil mise à jour.",
  "That image could not be uploaded.": "Impossible d'envoyer cette image.",
  "Profile photo removed.": "Photo de profil supprimée.",
  "That image could not be removed.": "Impossible de supprimer cette image.",
  "Password added.": "Mot de passe ajouté.",
  "That password could not be saved.":
    "Impossible d'enregistrer ce mot de passe.",
  "Export prepared.": "Export préparé.",
  "That sign-in could not be linked.":
    "Impossible d'associer cette méthode de connexion.",
  "Sign-in linked.": "Méthode de connexion associée.",
  "That sign-in could not be removed.":
    "Impossible de retirer cette méthode de connexion.",
  "Sign-in removed.": "Méthode de connexion retirée.",
  "That could not be started.": "Impossible de démarrer cette opération.",
  "Check your email to confirm.": "Consultez votre boîte mail pour confirmer.",
  Profile: "Profil",
  "Choose a photo": "Choisir une photo",
  "Remove photo": "Supprimer la photo",
  "Email address": "Adresse e-mail",
  "Add a password": "Ajouter un mot de passe",
  "Add password": "Ajouter le mot de passe",
  "Linked sign-ins": "Méthodes de connexion associées",
  "Linked to this account": "Associé à ce compte",
  "Not linked": "Non associé",
  "Working…": "Traitement…",
  Unlink: "Dissocier",
  "Only sign-in": "Seul accès",
  Link: "Associer",
  "Where you are signed in": "Vos sessions actives",
  "this device": "cet appareil",
  "Sign out other devices": "Déconnecter les autres appareils",
  "Other sessions could not be signed out.":
    "Impossible de déconnecter les autres sessions.",
  "Other devices have been signed out.":
    "Les autres appareils ont été déconnectés.",
  "Start over": "Recommencer",
  "Type RESET to confirm": "Tapez RESET pour confirmer",
  "Clear everything": "Tout effacer",
  "Delete this account": "Supprimer ce compte",
  "Type DELETE to confirm": "Tapez DELETE pour confirmer",
  "Delete my account": "Supprimer mon compte",
  "Delete this account?": "Supprimer ce compte ?",
  "We email you a link before anything is removed.":
    "Nous vous envoyons un lien par e-mail avant toute suppression.",
  "That preference could not be saved.":
    "Impossible d'enregistrer cette préférence.",
  Theme: "Thème",
  "Match my device": "Suivre mon appareil",
  Light: "Clair",
  Dark: "Sombre",
  "Seasonal themes": "Thèmes saisonniers",
  "Small visual touches at special times of year":
    "De petites touches visuelles à certains moments de l'année",
  Interaction: "Interactions",
  "Reduce motion": "Réduire les animations",
  "Use fewer animated transitions": "Utiliser moins de transitions animées",
  "Compact layout": "Affichage compact",
  "Fit more information on each screen":
    "Afficher davantage d'informations sur chaque écran",
  Charts: "Graphiques",
  "Automatic zoom": "Zoom automatique",
  "Show trend": "Afficher la tendance",
  "Show data points": "Afficher les points",
  "Show sub-subjects": "Afficher les sous-matières",
  "Trend detail": "Détail de la tendance",
  "Preferences saved.": "Préférences enregistrées.",
  Colour: "Couleur",
  Default: "Par défaut",
  Custom: "Personnalisé",
  "Theme studio": "Studio de thèmes",
  Previous: "Précédent",
  Next: "Suivant",
  "Create a user": "Créer un utilisateur",
  "Temporary password": "Mot de passe temporaire",
  "Create user": "Créer l'utilisateur",
  "Administrative suspension": "Suspension administrative",
  "Suspension reason": "Motif de suspension",
  Duration: "Durée",
  "7 days": "7 jours",
  "30 days": "30 jours",
  Indefinite: "Indéfinie",
  "No suspension reason": "Aucun motif de suspension",
  "Mokattam theme": "Thème Mokattam",
  "Grant this unlockable theme to the user":
    "Accorder ce thème à débloquer à l'utilisateur",
  Usage: "Utilisation",
  None: "Aucun",
  "Schedule publication": "Planifier la publication",
  "Keep it hidden until the start date":
    "La garder masquée jusqu'à la date de début",
  "Something went wrong": "Un problème est survenu",
  "The error was reported without your grades or personal data.":
    "L'erreur a été signalée sans vos notes ni vos données personnelles.",
  "Try again": "Réessayer",
  Season: "Saison",
  Automatic: "Automatique",
  "New Year": "Nouvel An",
  "April Fools": "Poisson d'avril",
  "Which subject is this for?": "Pour quelle matière ?",
  "Year preset": "Modèle de l’année",
  "Official curriculum and updates": "Programme officiel et mises à jour",
  "Preset up to date": "Modèle à jour",
  "This year follows version {version} of {name}.":
    "Cette année suit la version {version} de {name}.",
  "Preset update available": "Mise à jour du modèle disponible",
  "Review the official changes before updating.":
    "Consultez les changements officiels avant la mise à jour.",
  "Customized year": "Année personnalisée",
  "Your configuration is protected. Official preset updates will not overwrite it.":
    "Votre configuration est protégée. Les mises à jour officielles du modèle ne l’écraseront pas.",
  "Update needs your decision": "La mise à jour nécessite votre décision",
  "The update would remove subjects that already contain grades, so nothing was changed.":
    "La mise à jour supprimerait des matières qui contiennent déjà des notes : rien n’a donc été modifié.",
  "No linked preset": "Aucun modèle lié",
  "Choose a curriculum below, or keep managing this year yourself.":
    "Choisissez un programme ci-dessous ou continuez à gérer cette année vous-même.",
  "Customize this year?": "Personnaliser cette année ?",
  "Nothing is deleted. This year simply stops receiving official preset updates until you reapply one.":
    "Rien n’est supprimé. Cette année cesse simplement de recevoir les mises à jour officielles jusqu’à ce que vous réappliquiez un modèle.",
  Customize: "Personnaliser",
  "Replace this configuration?": "Remplacer cette configuration ?",
  "This replaces {subjects} subjects and {averages} averages. Avermate blocks the operation if any grade could be deleted.":
    "Cela remplace {subjects} matières et {averages} moyennes. Avermate bloque l’opération si une note risque d’être supprimée.",
  "Replace and link": "Remplacer et lier",
  Added: "Ajoutés",
  Changed: "Modifiés",
  Removed: "Supprimés",
  "{name}: {count} grades would be affected":
    "{name} : {count} notes seraient affectées",
  "Update to version {version}": "Mettre à jour vers la version {version}",
  "Customize this year": "Personnaliser cette année",
  "Choose another preset": "Choisir un autre modèle",
  "Choose a preset": "Choisir un modèle",
  "{subjects} subjects · {averages} averages":
    "{subjects} matières · {averages} moyennes",
  "This replaces {subjects} current subjects and {averages} current averages.":
    "Cela remplace les {subjects} matières et {averages} moyennes actuelles.",
  "This year is empty, so the preset can be linked safely.":
    "Cette année est vide : le modèle peut être lié sans risque.",
  "Reapply preset": "Réappliquer le modèle",
  "Apply preset": "Appliquer le modèle",
  "This year contains {count} grades. Avermate will not replace subjects that carry student data.":
    "Cette année contient {count} notes. Avermate ne remplacera pas des matières qui portent des données d’élève.",
  "Home screen widget": "Widget d’écran d’accueil",
  "Private, aggregate-only progress":
    "Progression privée et uniquement agrégée",
  "On this device": "Sur cet appareil",
  "Allow the Avermate widget": "Autoriser le widget Avermate",
  "This choice is stored only for this account on this device.":
    "Ce choix est enregistré uniquement pour ce compte sur cet appareil.",
  "The widget preference could not be saved.":
    "Impossible d’enregistrer la préférence du widget.",
  "Show academic aggregates on this device?":
    "Afficher des données scolaires agrégées sur cet appareil ?",
  "The widget can show your general average, grade count and activity streak. It never includes friends, groups, class names or individual grades, and iOS marks values as private when the device is locked.":
    "Le widget peut afficher votre moyenne générale, votre nombre de notes et votre série d’activité. Il n’inclut jamais d’amis, de groupes, de noms de classe ni de notes individuelles, et iOS masque les valeurs privées lorsque l’appareil est verrouillé.",
  "Enable widget": "Activer le widget",
  "System widgets require an Avermate development or EAS build; they are not available in Expo Go.":
    "Les widgets système nécessitent un build de développement Avermate ou EAS ; ils ne sont pas disponibles dans Expo Go.",
  "System widgets are currently supported on iOS. The same configurable cards remain available inside Avermate on this device.":
    "Les widgets système sont actuellement pris en charge sur iOS. Les mêmes cartes configurables restent disponibles dans Avermate sur cet appareil.",
  "The widget is enabled for this device.":
    "Le widget est activé pour cet appareil.",
  "Nothing is shared with the operating-system widget until you enable it.":
    "Aucune donnée n’est transmise au widget du système tant que vous ne l’activez pas.",
  "Widget focus": "Priorité du widget",
  "Balanced summary": "Résumé équilibré",
  "Average and current activity streak": "Moyenne et série d’activité actuelle",
  "Average first": "Moyenne en priorité",
  "General average and grade count": "Moyenne générale et nombre de notes",
  "Activity first": "Activité en priorité",
  "Grade count without subject or grade names":
    "Nombre de notes sans nom de matière ni de note",
  "Privacy by design": "Confidentialité dès la conception",
  "Aggregate-only payload": "Données uniquement agrégées",
  "No account, friend, group, class or subject names":
    "Aucun nom de compte, d’ami, de groupe, de classe ou de matière",
  "Lock-screen redaction": "Masquage sur l’écran verrouillé",
  "Academic values are always marked privacy-sensitive":
    "Les valeurs scolaires sont toujours marquées comme confidentielles",
  "No background sign-in": "Aucune connexion en arrière-plan",
  "The app writes a local snapshot after you open it":
    "L’application écrit un instantané local après son ouverture",
  "Removing the widget preference or signing out replaces its snapshot with a neutral Avermate message.":
    "Désactiver le widget ou se déconnecter remplace son instantané par un message Avermate neutre.",
  "Widget library": "Bibliothèque de widgets",
  "Browse widget library": "Parcourir la bibliothèque de widgets",
  "Search metrics": "Rechercher des indicateurs",
  "Average, trend, streak…": "Moyenne, tendance, série…",
  "Choose what matters; scope, appearance and width come next.":
    "Choisissez ce qui compte ; la portée, l’apparence et la largeur viennent ensuite.",
  "Try a different metric name.": "Essayez un autre nom d’indicateur.",
  Essentials: "Essentiels",
  "Momentum and progress": "Dynamique et progression",
  "Results and rankings": "Résultats et classements",
  "Consistency and habits": "Régularité et habitudes",
  "All {count} widgets use the same audited analytics engine as the web app.":
    "Les {count} widgets utilisent le même moteur d’analyse vérifié que l’application web.",
  "{visible} visible · {hidden} hidden":
    "{visible} visibles · {hidden} masqués",
  "Build this year’s dashboard from 21 reusable analytics widgets.":
    "Composez le tableau de bord de cette année avec 21 widgets d’analyse réutilisables.",
  Duplicate: "Dupliquer",
  // --------------------------------------------------------------- social
  "Social, friends and groups": "Social, amis et groupes",
  "Private by default; sharing is always explicit":
    "Privé par défaut ; le partage est toujours explicite",
  Friends: "Amis",
  Groups: "Groupes",
  Sharing: "Partage",
  Updates: "Actualités",
  "Send request": "Envoyer la demande",
  Accept: "Accepter",
  Decline: "Refuser",
  Block: "Bloquer",
  "Your friends": "Vos amis",
  "Blocked accounts": "Comptes bloqués",
  "Remove this friend?": "Supprimer cet ami ?",
  Remove: "Supprimer",
  "Block this account?": "Bloquer ce compte ?",
  "Report a safety concern": "Signaler un problème de sécurité",
  "{count} members": "{count} membres",
  "Blocked by you": "Bloqués par vous",
  "Blocked accounts could not be refreshed.":
    "Impossible d’actualiser les comptes bloqués.",
  "No blocked accounts": "Aucun compte bloqué",
  Unblock: "Débloquer",
  "Unblock this account?": "Débloquer ce compte ?",
  "Friend invitation": "Invitation d’ami",
  "Your groups": "Vos groupes",
  "Groups could not be refreshed.": "Impossible d’actualiser les groupes.",
  "No groups yet": "Aucun groupe pour le moment",
  "Group name": "Nom du groupe",
  Description: "Description",
  "Last 30 days": "30 derniers jours",
  Owner: "Propriétaire",
  Group: "Groupe",
  "Remove from group": "Retirer du groupe",
  "Leave group": "Quitter le groupe",
  "Group settings": "Réglages du groupe",
  Median: "Médiane",
  "Group invitation": "Invitation à un groupe",
  "Mark all read": "Tout marquer comme lu",
  "What happened?": "Que s’est-il passé ?",
  Harassment: "Harcèlement",
  Impersonation: "Usurpation d’identité",
  "Unsafe content": "Contenu dangereux",
  Other: "Autre",
  Resolved: "Résolu",
  Dismissed: "Classé sans suite",
  Copy: "Copie",

  // ------------------------------------------------------- grade detail
  Grade: "Note",
  "Grade not found": "Note introuvable",
  "Impact on averages": "Impact sur les moyennes",
  "What it is made of": "Sa composition",

  // ---------------------------------------------------- social, rebuilt
  "included with {name}": "incluse avec {name}",
  "That comparison already exists.": "Cette comparaison existe déjà.",
  "Share my figures with this group": "Partager mes chiffres avec ce groupe",
  "Off means the others see you in the list without figures.": "Désactivé, les autres vous voient dans la liste sans chiffres.",
  "Boards": "Tableaux",
  "Add a board": "Ajouter un tableau",
  "A subject": "Une matière",
  "Median grade": "Note médiane",
  "Goals achieved": "Objectifs atteints",
  "The picker lists the template year's subjects, or yours. Offer a common configuration below to widen it.": "Le sélecteur liste les matières de l'année modèle, ou les vôtres. Proposez une configuration commune ci-dessous pour l'élargir.",
  "Add": "Ajouter",
  "Remove this board": "Retirer ce tableau",
  "This group offers a common year configuration you can adopt after joining.": "Ce groupe propose une configuration d’année commune que vous pourrez adopter après avoir rejoint.",
  "Year created": "Année créée",
  "Find it in your year picker. It is fully yours from here.": "Retrouvez-la dans votre sélecteur d’années. Elle est entièrement à vous désormais.",
  "Common configuration": "Configuration commune",
  "{subjects} subjects · {averages} custom averages · {periods} periods": "{subjects} matières · {averages} moyennes personnalisées · {periods} périodes",
  "Adopt this configuration": "Adopter cette configuration",
  "Adopt this configuration?": "Adopter cette configuration ?",
  "This copies the subjects, periods and custom averages into a fresh year of your own. Never any grades — and it is a copy, not a subscription.": "Cela copie les matières, les périodes et les moyennes personnalisées dans une nouvelle année à vous. Jamais aucune note — et c’est une copie, pas un abonnement.",
  "Create my year": "Créer mon année",
  "This group has no common configuration yet.": "Ce groupe n’a pas encore de configuration commune.",
  "Offer one of your years as the template": "Proposer une de vos années comme modèle",
  "No common configuration": "Aucune configuration commune",
  "Group type": "Type de groupe",
  "Friends group": "Groupe d'amis",
  "Study group": "Groupe d'étude",
  "Class": "Classe",
  "Show each member's 30-day trend": "Afficher la tendance sur 30 jours de chaque membre",
  "Show grade counts": "Afficher le nombre de notes",
  "Blocking removes the friendship and pending requests in both directions. Unblocking never recreates them.": "Bloquer supprime l'amitié et les demandes en attente dans les deux sens. Débloquer ne les recrée jamais.",
  "You can block someone from their friend screen.": "Vous pouvez bloquer quelqu'un depuis sa fiche d'ami.",
  "No friendship will be restored automatically — either of you can send a new request.": "Aucune amitié ne sera restaurée automatiquement — chacun peut renvoyer une demande.",
  "Friend": "Ami",
  "This friend could not be found": "Cet ami est introuvable",
  "The friendship may have been removed.": "L'amitié a peut-être été supprimée.",
  "Computed from {year}": "Calculée à partir de {year}",
  "Shared subjects": "Matières partagées",
  "Nothing is shared right now": "Rien n'est partagé pour le moment",
  "They locked their figures, or have no academic year to share yet.": "Cette personne a verrouillé ses chiffres, ou n'a pas encore d'année scolaire à partager.",
  "Actions": "Actions",
  "Remove friend": "Retirer l'ami",
  "Neither of you will see the other's figures any more.": "Aucun de vous ne verra plus les chiffres de l'autre.",
  "The friendship ends immediately and they can no longer reach you. They are not notified.": "L'amitié prend fin immédiatement et cette personne ne peut plus vous joindre. Elle n'est pas prévenue.",
  "This invitation is no longer valid": "Cette invitation n'est plus valide",
  "It may have expired, been revoked, or already used.": "Elle a peut-être expiré, été révoquée ou déjà utilisée.",
  "Go to friends": "Aller aux amis",
  "Becoming friends shares only what each of you unlocked.": "Devenir amis ne partage que ce que chacun de vous a déverrouillé.",
  "This is your own invitation link — send it to someone else.": "C'est votre propre lien d'invitation — envoyez-le à quelqu'un d'autre.",
  "You are already friends.": "Vous êtes déjà amis.",
  "Accept and become friends": "Accepter et devenir amis",
  "Compare general averages with a class or a group of friends. Each member decides whether their own figure appears.": "Comparez vos moyennes générales avec une classe ou un groupe d'amis. Chaque membre décide si son propre chiffre apparaît.",
  "Description (optional)": "Description (facultative)",
  "Create group": "Créer le groupe",
  "New group": "Nouveau groupe",
  "1 member": "1 membre",
  "On hold": "En pause",
  "Create one and send the link, or open an invitation someone sent you.": "Créez-en un et envoyez le lien, ou ouvrez une invitation reçue.",
  "You still own this group": "Vous possédez encore ce groupe",
  "Transfer or remove the other members first, or delete the group.": "Transférez ou retirez d'abord les autres membres, ou supprimez le groupe.",
  "This group could not be found": "Ce groupe est introuvable",
  "It may have been deleted, or you were removed.": "Il a peut-être été supprimé, ou vous en avez été retiré.",
  "A moderator paused this group after a report. Figures are hidden until the hold is lifted; nothing has been deleted.": "Un modérateur a suspendu ce groupe après un signalement. Les chiffres sont masqués jusqu'à la levée de la pause ; rien n'a été supprimé.",
  "Group average": "Moyenne du groupe",
  "Range": "Étendue",
  "Leaderboard": "Classement",
  "Members without a figure keep their switch off, or have no year to share.": "Les membres sans chiffre gardent leur interrupteur désactivé, ou n'ont pas d'année à partager.",
  "Invite people": "Inviter des personnes",
  "Share an invitation link": "Partager un lien d'invitation",
  "Anyone with the link joins directly. It works for a month or until revoked.": "Toute personne avec le lien rejoint directement. Il fonctionne un mois ou jusqu'à révocation.",
  "Edit name and description": "Modifier le nom et la description",
  "Delete group": "Supprimer le groupe",
  "Delete this group?": "Supprimer ce groupe ?",
  "The group and its memberships disappear for everyone. Nobody's grades are affected.": "Le groupe et ses adhésions disparaissent pour tout le monde. Les notes de personne ne sont affectées.",
  "Add a friend": "Ajouter un ami",
  "Their handle": "Son pseudo",
  "their-handle": "son-pseudo",
  "Nobody with that handle could be reached.": "Personne avec ce pseudo n'a pu être joint.",
  "Requests for you": "Demandes reçues",
  "Waiting for an answer": "En attente d'une réponse",
  "Sent — you can cancel it": "Envoyée — vous pouvez l'annuler",
  "Cancel this request?": "Annuler cette demande ?",
  "Keep waiting": "Continuer d'attendre",
  "Cancel request": "Annuler la demande",
  "Friends could not be refreshed.": "Les amis n'ont pas pu être actualisés.",
  "Shares their figures": "Partage ses chiffres",
  "Shares nothing": "Ne partage rien",
  "No friends yet": "Pas encore d'amis",
  "Send a request to a handle you know, or share an invitation link.": "Envoyez une demande à un pseudo que vous connaissez, ou partagez un lien d'invitation.",
  "Elsewhere": "Ailleurs",
  "What your friends may see": "Ce que vos amis peuvent voir",
  "Each friend sees exactly what your sharing locks allow — nothing more.": "Chaque ami voit exactement ce que vos verrous de partage autorisent — rien de plus.",
  "It may have expired, been revoked, or the group is gone.": "Elle a peut-être expiré, été révoquée, ou le groupe n'existe plus.",
  "Go to groups": "Aller aux groupes",
  "{name} invites you. {count} people are in.": "{name} vous invite. {count} personnes y sont.",
  "{count} people are in.": "{count} personnes y sont.",
  "Members compare general averages. Yours is visible on joining, and one switch inside the group hides it whenever you want.": "Les membres comparent leurs moyennes générales. La vôtre est visible dès l'arrivée, et un interrupteur dans le groupe la masque quand vous voulez.",
  "You are already a member.": "Vous êtes déjà membre.",
  "Join the group": "Rejoindre le groupe",
  "You received a friend request.": "Vous avez reçu une demande d'ami.",
  "Your friend request was accepted.": "Votre demande d'ami a été acceptée.",
  "Someone joined {groupName}.": "Quelqu'un a rejoint {groupName}.",
  "Someone joined your group.": "Quelqu'un a rejoint votre groupe.",
  "You were removed from {groupName}.": "Vous avez été retiré de {groupName}.",
  "You were removed from a group.": "Vous avez été retiré d'un groupe.",
  "A social update is available.": "Une mise à jour sociale est disponible.",
  "Latest": "Récents",
  "Updates could not be refreshed.": "Les mises à jour n'ont pas pu être actualisées.",
  "Nothing yet": "Rien pour l'instant",
  "Friend requests and group activity will appear here.": "Les demandes d'amis et l'activité des groupes apparaîtront ici.",
  "Describe the problem": "Décrivez le problème",
  "Write only what a moderator needs. Do not paste grades, subject names or anyone's academic results.": "N'écrivez que ce dont un modérateur a besoin. Ne collez ni notes, ni noms de matières, ni résultats scolaires de quiconque.",
  "The report could not be sent. Try again later.": "Le signalement n'a pas pu être envoyé. Réessayez plus tard.",
  "Send private report": "Envoyer le signalement privé",
  "Sharing settings could not be loaded.": "Les réglages de partage n'ont pas pu être chargés.",
  "Your handle": "Votre pseudo",
  "Handle": "Pseudo",
  "your-handle": "votre-pseudo",
  "That handle is already taken.": "Ce pseudo est déjà pris.",
  "Save handle": "Enregistrer le pseudo",
  "Friends find you with it. Leave empty to be reachable by invitation link only.": "Les amis vous trouvent avec. Laissez vide pour n'être joignable que par lien d'invitation.",
  "What friends see": "Ce que voient les amis",
  "One number for the whole year.": "Un seul chiffre pour toute l'année.",
  "Subject averages": "Moyennes par matière",
  "All subjects": "Toutes les matières",
  "Only subjects I pick": "Seulement celles que je choisis",
  "No subjects": "Aucune matière",
  "Year being shared": "Année partagée",
  "My current year ({name})": "Mon année en cours ({name})",
  "My current year": "Mon année en cours",
  "Subjects you share": "Matières que vous partagez",
  "The shared year has no subjects yet.": "L'année partagée n'a pas encore de matières.",
  "Exactly what a friend sees": "Exactement ce qu'un ami voit",
  "Locked": "Verrouillée",
  "Friends currently see nothing: both locks are closed, or there is no academic year to share yet.": "Les amis ne voient rien actuellement : les deux verrous sont fermés, ou il n'y a pas encore d'année scolaire à partager.",
  "Hold a reported group, or delete it outright.": "Mettez en pause un groupe signalé, ou supprimez-le.",
  "All groups": "Tous les groupes",
  "Owner: {name}": "Propriétaire : {name}",
  "Lift hold": "Lever la pause",
  "Put on hold": "Mettre en pause",
  "It disappears for every member. Nobody's grades are affected.": "Il disparaît pour chaque membre. Les notes de personne ne sont affectées.",
  "No groups": "Aucun groupe",
  "Nothing has been created yet.": "Rien n'a encore été créé.",
  "Reports and group holds. Academic figures never appear here.": "Signalements et pauses de groupes. Les chiffres scolaires n'apparaissent jamais ici.",
  "Moderation counts could not be refreshed.": "Les compteurs de modération n'ont pas pu être actualisés.",
  "Friendships": "Amitiés",
  "Open reports": "Signalements ouverts",
  "Sharing profiles": "Profils de partage",
  "Queues": "Files d'attente",
  "Investigating": "En cours d'examen",
  "What members flagged. Messages never contain academic figures.": "Ce que les membres ont signalé. Les messages ne contiennent jamais de chiffres scolaires.",
  "Queue": "File d'attente",
  "Reports could not be refreshed.": "Les signalements n'ont pas pu être actualisés.",
  "From {name}": "De {name}",
  "about {name}": "à propos de {name}",
  "group {name}": "groupe {name}",
  "Change status": "Changer le statut",
  "No reports": "Aucun signalement",
  "Nothing waits in this view.": "Rien n'attend dans cette vue.",

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
