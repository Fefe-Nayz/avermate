import type {
  CorpusOriginKind,
  SourceLocatorV1,
} from "@avermate/agent-contracts";

export type LabelledRetrievalFixture = {
  id: string;
  query: string;
  passage: string;
  sourceKind: Exclude<CorpusOriginKind, "conversation">;
  locator: SourceLocatorV1;
  language: "fr" | "en";
  semantic: boolean;
};

const entries = [
  [
    "mitochondrie",
    "La mitochondrie produit une grande partie de l'ATP cellulaire.",
  ],
  [
    "photosynthèse",
    "La photosynthèse convertit l'énergie lumineuse en énergie chimique.",
  ],
  ["ribosome", "Le ribosome assemble les acides aminés pendant la traduction."],
  ["osmose", "L'osmose décrit le passage du solvant à travers une membrane."],
  ["méiose", "La méiose forme des cellules haploïdes et crée de la diversité."],
  ["allèle", "Un allèle est une version particulière d'un même gène."],
  [
    "écosystème",
    "Un écosystème réunit un milieu et les êtres vivants qui l'occupent.",
  ],
  ["enzyme", "Une enzyme accélère une réaction sans être consommée."],
  [
    "Pythagore",
    "Le théorème de Pythagore relie les côtés d'un triangle rectangle.",
  ],
  [
    "Thalès",
    "Le théorème de Thalès établit des rapports de longueurs proportionnels.",
  ],
  ["discriminant", "Le discriminant d'un trinôme vaut b² moins quatre ac."],
  ["dérivée", "La dérivée mesure le taux de variation local d'une fonction."],
  ["primitive", "Une primitive a pour dérivée la fonction considérée."],
  ["asymptote", "Une asymptote décrit le comportement limite d'une courbe."],
  ["barycentre", "Le barycentre est un point pondéré par des coefficients."],
  ["logarithme", "Le logarithme népérien transforme un produit en somme."],
  [
    "cinématique",
    "La cinématique décrit le mouvement sans étudier ses causes.",
  ],
  ["inertie", "Le principe d'inertie concerne un système pseudo-isolé."],
  [
    "réfraction",
    "La réfraction dévie une onde lors d'un changement de milieu.",
  ],
  [
    "interférence",
    "Une interférence résulte de la superposition cohérente d'ondes.",
  ],
  [
    "enthalpie",
    "L'enthalpie est une fonction d'état utile à pression constante.",
  ],
  [
    "oxydoréduction",
    "Une oxydoréduction échange des électrons entre deux couples.",
  ],
  [
    "stœchiométrie",
    "La stœchiométrie utilise les proportions d'une équation chimique.",
  ],
  [
    "molarité",
    "La molarité exprime une quantité de matière par volume de solution.",
  ],
  ["métaphore", "Une métaphore rapproche deux réalités sans outil comparatif."],
  ["anaphore", "Une anaphore répète un mot au début de plusieurs segments."],
  ["focalisation", "La focalisation détermine le point de vue du récit."],
  [
    "alexandrin",
    "Un alexandrin français comporte traditionnellement douze syllabes.",
  ],
  ["litote", "La litote dit moins pour laisser entendre davantage."],
  ["oxymore", "Un oxymore unit deux termes apparemment contradictoires."],
  [
    "paratexte",
    "Le paratexte regroupe les éléments qui entourent le texte principal.",
  ],
  ["didactique", "Le registre didactique cherche à transmettre un savoir."],
  [
    "mercantilisme",
    "Le mercantilisme associe puissance politique et accumulation de métaux.",
  ],
  [
    "féodalité",
    "La féodalité organise des liens de dépendance entre seigneurs.",
  ],
  ["suffrage", "Le suffrage universel étend le droit de vote aux citoyens."],
  [
    "décolonisation",
    "La décolonisation conduit les territoires colonisés à l'indépendance.",
  ],
  [
    "bipolarisation",
    "La bipolarisation structure la guerre froide autour de deux blocs.",
  ],
  [
    "mondialisation",
    "La mondialisation intensifie les échanges à l'échelle planétaire.",
  ],
  [
    "métropolisation",
    "La métropolisation concentre population et fonctions de commandement.",
  ],
  [
    "littoralisation",
    "La littoralisation attire les activités vers les façades maritimes.",
  ],
  [
    "recursion",
    "Recursion solves a problem through smaller instances of itself.",
  ],
  [
    "polymorphism",
    "Polymorphism lets one interface represent multiple concrete types.",
  ],
  [
    "encapsulation",
    "Encapsulation limits direct access to internal program state.",
  ],
  [
    "deadlock",
    "A deadlock occurs when processes wait indefinitely for resources.",
  ],
  [
    "idempotency",
    "Idempotency means repeating an operation has no additional effect.",
  ],
  [
    "normalization",
    "Database normalization reduces redundant stored information.",
  ],
  ["quicksort", "Quicksort partitions values around a chosen pivot."],
  ["hashing", "Hashing maps arbitrary input to a fixed-size digest."],
  [
    "opportunity",
    "Opportunity cost is the value of the best forgone alternative.",
  ],
  [
    "elasticity",
    "Price elasticity measures demand response to a price change.",
  ],
  ["inflation", "Inflation is a sustained rise in the general price level."],
  [
    "externality",
    "An externality affects others outside a market transaction.",
  ],
  [
    "liquidity",
    "Liquidity describes how easily an asset becomes a means of payment.",
  ],
  ["productivity", "Productivity compares output with the resources used."],
  [
    "comparative",
    "Comparative advantage depends on relative opportunity costs.",
  ],
  ["monopsony", "A monopsony is a market with a single dominant buyer."],
  ["morpheme", "A morpheme is the smallest linguistic unit carrying meaning."],
  ["phoneme", "A phoneme is a contrastive sound unit in a language."],
  [
    "subordinate",
    "A subordinate clause depends syntactically on another clause.",
  ],
  ["alliteration", "Alliteration repeats consonant sounds in nearby words."],
  [
    "modal",
    "A modal verb expresses ability, obligation, permission, or probability.",
  ],
  ["gerund", "An English gerund uses an ing form as a noun."],
  ["collocation", "A collocation is a conventional combination of words."],
  [
    "register",
    "Language register changes with situation, audience, and purpose.",
  ],
] as const;

const kinds = [
  "material",
  "study-document",
  "recording",
  "grade",
  "subject",
  "artifact",
] as const;

export const RETRIEVAL_EVALUATION_028: readonly LabelledRetrievalFixture[] =
  entries.map(([query, passage], index) => {
    const kind = kinds[index % kinds.length]!;
    const locator: SourceLocatorV1 =
      kind === "recording"
        ? { kind: "audio", startMs: index * 1_000, endMs: index * 1_000 + 900 }
        : kind === "grade"
          ? { kind: "grade", gradeId: `eval-grade-${index + 1}` }
          : kind === "artifact"
            ? { kind: "slides", slide: (index % 12) + 1 }
            : kind === "material"
              ? { kind: "pdf", page: (index % 8) + 1 }
              : {
                  kind: "markdown",
                  headingPath: [query],
                  startLine: index + 1,
                  endLine: index + 1,
                };
    return {
      id: `eval-${String(index + 1).padStart(2, "0")}`,
      query,
      passage,
      sourceKind: kind,
      locator,
      language: index < 40 ? "fr" : "en",
      semantic: index % 5 === 0,
    };
  });
