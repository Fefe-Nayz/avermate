import { db } from "@/db";
import { customAverages, subjects } from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { limitable } from "@/lib/limitable";
import { generateId } from "@/lib/nanoid";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getConnInfo } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getYearById } from "./years";
import { env } from "@/lib/env";

const router = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

const presets: Preset[] = [
  {
    id: "CPE_PREPA_SUP_NUM_2025_2026",
    name: "Prépa CPE Sup Numérique",
    description: "Préset des matières pour la prépa CPE Sup Numérique",
    tags: ["CPE", "2025-2026"],
    subjects: [
      {
        name: "Module Scientifique",
        isDisplaySubject: true,
        subjects: [
          {
            name: "Mathématiques",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            coefficient: 5,
          },
          /**
           * TIPE
           */
          {
            name: "TIPE - Compétences Scientifiques",
            coefficient: 2,
          },
        ],
      },
      /**
       * Module Sciences Humaines
       */
      {
        name: "Module Sciences Humaines",
        isDisplaySubject: true,
        subjects: [
          /**
           * Français
           */
          {
            name: "Français",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * Anglais
           */
          {
            name: "Anglais",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * LV2
           */
          {
            name: "LV2",
            isMainSubject: true,
            coefficient: 3,
          },
          /**
           * TIPE Compétences Transversales
           */
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
    customAverages: [
      {
        name: "Moyenne des Écrits",
        isMainAverage: true,
        subjects: [
          {
            name: "Mathématiques - Écrit",
            customCoefficient: 1,
          },
          {
            name: "Physique-Chimie - Écrit",
            customCoefficient: 1,
          },
          {
            name: "SI - Écrit",
            customCoefficient: 1,
          },
        ],
      },
    ],
  },
  /**
   * Prépa CPE Sup Chimie
   */
  {
    id: "CPE_PREPA_SUP_CHI_2025_2026",
    name: "Prépa CPE Sup Chimie",
    description: "Préset des matières pour la prépa CPE Sup Chimie",
    tags: ["CPE", "2025-2026"],
    subjects: [
      {
        name: "Module Scientifique",
        isDisplaySubject: true,
        subjects: [
          {
            name: "Mathématiques",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            coefficient: 4,
          },
          /**
           * TIPE
           */
          {
            name: "TIPE - Compétences Scientifiques",
            coefficient: 2,
          },
        ],
      },
      /**
       * Module Sciences Humaines
       */
      {
        name: "Module Sciences Humaines",
        isDisplaySubject: true,
        subjects: [
          /**
           * Français
           */
          {
            name: "Français",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * Anglais
           */
          {
            name: "Anglais",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * LV2
           */
          {
            name: "LV2",
            isMainSubject: true,
            coefficient: 3,
          },
          /**
           * TIPE Compétences Transversales
           */
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
    customAverages: [
      {
        name: "Moyenne des Écrits",
        isMainAverage: true,
        subjects: [
          {
            name: "Mathématiques - Écrit",
            customCoefficient: 1,
          },
          {
            name: "Physique - Écrit",
            customCoefficient: 1,
          },
          {
            name: "Chimie - Écrit",
            customCoefficient: 1,
          },
          {
            name: "SI - Écrit",
            customCoefficient: 1,
          },
        ],
      },
    ],
  },
  /**
   * Prépa CPE SPE PSI
   */
  {
    id: "CPE_PREPA_SPE_PSI_2025_2026",
    name: "Prépa CPE Spé PSI",
    description: "Préset des matières pour la prépa CPE Spé PSI",
    tags: ["CPE", "2025-2026"],
    subjects: [
      {
        name: "Module Scientifique",
        isDisplaySubject: true,
        subjects: [
          {
            name: "Mathématiques",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            coefficient: 5,
          },
          /**
           * TIPE
           */
          {
            name: "TIPE",
            coefficient: 2,
          },
        ],
      },
      /**
       * Module Sciences Humaines
       */
      {
        name: "Module Sciences Humaines",
        isDisplaySubject: true,
        subjects: [
          /**
           * Français
           */
          {
            name: "Français",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * Anglais
           */
          {
            name: "Anglais",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * LV2
           */
          {
            name: "LV2",
            isMainSubject: true,
            coefficient: 3,
          },
          /**
           * TIPE Compétences Transversales
           */
          {
            name: "TIPE - Compétences Transversales",
            coefficient: 1,
          },
          /**
           * Sport
           */
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
    customAverages: [
      {
        name: "Moyenne des Écrits",
        isMainAverage: true,
        subjects: [
          {
            name: "Mathématiques - Écrit",
            customCoefficient: 1,
          },
          {
            name: "Physique-Chimie - Écrit",
            customCoefficient: 1,
          },
          {
            name: "SI - Écrit",
            customCoefficient: 1,
          },
        ],
      },
    ],
  },
  /**
   * Prépa CPE Spé PC
   */
  {
    id: "CPE_PREPA_SPE_PC_2025_2026",
    name: "Prépa CPE Spé PC",
    description: "Préset des matières pour la prépa CPE Spé PC",
    tags: ["CPE", "2025-2026"],
    subjects: [
      {
        name: "Module Scientifique",
        isDisplaySubject: true,
        subjects: [
          {
            name: "Mathématiques",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
            isMainSubject: true,
            coefficient: 4,
          },
          /**
           * TIPE
           */
          {
            name: "TIPE - Compétences Scientifiques",
            coefficient: 2,
          },
        ],
      },
      /**
       * Module Sciences Humaines
       */
      {
        name: "Module Sciences Humaines",
        isDisplaySubject: true,
        subjects: [
          /**
           * Français
           */
          {
            name: "Français",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * Anglais
           */
          {
            name: "Anglais",
            isMainSubject: true,
            isDisplaySubject: true,
            subjects: [
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
          /**
           * LV2
           */
          {
            name: "LV2",
            isMainSubject: true,
            coefficient: 3,
          },
          /**
           * TIPE Compétences Transversales
           */
          {
            name: "TIPE - Compétences Transversales",
            coefficient: 1,
          },
          /**
           * Sport
           */
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
    customAverages: [
      {
        name: "Moyenne des Écrits",
        isMainAverage: true,
        subjects: [
          {
            name: "Mathématiques - Écrit",
            customCoefficient: 1,
          },
          {
            name: "Physique - Écrit",
            customCoefficient: 1,
          },
          {
            name: "Chimie - Écrit",
            customCoefficient: 1,
          },
        ],
      },
    ],
  },
  /**
   * Lycée - G
   */
  /**
   * Terminal G
   */
  {
    id: "LYCEE_TERMINALE_G",
    name: "Terminale - Section Générale",
    description: "Préset pour la terminale générale.",
    tags: ["LYCEE"],
    subjects: [
      /**
       * Spécialité 1
       */
      {
        name: "Spé. 1",
        isMainSubject: true,
        coefficient: 16,
      },
      /**
       * Spécialité 2
       */
      {
        name: "Spé. 2",
        isMainSubject: true,
        coefficient: 16,
      },
      /**
       * Philosophie
       */
      {
        name: "Philosophie",
        isMainSubject: true,
        coefficient: 8,
      },
      /**
       * Histoire-Géographie
       */
      {
        name: "Histoire-Géographie",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * EMC
       */
      {
        name: "EMC",
        isMainSubject: true,
        coefficient: 1,
      },
      /**
       * Enseignement-Scientifique
       */
      {
        name: "Enseignement-Scientifique",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * EPS
       */
      {
        name: "EPS",
        isMainSubject: true,
        coefficient: 6,
      },
      /**
       * LV1
       */
      {
        name: "LV1",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * LV2
       */
      {
        name: "LV2",
        isMainSubject: true,
        coefficient: 3,
      },
    ],
  },
  /**
   * 1ère G
   */
  {
    id: "LYCEE_1ERE_G",
    name: "1ère - Section Générale",
    description: "Préset pour la 1ère générale.",
    tags: ["LYCEE"],
    subjects: [
      /**
       * Spécialité 1
       */
      {
        name: "Spé. 1",
        isMainSubject: true,
        coefficient: 16,
      },
      /**
       * Spécialité 2
       */
      {
        name: "Spé. 2",
        isMainSubject: true,
        coefficient: 16,
      },
      /**
       * Spécialité 3
       */
      {
        name: "Spé. 3",
        isMainSubject: true,
        coefficient: 16,
      },
      /**
       * Français
       */
      {
        name: "Français",
        isMainSubject: true,
        coefficient: 10,
      },
      /**
       * Histoire-Géographie
       */
      {
        name: "Histoire-Géographie",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * EMC
       */
      {
        name: "EMC",
        isMainSubject: true,
        coefficient: 1,
      },
      /**
       * Enseignement-Scientifique
       */
      {
        name: "Enseignement-Scientifique",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * EPS
       */
      {
        name: "EPS",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * LV1
       */
      {
        name: "LV1",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * LV2
       */
      {
        name: "LV2",
        isMainSubject: true,
        coefficient: 3,
      },
    ],
  },
  /**
   * 2nd GT
   */
  {
    id: "LYCEE_2NDE_GT",
    name: "2nde - Section Générale & Technologique",
    description: "Préset pour la 2nde générale & technologie.",
    tags: ["LYCEE"],
    subjects: [
      /**
       * Mathématiques
       */
      {
        name: "Mathématiques",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * Physique-Chimie
       */
      {
        name: "Physique-Chimie",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * Science de la vie et de la terre
       */
      {
        name: "Science de la Vie et de la Terre",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * Français
       */
      {
        name: "Français",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * Histoire-Géographie
       */
      {
        name: "Histoire-Géographie",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * SNT
       */
      {
        name: "Science Numérique et Technologique",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * EMC
       */
      {
        name: "EMC",
        isMainSubject: true,
        coefficient: 1,
      },
      /**
       * EPS
       */
      {
        name: "EPS",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * LV1
       */
      {
        name: "LV1",
        isMainSubject: true,
        coefficient: 3,
      },
      /**
       * LV2
       */
      {
        name: "LV2",
        isMainSubject: true,
        coefficient: 3,
      },
    ],
  },
];

type Preset = {
  id: string;
  name: string;
  description: string;
  subjects: PresetSubject[];
  customAverages?: CustomAveragePreset[];
  tags: string[];
};

type PresetSubject = {
  name: string;
  isMainSubject?: boolean;
  isDisplaySubject?: boolean;
  coefficient?: number;
  subjects?: PresetSubject[];
};

type CustomAveragePreset = {
  name: string;
  isMainAverage?: boolean;
  subjects: {
    name: string;
    customCoefficient?: number;
    includeChildren?: boolean;
  }[];
};

type InsertedCustomAverage = {
  id: string;
  name: string;
  subjects: string;
  userId: string;
  isMainAverage: boolean;
  createdAt: Date;
};

/**
 * Get all presets
 */
router.get("/", async (c) => {
  return c.json({ presets });
});

/**
 * Use a preset
 */
router.post(
  "/:id",
  zValidator(
    "param",
    z.object({
      id: z.enum([
        "CPE_PREPA_SUP_NUM_2025_2026",
        "CPE_PREPA_SUP_CHI_2025_2026",
        "CPE_PREPA_SPE_PC_2025_2026",
        "CPE_PREPA_SPE_PSI_2025_2026",
        "LYCEE_TERMINALE_G",
        "LYCEE_1ERE_G",
        "LYCEE_2NDE_GT",
      ]),
    })
  ),
  async (c) => {
    const { id } = c.req.valid("param");


    const preset = presets.find((p) => p.id === id);

    if (!preset) throw new HTTPException(404);

    const session = c.get("session");

    if (!session) throw new HTTPException(401);

    if (!session.user.emailVerified) {
      return c.json(
        {
          code: "EMAIL_NOT_VERIFIED",
          message: "Email verification is required",
        },
        403
      );
    }

    if (!env.DISABLE_RATE_LIMIT) {
      const info = getConnInfo(c);
      const forwardedFor = c.req.header("x-forwarded-for");
      const identifier =
        session?.user?.id || forwardedFor || info?.remote?.address || "anon";

      const { isExceeded, remaining, limit, resetIn } = await limitable.verify(
        identifier,
        "preset"
      );

      c.header("RateLimit-Limit", limit.toString());
      c.header("RateLimit-Remaining", remaining.toString());
      c.header("RateLimit-Reset", resetIn.toString());

      if (isExceeded)
        return c.json(
          {
            code: "ERR_RATE_LIMIT_EXCEEDED",
            message: "You're being rate limited!",
          },
          429
        );
    }

    const { yearId } = c.req.query();
    const year = await getYearById(yearId);
    if (!year) throw new HTTPException(404);
    if (year.userId !== session.user.id) throw new HTTPException(403);

    const flattenSubjects = (
      subjectsArr: PresetSubject[],
      parentId: string | null = null,
      depth: number = 0
    ): {
      id: string;
      name: string;
      parentId: string | null;
      coefficient: number;
      depth: number;
      isMainSubject: boolean;
      isDisplaySubject: boolean;
      createdAt: Date;
      userId: string;
      yearId: string;
    }[] => {
      return subjectsArr.flatMap((subject) => {
        const id = generateId("sub");

        const flatSubject = {
          id,
          name: subject.name,
          coefficient: (subject?.coefficient || 1) * 100,
          isMainSubject: subject?.isMainSubject || false,
          isDisplaySubject: subject?.isDisplaySubject || false,
          parentId,
          createdAt: new Date(),
          depth,
          userId: session.user.id,
          yearId: year.id,
        };

        if (subject.subjects && subject.subjects.length > 0) {
          return [
            flatSubject,
            ...flattenSubjects(subject.subjects, id, depth + 1),
          ];
        }
        return [flatSubject];
      });
    };

    const presetSubjects = flattenSubjects(preset.subjects);

    // Insert subjects into the database
    const insertedSubjects = await db
      .insert(subjects)
      .values(presetSubjects)
      .returning()
      .all();

    // If the preset has custom averages, insert them
    let insertedCustomAverages: InsertedCustomAverage[] = [];
    if (preset.customAverages && preset.customAverages.length > 0) {
      const customAveragesToInsert = [];

      for (const customAvg of preset.customAverages) {
        const avgSubjects = [];
        for (const subj of customAvg.subjects) {
          const foundSubj = insertedSubjects.find((s) => s.name === subj.name);
          if (!foundSubj) {
            throw new HTTPException(400);
          }
          avgSubjects.push({
            id: foundSubj.id,
            customCoefficient: subj.customCoefficient ?? null,
            includeChildren: subj.includeChildren ?? true,
          });
        }

        customAveragesToInsert.push({
          id: generateId("ca"),
          name: customAvg.name,
          subjects: JSON.stringify(avgSubjects),
          userId: session.user.id,
          isMainAverage: customAvg.isMainAverage ?? false,
          createdAt: new Date(),
          yearId: year.id,
        });
      }

      insertedCustomAverages = await db
        .insert(customAverages)
        .values(customAveragesToInsert)
        .returning()
        .all();
    }

    return c.json(
      {
        subjects: insertedSubjects,
        customAverages: insertedCustomAverages,
      },
      201
    );
  }
);

export default router;
