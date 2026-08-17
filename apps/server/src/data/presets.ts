import type { Preset } from "./preset-types";

/**
 * Ready-made subject trees for common French curricula.
 *
 * These are the fastest path from an empty account to a usable year: the
 * coefficients in a prépa or a lycée are published, identical for everyone, and
 * tedious to type in. A preset is a starting point, not a lock — everything it
 * creates is ordinary data the user can rename, reweight or delete.
 */
export const PRESETS: Preset[] = [
  {
    id: "CPE_PREPA_SUP_NUM_2025_2026",
    name: "Prépa CPE Sup Numérique",
    description: "",
    tags: ["CPE", "2025-2026"],
    featured: true,
    archived: false,
    subjects: [
      {
        name: "Module Scientifique",
        kind: "category",
        children: [
          {
            name: "Mathématiques",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Mathématiques - Écrit",
                coefficient: 7,
              },
              {
                name: "Mathématiques - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Physique-Chimie",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Physique-Chimie - Écrit",
                coefficient: 7,
              },
              {
                name: "Physique-Chimie - Oral",
                coefficient: 3,
              },
              {
                name: "Physique-Chimie - TP",
                coefficient: 2,
              },
            ],
          },
          {
            name: "Sciences-Industrielles",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "SI - Écrit",
                coefficient: 4,
              },
              {
                name: "SI - Oral",
                coefficient: 1.5,
              },
              {
                name: "SI - TP",
                coefficient: 1.5,
              },
            ],
          },
          {
            name: "Informatique",
            isMain: true,
            coefficient: 5,
          },
          {
            name: "TIPE - Compétences Scientifiques",
            coefficient: 2,
          },
        ],
      },
      {
        name: "Module Sciences Humaines",
        kind: "category",
        children: [
          {
            name: "Français",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Français - Écrit",
                coefficient: 6,
              },
              {
                name: "Français - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Anglais",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Anglais - Écrit",
                coefficient: 5,
              },
              {
                name: "Anglais - Oral",
                coefficient: 2,
              },
            ],
          },
          {
            name: "LV2",
            isMain: true,
            coefficient: 3,
          },
          {
            name: "TIPE - Compétences Transversales",
            coefficient: 1,
          },
          {
            name: "Sport  /Club / Communications",
            coefficient: 1,
          },
        ],
      },
    ],
    averages: [
      {
        name: "Moyenne des Écrits",
        isMain: true,
        entries: [
          {
            name: "Mathématiques - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "Physique-Chimie - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "SI - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
        ],
      },
    ],
  },
  {
    id: "CPE_PREPA_SUP_CHI_2025_2026",
    name: "Prépa CPE Sup Chimie",
    description: "",
    tags: ["CPE", "2025-2026"],
    featured: true,
    archived: false,
    subjects: [
      {
        name: "Module Scientifique",
        kind: "category",
        children: [
          {
            name: "Mathématiques",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Mathématiques - Écrit",
                coefficient: 7,
              },
              {
                name: "Mathématiques - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Physique",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Physique - Écrit",
                coefficient: 6,
              },
              {
                name: "Physique - Oral",
                coefficient: 2,
              },
              {
                name: "Physique - TP",
                coefficient: 2,
              },
            ],
          },
          {
            name: "Chimie",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Chimie - Écrit",
                coefficient: 6,
              },
              {
                name: "Chimie - Oral",
                coefficient: 2,
              },
              {
                name: "Chimie - TP",
                coefficient: 2,
              },
            ],
          },
          {
            name: "Sciences-Industrielles",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "SI - Écrit",
                coefficient: 3,
              },
              {
                name: "SI - Oral",
                coefficient: 2,
              },
              {
                name: "SI - TP",
                coefficient: 2,
              },
            ],
          },
          {
            name: "Informatique",
            isMain: true,
            coefficient: 4,
          },
          {
            name: "TIPE - Compétences Scientifiques",
            coefficient: 2,
          },
        ],
      },
      {
        name: "Module Sciences Humaines",
        kind: "category",
        children: [
          {
            name: "Français",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Français - Écrit",
                coefficient: 6,
              },
              {
                name: "Français - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Anglais",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Anglais - Écrit",
                coefficient: 5,
              },
              {
                name: "Anglais - Oral",
                coefficient: 2,
              },
            ],
          },
          {
            name: "LV2",
            isMain: true,
            coefficient: 3,
          },
          {
            name: "TIPE - Compétences Transversales",
            coefficient: 1,
          },
          {
            name: "Sport  /Club / Communications",
            coefficient: 1,
          },
        ],
      },
    ],
    averages: [
      {
        name: "Moyenne des Écrits",
        isMain: true,
        entries: [
          {
            name: "Mathématiques - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "Physique - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "Chimie - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "SI - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
        ],
      },
    ],
  },
  {
    id: "CPE_PREPA_SPE_PSI_2025_2026",
    name: "Prépa CPE Spé PSI",
    description: "",
    tags: ["CPE", "2025-2026"],
    featured: true,
    archived: false,
    subjects: [
      {
        name: "Module Scientifique",
        kind: "category",
        children: [
          {
            name: "Mathématiques",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Mathématiques - Écrit",
                coefficient: 7,
              },
              {
                name: "Mathématiques - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Physique-Chimie",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Physique-Chimie - Écrit",
                coefficient: 7,
              },
              {
                name: "Physique-Chimie - Oral",
                coefficient: 3,
              },
              {
                name: "Physique-Chimie - TP",
                coefficient: 2,
              },
            ],
          },
          {
            name: "Sciences-Industrielles",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "SI - Écrit",
                coefficient: 4,
              },
              {
                name: "SI - Oral",
                coefficient: 1.5,
              },
              {
                name: "SI - TP",
                coefficient: 1.5,
              },
            ],
          },
          {
            name: "Informatique",
            isMain: true,
            coefficient: 5,
          },
          {
            name: "TIPE",
            coefficient: 2,
          },
        ],
      },
      {
        name: "Module Sciences Humaines",
        kind: "category",
        children: [
          {
            name: "Français",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Français - Écrit",
                coefficient: 6,
              },
              {
                name: "Français - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Anglais",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Anglais - Écrit",
                coefficient: 5,
              },
              {
                name: "Anglais - Oral",
                coefficient: 2,
              },
            ],
          },
          {
            name: "LV2",
            isMain: true,
            coefficient: 3,
          },
          {
            name: "TIPE - Compétences Transversales",
            coefficient: 1,
          },
          {
            name: "Sport",
            coefficient: 1,
          },
          {
            name: "BDE / Club / Communications",
            coefficient: 1,
          },
        ],
      },
    ],
    averages: [
      {
        name: "Moyenne des Écrits",
        isMain: true,
        entries: [
          {
            name: "Mathématiques - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "Physique-Chimie - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "SI - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
        ],
      },
    ],
  },
  {
    id: "CPE_PREPA_SPE_PC_2025_2026",
    name: "Prépa CPE Spé PC",
    description: "",
    tags: ["CPE", "2025-2026"],
    featured: true,
    archived: false,
    subjects: [
      {
        name: "Module Scientifique",
        kind: "category",
        children: [
          {
            name: "Mathématiques",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Mathématiques - Écrit",
                coefficient: 7,
              },
              {
                name: "Mathématiques - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Physique",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Physique - Écrit",
                coefficient: 5,
              },
              {
                name: "Physique - Oral",
                coefficient: 3,
              },
              {
                name: "Physique - TP",
                coefficient: 2,
              },
            ],
          },
          {
            name: "Chimie",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Chimie - Écrit",
                coefficient: 5,
              },
              {
                name: "Chimie - Oral",
                coefficient: 3,
              },
              {
                name: "Chimie - TP",
                coefficient: 2,
              },
            ],
          },
          {
            name: "Informatique",
            isMain: true,
            coefficient: 4,
          },
          {
            name: "TIPE - Compétences Scientifiques",
            coefficient: 2,
          },
        ],
      },
      {
        name: "Module Sciences Humaines",
        kind: "category",
        children: [
          {
            name: "Français",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Français - Écrit",
                coefficient: 6,
              },
              {
                name: "Français - Oral",
                coefficient: 3,
              },
            ],
          },
          {
            name: "Anglais",
            kind: "category",
            isMain: true,
            children: [
              {
                name: "Anglais - Écrit",
                coefficient: 5,
              },
              {
                name: "Anglais - Oral",
                coefficient: 2,
              },
            ],
          },
          {
            name: "LV2",
            isMain: true,
            coefficient: 3,
          },
          {
            name: "TIPE - Compétences Transversales",
            coefficient: 1,
          },
          {
            name: "Sport",
            coefficient: 1,
          },
          {
            name: "BDE / Club / Communications",
            coefficient: 1,
          },
        ],
      },
    ],
    averages: [
      {
        name: "Moyenne des Écrits",
        isMain: true,
        entries: [
          {
            name: "Mathématiques - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "Physique - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
          {
            name: "Chimie - Écrit",
            coefficient: 1,
            includeChildren: false,
          },
        ],
      },
    ],
  },
  {
    id: "LYCEE_TERMINALE_G",
    name: "Terminale - Section Générale",
    description: "",
    tags: ["LYCEE"],
    featured: true,
    archived: false,
    subjects: [
      {
        name: "Spé. 1",
        isMain: true,
        coefficient: 16,
      },
      {
        name: "Spé. 2",
        isMain: true,
        coefficient: 16,
      },
      {
        name: "Philosophie",
        isMain: true,
        coefficient: 8,
      },
      {
        name: "Histoire-Géographie",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "EMC",
        isMain: true,
        coefficient: 1,
      },
      {
        name: "Enseignement-Scientifique",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "EPS",
        isMain: true,
        coefficient: 6,
      },
      {
        name: "LV1",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "LV2",
        isMain: true,
        coefficient: 3,
      },
    ],
    averages: [],
  },
  {
    id: "LYCEE_1ERE_G",
    name: "1ère - Section Générale",
    description: "",
    tags: ["LYCEE"],
    featured: true,
    archived: false,
    subjects: [
      {
        name: "Spé. 1",
        isMain: true,
        coefficient: 16,
      },
      {
        name: "Spé. 2",
        isMain: true,
        coefficient: 16,
      },
      {
        name: "Spé. 3",
        isMain: true,
        coefficient: 16,
      },
      {
        name: "Français",
        isMain: true,
        coefficient: 10,
      },
      {
        name: "Histoire-Géographie",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "EMC",
        isMain: true,
        coefficient: 1,
      },
      {
        name: "Enseignement-Scientifique",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "EPS",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "LV1",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "LV2",
        isMain: true,
        coefficient: 3,
      },
    ],
    averages: [],
  },
  {
    id: "LYCEE_2NDE_GT",
    name: "2nde - Section Générale & Technologique",
    description: "",
    tags: ["LYCEE"],
    featured: true,
    archived: false,
    subjects: [
      {
        name: "Mathématiques",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "Physique-Chimie",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "Science de la Vie et de la Terre",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "Français",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "Histoire-Géographie",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "Science Numérique et Technologique",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "EMC",
        isMain: true,
        coefficient: 1,
      },
      {
        name: "EPS",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "LV1",
        isMain: true,
        coefficient: 3,
      },
      {
        name: "LV2",
        isMain: true,
        coefficient: 3,
      },
    ],
    averages: [],
  },
];
