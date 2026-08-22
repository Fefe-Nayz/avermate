import { z } from "zod";
import { sourceLocatorV1Schema } from "@avermate/agent-contracts";
import fixtureJson from "./fixtures/french-school-v1.json";
import { canonicalJson, sha256 } from "../values";

export const retrievalEvaluationConfigurationSchema = z.enum([
  "lexical",
  "dense",
  "rrf",
  "rrf-cohere",
  "rrf-tei",
  "multimodal",
]);
export type RetrievalEvaluationConfiguration = z.infer<
  typeof retrievalEvaluationConfigurationSchema
>;

const fixtureSchema = z.strictObject({
  revision: z.literal("french-school-v1"),
  reviewedAt: z.iso.date(),
  language: z.literal("fr"),
  license: z.string().min(1),
  documents: z.array(
    z.strictObject({
      id: z.string().min(1),
      sourceId: z.string().min(1),
      modality: z.string().min(1),
      locator: sourceLocatorV1Schema,
    }),
  ),
  queries: z.array(
    z.strictObject({
      id: z.string().min(1),
      query: z.string().min(1),
      relevance: z.array(
        z.strictObject({
          documentId: z.string().min(1),
          grade: z.number().int().min(1).max(3),
        }),
      ),
      rankings: z.record(
        retrievalEvaluationConfigurationSchema,
        z.array(z.string().min(1)),
      ),
    }),
  ),
});

export const frenchSchoolFixture = fixtureSchema.parse(fixtureJson);
export const FRENCH_SCHOOL_FIXTURE_REVISION = frenchSchoolFixture.revision;

function mean(values: readonly number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function recallAt(
  ranked: readonly string[],
  relevant: ReadonlyMap<string, number>,
  cutoff: number,
) {
  const found = new Set(
    ranked.slice(0, cutoff).filter((documentId) => relevant.has(documentId)),
  );
  return relevant.size === 0 ? 0 : found.size / relevant.size;
}

function reciprocalRank(
  ranked: readonly string[],
  relevant: ReadonlyMap<string, number>,
  cutoff: number,
) {
  const index = ranked.slice(0, cutoff).findIndex((id) => relevant.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

function averagePrecision(
  ranked: readonly string[],
  relevant: ReadonlyMap<string, number>,
) {
  let found = 0;
  let precision = 0;
  ranked.forEach((id, index) => {
    if (!relevant.has(id)) return;
    found += 1;
    precision += found / (index + 1);
  });
  return relevant.size === 0 ? 0 : precision / relevant.size;
}

function discountedGain(grades: readonly number[]) {
  return grades.reduce(
    (total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

function ndcgAt(
  ranked: readonly string[],
  relevant: ReadonlyMap<string, number>,
  cutoff: number,
) {
  const actual = ranked
    .slice(0, cutoff)
    .map((documentId) => relevant.get(documentId) ?? 0);
  const ideal = [...relevant.values()]
    .sort((left, right) => right - left)
    .slice(0, cutoff);
  const maximum = discountedGain(ideal);
  return maximum === 0 ? 0 : discountedGain(actual) / maximum;
}

function isMultimodalEvaluationDocument(modality: string) {
  return !["text", "native-pdf", "moodle", "conversation"].includes(modality);
}

export type RetrievalEvaluationMetrics = {
  recallAt5: number;
  recallAt10: number;
  recallAt20: number;
  mrrAt10: number;
  ndcgAt10: number;
  map: number;
  sourceDiversityAt10: number;
  citationLocatorAccuracy: number;
  multimodalRelevantRecallAt10: number;
};

export type RetrievalEvaluationObservation = {
  queryId: string;
  rankedDocumentIds: readonly string[];
  /** Exact documents actually cited by the answer, not merely retrieved. */
  citationDocumentIds: readonly string[];
  abstained: boolean;
  latencyMs: number;
  /** Null means the provider did not return an attributable monetary cost. */
  providerCostMinor: number | null;
};

export type LiveRetrievalEvaluationMetrics = RetrievalEvaluationMetrics & {
  citationPrecisionAt10: number;
  citationCoverageAt10: number;
  abstentionAccuracy: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  totalProviderCostMinor: number | null;
};

function percentile(values: readonly number[], quantile: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)
  ]!;
}

/**
 * Scores rankings produced by a real retrieval run against reviewed relevance
 * labels. This is deliberately separate from the checked-in deterministic
 * regression fixture: callers must supply observations from the provider run.
 */
export function evaluateObservedRankings(input: {
  documents: readonly {
    id: string;
    sourceId: string;
    modality: string;
    locator: unknown;
  }[];
  queries: readonly {
    id: string;
    relevance: readonly { documentId: string; grade: number }[];
  }[];
  observations: readonly RetrievalEvaluationObservation[];
}): LiveRetrievalEvaluationMetrics {
  if (
    new Set(input.documents.map((document) => document.id)).size !==
      input.documents.length ||
    new Set(input.queries.map((query) => query.id)).size !==
      input.queries.length
  ) {
    throw new Error("EVAL_DUPLICATE_DOCUMENT_OR_QUERY_ID");
  }
  const documents = new Map(
    input.documents.map((document) => [document.id, document]),
  );
  const observations = new Map(
    input.observations.map((observation) => [observation.queryId, observation]),
  );
  if (observations.size !== input.queries.length) {
    throw new Error("EVAL_OBSERVATION_COUNT_MISMATCH");
  }
  const perQuery = input.queries.map((query) => {
    if (
      new Set(query.relevance.map((entry) => entry.documentId)).size !==
        query.relevance.length ||
      query.relevance.some(
        (entry) =>
          !documents.has(entry.documentId) ||
          !Number.isInteger(entry.grade) ||
          entry.grade < 1 ||
          entry.grade > 3,
      )
    ) {
      throw new Error(`EVAL_INVALID_RELEVANCE:${query.id}`);
    }
    const observation = observations.get(query.id);
    if (!observation) throw new Error(`EVAL_OBSERVATION_MISSING:${query.id}`);
    if (
      !Number.isFinite(observation.latencyMs) ||
      observation.latencyMs < 0 ||
      new Set(observation.rankedDocumentIds).size !==
        observation.rankedDocumentIds.length ||
      observation.rankedDocumentIds.some((id) => !documents.has(id)) ||
      observation.citationDocumentIds.some((id) => !documents.has(id)) ||
      new Set(observation.citationDocumentIds).size !==
        observation.citationDocumentIds.length ||
      (observation.abstained && observation.citationDocumentIds.length > 0) ||
      (observation.providerCostMinor !== null &&
        (!Number.isFinite(observation.providerCostMinor) ||
          observation.providerCostMinor < 0))
    ) {
      throw new Error(`EVAL_INVALID_OBSERVATION:${query.id}`);
    }
    const relevant = new Map(
      query.relevance.map((entry) => [entry.documentId, entry.grade]),
    );
    const ranked = observation.rankedDocumentIds;
    const rankedDocuments = ranked.map((id) => documents.get(id)!);
    const uniqueSources = new Set(
      rankedDocuments.slice(0, 10).map((document) => document.sourceId),
    ).size;
    const relevantCitations = observation.citationDocumentIds.filter((id) =>
      relevant.has(id),
    );
    const relevantInTopTen = ranked
      .slice(0, 10)
      .filter((id) => relevant.has(id));
    const multimodalRelevant = [...relevant.keys()].filter((id) =>
      isMultimodalEvaluationDocument(documents.get(id)!.modality),
    );
    const multimodalRelevantIds = new Set(multimodalRelevant);
    return {
      recallAt5: recallAt(ranked, relevant, 5),
      recallAt10: recallAt(ranked, relevant, 10),
      recallAt20: recallAt(ranked, relevant, 20),
      mrrAt10: reciprocalRank(ranked, relevant, 10),
      ndcgAt10: ndcgAt(ranked, relevant, 10),
      map: averagePrecision(ranked, relevant),
      sourceDiversityAt10:
        rankedDocuments.length === 0
          ? 0
          : uniqueSources / Math.min(10, rankedDocuments.length),
      citationLocatorAccuracy:
        observation.citationDocumentIds.length === 0
          ? observation.abstained
            ? 1
            : 0
          : observation.citationDocumentIds.filter(
              (id) => documents.get(id)?.locator,
            ).length / observation.citationDocumentIds.length,
      multimodalRelevantRecallAt10:
        multimodalRelevant.length === 0
          ? 1
          : new Set(
              ranked.slice(0, 10).filter((id) => multimodalRelevantIds.has(id)),
            ).size / multimodalRelevant.length,
      citationPrecisionAt10:
        observation.citationDocumentIds.length === 0
          ? observation.abstained
            ? 1
            : 0
          : relevantCitations.length / observation.citationDocumentIds.length,
      citationCoverageAt10:
        relevantInTopTen.length === 0
          ? observation.abstained
            ? 1
            : 0
          : new Set(relevantCitations).size / new Set(relevantInTopTen).size,
      abstentionAccuracy:
        observation.abstained === (relevantInTopTen.length === 0) ? 1 : 0,
      latencyMs: observation.latencyMs,
      providerCostMinor: observation.providerCostMinor,
    };
  });
  const monetary = perQuery.map((entry) => entry.providerCostMinor);
  const costsKnown = monetary.every((value) => value !== null);
  return {
    recallAt5: mean(perQuery.map((entry) => entry.recallAt5)),
    recallAt10: mean(perQuery.map((entry) => entry.recallAt10)),
    recallAt20: mean(perQuery.map((entry) => entry.recallAt20)),
    mrrAt10: mean(perQuery.map((entry) => entry.mrrAt10)),
    ndcgAt10: mean(perQuery.map((entry) => entry.ndcgAt10)),
    map: mean(perQuery.map((entry) => entry.map)),
    sourceDiversityAt10: mean(
      perQuery.map((entry) => entry.sourceDiversityAt10),
    ),
    citationLocatorAccuracy: mean(
      perQuery.map((entry) => entry.citationLocatorAccuracy),
    ),
    multimodalRelevantRecallAt10: mean(
      perQuery.map((entry) => entry.multimodalRelevantRecallAt10),
    ),
    citationPrecisionAt10: mean(
      perQuery.map((entry) => entry.citationPrecisionAt10),
    ),
    citationCoverageAt10: mean(
      perQuery.map((entry) => entry.citationCoverageAt10),
    ),
    abstentionAccuracy: mean(perQuery.map((entry) => entry.abstentionAccuracy)),
    p50LatencyMs: percentile(
      perQuery.map((entry) => entry.latencyMs),
      0.5,
    ),
    p95LatencyMs: percentile(
      perQuery.map((entry) => entry.latencyMs),
      0.95,
    ),
    totalProviderCostMinor: costsKnown
      ? monetary.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null,
  };
}

export function evaluateFixtureRanking(
  configuration: RetrievalEvaluationConfiguration,
): RetrievalEvaluationMetrics {
  const documents = new Map(
    frenchSchoolFixture.documents.map((document) => [document.id, document]),
  );
  const perQuery = frenchSchoolFixture.queries.map((query) => {
    const relevant = new Map(
      query.relevance.map((entry) => [entry.documentId, entry.grade]),
    );
    const ranked = query.rankings[configuration];
    const rankedDocuments = ranked.flatMap((id) => {
      const document = documents.get(id);
      return document ? [document] : [];
    });
    const uniqueSources = new Set(
      rankedDocuments.slice(0, 10).map((document) => document.sourceId),
    ).size;
    const citedRelevant = ranked.slice(0, 10).filter((id) => relevant.has(id));
    const locatorAccuracy = citedRelevant.length
      ? citedRelevant.filter((id) => documents.get(id)?.locator).length /
        citedRelevant.length
      : 0;
    const multimodalRelevant = [...relevant.keys()].filter((id) =>
      isMultimodalEvaluationDocument(documents.get(id)!.modality),
    );
    const multimodalRelevantIds = new Set(multimodalRelevant);
    const multimodalFound = new Set(
      ranked.slice(0, 10).filter((id) => multimodalRelevantIds.has(id)),
    );
    return {
      recallAt5: recallAt(ranked, relevant, 5),
      recallAt10: recallAt(ranked, relevant, 10),
      recallAt20: recallAt(ranked, relevant, 20),
      mrrAt10: reciprocalRank(ranked, relevant, 10),
      ndcgAt10: ndcgAt(ranked, relevant, 10),
      map: averagePrecision(ranked, relevant),
      sourceDiversityAt10:
        rankedDocuments.length === 0
          ? 0
          : uniqueSources / Math.min(10, rankedDocuments.length),
      citationLocatorAccuracy: locatorAccuracy,
      multimodalRelevantRecallAt10:
        multimodalRelevant.length === 0
          ? 1
          : multimodalFound.size / multimodalRelevant.length,
    };
  });
  return {
    recallAt5: mean(perQuery.map((entry) => entry.recallAt5)),
    recallAt10: mean(perQuery.map((entry) => entry.recallAt10)),
    recallAt20: mean(perQuery.map((entry) => entry.recallAt20)),
    mrrAt10: mean(perQuery.map((entry) => entry.mrrAt10)),
    ndcgAt10: mean(perQuery.map((entry) => entry.ndcgAt10)),
    map: mean(perQuery.map((entry) => entry.map)),
    sourceDiversityAt10: mean(
      perQuery.map((entry) => entry.sourceDiversityAt10),
    ),
    citationLocatorAccuracy: mean(
      perQuery.map((entry) => entry.citationLocatorAccuracy),
    ),
    multimodalRelevantRecallAt10: mean(
      perQuery.map((entry) => entry.multimodalRelevantRecallAt10),
    ),
  };
}

export function evaluateFrenchSchoolFixture(
  configurations: readonly RetrievalEvaluationConfiguration[] = retrievalEvaluationConfigurationSchema.options,
) {
  const selected = [...new Set(configurations)];
  const ablations = selected.map((configuration) => ({
    configuration,
    metrics: evaluateFixtureRanking(configuration),
  }));
  const corpusDigest = sha256(
    canonicalJson({
      documents: frenchSchoolFixture.documents,
      queries: frenchSchoolFixture.queries.map((query) => ({
        id: query.id,
        queryDigest: sha256(query.query),
        relevance: query.relevance,
      })),
    }),
  );
  const configurationDigest = sha256(canonicalJson(selected));
  const preferred =
    ablations.find((entry) => entry.configuration === "multimodal") ??
    ablations.at(-1);
  return {
    evidenceClass: "deterministic-pre-ranked-regression-fixture" as const,
    provesLiveProviderQuality: false as const,
    fixtureRevision: frenchSchoolFixture.revision,
    corpusDigest,
    configurationDigest,
    metrics: preferred?.metrics ?? evaluateFixtureRanking("lexical"),
    ablations,
  };
}

export function assertFrenchSchoolRegressionGate() {
  const lexical = evaluateFixtureRanking("lexical");
  const multimodal = evaluateFixtureRanking("multimodal");
  if (multimodal.recallAt10 < lexical.recallAt10 + 0.15) {
    throw new Error("EVAL_REGRESSION_ADVANCED_RECALL_IMPROVEMENT_REQUIRED");
  }
  if (
    multimodal.citationLocatorAccuracy < 0.99 ||
    multimodal.multimodalRelevantRecallAt10 < 0.95 ||
    multimodal.ndcgAt10 < 0.9
  ) {
    throw new Error("EVAL_REGRESSION_MULTIMODAL_GATE_FAILED");
  }
  return { lexical, multimodal };
}

/** @deprecated This is a deterministic regression gate, not live quality evidence. */
export const assertFrenchSchoolQualityGate = assertFrenchSchoolRegressionGate;
