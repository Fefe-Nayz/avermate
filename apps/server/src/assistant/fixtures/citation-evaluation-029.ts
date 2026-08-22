import { RETRIEVAL_EVALUATION_028 } from "../../search/fixtures/evaluation-028";
import type { LabelledCitationAnswer } from "../citation-quality";

export const CITATION_EVALUATION_FIXTURE_VERSION =
  "retrieval-028+citation-029/1" as const;

const UNANSWERABLE_QUESTIONS = [
  "Quelle était la température exacte de la salle pendant le cours ?",
  "Quel élève a posé la première question du chapitre ?",
  "Quelle page supprimée contenait la correction manuscrite ?",
  "Quelle note obtiendra l'élève au prochain devoir ?",
  "Quel exercice le professeur choisira demain ?",
  "Quelle était la couleur du tableau pendant l'explication ?",
  "Quel exemple oral non enregistré a été donné ?",
  "Quelle annotation privée a été effacée avant l'indexation ?",
  "Quel sera le sujet exact de l'examen final ?",
  "À quelle seconde un passage absent de l'audio a-t-il été prononcé ?",
  "Who entered the classroom first during the lesson?",
  "What exact grade will the next assignment receive?",
  "Which deleted draft contained the teacher's private note?",
  "What example was spoken while recording was paused?",
  "What will tomorrow's surprise quiz ask?",
  "Which student silently disagreed with the explanation?",
  "What was written outside the captured PDF page?",
  "Which unrecorded website revision did the teacher read?",
  "What private comment was removed before synchronization?",
  "What exact answer will the teacher accept next year?",
] as const;

/**
 * A deterministic protocol baseline built from the reviewed bilingual corpus.
 * Real provider rollout still needs separately recorded model outputs reviewed
 * against the same scorer; these rows prove the metric implementation itself.
 */
export const CITATION_EVALUATION_029: readonly LabelledCitationAnswer[] = [
  ...RETRIEVAL_EVALUATION_028.slice(0, 40).map((fixture) => ({
    id: `answerable-${fixture.id}`,
    answerable: true,
    abstained: false,
    claims: [
      {
        id: `claim-${fixture.id}`,
        text: fixture.passage,
        externallyCheckable: true,
        supportingEvidenceIds: [fixture.id],
        citedEvidenceIds: [fixture.id],
      },
    ],
  })),
  ...UNANSWERABLE_QUESTIONS.map((_question, index) => ({
    id: `unanswerable-${String(index + 1).padStart(2, "0")}`,
    answerable: false,
    abstained: true,
    claims: [],
  })),
];

export const CITATION_EVALUATION_UNANSWERABLE_QUESTIONS =
  UNANSWERABLE_QUESTIONS;
