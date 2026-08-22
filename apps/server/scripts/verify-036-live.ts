import {
  GEMINI_EMBEDDING_DISCLOSURE_REVISION,
  GeminiEmbeddingProvider,
} from "../src/search/gemini-embedding";
import { createHash } from "node:crypto";
import {
  CohereRerankProvider,
  GTE_MULTILINGUAL_RERANK_MODEL,
  TeiRerankProvider,
} from "../src/search/rerank-providers";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PLAN036_LIVE_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function syntheticOnePagePdf(text: string) {
  const escaped = text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

const signal = AbortSignal.timeout(60_000);
const gemini = new GeminiEmbeddingProvider({
  apiKey: required("GEMINI_API_KEY"),
  dimensions: 768,
});
const [embedding] = await gemini.embedText(
  [
    {
      contentHash: "a".repeat(64),
      text: "Une force modifie le mouvement d'un système.",
      purpose: "document",
      title: "Fixture live Plan 036",
    },
  ],
  {
    operationId: crypto.randomUUID(),
    signal,
    consent: {
      provider: "gemini",
      capability: "embedding",
      disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
      grantedAt: new Date().toISOString(),
    },
  },
);
if (!embedding || embedding.values.length !== 768) {
  throw new Error("PLAN036_LIVE_GEMINI_CONFORMANCE_FAILED");
}

const image = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const pdfPage = syntheticOnePagePdf("Schema de force Avermate");
const mediaByHandle = new Map([
  ["file:live-image", { bytes: image, mediaType: "image/png" }],
  ["file:live-pdf-page", { bytes: pdfPage, mediaType: "application/pdf" }],
]);
const multimodalGemini = new GeminiEmbeddingProvider({
  apiKey: required("GEMINI_API_KEY"),
  dimensions: 768,
  resolveMedia: async (input) => {
    const media = mediaByHandle.get(input.opaqueFileHandle);
    if (!media) throw new Error("PLAN036_LIVE_MEDIA_HANDLE_UNKNOWN");
    return media;
  },
});
const mediaEmbeddings = await multimodalGemini.embedMedia(
  [
    {
      contentHash: digest(image),
      modality: "image",
      mediaType: "image/png",
      opaqueFileHandle: "file:live-image",
      locator: { kind: "slides", slide: 1 },
      byteLength: image.byteLength,
      estimatedInputTokens: 8,
    },
    {
      contentHash: digest(pdfPage),
      modality: "pdf-page",
      mediaType: "application/pdf",
      opaqueFileHandle: "file:live-pdf-page",
      locator: { kind: "pdf", page: 1 },
      byteLength: pdfPage.byteLength,
      estimatedInputTokens: 64,
    },
  ],
  {
    operationId: crypto.randomUUID(),
    signal,
    consent: {
      provider: "gemini",
      capability: "embedding",
      disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
      grantedAt: new Date().toISOString(),
    },
  },
);
if (
  mediaEmbeddings.length !== 2 ||
  mediaEmbeddings.some((item) => item.values.length !== 768)
) {
  throw new Error("PLAN036_LIVE_GEMINI_MULTIMODAL_CONFORMANCE_FAILED");
}

const candidates = [
  {
    id: "relevant",
    text: "La force est une action mécanique.",
    tokenEstimate: 8,
  },
  { id: "noise", text: "La poésie utilise des vers.", tokenEstimate: 7 },
];
const cohere = new CohereRerankProvider({
  apiKey: required("COHERE_API_KEY"),
  model: "rerank-v4.0-pro",
});
const cohereScores = await cohere.rerank({
  operationId: crypto.randomUUID(),
  query: "Qu'est-ce qu'une force ?",
  candidates,
  topN: 2,
  signal,
});
if (cohereScores.length !== 2) {
  throw new Error("PLAN036_LIVE_COHERE_CONFORMANCE_FAILED");
}
if (cohereScores[0]?.candidateId !== "relevant") {
  throw new Error("PLAN036_LIVE_COHERE_RELEVANCE_FAILED");
}

if (required("CORPUS_RERANK_MODEL") !== GTE_MULTILINGUAL_RERANK_MODEL) {
  throw new Error("PLAN036_LIVE_TEI_MODEL_MUST_BE_GTE_MULTILINGUAL");
}
const tei = new TeiRerankProvider({
  fetch,
  baseUrl: required("CORPUS_RERANK_BASE_URL"),
  modelRevision: required("CORPUS_RERANK_MODEL_REVISION"),
  imageDigest: required("CORPUS_RERANK_IMAGE_DIGEST"),
  teiRevision: required("CORPUS_RERANK_TEI_REVISION"),
});
const teiScores = await tei.rerank({
  operationId: crypto.randomUUID(),
  query: "Qu'est-ce qu'une force ?",
  candidates,
  topN: 2,
  signal,
});
if (teiScores.length !== 2) {
  throw new Error("PLAN036_LIVE_TEI_CONFORMANCE_FAILED");
}
if (teiScores[0]?.candidateId !== "relevant") {
  throw new Error("PLAN036_LIVE_TEI_RELEVANCE_FAILED");
}

console.log(
  "Plan 036 live Gemini text/image/PDF-page, Cohere, and local reranker conformance passed.",
);
