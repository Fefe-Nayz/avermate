import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { CorpusDerivativeWorkerOutputV1 } from "@avermate/agent-contracts";
import {
  boundedMediaWindows,
  runCorpusDerivativeProductionJob,
  type CorpusDerivativeJobDependencies,
  type CorpusDerivativeSource,
  type CorpusDerivativeUnit,
} from "./corpus-derivatives";

const ownerId = "derivative-owner";
const versionId = "derivative-version";
const locator = { kind: "pdf" as const, page: 2 };
const sourceBytes = new TextEncoder().encode("owned source bytes");

function digest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function onePagePdf() {
  const stream = "BT /F1 12 Tf 72 720 Td (diagram) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const pagePdf = onePagePdf();

function source(): CorpusDerivativeSource {
  return {
    ownerId,
    sourceId: "source-1",
    originId: "material-1",
    title: "Cours avec diagramme",
    versionId,
    fileId: "source-file-1",
    provider: "local",
    storageKey: "private/course-material/owner/source.pdf",
    mimeType: "application/pdf",
    byteSize: sourceBytes.byteLength,
    storageKeyHash: createHash("sha256")
      .update("private/course-material/owner/source.pdf")
      .digest("hex"),
  };
}

function workerOutput(
  unitId = "visual-chunk-1",
): CorpusDerivativeWorkerOutputV1 {
  return {
    schemaVersion: 1,
    worker: "corpus-derivatives.v1",
    kind: "pdf",
    totalPages: 2,
    units: [
      {
        unitId,
        page: 2,
        rotationDegrees: 90,
        widthPoints: 612,
        heightPoints: 792,
        pdf: {
          path: "output/page-00002.pdf",
          digest: digest(pagePdf),
          byteSize: pagePdf.byteLength,
          mimeType: "application/pdf",
        },
        image: {
          path: "output/page-00002.png",
          digest: digest(png),
          byteSize: png.byteLength,
          mimeType: "image/png",
        },
      },
    ],
  };
}

function dependencies(input: {
  ready?: ReadonlySet<string>;
  output?: CorpusDerivativeWorkerOutputV1;
  abortAfterStore?: AbortController;
  source?: CorpusDerivativeSource;
  units?: CorpusDerivativeUnit[];
}) {
  const registrations: Array<Record<string, unknown>> = [];
  const removed: string[] = [];
  const manifests: unknown[] = [];
  const discoveries: Array<{
    modality: "audio" | "video";
    durationMs: number;
  }> = [];
  const reads: Array<{
    ownerId: string;
    provider: string;
    storageKey: string;
    maxBytes: number | undefined;
  }> = [];
  let stores = 0;
  let executions = 0;
  let embeddings = 0;
  const output = input.output ?? workerOutput();
  const selectedSource = input.source ?? source();
  const deps: CorpusDerivativeJobDependencies = {
    loadSource: async () => selectedSource,
    loadUnits: async () =>
      input.units ?? [{ chunkId: "visual-chunk-1", locator }],
    readyKeys: async () => input.ready ?? new Set(),
    readObject: async (readOwnerId, file, options) => {
      reads.push({
        ownerId: readOwnerId,
        provider: file.provider,
        storageKey: file.storageKey,
        maxBytes: options?.maxBytes,
      });
      return exactArrayBuffer(sourceBytes);
    },
    executeWorker: (async (request: { manifest: unknown }) => {
      executions += 1;
      manifests.push(request.manifest);
      return {
        output,
        files: new Map([
          ["output/page-00002.pdf", pagePdf],
          ["output/page-00002.png", png],
        ]),
        profileVersion: "media-v1",
        imageDigest: `sha256:${"5".repeat(64)}`,
        evidenceNonce: "evidence-1",
      };
    }) as CorpusDerivativeJobDependencies["executeWorker"],
    store: (async ({ userId, purpose, file }) => {
      stores += 1;
      input.abortAfterStore?.abort(new DOMException("cancelled", "AbortError"));
      return {
        id: `file-${stores}`,
        provider: "local",
        storageKey: `derived/${stores}`,
        url: `private://derived/${stores}`,
        mimeType: file.type,
        byteSize: file.size,
        purpose,
        status: "stored",
        previewFileId: null,
        previewStatus: "unsupported",
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as CorpusDerivativeJobDependencies["store"],
    remove: (async (_owner, fileId) => {
      removed.push(fileId);
      return { id: fileId };
    }) as CorpusDerivativeJobDependencies["remove"],
    register: (async (value: unknown) => {
      const record = value as Record<string, unknown>;
      registrations.push(record);
      return {
        id: `derivative-${registrations.length}`,
        fileId: String(record.fileId),
        reused: false as const,
      };
    }) as CorpusDerivativeJobDependencies["register"],
    enqueueEmbedding: async () => {
      embeddings += 1;
      return "embedding-job-1";
    },
    publishMediaDiscovery: async (value) => {
      discoveries.push({
        modality: value.modality,
        durationMs: value.durationMs,
      });
      return {
        versionId: "successor-version",
        derivativeJobId: "successor-job",
      };
    },
  };
  return {
    deps,
    registrations,
    removed,
    manifests,
    discoveries,
    reads,
    get stores() {
      return stores;
    },
    get executions() {
      return executions;
    },
    get embeddings() {
      return embeddings;
    },
  };
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

describe("durable corpus derivative production", () => {
  test("creates bounded, overlapping windows that exactly reach media duration", () => {
    expect(boundedMediaWindows("video", 250_000)).toEqual([
      { startMs: 0, endMs: 120_000 },
      { startMs: 110_000, endMs: 230_000 },
      { startMs: 220_000, endMs: 250_000 },
    ]);
    expect(boundedMediaWindows("audio", 180_001)).toEqual([
      { startMs: 0, endMs: 180_000 },
      { startMs: 170_000, endMs: 180_001 },
    ]);
  });

  test("probes owned media without transcript and schedules its indexed successor", async () => {
    const fixture = dependencies({
      source: {
        ...source(),
        provider: "node:node_derivative_test:relay-storage-v1",
        mimeType: "video/mp4",
      },
      units: [],
      output: {
        schemaVersion: 1,
        worker: "corpus-derivatives.v1",
        kind: "media-probe",
        modality: "video",
        durationMs: 250_000,
      },
    });
    const result = await runCorpusDerivativeProductionJob(
      { ownerId, versionId },
      { dependencies: fixture.deps, operationId: "job-probe" },
    );
    expect(result).toEqual({
      stage: "media-discovered",
      derivatives: 0,
      successorVersionId: "successor-version",
      derivativeJobId: "successor-job",
      embeddingJobId: null,
    });
    expect(fixture.executions).toBe(1);
    expect(fixture.embeddings).toBe(0);
    expect(fixture.reads).toEqual([
      {
        ownerId,
        provider: "node:node_derivative_test:relay-storage-v1",
        storageKey: "private/course-material/owner/source.pdf",
        maxBytes: sourceBytes.byteLength,
      },
    ]);
    expect(fixture.discoveries).toEqual([
      { modality: "video", durationMs: 250_000 },
    ]);
    expect(fixture.manifests).toEqual([
      expect.objectContaining({
        request: { kind: "media-probe", modality: "video" },
      }),
    ]);
  });

  test("rejects a media probe for the wrong modality", async () => {
    const fixture = dependencies({
      source: { ...source(), mimeType: "video/mp4" },
      units: [],
      output: {
        schemaVersion: 1,
        worker: "corpus-derivatives.v1",
        kind: "media-probe",
        modality: "audio",
        durationMs: 1_000,
      },
    });
    await expect(
      runCorpusDerivativeProductionJob(
        { ownerId, versionId },
        { dependencies: fixture.deps },
      ),
    ).rejects.toThrow("CORPUS_DERIVATIVE_WORKER_PROBE_MISMATCH");
    expect(fixture.discoveries).toHaveLength(0);
    expect(fixture.embeddings).toBe(0);
  });

  test("adopts an attested single-page PDF and page image for a distinct visual chunk", async () => {
    const fixture = dependencies({});
    const result = await runCorpusDerivativeProductionJob(
      { ownerId, versionId },
      { dependencies: fixture.deps, operationId: "job-1" },
    );
    expect(result).toMatchObject({
      stage: "ready",
      derivatives: 2,
      embeddingJobId: "embedding-job-1",
    });
    expect(fixture.executions).toBe(1);
    expect(fixture.stores).toBe(2);
    expect(fixture.registrations).toEqual([
      expect.objectContaining({
        chunkId: "visual-chunk-1",
        kind: "pdf-page",
        locator,
        rendererProfile: "media-v1",
        rendererImageDigest: `sha256:${"5".repeat(64)}`,
        metadata: expect.objectContaining({
          originalPage: 2,
          rotationDegrees: 90,
          widthPoints: 612,
          heightPoints: 792,
        }),
      }),
      expect.objectContaining({
        chunkId: "visual-chunk-1",
        kind: "page-image",
        locator,
      }),
    ]);
  });

  test("reuses a complete derivative set without rerunning the sandbox", async () => {
    const ready = new Set([
      `pdf-page\0${JSON.stringify(locator)}`,
      `page-image\0${JSON.stringify(locator)}`,
    ]);
    const fixture = dependencies({ ready });
    const result = await runCorpusDerivativeProductionJob(
      { ownerId, versionId },
      { dependencies: fixture.deps },
    );
    expect(result).toMatchObject({ stage: "reused", derivatives: 2 });
    expect(fixture.executions).toBe(0);
    expect(fixture.stores).toBe(0);
  });

  test("repairs only a missing PDF representation on retry", async () => {
    const ready = new Set([`pdf-page\0${JSON.stringify(locator)}`]);
    const fixture = dependencies({ ready });
    const result = await runCorpusDerivativeProductionJob(
      { ownerId, versionId },
      { dependencies: fixture.deps },
    );
    expect(result).toMatchObject({ stage: "ready", derivatives: 1 });
    expect(fixture.executions).toBe(1);
    expect(fixture.stores).toBe(1);
    expect(fixture.registrations).toEqual([
      expect.objectContaining({ kind: "page-image", locator }),
    ]);
  });

  test("rejects invented worker unit ids before storing any output", async () => {
    const fixture = dependencies({ output: workerOutput("invented-chunk") });
    await expect(
      runCorpusDerivativeProductionJob(
        { ownerId, versionId },
        { dependencies: fixture.deps },
      ),
    ).rejects.toThrow("CORPUS_DERIVATIVE_WORKER_UNIT_MISMATCH");
    expect(fixture.stores).toBe(0);
  });

  test("compensates a stored candidate when cancellation arrives before registration", async () => {
    const controller = new AbortController();
    const fixture = dependencies({ abortAfterStore: controller });
    await expect(
      runCorpusDerivativeProductionJob(
        { ownerId, versionId },
        {
          signal: controller.signal,
          dependencies: fixture.deps,
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.registrations).toHaveLength(0);
    expect(fixture.removed).toEqual(["file-1"]);
  });
});
