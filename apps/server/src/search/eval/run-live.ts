import { runLiveRetrievalEvaluation } from "./live-evaluation";

const report = await runLiveRetrievalEvaluation();
console.log(
  JSON.stringify(
    {
      status: "passed",
      runId: report.runId,
      corpusRevision: report.manifest.corpusRevision,
      corpusDigest: report.manifest.corpusDigest,
      labelRevision: report.manifest.labelRevision,
      configurationDigest: report.pipeline.configurationDigest,
      metrics: report.metrics,
      reportWritten: true,
    },
    null,
    2,
  ),
);
