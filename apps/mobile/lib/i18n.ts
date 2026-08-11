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
  "Cancel invitation setup": "Annuler la configuration de l’invitation",
  "Request code {code}": "Code de demande {code}",
  "Invitation unavailable": "Invitation indisponible",
  "The private continuation expired. Reopen the original link; its secret was not stored on this device.":
    "La reprise privée a expiré. Rouvrez le lien d’origine ; son secret n’a pas été stocké sur cet appareil.",
  "Private social invitation": "Invitation sociale privée",
  "The link is invalid, expired or incomplete. No membership or sharing permission was created.":
    "Le lien est invalide, expiré ou incomplet. Aucune adhésion ni autorisation de partage n’a été créée.",
  "Feedback detail": "Détail du retour",
  "Social moderation": "Modération sociale",
  "Safety reports": "Signalements de sécurité",
  "Safety report": "Signalement de sécurité",
  "Social groups": "Groupes sociaux",
  "Social audit": "Audit social",
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
  "Freeze this group?": "Geler ce groupe ?",
  "Unfreeze this group?": "Dégeler ce groupe ?",
  "Accepted consents are withdrawn, invitations are revoked and sharing stops until members consent again.":
    "Les consentements acceptés sont retirés, les invitations révoquées et le partage s’arrête jusqu’au nouveau consentement des membres.",
  "The group becomes active again, but prior consent and ranking opt-ins are not silently restored.":
    "Le groupe redevient actif, mais les consentements et accords de classement antérieurs ne sont pas restaurés silencieusement.",
  Freeze: "Geler",
  Unfreeze: "Dégeler",
  "Class groups are self-declared. This moderation view contains group metadata and counts only, never academic rows.":
    "Les groupes de classe sont autodéclarés. Cette vue de modération ne contient que les métadonnées et décomptes du groupe, jamais de lignes scolaires.",
  "Search group name": "Rechercher un nom de groupe",
  Frozen: "Gelé",
  Type: "Type",
  "Social groups could not be loaded.":
    "Impossible de charger les groupes sociaux.",
  "{count} groups": "{count} groupes",
  members: "membres",
  "Moderate {name}": "Modérer {name}",
  "Required audit reason": "Motif d’audit obligatoire",
  "At least 10 characters": "Au moins 10 caractères",
  "Unfreeze group": "Dégeler le groupe",
  "Freeze group sharing": "Geler le partage du groupe",
  "Archived groups cannot be unfrozen.":
    "Les groupes archivés ne peuvent pas être dégelés.",
  "The group changed elsewhere. Refresh before trying again.":
    "Le groupe a changé ailleurs. Actualisez avant de réessayer.",
  "This timeline is read-only. Reasons are represented by opaque digests; invitation secrets and academic data are excluded.":
    "Cet historique est en lecture seule. Les motifs sont représentés par des empreintes opaques ; les secrets d’invitation et données scolaires sont exclus.",
  "Exact action": "Action exacte",
  "Exact entity type": "Type d’entité exact",
  "The social audit could not be loaded.":
    "Impossible de charger l’audit social.",
  "{count} events": "{count} événements",
  "reason recorded": "motif enregistré",
  "no reason digest": "aucune empreinte de motif",
  "Enable social features?": "Activer les fonctions sociales ?",
  "Disable social features?": "Désactiver les fonctions sociales ?",
  "This opens eligibility setup. Profiles and sharing still require explicit consent.":
    "Cela ouvre la configuration d’éligibilité. Les profils et le partage exigent toujours un consentement explicite.",
  "Social access stops immediately and aggregate caches are cleared. Moderation and audit records remain.":
    "L’accès social s’arrête immédiatement et les caches agrégés sont vidés. Les dossiers de modération et d’audit restent conservés.",
  Enable: "Activer",
  Disable: "Désactiver",
  "Global social feature flag": "Drapeau global des fonctions sociales",
  Enabled: "Activé",
  Disabled: "Désactivé",
  "Revision {revision}": "Révision {revision}",
  ON: "ACTIF",
  OFF: "INACTIF",
  "The safe default is off. Changing this flag never bypasses age, guardian, profile or group consent checks.":
    "La valeur sûre par défaut est désactivée. Ce drapeau ne contourne jamais les contrôles d’âge, de responsable, de profil ou de consentement de groupe.",
  "Disable social": "Désactiver le social",
  "Enable social": "Activer le social",
  "The social feature flag was updated.":
    "Le drapeau des fonctions sociales a été mis à jour.",
  "The feature flag changed elsewhere or could not be saved.":
    "Le drapeau a changé ailleurs ou n’a pas pu être enregistré.",
  "Privacy-safe overview": "Vue d’ensemble respectueuse de la confidentialité",
  Profiles: "Profils",
  Memberships: "Adhésions",
  Reports: "Signalements",
  "These are aggregate moderation counts only. No grade, subject or raw school record is exposed.":
    "Il s’agit uniquement de décomptes de modération agrégés. Aucune note, matière ou donnée scolaire brute n’est exposée.",
  Moderate: "Modérer",
  "Resolve, dismiss, assign or freeze safely":
    "Résoudre, classer, attribuer ou geler en sécurité",
  "Inspect state and freeze sharing": "Examiner l’état et geler le partage",
  "Read-only privacy and moderation events":
    "Événements de confidentialité et modération en lecture seule",
  "Moderation shows the submitted safety message and opaque target capabilities, never grades or academic rows.":
    "La modération affiche le message de sécurité envoyé et des capacités de cible opaques, jamais les notes ni des lignes scolaires.",
  "Search report message": "Rechercher dans le message du signalement",
  "Social reports could not be loaded.":
    "Impossible de charger les signalements sociaux.",
  "{count} reports": "{count} signalements",
  Request: "Demande",
  "Freeze the reported profile?": "Geler le profil signalé ?",
  "Sharing stops immediately. This action is audited and does not expose or alter academic records.":
    "Le partage s’arrête immédiatement. Cette action est auditée et n’expose ni ne modifie les dossiers scolaires.",
  "This safety report could not be loaded.":
    "Impossible de charger ce signalement de sécurité.",
  "Reported by {name}": "Signalé par {name}",
  "The target remains an administrator-only capability. Grades, subjects and raw school records are not part of this view.":
    "La cible reste une capacité réservée aux administrateurs. Les notes, matières et dossiers scolaires bruts ne font pas partie de cette vue.",
  "Moderation decision": "Décision de modération",
  Resolve: "Résoudre",
  "This report changed elsewhere. Refresh before trying again.":
    "Ce signalement a changé ailleurs. Actualisez avant de réessayer.",
  "Immediate safety action": "Action de sécurité immédiate",
  "Freeze reported profile": "Geler le profil signalé",
  "The target changed or could not be frozen safely.":
    "La cible a changé ou n’a pas pu être gelée en sécurité.",
  "This group is outside the first moderation page. Open Social groups to find and freeze it.":
    "Ce groupe n’est pas sur la première page de modération. Ouvrez Groupes sociaux pour le trouver et le geler.",
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
  Social: "Social",
  "Social, friends and groups": "Social, amis et groupes",
  "Private by default; sharing is always explicit":
    "Privé par défaut ; le partage est toujours explicite",
  Overview: "Vue d’ensemble",
  Friends: "Amis",
  Groups: "Groupes",
  Sharing: "Partage",
  Updates: "Actualités",
  Requests: "Demandes",
  Notifications: "Notifications",
  "Shared by choice": "Partagé par choix",
  "A missing permission always means no access. Social views never expose complete grades, subject names, comments, dates or your email.":
    "Une autorisation absente signifie toujours aucun accès. Les vues sociales n’exposent jamais les notes détaillées, noms de matières, commentaires, dates ou votre e-mail.",
  "Private by default, useful by mutual choice":
    "Privé par défaut, utile par choix mutuel",
  "Your social space": "Votre espace social",
  "Your profile": "Votre profil",
  "Activate friend features": "Activer les fonctionnalités entre amis",
  "Groups work without a discoverable friend profile":
    "Les groupes fonctionnent sans profil d’ami découvrable",
  "Private profile": "Profil privé",
  "Review exactly what friends can see":
    "Vérifier exactement ce que vos amis voient",
  "Permissions are field-by-field and reversible":
    "Les autorisations sont détaillées par champ et réversibles",
  "Social data could not be refreshed":
    "Impossible d’actualiser les données sociales",
  "Reconnect before making a sharing decision.":
    "Reconnectez-vous avant toute décision de partage.",
  Connect: "Se connecter aux autres",
  "Friends and requests": "Amis et demandes",
  "Mutual acceptance, exact handle or private invitation":
    "Acceptation mutuelle, identifiant exact ou invitation privée",
  "Groups and classes": "Groupes et classes",
  "Join only after reviewing the current sharing policy":
    "Rejoindre uniquement après avoir vérifié la politique de partage actuelle",
  "Friend, invitation, consent and moderation updates":
    "Actualités des amis, invitations, consentements et modération",
  "Social is unavailable offline": "Le social est indisponible hors ligne",
  "Reconnect to verify your current sharing permissions.":
    "Reconnectez-vous pour vérifier vos autorisations de partage actuelles.",
  "Social is not available yet": "Le social n’est pas encore disponible",
  "Administrators can enable it when the privacy and moderation controls are ready for your account.":
    "Les administrateurs pourront l’activer lorsque les protections de confidentialité et de modération seront prêtes pour votre compte.",
  "Social access is paused": "L’accès social est suspendu",
  "Finish social setup": "Terminer la configuration sociale",
  "Activate a friend profile": "Activer un profil d’ami",
  "Friend features require an active profile. Groups remain available without one.":
    "Les fonctionnalités entre amis exigent un profil actif. Les groupes restent disponibles sans profil.",
  "Choose your age band and consent to the current policy before anything is shared.":
    "Choisissez votre tranche d’âge et acceptez la politique actuelle avant tout partage.",
  "Open social profile": "Ouvrir le profil social",
  "Your academic data remains private while an administrator reviews this account.":
    "Vos données scolaires restent privées pendant l’examen de ce compte par un administrateur.",
  "Review setup": "Vérifier la configuration",
  "Contact support if you think this pause is a mistake.":
    "Contactez l’assistance si vous pensez que cette suspension est une erreur.",
  "Social setup": "Configuration sociale",
  "Setup cannot be verified": "La configuration ne peut pas être vérifiée",
  "Reconnect and try again. No social permission was changed.":
    "Reconnectez-vous puis réessayez. Aucune autorisation sociale n’a été modifiée.",
  "Joint consent required": "Consentement conjoint requis",
  "Your choice is recorded": "Votre choix est enregistré",
  "No profile or sharing is active yet":
    "Aucun profil ni partage n’est encore actif",
  "Guardian verification is still required":
    "La vérification du responsable légal reste nécessaire",
  "For accounts under 15 in France":
    "Pour les comptes de moins de 15 ans en France",
  "A parent or guardian must complete the verified consent flow. A name, checkbox or code shared by the student is not accepted as proof.":
    "Un parent ou responsable légal doit terminer le parcours de consentement vérifié. Un nom, une case cochée ou un code communiqué par l’élève ne constitue pas une preuve.",
  "Guardian email": "E-mail du responsable légal",
  "Send secure guardian link": "Envoyer le lien sécurisé au responsable légal",
  "A secure, single-use link was sent. Your guardian must sign in with that exact verified email within 72 hours.":
    "Un lien sécurisé à usage unique a été envoyé. Votre responsable légal doit se connecter avec cette adresse e-mail vérifiée exacte sous 72 heures.",
  "The guardian request could not be sent. Verify the address or try again tomorrow.":
    "Impossible d’envoyer la demande au responsable légal. Vérifiez l’adresse ou réessayez demain.",
  "The guardian completes the decision on Avermate web after signing in with the addressed account. The app never receives the secret link or their email back.":
    "Le responsable légal prend sa décision sur Avermate web après connexion avec le compte destinataire. L’application ne reçoit jamais le lien secret ni son e-mail en retour.",
  "Guardian request · {status}": "Demande au responsable · {status}",
  "Policy {version}": "Politique {version}",
  pending: "en attente",
  accepted: "acceptée",
  declined: "refusée",
  revoked: "révoquée",
  expired: "expirée",
  "Guardian request status could not be updated. No permission was granted silently.":
    "Impossible de mettre à jour l’état de la demande au responsable légal. Aucune autorisation n’a été accordée silencieusement.",
  "Check guardian decision": "Vérifier la décision du responsable légal",
  "The private invitation continuation expired. Reopen the original link; its secret was not stored on this device.":
    "La reprise de l’invitation privée a expiré. Rouvrez le lien d’origine ; son secret n’a pas été conservé sur cet appareil.",
  "Age band": "Tranche d’âge",
  "Under 15": "Moins de 15 ans",
  "15 to 17": "15 à 17 ans",
  "18 or older": "18 ans ou plus",
  "Joint consent with a verified guardian is required in France":
    "Un consentement conjoint avec un responsable légal vérifié est requis en France",
  "Avermate stores only this broad band and assurance status, never a birth date or identity document.":
    "Avermate conserve uniquement cette tranche générale et le niveau de vérification, jamais une date de naissance ni une pièce d’identité.",
  "Current policy": "Politique actuelle",
  "Policy version": "Version de la politique",
  "Friends require mutual acceptance":
    "Les amis nécessitent une acceptation mutuelle",
  "Exact-handle discovery only; no contact upload":
    "Découverte uniquement par identifiant exact ; aucun import de contacts",
  "Groups require a separate data choice":
    "Les groupes nécessitent un choix de données distinct",
  "A policy change always asks again":
    "Toute modification de politique demande un nouveau consentement",
  "Named rankings are off by default":
    "Les classements nominatifs sont désactivés par défaut",
  "Separate opt-in and privacy thresholds apply":
    "Un accord distinct et des seuils de confidentialité s’appliquent",
  "I understand and consent to this policy":
    "Je comprends et j’accepte cette politique",
  "You can withdraw later; withdrawal stops future social access.":
    "Vous pourrez retirer votre consentement ; le retrait bloque les futurs accès sociaux.",
  "Consent and continue": "Accepter et continuer",
  "Social setup could not be saved.":
    "Impossible d’enregistrer la configuration sociale.",
  "Social profile": "Profil social",
  "Profile permissions could not be loaded":
    "Impossible de charger les autorisations du profil",
  "Reconnect before changing what other people can see.":
    "Reconnectez-vous avant de modifier ce que les autres peuvent voir.",
  "Complete consent first": "Terminer d’abord le consentement",
  "A social profile cannot be activated before the current eligibility decision is complete.":
    "Un profil social ne peut pas être activé avant la fin de la décision d’éligibilité actuelle.",
  "Profile status": "État du profil",
  "Activate my social profile": "Activer mon profil social",
  "Off means nobody can discover or view it, including existing friends.":
    "Désactivé signifie que personne ne peut le découvrir ni le voir, y compris vos amis actuels.",
  "Display name": "Nom affiché",
  "Exact handle": "Identifiant exact",
  "A short introduction without school or contact details":
    "Une courte présentation sans établissement ni coordonnées",
  "Education level": "Niveau d’études",
  Discovery: "Découverte",
  Off: "Désactivé",
  "Only existing accepted relationships remain":
    "Seules les relations déjà acceptées subsistent",
  "Invitation links only": "Liens d’invitation uniquement",
  "Useful for joining groups without appearing in search":
    "Utile pour rejoindre des groupes sans apparaître dans une recherche",
  "People must type the complete handle; there is no directory":
    "Il faut saisir l’identifiant complet ; aucun annuaire n’existe",
  "What every accepted friend can see": "Ce que chaque ami accepté peut voir",
  "Profile picture": "Photo de profil",
  Bio: "Présentation",
  "Circle- and person-specific exceptions are managed from Friends. A missing grant always hides the field.":
    "Les exceptions par cercle ou personne se gèrent depuis Amis. Une autorisation absente masque toujours le champ.",
  "Exact friend preview": "Aperçu exact pour un ami",
  "Bio not shared": "Présentation non partagée",
  "Education level not shared": "Niveau d’études non partagé",
  "Social profile saved.": "Profil social enregistré.",
  "That exact handle is unavailable.":
    "Cet identifiant exact est indisponible.",
  "The social profile could not be saved.":
    "Impossible d’enregistrer le profil social.",
  "That sharing permission could not be changed.":
    "Impossible de modifier cette autorisation de partage.",
  "Withdraw social consent": "Retirer le consentement social",
  "Turn off social and withdraw":
    "Désactiver le social et retirer le consentement",
  "Future profile and group access stops immediately":
    "Les futurs accès au profil et aux groupes cessent immédiatement",
  "Withdraw social consent?": "Retirer le consentement social ?",
  "Your profile turns off and future social access stops. Existing moderation and consent audit records remain as required for safety.":
    "Votre profil est désactivé et les futurs accès sociaux cessent. Les traces de modération et de consentement existantes sont conservées pour la sécurité.",
  Withdraw: "Retirer",
  "Social data controls": "Contrôles des données sociales",
  "Export my social data": "Exporter mes données sociales",
  "My Avermate social data": "Mes données sociales Avermate",
  "The export opens the system share sheet only after your explicit action. Review the destination because it contains your social history.":
    "L’export ouvre la feuille de partage système uniquement après votre action explicite. Vérifiez la destination, car il contient votre historique social.",
  "Reset all social data": "Réinitialiser toutes les données sociales",
  "Reset all social data?": "Réinitialiser toutes les données sociales ?",
  "This permanently removes your social profile, friendships, circles, group memberships, invitations and sharing decisions. Your private grades remain.":
    "Cela supprime définitivement votre profil social, vos amitiés, cercles, adhésions aux groupes, invitations et décisions de partage. Vos notes privées restent intactes.",
  Reset: "Réinitialiser",
  "The social data action could not be completed.":
    "Impossible d’effectuer l’action sur les données sociales.",
  "Add by exact handle": "Ajouter par identifiant exact",
  "Message (optional)": "Message (facultatif)",
  "A short context without personal contact details":
    "Un court contexte sans coordonnées personnelles",
  "Send request": "Envoyer la demande",
  "Avermate gives the same response for unknown, blocked and unavailable handles, so this form cannot be used as an account directory.":
    "Avermate renvoie la même réponse pour les identifiants inconnus, bloqués et indisponibles ; ce formulaire ne peut donc pas servir d’annuaire.",
  "If that exact handle can receive requests, the invitation is now pending.":
    "Si cet identifiant exact peut recevoir des demandes, l’invitation est maintenant en attente.",
  "The friend request could not be sent. Try again later.":
    "Impossible d’envoyer la demande d’ami. Réessayez plus tard.",
  "Use a private invitation link instead":
    "Utiliser plutôt un lien d’invitation privé",
  "Requests could not be refreshed. Cached friends stay visible.":
    "Impossible d’actualiser les demandes. Les amis en cache restent visibles.",
  "Requests to you": "Demandes reçues",
  "Private account": "Compte privé",
  Accept: "Accepter",
  Decline: "Refuser",
  Block: "Bloquer",
  Report: "Signaler",
  "Sent requests": "Demandes envoyées",
  "Pending invitation": "Invitation en attente",
  "Waiting for a response": "En attente d’une réponse",
  "Your friends": "Vos amis",
  "Friends could not be refreshed": "Impossible d’actualiser les amis",
  "Reconnect to verify the latest privacy grants.":
    "Reconnectez-vous pour vérifier les dernières autorisations de confidentialité.",
  "No accepted friends yet": "Aucun ami accepté pour le moment",
  "Friendships appear here only after mutual acceptance.":
    "Les amitiés apparaissent ici uniquement après une acceptation mutuelle.",
  "Private friend": "Ami au profil privé",
  "View exact shared profile": "Voir le profil partagé exact",
  "Friend circles": "Cercles d’amis",
  "Give selected friends different profile permissions":
    "Accorder des autorisations de profil différentes à certains amis",
  "Blocked accounts": "Comptes bloqués",
  "Requests and discovery stop in both directions":
    "Les demandes et la découverte cessent dans les deux sens",
  "That account could not be blocked.": "Impossible de bloquer ce compte.",
  "Shared profile": "Profil partagé",
  "This profile is no longer available": "Ce profil n’est plus disponible",
  "The friendship, profile status or sharing permissions may have changed.":
    "L’amitié, l’état du profil ou les autorisations de partage ont peut-être changé.",
  "Back to friends": "Retour aux amis",
  "Privacy boundary": "Limite de confidentialité",
  "Choose what I share with this friend":
    "Choisir ce que je partage avec cet ami",
  "this friend": "cet ami",
  "Only fields this friend explicitly granted to you are present. Empty fields are not inferred or replaced with account data.":
    "Seuls les champs explicitement partagés par cet ami sont présents. Les champs vides ne sont ni déduits ni remplacés par des données de compte.",
  "Relationship actions": "Actions sur la relation",
  "Remove friendship": "Supprimer l’amitié",
  "Remove this friend?": "Supprimer cet ami ?",
  "Both profiles stop being shared and circle membership is removed.":
    "Les deux profils cessent d’être partagés et l’appartenance aux cercles est supprimée.",
  Remove: "Supprimer",
  "Block account": "Bloquer le compte",
  "Block this account?": "Bloquer ce compte ?",
  "Friendship, requests, circle membership and sharing stop in both directions.":
    "L’amitié, les demandes, l’appartenance aux cercles et le partage cessent dans les deux sens.",
  "Report a safety concern": "Signaler un problème de sécurité",
  "That action could not be completed. Refresh and try again.":
    "Impossible d’effectuer cette action. Actualisez puis réessayez.",
  "New circle": "Nouveau cercle",
  "Circle name": "Nom du cercle",
  "Close friends": "Amis proches",
  "Create circle": "Créer le cercle",
  "The circle could not be created.": "Impossible de créer le cercle.",
  "Your circles": "Vos cercles",
  "Circles could not be refreshed": "Impossible d’actualiser les cercles",
  "Reconnect before changing profile permissions.":
    "Reconnectez-vous avant de modifier les autorisations du profil.",
  "No circles yet": "Aucun cercle pour le moment",
  "A circle groups accepted friends for more precise field permissions.":
    "Un cercle regroupe des amis acceptés pour définir des autorisations de champ plus précises.",
  "{count} members": "{count} membres",
  "Friend circle": "Cercle d’amis",
  "This circle could not be loaded": "Impossible de charger ce cercle",
  "It may have been deleted or changed in another session.":
    "Il a peut-être été supprimé ou modifié dans une autre session.",
  "The circle changed elsewhere. It has been refreshed.":
    "Le cercle a été modifié ailleurs. Il a été actualisé.",
  Members: "Membres",
  "No members in this circle": "Aucun membre dans ce cercle",
  "Only accepted friends can be added.":
    "Seuls les amis acceptés peuvent être ajoutés.",
  "Remove from circle": "Retirer du cercle",
  "Add accepted friends": "Ajouter des amis acceptés",
  "Add to {circle}": "Ajouter à {circle}",
  "Membership changed elsewhere. Refresh and try again.":
    "L’appartenance a été modifiée ailleurs. Actualisez puis réessayez.",
  "Delete circle": "Supprimer le cercle",
  "Circle privacy": "Confidentialité du cercle",
  "Choose fields shared with this circle":
    "Choisir les champs partagés avec ce cercle",
  "Delete this circle?": "Supprimer ce cercle ?",
  "Circle-specific sharing stops. Friendships are not removed.":
    "Le partage propre au cercle cesse. Les amitiés ne sont pas supprimées.",
  "Blocking removes friendship, pending requests, circle membership and sharing in both directions. Unblocking never recreates them.":
    "Le blocage supprime l’amitié, les demandes en attente, l’appartenance aux cercles et le partage dans les deux sens. Le déblocage ne les recrée jamais.",
  "Blocked by you": "Bloqués par vous",
  "Blocked accounts could not be refreshed.":
    "Impossible d’actualiser les comptes bloqués.",
  "No blocked accounts": "Aucun compte bloqué",
  "Unavailable profile": "Profil indisponible",
  "You can block from a friend profile or an incoming request.":
    "Vous pouvez bloquer depuis le profil d’un ami ou une demande reçue.",
  Unblock: "Débloquer",
  "Unblock this account?": "Débloquer ce compte ?",
  "No friendship or sharing permission will be restored automatically.":
    "Aucune amitié ni autorisation de partage ne sera restaurée automatiquement.",
  "Private invitations": "Invitations privées",
  "Create an invitation": "Créer une invitation",
  "Each link is single-use and expires after seven days. Share it only with the intended person.":
    "Chaque lien est à usage unique et expire après sept jours. Partagez-le uniquement avec la personne concernée.",
  "Create private link": "Créer un lien privé",
  "The link is ready. For safety, this is the only time its secret can be displayed.":
    "Le lien est prêt. Par sécurité, c’est la seule fois où son secret peut être affiché.",
  "Share now": "Partager maintenant",
  "Set discovery to Invitation links only in your social profile, then try again.":
    "Réglez la découverte sur Liens d’invitation uniquement dans votre profil social, puis réessayez.",
  "Invitation history": "Historique des invitations",
  "Invitation history could not be refreshed.":
    "Impossible d’actualiser l’historique des invitations.",
  "No invitation links": "Aucun lien d’invitation",
  "Create one when an exact handle is not appropriate.":
    "Créez-en un lorsqu’un identifiant exact n’est pas approprié.",
  Used: "Utilisée",
  Revoked: "Révoquée",
  Expired: "Expirée",
  "Invitation · {prefix}": "Invitation · {prefix}",
  "Avermate friend invitation": "Invitation d’ami Avermate",
  "Open this private, single-use Avermate invitation: {url}":
    "Ouvrez cette invitation Avermate privée et à usage unique : {url}",
  "Friend invitation": "Invitation d’ami",
  "This invitation is unavailable": "Cette invitation est indisponible",
  "It may be expired, revoked, already used, blocked or unavailable.":
    "Elle est peut-être expirée, révoquée, déjà utilisée, bloquée ou indisponible.",
  "Invitation from": "Invitation de",
  "Accept friendship": "Accepter l’amitié",
  "Not now": "Pas maintenant",
  "Friendship accepted. Only explicit profile grants are now visible.":
    "Amitié acceptée. Seules les autorisations de profil explicites sont désormais visibles.",
  "Open friends": "Ouvrir les amis",
  "The invitation could not be accepted.":
    "Impossible d’accepter l’invitation.",
  "Activate a friend profile before accepting. The invitation is not consumed.":
    "Activez un profil d’ami avant d’accepter. L’invitation n’est pas consommée.",
  "Complete social consent before accepting. The invitation is not consumed.":
    "Terminez le consentement social avant d’accepter. L’invitation n’est pas consommée.",
  "Activate friend profile": "Activer le profil d’ami",
  "Set up social": "Configurer le social",
  "Profile picture for {name}": "Photo de profil de {name}",
  "Middle school": "Collège",
  "High school": "Lycée",
  "Higher education": "Enseignement supérieur",
  "Other education": "Autre niveau d’études",
  "Not specified": "Non précisé",
  Class: "Classe",
  "Study group": "Groupe d’étude",
  "Friends group": "Groupe d’amis",
  "Normalized average": "Moyenne normalisée",
  "Trend range": "Plage de tendance",
  "Success-rate range": "Plage de taux de réussite",
  "Activity range": "Plage d’activité",
  "Goal progress range": "Plage de progression des objectifs",
  "Group aggregate only": "Agrégat du groupe uniquement",
  "Visible to participating members": "Visible par les membres participants",
  "Eligible for an optional ranking": "Éligible à un classement facultatif",
  "Every group has a versioned policy. Joining never starts academic sharing until you accept the exact current fields and choose a school year.":
    "Chaque groupe possède une politique versionnée. Rejoindre ne démarre aucun partage scolaire avant d’avoir accepté les champs exacts actuels et choisi une année scolaire.",
  "Create a group": "Créer un groupe",
  "Your groups": "Vos groupes",
  "Groups could not be refreshed.": "Impossible d’actualiser les groupes.",
  "No groups yet": "Aucun groupe pour le moment",
  "Create one or open a private invitation link.":
    "Créez-en un ou ouvrez un lien d’invitation privé.",
  "Review updated sharing policy":
    "Vérifier la politique de partage mise à jour",
  "Create with this policy": "Créer avec cette politique",
  "Group identity": "Identité du groupe",
  "Group name": "Nom du groupe",
  Description: "Description",
  "Group type": "Type de groupe",
  "Self-declared class": "Classe autodéclarée",
  "I confirm this class is self-declared":
    "Je confirme que cette classe est autodéclarée",
  "It is not an official enrolment record or school-verified directory.":
    "Il ne s’agit ni d’une inscription officielle ni d’un annuaire vérifié par l’établissement.",
  "Your group alias": "Votre pseudonyme dans le groupe",
  "A name group members will see": "Un nom visible par les membres du groupe",
  "School year used for your derived metrics":
    "Année scolaire utilisée pour vos indicateurs dérivés",
  "Version 1 sharing policy": "Politique de partage version 1",
  Purpose: "Finalité",
  "Why these aggregated metrics help this group":
    "Pourquoi ces indicateurs agrégés sont utiles à ce groupe",
  "Who is expected to join": "Qui est censé rejoindre",
  "For example: students in the same study project":
    "Par exemple : élèves du même projet d’étude",
  "Time window": "Période analysée",
  "Current academic year": "Année scolaire actuelle",
  "Last 90 days": "90 derniers jours",
  "Last 30 days": "30 derniers jours",
  "Derived metrics": "Indicateurs dérivés",
  "Aggregate-only is the default. Raw grades, subjects, comments and dates can never be selected.":
    "L’agrégat seul est la valeur par défaut. Les notes brutes, matières, commentaires et dates ne peuvent jamais être sélectionnés.",
  Visibility: "Visibilité",
  "Required to participate": "Obligatoire pour participer",
  "People who decline a required field cannot activate membership under this policy.":
    "Une personne refusant un champ obligatoire ne peut pas activer son adhésion sous cette politique.",
  "Allow optional named rankings":
    "Autoriser les classements nominatifs facultatifs",
  "Still off for every member until a separate opt-in; privacy thresholds always apply.":
    "Ils restent désactivés pour chaque membre jusqu’à un accord distinct ; les seuils de confidentialité s’appliquent toujours.",
  "Your consent": "Votre consentement",
  "I accept every required field in version 1":
    "J’accepte chaque champ obligatoire de la version 1",
  "Changing the policy creates a new immutable version and requires consent again.":
    "Modifier la politique crée une nouvelle version immuable et exige un nouveau consentement.",
  "The group could not be created.": "Impossible de créer le groupe.",
  Owner: "Propriétaire",
  Moderator: "Modérateur",
  Member: "Membre",
  Group: "Groupe",
  "This group could not be loaded": "Impossible de charger ce groupe",
  "Access may have changed. Reconnect before making a sharing decision.":
    "L’accès a peut-être changé. Reconnectez-vous avant toute décision de partage.",
  "Shared statistics": "Statistiques partagées",
  "Unavailable metric": "Indicateur indisponible",
  "Aggregates, ranges and optional rankings":
    "Agrégats, plages et classements facultatifs",
  "No active members": "Aucun membre actif",
  "Members awaiting consent do not expose metrics.":
    "Les membres en attente de consentement n’exposent aucun indicateur.",
  "Consent required": "Consentement requis",
  "Make member": "Passer membre",
  "Make moderator": "Passer modérateur",
  "Transfer ownership": "Transférer la propriété",
  "Transfer group ownership?": "Transférer la propriété du groupe ?",
  "You become a regular member and cannot undo this without the new owner.":
    "Vous devenez membre ordinaire et ne pourrez pas annuler sans le nouveau propriétaire.",
  Transfer: "Transférer",
  "Remove from group": "Retirer du groupe",
  "Block member": "Bloquer le membre",
  "Report member": "Signaler le membre",
  "Group actions": "Actions du groupe",
  "Manage invitation links": "Gérer les liens d’invitation",
  "Group settings and policy": "Réglages et politique du groupe",
  "Withdraw sharing consent": "Retirer le consentement de partage",
  "Report this group": "Signaler ce groupe",
  "Leave group": "Quitter le groupe",
  "Transfer ownership before leaving this group.":
    "Transférez la propriété avant de quitter ce groupe.",
  "The group action could not be completed. Refresh and try again.":
    "Impossible d’effectuer l’action sur le groupe. Actualisez puis réessayez.",
  "Avermate group invitation": "Invitation à un groupe Avermate",
  "Review the current group policy before joining: {url}":
    "Vérifiez la politique actuelle du groupe avant de rejoindre : {url}",
  "Group invitations": "Invitations au groupe",
  "Create a single-use link": "Créer un lien à usage unique",
  "Target email (optional)": "E-mail destinataire (facultatif)",
  "Restrict this link to one verified account":
    "Limiter ce lien à un seul compte vérifié",
  "The invitation is bound to the current policy version. Any policy update invalidates unused old links.":
    "L’invitation est liée à la version actuelle de la politique. Toute mise à jour invalide les anciens liens non utilisés.",
  "Create invitation": "Créer l’invitation",
  "This is the only time the secret invitation link can be displayed.":
    "C’est la seule fois où le lien d’invitation secret peut être affiché.",
  "The invitation could not be created.": "Impossible de créer l’invitation.",
  "Email-restricted": "Limité à un e-mail",
  "Owner access required": "Accès propriétaire requis",
  "No group setting was changed.": "Aucun réglage du groupe n’a été modifié.",
  "Group settings": "Réglages du groupe",
  "Save group": "Enregistrer le groupe",
  "Group saved.": "Groupe enregistré.",
  "Sharing policy": "Politique de partage",
  "Editing a policy always creates a new immutable version, pauses every membership and disables ranking opt-ins until people consent again.":
    "Modifier une politique crée toujours une nouvelle version immuable, suspend toutes les adhésions et désactive les accords aux classements jusqu’à un nouveau consentement.",
  "Create a new policy version": "Créer une nouvelle version de politique",
  "Group lifecycle": "Cycle de vie du groupe",
  "Restore group": "Restaurer le groupe",
  "Archive group": "Archiver le groupe",
  "Delete group permanently": "Supprimer définitivement le groupe",
  "Delete this group permanently?": "Supprimer définitivement ce groupe ?",
  "Memberships, invitations, consents and group statistics are removed. This cannot be undone.":
    "Les adhésions, invitations, consentements et statistiques du groupe sont supprimés. Cette action est définitive.",
  "The group changed elsewhere. Refresh and try again.":
    "Le groupe a été modifié ailleurs. Actualisez puis réessayez.",
  "Top quartile": "Quart supérieur",
  "Upper-middle quartile": "Quart intermédiaire supérieur",
  "Lower-middle quartile": "Quart intermédiaire inférieur",
  "Bottom quartile": "Quart inférieur",
  "Not participating": "Non participant",
  "No social data was requested.": "Aucune donnée sociale n’a été demandée.",
  "This metric is not in the current policy":
    "Cet indicateur ne figure pas dans la politique actuelle",
  "The group policy may have changed. Return to the group and review it.":
    "La politique du groupe a peut-être changé. Revenez au groupe pour la vérifier.",
  "Accept the exact current policy before group statistics become available.":
    "Acceptez la politique actuelle exacte avant d’accéder aux statistiques du groupe.",
  "Group statistics could not be refreshed.":
    "Impossible d’actualiser les statistiques du groupe.",
  "Protected until the group is large enough":
    "Protégé tant que le groupe n’est pas assez grand",
  "Consent is required first.": "Le consentement est d’abord requis.",
  "Only {count} consenting members currently contribute; at least {required} are required.":
    "Seuls {count} membres consentants contribuent actuellement ; au moins {required} sont requis.",
  "Group aggregate": "Agrégat du groupe",
  "Built only from members who accepted this metric under policy version {version}.":
    "Calculé uniquement avec les membres ayant accepté cet indicateur sous la politique version {version}.",
  Minimum: "Minimum",
  Median: "Médiane",
  Maximum: "Maximum",
  "Middle half": "Moitié centrale",
  "Protected small bucket": "Petite catégorie protégée",
  "Optional ranking": "Classement facultatif",
  "This is a second opt-in. Under-18 accounts receive only a private percentile band; adult names appear only after the ranking threshold is met.":
    "Il s’agit d’un second accord. Les comptes mineurs reçoivent uniquement une plage de percentile privée ; les noms adultes n’apparaissent qu’une fois le seuil de classement atteint.",
  "Participate in this ranking": "Participer à ce classement",
  "This affects only this metric and can be switched off at any time.":
    "Cela concerne uniquement cet indicateur et peut être désactivé à tout moment.",
  "Ranking participation is enabled for this metric.":
    "La participation au classement est activée pour cet indicateur.",
  "Ranking participation is disabled for this metric.":
    "La participation au classement est désactivée pour cet indicateur.",
  "Ranking preference or results could not be refreshed.":
    "Impossible d’actualiser la préférence ou les résultats du classement.",
  "The named ranking stays hidden until its separate privacy threshold is met.":
    "Le classement nominatif reste masqué jusqu’à ce que son seuil de confidentialité distinct soit atteint.",
  "Your private position": "Votre position privée",
  "No policy was changed.": "Aucune politique n’a été modifiée.",
  "New policy version": "Nouvelle version de politique",
  "Publish version {version}": "Publier la version {version}",
  "Purpose and audience": "Finalité et public",
  "Who is expected to participate": "Qui est censé participer",
  "Reconsent impact": "Impact du nouveau consentement",
  "Publishing pauses every membership, clears ranking opt-ins and requires each person to review the new immutable policy before any further sharing.":
    "La publication suspend toutes les adhésions, efface les accords aux classements et exige que chacun vérifie la nouvelle politique immuable avant tout nouveau partage.",
  "I understand everyone must consent again":
    "Je comprends que tout le monde doit consentir à nouveau",
  "The policy could not be published.": "Impossible de publier la politique.",
  "Group invitation": "Invitation à un groupe",
  "It may be expired, used, revoked, blocked or tied to an older policy.":
    "Elle est peut-être expirée, utilisée, révoquée, bloquée ou liée à une ancienne politique.",
  "You were invited to": "Vous avez été invité à",
  "Created by {alias}{selfDeclared}": "Créé par {alias}{selfDeclared}",
  "self-declared identity": "identité autodéclarée",
  "Join without sharing yet": "Rejoindre sans encore partager",
  "Accepting this invitation creates a pending membership only. You choose metrics and school year on the next screen.":
    "Accepter cette invitation crée uniquement une adhésion en attente. Vous choisirez les indicateurs et l’année scolaire à l’écran suivant.",
  "Continue to consent choices": "Continuer vers les choix de consentement",
  "Decline invitation": "Refuser l’invitation",
  "The invitation decision could not be saved.":
    "Impossible d’enregistrer la décision sur l’invitation.",
  "Complete social consent before joining. The invitation is not consumed and no group data is shared.":
    "Terminez le consentement social avant de rejoindre. L’invitation n’est pas consommée et aucune donnée de groupe n’est partagée.",
  "New friend request": "Nouvelle demande d’ami",
  "Friend request accepted": "Demande d’ami acceptée",
  "Private invitation accepted": "Invitation privée acceptée",
  "A member joined your group": "Un membre a rejoint votre groupe",
  "A group sharing policy changed":
    "Une politique de partage de groupe a changé",
  "Guardian consent accepted": "Consentement du responsable légal accepté",
  "Guardian consent declined": "Consentement du responsable légal refusé",
  "Social access paused by moderation":
    "Accès social suspendu par la modération",
  "Social update": "Actualité sociale",
  "Social notifications": "Notifications sociales",
  "Latest updates": "Dernières actualités",
  "Mark all read": "Tout marquer comme lu",
  "Notifications could not be refreshed.":
    "Impossible d’actualiser les notifications.",
  "No social updates": "Aucune actualité sociale",
  "Friend, group, consent and moderation changes appear here.":
    "Les changements concernant les amis, groupes, consentements et la modération apparaissent ici.",
  Unread: "Non lu",
  "Your safety reports": "Vos signalements de sécurité",
  "View submitted reports": "Voir les signalements envoyés",
  "Invalid report target": "Cible de signalement invalide",
  "No report was sent.": "Aucun signalement n’a été envoyé.",
  "What happened?": "Que s’est-il passé ?",
  Harassment: "Harcèlement",
  "Privacy violation": "Atteinte à la vie privée",
  Impersonation: "Usurpation d’identité",
  "Unsafe content": "Contenu dangereux",
  Other: "Autre",
  "Describe the concern": "Décrire le problème",
  "Include useful context without copying grades or unnecessary personal data":
    "Ajoutez le contexte utile sans copier de notes ni de données personnelles inutiles",
  "Reports go to Avermate’s admin moderation queue, not Discord. Blocking remains a separate immediate action.":
    "Les signalements arrivent dans la file de modération de l’administration Avermate, pas sur Discord. Le blocage reste une action immédiate distincte.",
  "Submit report": "Envoyer le signalement",
  "Report submitted. You can follow its status without exposing the reported account.":
    "Signalement envoyé. Vous pouvez suivre son état sans exposer le compte signalé.",
  "The report could not be submitted. Try again later.":
    "Impossible d’envoyer le signalement. Réessayez plus tard.",
  "Under review": "En cours d’examen",
  Resolved: "Résolu",
  Dismissed: "Classé sans suite",
  "Submitted reports": "Signalements envoyés",
  "Moderation status": "État de la modération",
  "Report status could not be refreshed.":
    "Impossible d’actualiser l’état des signalements.",
  "No submitted reports": "Aucun signalement envoyé",
  "Safety reports you create appear here without identifying the target.":
    "Vos signalements de sécurité apparaissent ici sans identifier leur cible.",
  "Group statistics": "Statistiques du groupe",
  "Your explicit choices": "Vos choix explicites",
  "Select only the derived metrics you agree to share. Raw grades, subject names, comments and dates stay excluded.":
    "Sélectionnez uniquement les indicateurs dérivés que vous acceptez de partager. Les notes brutes, noms de matières, commentaires et dates restent exclus.",
  Required: "Obligatoire",
  Optional: "Facultatif",
  "School year used to derive these metrics":
    "Année scolaire utilisée pour calculer ces indicateurs",
  "I accept this exact policy version":
    "J’accepte cette version exacte de la politique",
  "A future policy version stops sharing and asks for consent again.":
    "Une future version de la politique arrête le partage et demande à nouveau votre consentement.",
  "Accept selected fields and join":
    "Accepter les champs sélectionnés et rejoindre",
  "Consent could not be saved. The policy may have changed; refresh before deciding again.":
    "Impossible d’enregistrer le consentement. La politique a peut-être changé ; actualisez avant de décider à nouveau.",
  "Sharing policy · version {version}":
    "Politique de partage · version {version}",
  "Named rankings still require a separate personal opt-in and the minimum privacy threshold.":
    "Les classements nominatifs exigent toujours un accord personnel distinct et le seuil minimal de confidentialité.",
  "Insufficient data": "Données insuffisantes",
  Improving: "En progression",
  Stable: "Stable",
  Declining: "En baisse",
  High: "Élevé",
  Medium: "Moyen",
  Low: "Faible",
  "Protected range": "Plage protégée",
  "Sharing permissions": "Autorisations de partage",
  "Invalid sharing target": "Cible de partage invalide",
  "No permission was changed.": "Aucune autorisation n’a été modifiée.",
  "Sharing with {target}": "Partage avec {target}",
  "this audience": "ce public",
  "Additional fields for this audience":
    "Champs supplémentaires pour ce public",
  "These permissions add to any friend-wide grant. Avermate never infers a missing field.":
    "Ces autorisations s’ajoutent au partage accordé à tous les amis. Avermate ne déduit jamais un champ absent.",
  "Exact preview for this audience": "Aperçu exact pour ce public",
  "The exact preview could not be verified.":
    "Impossible de vérifier l’aperçu exact.",
  Copy: "Copie",
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
