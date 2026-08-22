import { afterEach, describe, expect, test } from "bun:test";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_OCR = "false";

afterEach(() => {
  process.env.DISABLE_OCR = "false";
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Mistral OCR client", () => {
  test("uploads once and concatenates provider pages in the stable format", async () => {
    const { runMistralOcr } = await import("./ocr");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return calls.length === 1
        ? jsonResponse({ id: "provider-file-1" })
        : jsonResponse({
            pages: [
              { index: 0, markdown: "# Chapter" },
              { index: 1, markdown: "Equation $x=1$." },
            ],
          });
    };

    const result = await runMistralOcr(
      "ocr-test-user",
      {
        blob: new Blob(["pdf"], { type: "application/pdf" }),
        name: "lesson.pdf",
      },
      { key: "test-key", fetch: fetcher, sleep: async () => undefined },
    );

    expect(result).toEqual({
      markdown:
        "<!-- Page 0 -->\n# Chapter\n\n<!-- Page 1 -->\nEquation $x=1$.",
      pageCount: 2,
      providerFileId: "provider-file-1",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toEndWith("/v1/files");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
    expect(calls[1]?.url).toEndWith("/v1/ocr");
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      document: { file_id: "provider-file-1" },
      model: "mistral-ocr-latest",
      include_image_base64: false,
    });
  });

  test("retries a throttled request with bounded exponential backoff", async () => {
    const { runMistralOcr } = await import("./ocr");
    let calls = 0;
    const delays: number[] = [];
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ message: "slow down" }, 429);
      if (calls === 2) return jsonResponse({ id: "provider-file-2" });
      return jsonResponse({ pages: [{ index: 1, markdown: "Ready" }] });
    };

    const result = await runMistralOcr(
      "ocr-test-user",
      { blob: new Blob(["pdf"]), name: "retry.pdf" },
      {
        key: "test-key",
        fetch: fetcher,
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    );
    expect(result.pageCount).toBe(1);
    expect(calls).toBe(3);
    expect(delays).toEqual([1_000]);
  });

  test("redacts a reflected credential from every provider error path", async () => {
    const { runMistralOcr } = await import("./ocr");
    const secret = "mistral-secret-that-must-never-be-persisted";
    const source = {
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      name: "secret.pdf",
    };

    const uploadError = await runMistralOcr("ocr-test-user", source, {
      key: secret,
      fetch: async () =>
        jsonResponse(
          { error: { message: `invalid ${secret} ${secret}` } },
          401,
        ),
      sleep: async () => undefined,
    }).catch((error: unknown) => error);
    expect(uploadError).toBeInstanceOf(Error);
    expect((uploadError as Error).message).toContain(
      "invalid [redacted] [redacted]",
    );
    expect((uploadError as Error).message).not.toContain(secret);

    let ocrCalls = 0;
    const ocrError = await runMistralOcr("ocr-test-user", source, {
      key: secret,
      fetch: async () => {
        ocrCalls += 1;
        return ocrCalls === 1
          ? jsonResponse({ id: "provider-file-secret" })
          : new Response(`authorization failed for ${secret}`, { status: 401 });
      },
      sleep: async () => undefined,
    }).catch((error: unknown) => error);
    expect(ocrError).toBeInstanceOf(Error);
    expect((ocrError as Error).message).toContain(
      "authorization failed for [redacted]",
    );
    expect((ocrError as Error).message).not.toContain(secret);

    let retryCalls = 0;
    const retryError = await runMistralOcr("ocr-test-user", source, {
      key: secret,
      fetch: async () => {
        retryCalls += 1;
        return jsonResponse({ detail: `retry ${secret}` }, 503);
      },
      sleep: async () => undefined,
    }).catch((error: unknown) => error);
    expect(retryCalls).toBe(6);
    expect(retryError).toBeInstanceOf(Error);
    expect((retryError as Error).message).toContain("retry [redacted]");
    expect((retryError as Error).message).not.toContain(secret);
  });

  test("rejects an over-budget page response without returning partial text", async () => {
    const { runMistralOcr } = await import("./ocr");
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ id: "provider-file-3" })
        : jsonResponse({
            pages: [
              { index: 0, markdown: "One" },
              { index: 1, markdown: "Two" },
            ],
          });
    };
    await expect(
      runMistralOcr(
        "ocr-test-user",
        { blob: new Blob(["pdf"]), name: "large.pdf" },
        {
          key: "test-key",
          fetch: fetcher,
          sleep: async () => undefined,
          maxPages: 1,
        },
      ),
    ).rejects.toThrow("2 pages; the configured limit is 1");
  });

  test("honors the disabled switch before resolving or calling a provider", async () => {
    const { runMistralOcr } = await import("./ocr");
    process.env.DISABLE_OCR = "true";
    let called = false;
    await expect(
      runMistralOcr(
        "ocr-test-user",
        { blob: new Blob(["pdf"]), name: "disabled.pdf" },
        {
          key: "test-key",
          fetch: async () => {
            called = true;
            return jsonResponse({});
          },
        },
      ),
    ).rejects.toThrow("OCR is disabled on this server");
    expect(called).toBe(false);
  });

  test("does not retry after the owning job loses its lease", async () => {
    const { runMistralOcr } = await import("./ocr");
    const controller = new AbortController();
    controller.abort(new Error("lease lost"));
    let calls = 0;
    let sleeps = 0;
    await expect(
      runMistralOcr(
        "ocr-test-user",
        { blob: new Blob(["pdf"]), name: "cancelled.pdf" },
        {
          key: "test-key",
          signal: controller.signal,
          fetch: async () => {
            calls += 1;
            return jsonResponse({});
          },
          sleep: async () => {
            sleeps += 1;
          },
        },
      ),
    ).rejects.toThrow("lease lost");
    expect(calls).toBe(0);
    expect(sleeps).toBe(0);
  });
});
