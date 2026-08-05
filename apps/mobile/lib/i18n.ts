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
  "Made for students": "Fait pour les élèves",
  "School year": "Année scolaire",
  "Current year": "Année en cours",
  Periods: "Périodes",
  "1 year": "1 année",
  "{count} years": "{count} années",

  "Custom averages": "Moyennes personnalisées",
  "Dashboard cards": "Cartes du tableau de bord",
  "Theme": "Thème",
  "Follows your device": "Suit votre appareil",
  "Profile and password": "Profil et mot de passe",
  "Send feedback": "Envoyer un retour",
  "About": "À propos",

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
  "Add a card": "Ajouter une carte",
  "Add a period": "Ajouter une période",
  "Add one, or restore the ones the app starts with.":
    "Ajoutez-en une, ou remettez celles d'origine.",
  "All In": "Tapis",
  "All the statistics": "Toutes les statistiques",
  "Among everyone using Avermate": "Parmi tous les utilisateurs d'Avermate",
  "An idea": "Une idée",
  "Anything worth remembering": "Ce qui mérite d'être noté",
  "Ask away.": "Posez votre question.",
  "Average": "Moyenne",
  "Avermate on the web": "Avermate sur le web",
  "Back to the year": "Retour à l'année",
  "Best result": "Meilleure note",
  "Best run this year": "Meilleure série de l'année",
  "Best this year: {count}": "Record de l'année : {count}",
  "Brilliant, then baffling. Never the same twice.":
    "Brillant, puis déroutant. Jamais deux fois pareil.",
  "Bug report": "Bug",
  "Busiest month": "Mois le plus chargé",
  "By": "Avant le",
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
  "Code": "Code",
  "Consecutive days with a grade recorded":
    "Jours consécutifs avec une note saisie",
  "Consecutive results at or above the passing mark":
    "Résultats consécutifs au-dessus de la moyenne",
  "Counts everything since the start of the year, not just this span.":
    "Compte tout depuis le début de l'année, pas seulement cette période.",
  "Cumulative": "Cumulative",
  "Current password": "Mot de passe actuel",
  "Decimal places": "Décimales",
  "Default maximum": "Maximum par défaut",
  "Delete every grade": "Supprimer toutes les notes",
  "Delete every grade?": "Supprimer toutes les notes ?",
  "Delete this average": "Supprimer cette moyenne",
  "Delete this card": "Supprimer cette carte",
  "Delete this card?": "Supprimer cette carte ?",
  "Delete this period": "Supprimer cette période",
  "Delete this year": "Supprimer cette année",
  "Display": "Affichage",
  "Done": "Terminé",
  "Edit card": "Modifier la carte",
  "Edit custom average": "Modifier la moyenne",
  "Editing": "Modification",
  "Enter the code, then pick something new.":
    "Saisissez le code, puis choisissez un nouveau mot de passe.",
  "Every subject and grade in this year goes with it. This cannot be undone.":
    "Toutes les matières et notes de cette année disparaissent avec elle. C'est définitif.",
  "Every year, subject and grade, as JSON.":
    "Toutes vos années, matières et notes, en JSON.",
  "Everything you were graded on, added up":
    "Tout ce sur quoi vous avez été noté, cumulé",
  "Export everything": "Tout exporter",
  "Feedback": "Retour",
  "Fine tuning": "Ajustements",
  "Friday": "Vendredi",
  "Furthest travelled between the halves of the year":
    "Plus grand écart entre les deux moitiés de l'année",
  "Give it a deadline": "Fixer une échéance",
  "Goal": "Objectif",
  "Goal progress": "Avancement d'un objectif",
  "Hidden": "Masquées",
  "Hide": "Masquer",
  "High, and it stayed high. That is the hard part.":
    "Haut, et ça l'est resté. C'est ça le plus dur.",
  "How far a typical result sits from your average":
    "L'écart habituel entre un résultat et votre moyenne",
  "How far the average has moved across the period":
    "De combien la moyenne a bougé sur la période",
  "How grades are written": "Comment s'écrivent les notes",
  "How it looks": "Apparence",
  "How you worked": "Comment vous avez travaillé",
  "I forgot my password": "J'ai oublié mon mot de passe",
  "Idea": "Idée",
  "If the trend holds": "Si la tendance se maintient",
  "Improvement": "Progression",
  "In total": "Au total",
  "Insights": "Statistiques",
  "It has landed. Every message gets read, even when the reply takes a while.":
    "C'est bien arrivé. Chaque message est lu, même si la réponse peut tarder.",
  "It started": "Ça a commencé",
  "It started badly. That is not how it ended.":
    "Ça avait mal commencé. Ça ne s'est pas fini comme ça.",
  "Its own weight, ×{value}": "Son propre coefficient, ×{value}",
  "Just the number": "Le nombre seul",
  "Last one in": "Dernière saisie",
  "Latest result": "Dernière note",
  "Leave it empty to use the metric's own name.":
    "Laissez vide pour reprendre le nom de la mesure.",
  "Leave one empty to keep the subject's own coefficient.":
    "Laissez vide pour garder le coefficient de la matière.",
  "Longest run of active days": "Plus longue série de jours actifs",
  "Mark as reached": "Marquer comme atteint",
  "Mean result": "Note moyenne",
  "Median result": "Note médiane",
  "Message": "Message",
  "Metric": "Mesure",
  "Monday": "Lundi",
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
  "Note": "Remarque",
  "Nothing to show yet": "Rien à afficher pour l'instant",
  "Nothing was deleted.": "Rien n'a été supprimé.",
  "Number and a line": "Le nombre et une courbe",
  "Numbers": "Les chiffres",
  "One average for the whole year. Add a period to change that.":
    "Une seule moyenne pour toute l'année. Ajoutez une période pour changer ça.",
  "Only the number matters — no names ever leave a device.":
    "Seul le classement compte — aucun nom ne quitte jamais un appareil.",
  "Open": "Ouvrir",
  "Passing mark": "Seuil de réussite",
  "Passing right now": "Série en cours",
  "Passing streak": "Série de réussites",
  "Password changed. Other devices have been signed out.":
    "Mot de passe changé. Vos autres appareils ont été déconnectés.",
  "Period {number}": "Période {number}",
  "Pick a handful of subjects and weigh them your own way — useful when the official average is not the one you care about.":
    "Choisissez quelques matières et pondérez-les à votre façon — utile quand la moyenne officielle n'est pas celle qui vous intéresse.",
  "Privacy": "Confidentialité",
  "Question": "Question",
  "Record a few more grades and your year gets its recap.":
    "Saisissez encore quelques notes et votre année aura sa rétrospective.",
  "Remove this part": "Retirer cette partie",
  "Reopen this goal": "Rouvrir cet objectif",
  "Reorder and move": "Réorganiser et déplacer",
  "Reset your password": "Réinitialiser votre mot de passe",
  "Restore": "Rétablir",
  "Restore the default cards": "Rétablir les cartes d'origine",
  "Restore the defaults?": "Rétablir les cartes d'origine ?",
  "Saturday": "Samedi",
  "Save name": "Enregistrer le nom",
  "Saving…": "Enregistrement…",
  "Science average, mock exams…": "Moyenne scientifique, bacs blancs…",
  "Scope": "Portée",
  "Second half of the period against the first":
    "Seconde moitié de la période contre la première",
  "Send": "Envoyer",
  "Send me a code": "Envoyez-moi un code",
  "Set the new password": "Définir le mot de passe",
  "Showing": "Affichage",
  "Slipping the most": "Plus grand recul",
  "Something else": "Autre chose",
  "Something is broken": "Quelque chose ne marche pas",
  "Spread": "Dispersion",
  "Spread of results": "Répartition des notes",
  "Steadiest": "Plus régulière",
  "Steadiest subjects": "Matières les plus régulières",
  "Streaks": "Séries",
  "Strong": "Fort",
  "Structure": "Structure",
  "Subjects followed": "Matières suivies",
  "Subjects ranked": "Classement des matières",
  "Subjects, best first": "Matières, les meilleures d'abord",
  "Sunday": "Dimanche",
  "Terms": "Conditions d'utilisation",
  "Thank you": "Merci",
  "That address could not be used.": "Cette adresse n'a pas pu être utilisée.",
  "That code could not be sent. Check the address.":
    "Le code n'a pas pu être envoyé. Vérifiez l'adresse.",
  "That code did not work. It may have expired.":
    "Ce code n'a pas fonctionné. Il a peut-être expiré.",
  "That could not be saved.": "Impossible d'enregistrer.",
  "That could not be sent. Try again in a moment.":
    "L'envoi a échoué. Réessayez dans un instant.",
  "That did not match. Nothing was deleted.":
    "Ça ne correspond pas. Rien n'a été supprimé.",
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
  "The day it always lands on": "Le jour où ça tombe toujours",
  "The day your average was at its highest":
    "Le jour où votre moyenne était au plus haut",
  "The export could not be prepared.": "L'export n'a pas pu être préparé.",
  "The grade as a whole": "La note dans son ensemble",
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
  "The year so far": "L'année jusqu'ici",
  "This drives the colour of every result and the pass rate.":
    "C'est ce qui détermine la couleur de chaque note et le taux de réussite.",
  "This period is over": "Cette période est terminée",
  "Thursday": "Jeudi",
  "Title": "Titre",
  "Track your grades, understand what moves your average, and get a plan for the result you are aiming at.":
    "Suivez vos notes, comprenez ce qui fait bouger votre moyenne, et sachez quoi faire pour atteindre le résultat que vous visez.",
  "Trend": "Tendance",
  "Tuesday": "Mardi",
  "Type RESET to confirm. Your account stays, everything in it goes.":
    "Tapez RESET pour confirmer. Votre compte reste, tout ce qu'il contient part.",
  "Unweighted — every grade counts once":
    "Sans coefficient — chaque note compte une fois",
  "Version {version}": "Version {version}",
  "We will send a six-digit code to your address.":
    "Nous enverrons un code à six chiffres à votre adresse.",
  "Weak": "Faible",
  "Wednesday": "Mercredi",
  "Weighted ×{value} here": "Pondérée ×{value} ici",
  "What are you trying to do that the app makes hard?":
    "Qu'essayez-vous de faire que l'application rend compliqué ?",
  "What counts as a pass": "Ce qui compte comme réussite",
  "What did you do, and what happened instead?":
    "Qu'avez-vous fait, et que s'est-il passé à la place ?",
  "What goes in": "Ce qu'elle contient",
  "What it looks at": "Ce qu'elle regarde",
  "What it measures": "Ce qu'elle mesure",
  "What you were best at": "Vos points forts",
  "When": "Quand",
  "Where it lands": "Où ça atterrit",
  "Where it sits": "Où elle se place",
  "Where the current trend puts you at the end":
    "Où la tendance actuelle vous mène à la fin",
  "Work it out from the date": "Déduire de la date",
  "Worst result": "Moins bonne note",
  "Year in review": "Rétrospective de l'année",
  "You have used this app more than the app expected.":
    "Vous avez utilisé cette application plus que prévu.",
  "You passed through. The year barely knew you were there.":
    "Vous êtes passé par là. L'année vous a à peine vu.",
  "You will get a link to confirm it.":
    "Vous recevrez un lien pour la confirmer.",
  "Your account stays, everything in it goes. This cannot be undone.":
    "Votre compte reste, tout ce qu'il contient part. C'est définitif.",
  "Your average": "Votre moyenne",
  "Your current cards are replaced. Nothing else changes.":
    "Vos cartes actuelles sont remplacées. Rien d'autre ne change.",
  "Your data": "Vos données",
  "Your grades are yours. Averages are computed on this device, not on a server, and nothing identifying you is ever compared against anybody else.":
    "Vos notes vous appartiennent. Les moyennes sont calculées sur cet appareil, pas sur un serveur, et rien qui vous identifie n'est jamais comparé à qui que ce soit.",
  "Your message": "Votre message",
  "Your name": "Votre nom",
  "Your peak": "Votre sommet",
  "Your year, told back to you": "Votre année, racontée",
  "Yours": "Les vôtres",
  "and counting": "et ça continue",
  "right now": "actuellement",
  "top {percent}%": "top {percent} %",
  "{count} days": "{count} jours",
  "{count} results": "{count} résultats",
  "{count} weeks left in this period":
    "{count} semaines restantes sur cette période",

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
