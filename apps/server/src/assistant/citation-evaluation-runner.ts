import {
  assertCitationQualityThresholds,
  evaluateCitationQuality,
} from "./citation-quality";
import {
  CITATION_EVALUATION_029,
  CITATION_EVALUATION_FIXTURE_VERSION,
} from "./fixtures/citation-evaluation-029";

const report = evaluateCitationQuality(CITATION_EVALUATION_029, {
  provider: "deterministic-protocol-fixture",
  model: "extractive-gold",
  modelVersion: "1",
  fixtureRevision: CITATION_EVALUATION_FIXTURE_VERSION,
});
assertCitationQualityThresholds(report);
console.log(JSON.stringify(report));
