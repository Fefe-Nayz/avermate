import {
  BookMarkedIcon,
  BookOpenCheckIcon,
  BrainCircuitIcon,
  CalendarRangeIcon,
  ChartNoAxesCombinedIcon,
  CloudCogIcon,
  CompassIcon,
  CpuIcon,
  FunctionSquareIcon,
  FolderOpenIcon,
  FolderKanbanIcon,
  InfoIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  PaletteIcon,
  PlugIcon,
  ScrollTextIcon,
  ServerCogIcon,
  SlidersHorizontalIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SparklesIcon,
  TagsIcon,
  TargetIcon,
  UserRoundIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * The app's routes, declared once.
 *
 * The sidebar, the mobile tab bar, the breadcrumb and the command palette all
 * read from this list, so a new screen appears in every navigation surface at
 * the same time and can never be reachable from only one of them.
 */

export interface NavEntry {
  href: string
  /** Source-language label; screens translate it through `useExtracted`. */
  label: string
  icon: LucideIcon
  /** Extra path prefixes that should light this entry up. */
  matches?: string[]
  /** Shown in the mobile tab bar. */
  tab?: boolean
  adminOnly?: boolean
}

export const NAV_ENTRIES: NavEntry[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboardIcon,
    tab: true,
  },
  {
    href: "/subjects",
    label: "Subjects",
    icon: BookMarkedIcon,
    tab: true,
  },
  {
    href: "/grades",
    label: "Grades",
    icon: ListChecksIcon,
    tab: true,
  },
  {
    href: "/materials",
    label: "Materials",
    icon: FolderOpenIcon,
  },
  {
    href: "/projects",
    label: "Study projects",
    icon: FolderKanbanIcon,
  },
  {
    href: "/learning",
    label: "Learning",
    icon: BookOpenCheckIcon,
  },
  {
    href: "/assistant",
    label: "Assistant",
    icon: BrainCircuitIcon,
  },
  {
    href: "/goals",
    label: "Goals",
    icon: TargetIcon,
  },
  {
    href: "/planning",
    label: "Planning",
    icon: CalendarRangeIcon,
    matches: ["/agenda"],
  },
  {
    href: "/insights",
    label: "Insights",
    icon: ChartNoAxesCombinedIcon,
  },
  {
    href: "/social",
    label: "Social",
    icon: UsersRoundIcon,
  },
  {
    href: "/review",
    label: "Year in review",
    icon: SparklesIcon,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
  },
  {
    href: "/admin",
    label: "Admin",
    icon: ShieldIcon,
    adminOnly: true,
  },
]

export interface SettingsSection {
  href: string
  /** Source-language label; screens translate it through `useExtracted`. */
  label: string
  icon: LucideIcon
  /** Search-only vocabulary for controls and concepts inside the section. */
  searchTerms?: readonly string[]
  /** Concrete settings inside the page, used by the cross-page search. */
  items?: readonly SettingsSearchItem[]
  /** Lit only on an exact match: `/settings` is a page, not a section root. */
  exact?: boolean
}

export interface SettingsSearchItem {
  href: string
  /** Source-language label translated by `useSettingsSections`. */
  label: string
  searchTerms?: readonly string[]
}

/**
 * The settings screens, declared once — for the same reason as above.
 *
 * This list existed and was read by nothing: the desktop rail kept its own
 * copy, which grew two sections this one never heard about, and the account hub
 * on a phone hand-picked four of them. The rail is `hidden md:block`, so those
 * five sections — Navigation, Year preset, Custom averages, Account,
 * Integrations — could not be reached on a phone at all. Nothing was broken;
 * there were simply three lists and only one of them was ever complete.
 *
 * Both surfaces now render this, so a new settings screen reaches the phone and
 * the desktop at the same time or neither.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    href: "/settings",
    label: "Profile",
    icon: UserRoundIcon,
    exact: true,
    searchTerms: ["name avatar language nom photo langue"],
    items: [
      {
        href: "/settings#profile-identity",
        label: "Who you are",
        searchTerms: ["identity profile nom photo identité profil"],
      },
      {
        href: "/settings#profile-identity",
        label: "Name and profile photo",
        searchTerms: ["avatar nom photo identité"],
      },
      {
        href: "/settings#profile-language",
        label: "Language",
        searchTerms: ["locale français english langue"],
      },
    ],
  },
  {
    href: "/settings/appearance",
    label: "Appearance",
    icon: PaletteIcon,
    searchTerms: [
      "theme colors density charts thème couleurs densité graphiques",
    ],
    items: [
      {
        href: "/settings/appearance#theme",
        label: "Match my device",
        searchTerms: ["theme mode system light dark appareil clair sombre"],
      },
      {
        href: "/settings/appearance#cards",
        label: "Theme and colors",
        searchTerms: ["color colour colors couleurs palette accents"],
      },
      {
        href: "/settings/appearance#cards",
        label: "Colour and theme",
        searchTerms: ["color colour colors couleurs theme thème palette"],
      },
      {
        href: "/settings/appearance#cards",
        label: "Build my own",
        searchTerms: ["custom theme personnaliser créer couleurs studio"],
      },
      {
        href: "/settings/appearance#cards",
        label: "Accents",
        searchTerms: ["color colour colors couleurs palette accent"],
      },
      {
        href: "/settings/appearance#typography",
        label: "Typography",
        searchTerms: ["font police taille texte"],
      },
      {
        href: "/settings/appearance#typography",
        label: "Typography and shape",
        searchTerms: ["font police forme shape radius arrondi"],
      },
      {
        href: "/settings/appearance#typography",
        label: "Body font",
        searchTerms: ["font family police corps sans serif reading lecture"],
      },
      {
        href: "/settings/appearance#typography",
        label: "Heading font",
        searchTerms: ["font family police titres heading display"],
      },
      {
        href: "/settings/appearance#cards",
        label: "Cards and density",
        searchTerms: ["compact spacing densité cartes espacement"],
      },
      {
        href: "/settings/appearance#cards",
        label: "Corner rounding",
        searchTerms: ["radius rounded corners arrondi rayon angles cartes"],
      },
      {
        href: "/settings/appearance#seasonal",
        label: "Enable seasonal themes",
        searchTerms: ["season seasonal saison thèmes automne hiver printemps"],
      },
      {
        href: "/settings/appearance#seasonal",
        label: "Seasonal touches",
        searchTerms: ["season seasonal saison thèmes automne hiver printemps"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Charts",
        searchTerms: ["graph graphs graphiques axes"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Zoom to the data",
        searchTerms: ["axis domain scale zoom données axe échelle graphique"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Show the trend line",
        searchTerms: ["trend tendance courbe moyenne graphique"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Trend detail",
        searchTerms: ["segments subdivisions tendance détail courbe"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Show child subject series",
        searchTerms: ["children subsubjects séries sous matières graphique"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Mark each point",
        searchTerms: ["dots points notes marqueurs graphique"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Join the grade dots",
        searchTerms: ["connect relier points notes ligne graphique"],
      },
      {
        href: "/settings/appearance#charts",
        label: "Line style",
        searchTerms: ["curve smooth straight courbe lisse droite graphique"],
      },
      {
        href: "/settings/appearance#motion",
        label: "Motion and haptics",
        searchTerms: ["animation reduced motion vibrations haptique"],
      },
      {
        href: "/settings/appearance#motion",
        label: "Feel",
        searchTerms: ["motion haptic animation mouvement haptique sensation"],
      },
      {
        href: "/settings/appearance#motion",
        label: "Haptic feedback",
        searchTerms: ["vibration vibrations retour haptique feedback tactile"],
      },
      {
        href: "/settings/appearance#motion",
        label: "Reduce motion",
        searchTerms: ["animation motion mouvement réduit accessibilité"],
      },
    ],
  },
  {
    href: "/settings/navigation",
    label: "Navigation",
    icon: CompassIcon,
    searchTerms: ["sidebar mobile tabs barre latérale onglets"],
    items: [
      {
        href: "/settings/navigation#sidebar",
        label: "Sidebar navigation",
        searchTerms: ["desktop barre latérale"],
      },
      {
        href: "/settings/navigation#sidebar",
        label: "Button at the top",
        searchTerms: ["quick add action bouton raccourci sidebar"],
      },
      {
        href: "/settings/navigation#mobile-navigation",
        label: "Mobile navigation",
        searchTerms: ["tabs onglets téléphone"],
      },
      {
        href: "/settings/navigation#mobile-navigation",
        label: "Phone tab bar",
        searchTerms: ["mobile phone tabs téléphone barre onglets"],
      },
    ],
  },
  {
    href: "/settings/year",
    label: "Year & periods",
    icon: CalendarRangeIcon,
    searchTerms: [
      "school year term semester trimestre semestre année périodes",
    ],
    items: [
      {
        href: "/settings/year#academic-year",
        label: "Academic year",
        searchTerms: ["dates barème scale année scolaire"],
      },
      {
        href: "/settings/year#academic-year",
        label: "This year",
        searchTerms: ["current academic year année scolaire actuelle"],
      },
      {
        href: "/settings/year#academic-year",
        label: "Year name",
        searchTerms: ["name nom année year"],
      },
      {
        href: "/settings/year#academic-year",
        label: "Starts",
        searchTerms: ["start beginning date début rentrée"],
      },
      {
        href: "/settings/year#academic-year",
        label: "Ends",
        searchTerms: ["end finish date fin vacances"],
      },
      {
        href: "/settings/year#academic-year",
        label: "Averages out of",
        searchTerms: ["average scale barème moyenne sur"],
      },
      {
        href: "/settings/year#academic-year",
        label: "New grades out of",
        searchTerms: ["default grade scale barème notes sur"],
      },
      {
        href: "/settings/year#academic-year",
        label: "Pass mark",
        searchTerms: ["passing threshold seuil réussite moyenne"],
      },
      {
        href: "/settings/year#academic-year",
        label: "Decimal places",
        searchTerms: ["precision decimals décimales arrondi"],
      },
      {
        href: "/settings/year#periods",
        label: "Periods",
        searchTerms: ["term semester trimestre semestre périodes"],
      },
      {
        href: "/settings/year#school-years",
        label: "School years",
        searchTerms: ["archive switch change années scolaires historique"],
      },
      {
        href: "/settings/year#general-average",
        label: "The general average",
        searchTerms: ["main average moyenne générale custom formula formule"],
      },
      {
        href: "/subjects",
        label: "Subjects",
        searchTerms: ["matières coefficients categories"],
      },
    ],
  },
  {
    href: "/settings/adjustments",
    label: "Average adjustments",
    icon: SlidersHorizontalIcon,
    searchTerms: [
      "bonus average period subject adjustment moyenne période matière ajustement",
    ],
    items: [
      {
        href: "/settings/adjustments#period-adjustments",
        label: "General average bonus by period",
        searchTerms: ["points trimestre semestre moyenne générale"],
      },
      {
        href: "/settings/adjustments#period-adjustments",
        label: "Subject bonus by period",
        searchTerms: ["points matière trimestre semestre"],
      },
    ],
  },
  {
    href: "/settings/preset",
    label: "Year preset",
    icon: ScrollTextIcon,
    searchTerms: ["template school model modèle établissement préréglage"],
    items: [
      {
        href: "/settings/preset#year-template",
        label: "School year template",
        searchTerms: ["preset modèle établissement matières"],
      },
    ],
  },
  {
    href: "/settings/averages",
    label: "Custom averages",
    icon: FunctionSquareIcon,
    searchTerms: ["formula coefficients subjects formule matières"],
    items: [
      {
        href: "/settings/averages",
        label: "Custom average formulas",
        searchTerms: ["coefficients matières formule"],
      },
    ],
  },
  // Beside the custom averages: both are short lists of things this year holds that the
  // reader defined, and both are read from the same screen when setting a year up.
  {
    href: "/settings/grade-types",
    label: "Assessment types",
    icon: TagsIcon,
    searchTerms: ["exam test oral ds devoir évaluation barème"],
    items: [
      {
        href: "/settings/grade-types",
        label: "Assessment types and scales",
        searchTerms: ["exam test oral ds devoir barème coefficient"],
      },
    ],
  },
  {
    href: "/settings/account",
    label: "Account",
    icon: ShieldCheckIcon,
    searchTerms: [
      "email password security sessions mot de passe sécurité compte",
    ],
    items: [
      { href: "/settings/account#email", label: "Email address" },
      {
        href: "/settings/account#password",
        label: "Password",
        searchTerms: ["mot de passe"],
      },
      {
        href: "/settings/account#password",
        label: "Current password",
        searchTerms: ["old existing actuel mot de passe"],
      },
      {
        href: "/settings/account#password",
        label: "New password",
        searchTerms: ["change nouveau mot de passe"],
      },
      {
        href: "/settings/account#sessions",
        label: "Active sessions",
        searchTerms: ["devices appareils connexions"],
      },
      {
        href: "/settings/account#sessions",
        label: "Where you are signed in",
        searchTerms: ["devices appareils connexions sessions"],
      },
      {
        href: "/settings/account#sessions",
        label: "Sign out",
        searchTerms: ["logout disconnect déconnexion session appareil"],
      },
      {
        href: "/settings/account#linked-sign-ins",
        label: "Linked sign-ins",
        searchTerms: ["google microsoft oauth link unlink comptes liés"],
      },
      {
        href: "/settings/account#export",
        label: "Export my data",
        searchTerms: ["download télécharger sauvegarde"],
      },
      {
        href: "/settings/account#export",
        label: "Your data",
        searchTerms: ["export download données télécharger json"],
      },
      {
        href: "/settings/account#delete",
        label: "Delete my account",
        searchTerms: ["supprimer effacer compte"],
      },
      {
        href: "/settings/account#delete",
        label: "Delete this account",
        searchTerms: ["delete remove supprimer effacer compte permanent"],
      },
      {
        href: "/settings/account#start-over",
        label: "Start over",
        searchTerms: ["reset clear everything recommencer effacer données"],
      },
    ],
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    icon: PlugIcon,
    searchTerms: [
      "moodle pronote ecole directe écoledirecte skolengo mcp api oauth mistral openai openrouter gemini cohere elevenlabs embeddings reranking byok",
    ],
    items: [
      {
        href: "/settings/integrations#school-services",
        label: "ÉcoleDirecte connection",
        searchTerms: ["ecoledirecte devoirs emploi du temps notes"],
      },
      {
        href: "/settings/integrations#school-services",
        label: "Username",
        searchTerms: ["ecoledirecte login identifiant utilisateur"],
      },
      {
        href: "/settings/integrations#school-services",
        label: "School time zone",
        searchTerms: ["timezone fuseau horaire école établissement"],
      },
      {
        href: "/settings/integrations#school-services",
        label: "Student account number",
        searchTerms: ["student account élève numéro compte account id"],
      },
      {
        href: "/settings/integrations#school-services",
        label: "Pronote connection",
        searchTerms: ["pronote devoirs emploi du temps notes"],
      },
      {
        href: "/settings/integrations#school-services",
        label: "Skolengo connection",
        searchTerms: ["skolengo devoirs emploi du temps notes"],
      },
      {
        href: "/settings/integrations#moodle",
        label: "Moodle connection",
        searchTerms: ["course files cours fichiers"],
      },
      {
        href: "/settings/integrations#moodle",
        label: "Connected services",
        searchTerms: ["services connected connexion moodle fichiers cours"],
      },
      {
        href: "/settings/integrations#moodle",
        label: "Provider",
        searchTerms: ["moodle source service fournisseur"],
      },
      {
        href: "/settings/integrations#moodle",
        label: "Moodle site address",
        searchTerms: ["url server serveur adresse site https"],
      },
      {
        href: "/settings/integrations#moodle",
        label: "Mobile token redirect",
        searchTerms: ["token jeton connexion mobile redirect redirection"],
      },
      {
        href: "/settings/integrations#moodle",
        label: "PEM certificate chain",
        searchTerms: [
          "certificate certificat ca authority autorité privée custom tls pem",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "AI service keys",
        searchTerms: [
          "mistral openai openrouter gemini cohere elevenlabs embeddings rerank reranking byok transcription ocr inference api podcast tts voxtral voix synthèse",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "AI provider keys",
        searchTerms: [
          "my api keys mes clés api keys clés fournisseurs providers byok mistral openai openrouter gemini cohere elevenlabs ocr transcription inference embeddings reranking",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "Mistral OCR & podcasts",
        searchTerms: [
          "clé cle key api document reconnaissance texte byok podcast tts voix synthèse audio voxtral",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "OpenAI transcription",
        searchTerms: [
          "clé cle key api openai audio cours enregistrement dictée speech to text byok",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "OpenAI and OpenRouter models",
        searchTerms: [
          "clé cle key api openai openrouter modèle model ia chat inference byok",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "Gemini multimodal embeddings",
        searchTerms: [
          "google ai studio gemini embedding 2 vectoriel vectors multimodal pdf image rag recherche",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "Cohere reranking",
        searchTerms: [
          "cohere rerank reranking cross encoder classement résultats rag recherche",
        ],
      },
      {
        href: "/settings/integrations#ai-keys",
        label: "ElevenLabs voices",
        searchTerms: [
          "elevenlabs voix synthèse tts podcast audio vidéo narration",
        ],
      },
      {
        href: "/settings/integrations#retrieval",
        label: "Advanced retrieval",
        searchTerms: [
          "rag recherche avancée hybride lexical dense fts rrf citations contexte corpus",
        ],
      },
      {
        href: "/settings/integrations#assistant-models",
        label: "Assistant models and routing",
        searchTerms: [
          "chat assistant model modèle inference placement byok core node managed litellm routage",
        ],
      },
      {
        href: "/settings/integrations#assistant-models",
        label: "Model fallback and limits",
        searchTerms: [
          "fallback fournisseur provider tokens contexte output coût cost budget devise route préférence",
        ],
      },
      {
        href: "/settings/integrations#retrieval",
        label: "Retrieval fallback policy",
        searchTerms: [
          "fallback repli lexical only hybride sans reranking fail échec projet",
        ],
      },
      {
        href: "/settings/integrations#retrieval",
        label: "Immutable embedding spaces",
        searchTerms: [
          "gemini embedding 2 vector multimodal génération index pdf image dimensions modèle",
        ],
      },
      {
        href: "/settings/integrations#retrieval",
        label: "Local and cloud rerankers",
        searchTerms: [
          "cohere tei local rerank reranking cross encoder classement rrf",
        ],
      },
      {
        href: "/settings/integrations#retrieval",
        label: "Corpus reindexing",
        searchTerms: [
          "réindexer reindex indexation génération progression jobs corpus projet",
        ],
      },
      {
        href: "/settings/integrations#retrieval",
        label: "Retrieval traces and evaluations",
        searchTerms: [
          "traces privées évaluation benchmark french school métriques rag qualité consentement",
        ],
      },
      {
        href: "/settings/integrations#mcp",
        label: "Connect an MCP assistant",
        searchTerms: ["oauth claude codex assistant api"],
      },
      {
        href: "/settings/integrations#mcp",
        label: "Avermate MCP server",
        searchTerms: ["server url endpoint serveur adresse"],
      },
      {
        href: "/settings/integrations#mcp",
        label: "Protected-resource metadata",
        searchTerms: ["oauth resource metadata découverte ressource protégée"],
      },
      {
        href: "/settings/integrations#custom-mcp",
        label: "External MCP tools",
        searchTerms: [
          "custom mcp external server tools read only catalogue permissions data egress serveur outils lecture seule catalogue autorisations données",
        ],
      },
      {
        href: "/settings/integrations#custom-mcp",
        label: "Data this tool may receive",
        searchTerms: [
          "prompt academic metadata snippets attachments content privacy request cours extraits pièces jointes confidentialité",
        ],
      },
      {
        href: "/settings/integrations#oauth-clients",
        label: "OAuth clients and permissions",
        searchTerms: ["scopes consent access permissions autorisations"],
      },
      {
        href: "/settings/integrations#oauth-clients",
        label: "What has access",
        searchTerms: ["oauth access permissions autorisations clients scopes"],
      },
      {
        href: "/settings/integrations#registered-clients",
        label: "Registered clients",
        searchTerms: ["oauth clients registered enregistrés redirect uri"],
      },
      {
        href: "/settings/integrations#learning-analysis",
        label: "Learning analysis privacy",
        searchTerms: [
          "copie ocr maîtrise evidence preuve analyse consentement confidentialité latency quiz progression",
        ],
      },
    ],
  },
  {
    href: "/settings/processing",
    label: "AI & processing",
    icon: CpuIcon,
    searchTerms: [
      "ai ia provider fournisseur connection connexion capability capacité routing routage fallback privacy confidentialité usage coût byok litellm hugging face deepgram elevenlabs mistral gemini cohere openai node self host",
    ],
    items: [
      {
        href: "/settings/processing#connections",
        label: "Provider connections",
        searchTerms: [
          "api key clé endpoint provider byok node managed litellm hugging face openai compatible",
        ],
      },
      {
        href: "/settings/processing#capabilities",
        label: "Available capabilities",
        searchTerms: [
          "chat embedding reranking transcription dictation tts ocr extraction image video models voices",
        ],
      },
      {
        href: "/settings/processing#policies",
        label: "Capability policies",
        searchTerms: [
          "primary fallback order automatic pinned placement purpose workflow route",
        ],
      },
      {
        href: "/settings/processing#usage",
        label: "AI usage and cost",
        searchTerms: [
          "tokens pages seconds characters vectors candidates quota budget coût consommation",
        ],
      },
      {
        href: "/settings/processing#privacy",
        label: "Processing privacy",
        searchTerms: [
          "consent egress data cloud local node managed external provider confidentialité données",
        ],
      },
      {
        href: "/settings/processing#diagnostics",
        label: "Capability diagnostics",
        searchTerms: [
          "operations attempts route health errors shadow mismatches debug diagnostic",
        ],
      },
    ],
  },
  {
    href: "/settings/node",
    label: "Avermate Node",
    icon: ServerCogIcon,
    searchTerms: [
      "node self host self-host hybrid pairing placement relay manifest health migration fingerprint credentials sandbox checkpoint opencode openhands serveur auto hébergé appairage placement migration empreinte identifiants",
    ],
    items: [
      {
        href: "/settings/node#readiness",
        label: "Deployment readiness",
        searchTerms: [
          "full self host onboarding protocol upgrade required capabilities diagnostics déploiement auto hébergé préparation mise à niveau",
        ],
      },
      {
        href: "/settings/node#pairing",
        label: "Pair a Node",
        searchTerms: [
          "one time code fingerprint confirmation capabilities appairage code unique empreinte confirmation capacités",
        ],
      },
      {
        href: "/settings/node#nodes",
        label: "Node health and manifest",
        searchTerms: [
          "online offline revoked upgrade config revision heartbeat relay capabilities runtime checkpoint specialist opencode openhands santé manifeste révoqué configuration",
        ],
      },
      {
        href: "/settings/node#nodes",
        label: "Rotate or revoke Node credentials",
        searchTerms: [
          "rotate revoke generation compromised retire rotation révocation identifiants compromis",
        ],
      },
      {
        href: "/settings/node#placements",
        label: "Capability placement",
        searchTerms: [
          "storage conversations retrieval models jobs sandbox renderers school connectors core node managed byok residency offline cost stockage recherche modèles exécution résidence coût",
        ],
      },
      {
        href: "/settings/node#lifecycle",
        label: "Lifecycle and migration diagnostics",
        searchTerms: [
          "planned running verified failed migration append only events lifecycle diagnostic migration planifiée vérifiée événements",
        ],
      },
    ],
  },
  {
    href: "/settings/managed",
    label: "AI & managed storage",
    icon: CloudCogIcon,
    searchTerms: [
      "managed ai storage usage limits quota consent privacy export deletion beta hosting ia stockage géré usage limites consentement confidentialité",
    ],
    items: [
      {
        href: "/settings/managed",
        label: "Managed beta invitation",
        searchTerms: ["invite waitlist activation invitation liste attente"],
      },
      {
        href: "/settings/managed#managed-execution",
        label: "Managed execution and limits",
        searchTerms: [
          "quota usage reservation stop breaker limites consommation",
        ],
      },
      {
        href: "/settings/managed",
        label: "Managed privacy and deletion",
        searchTerms: [
          "export delete erase receipts confidentialité suppression reçus",
        ],
      },
    ],
  },
  {
    href: "/settings/about",
    label: "About",
    icon: InfoIcon,
    searchTerms: [
      "version legal privacy licence confidentialité mentions légales",
    ],
    items: [
      { href: "/settings/about#version", label: "Application version" },
      {
        href: "/settings/about#support",
        label: "Support",
        searchTerms: ["help feedback aide assistance user id"],
      },
      {
        href: "/settings/about#install",
        label: "Install Avermate",
        searchTerms: ["pwa home screen application installer accueil"],
      },
      {
        href: "/settings/about#legal",
        label: "Privacy",
        searchTerms: ["confidentialité données"],
      },
      {
        href: "/settings/about#legal",
        label: "Legal information",
        searchTerms: ["licence mentions légales"],
      },
    ],
  },
]

/** Whether `pathname` is inside a settings section. */
export function isActiveSettingsSection(
  pathname: string,
  section: SettingsSection
): boolean {
  return section.exact
    ? pathname === section.href
    : pathname.startsWith(section.href)
}

export function isActivePath(pathname: string, entry: NavEntry): boolean {
  const candidates = [entry.href, ...(entry.matches ?? [])]
  return candidates.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
}

/**
 * The destinations an account may pin to its navigation: the nine primary
 * screens. Settings, review and admin stay where they are — the first is
 * chrome, the others are conditional.
 */
export const CUSTOMIZABLE_NAV_HREFS = [
  "/dashboard",
  "/subjects",
  "/grades",
  "/materials",
  "/projects",
  "/learning",
  "/assistant",
  "/goals",
  "/planning",
  "/insights",
  "/social",
] as const

/** The mobile tab bar's free slots (the fourth tab is always "More"). */
export const TAB_SLOT_COUNT = 3

export const DEFAULT_TAB_HREFS = ["/dashboard", "/subjects", "/grades"]

export const DEFAULT_SIDEBAR_HREFS = [...CUSTOMIZABLE_NAV_HREFS]

/**
 * A stored navigation choice survives renames and bad writes by being
 * sanitized at read time: unknown hrefs drop, duplicates collapse, and when
 * a fixed count is asked for, missing slots refill from the fallback.
 */
export function sanitizeNavSelection(
  stored: readonly string[] | undefined,
  fallback: readonly string[],
  count?: number
): string[] {
  const allowed = new Set<string>(CUSTOMIZABLE_NAV_HREFS)
  const chosen: string[] = []
  for (const storedHref of stored ?? []) {
    // `/agenda` was the former catch-all calendar/task screen. Preserve a
    // person's pinned choice while sending it to the new Planning hub.
    const href = storedHref === "/agenda" ? "/planning" : storedHref
    if (allowed.has(href) && !chosen.includes(href)) chosen.push(href)
  }
  if (count === undefined) {
    return chosen.length > 0 ? chosen : [...fallback]
  }
  for (const href of fallback) {
    if (chosen.length >= count) break
    if (!chosen.includes(href)) chosen.push(href)
  }
  return chosen.slice(0, count)
}
