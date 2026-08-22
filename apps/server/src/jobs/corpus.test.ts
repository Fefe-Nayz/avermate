import { describe, expect, test } from "bun:test";
import { runCorpusEmbeddingUnavailableJob } from "./corpus";

describe("corpus embedding jobs", () => {
  test("honors the worker abort signal before provider or database work", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(
      runCorpusEmbeddingUnavailableJob(
        {},
        { signal: controller.signal, runtime: null },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
