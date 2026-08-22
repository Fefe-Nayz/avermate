import { z } from "zod";
import { id, meta, type McpSurface, type McpSurfaceContext } from "../shared";

function registerPrompts({ server, principal }: McpSurfaceContext): void {
  const promptMeta = meta("avermate:read");
  server.registerPrompt(
    "academic-check-in",
    {
      title: "Academic check-in",
      description:
        "Review recent performance and propose a short, evidence-based action plan.",
      argsSchema: z.object({
        yearId: id,
        focus: z.string().max(200).optional(),
      }),
      _meta: promptMeta,
    },
    ({ yearId, focus }) => ({
      description: "A data-grounded Avermate academic check-in",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use analytics.snapshot for year ${yearId} and grades.recent. Summarize trends without inventing data, identify at most three actionable priorities, and relate them to existing goals.${focus ? ` Focus especially on: ${focus}.` : ""}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "grade-impact-analysis",
    {
      title: "Grade impact analysis",
      description:
        "Explain a grade in the context of its subject, components and year.",
      argsSchema: z.object({ gradeId: id, yearId: id }),
      _meta: promptMeta,
    },
    ({ gradeId, yearId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read grade ${gradeId} with grades.get and year ${yearId} with analytics.snapshot. Explain the grade's weighted impact, relevant component detail and uncertainty. Do not modify data unless explicitly asked afterward.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "goal-plan",
    {
      title: "Goal plan",
      description:
        "Turn an existing Avermate goal into a practical study plan.",
      argsSchema: z.object({ goalId: id, yearId: id }),
      _meta: promptMeta,
    },
    ({ goalId, yearId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read goals.list and analytics.snapshot for year ${yearId}, then locate goal ${goalId}. Produce a realistic plan tied to the actual target, due date, recent grades and subject hierarchy. Ask before changing the goal.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "year-recap",
    {
      title: "Year recap",
      description: "Create a factual, encouraging recap from Avermate data.",
      argsSchema: z.object({ yearId: id }),
      _meta: promptMeta,
    },
    ({ yearId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Read recap.status and analytics.snapshot for year ${yearId}. Create an encouraging factual recap: volume, progression, strongest moments, subject balance, composite work and goal outcomes. The activity percentile measures recording activity, not academic ranking.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "fiche-methodology",
    {
      title: "Fiche methodology",
      description:
        "Apply Avermate's compact, source-grounded revision-fiche method.",
      argsSchema: z.object({}).strict(),
      _meta: promptMeta,
    },
    () => ({
      description: "Avermate's house method for a revision fiche",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Create a concise, source-grounded revision fiche structured as Définitions → Théorèmes → Méthodes → Pièges → Checklist. Use the callouts [!DEF], [!THM], [!METH], [!PIEGE] and [!CHECK] for those sections. Write inline mathematics as $…$ and display mathematics as $$…$$. Keep the result to roughly one screen per chapter, preserve the conditions of every theorem or method, and cite the source documents by title. Never invent missing course content.",
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "fiche-from-chapter",
    {
      title: "Fiche from chapter",
      description:
        "Build a source-grounded revision fiche from one materials folder.",
      argsSchema: z
        .object({
          folderId: id,
          focus: z.string().trim().max(200).optional(),
        })
        .strict(),
      _meta: promptMeta,
    },
    ({ folderId, focus }) => ({
      description: "Create an Avermate fiche from a materials chapter",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `List the course materials in folder ${folderId}, then read every available source and materials.documents.transcript result. When a PDF or image is still untranscribed and the granted scopes permit it, call materials.documents.transcribe and wait for its durable job before reading the transcript. Create a fiche in the same folder with documents.create, following the fiche-methodology structure and callout syntax. Then call documents.update with the revision returned by create and the readable sources to attach their relational citations. Cite every readable source by title in the fiche and report explicitly which sources you could not read.${focus ? ` Focus especially on: ${focus}.` : ""}`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "mindmap-from-chapter",
    {
      title: "Mind map from chapter",
      description:
        "Build a bounded, source-grounded mind map from one materials folder.",
      argsSchema: z
        .object({
          folderId: id,
          focus: z.string().trim().max(200).optional(),
        })
        .strict(),
      _meta: promptMeta,
    },
    ({ folderId, focus }) => ({
      description: "Create an Avermate mind map from a materials chapter",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `List and read the available course materials in folder ${folderId}, including readable transcripts. Call documents.create to create a mindmap document in that folder with an empty bodyMarkdown and metaJson {version:1,root:{id,label,note?,children?}}. Use stable unique ids, short labels, at most 8 levels and no more than 500 nodes. Then call documents.update with the revision returned by create and the readable sources to attach their relational citations. Organize concepts from the chapter's central idea toward definitions, results, methods and examples, and never invent unread content.${focus ? ` Focus especially on: ${focus}.` : ""}`,
          },
        },
      ],
    }),
  );
  void principal;
}

export const promptsSurface: McpSurface = {
  scopes: ["avermate:read"],
  register: registerPrompts,
};
