import { createHash } from "node:crypto";
import type { LearningMasteryExplanationV1 } from "../db/schema";

export const LEARNING_MASTERY_ALGORITHM_REVISION = "beta-evidence-v1";

const DAY_MS = 86_400_000;

export type MasteryEvidenceInput = {
  id: string;
  observedOutcome: number | null;
  denominator: number | null;
  reliability: number;
  difficulty: number | null;
  occurredAt: Date;
  included: boolean;
  exclusionReason?: string;
};

export type MasteryProjectionResult = {
  algorithmRevision: typeof LEARNING_MASTERY_ALGORITHM_REVISION;
  evidenceCursor: string;
  estimate: number;
  low: number;
  high: number;
  alpha: number;
  beta: number;
  evidenceCount: number;
  freshnessDays: number | null;
  explanation: LearningMasteryExplanationV1;
  digest: string;
};

function bounded(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function rounded(value: number): number {
  return Number(value.toFixed(12));
}

/**
 * Deterministic and deliberately modest Beta-style mastery hypothesis.
 *
 * Missing difficulty is kept as `null` in the explanation and receives no
 * adjustment. Recency is bounded at 0.5 so an old, reviewed observation does
 * not silently disappear. Only observations with an explicit denominator are
 * normalized; every omitted row remains inspectable in the explanation.
 */
export function projectObjectiveMastery(input: {
  evidence: MasteryEvidenceInput[];
  asOf: Date;
  prior?: { alpha: number; beta: number };
}): MasteryProjectionResult {
  const prior = input.prior ?? { alpha: 1, beta: 1 };
  if (!(prior.alpha > 0 && prior.beta > 0)) {
    throw new Error("Mastery prior parameters must be positive");
  }

  const ordered = [...input.evidence].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  let alpha = prior.alpha;
  let beta = prior.beta;
  let evidenceCount = 0;
  let newestIncluded: Date | null = null;
  const contributions: LearningMasteryExplanationV1["contributions"] = [];

  for (const row of ordered) {
    const base = {
      evidenceId: row.id,
      included: row.included,
      reliability: rounded(bounded(row.reliability)),
      difficulty:
        row.difficulty === null ? null : rounded(bounded(row.difficulty)),
    };
    if (!row.included) {
      contributions.push({
        ...base,
        exclusionReason: row.exclusionReason ?? "excluded by the user",
      });
      continue;
    }
    if (
      row.observedOutcome === null ||
      row.denominator === null ||
      !Number.isFinite(row.observedOutcome) ||
      !Number.isFinite(row.denominator) ||
      row.denominator <= 0
    ) {
      contributions.push({
        ...base,
        included: false,
        exclusionReason: "no defined numeric rubric",
      });
      continue;
    }

    const normalizedOutcome = bounded(row.observedOutcome / row.denominator);
    const ageDays = Math.max(
      0,
      (input.asOf.getTime() - row.occurredAt.getTime()) / DAY_MS,
    );
    const recencyWeight = Math.max(0.5, Math.exp(-ageDays / 180));
    // Unknown difficulty means no adjustment. Known difficult tasks add at most 25%.
    const difficultyWeight =
      row.difficulty === null ? 1 : 0.75 + 0.5 * bounded(row.difficulty);
    const weight = bounded(row.reliability) * recencyWeight * difficultyWeight;
    const alphaContribution = normalizedOutcome * weight;
    const betaContribution = (1 - normalizedOutcome) * weight;
    alpha += alphaContribution;
    beta += betaContribution;
    evidenceCount += 1;
    if (!newestIncluded || row.occurredAt > newestIncluded)
      newestIncluded = row.occurredAt;
    contributions.push({
      ...base,
      normalizedOutcome: rounded(normalizedOutcome),
      recencyWeight: rounded(recencyWeight),
      difficultyWeight: rounded(difficultyWeight),
      alphaContribution: rounded(alphaContribution),
      betaContribution: rounded(betaContribution),
    });
  }

  alpha = rounded(alpha);
  beta = rounded(beta);
  const estimate = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const margin = 1.96 * Math.sqrt(variance);
  const explanation: LearningMasteryExplanationV1 = {
    version: 1,
    prior: { alpha: rounded(prior.alpha), beta: rounded(prior.beta) },
    asOf: input.asOf.toISOString(),
    contributions,
  };
  const evidenceCursor = digest(
    ordered.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    })),
  );
  const projection = {
    algorithmRevision: LEARNING_MASTERY_ALGORITHM_REVISION,
    evidenceCursor,
    estimate: rounded(estimate),
    low: rounded(bounded(estimate - margin)),
    high: rounded(bounded(estimate + margin)),
    alpha,
    beta,
    evidenceCount,
    freshnessDays:
      newestIncluded === null
        ? null
        : rounded(
            Math.max(
              0,
              (input.asOf.getTime() - newestIncluded.getTime()) / DAY_MS,
            ),
          ),
    explanation,
  } as const;
  return { ...projection, digest: digest(projection) };
}
