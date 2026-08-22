import { describe, expect, test } from "bun:test";
import { createAssistantDictationRoutes } from "./assistant-dictation";

function audioForm() {
  const form = new FormData();
  form.set(
    "audio",
    new File([new Uint8Array([1, 2, 3])], "dictation.webm", {
      type: "audio/webm",
    }),
  );
  return form;
}

describe("assistant dictation transport limits", () => {
  test("rejects a chunked body without Content-Length before multipart parsing", async () => {
    let providerCalls = 0;
    const routes = createAssistantDictationRoutes({
      authenticate: async () => ({ id: "chunked-owner" }),
      maximumMultipartBytes: 64,
      resolveProvider: async () => {
        providerCalls += 1;
        return {
          id: "node-local",
          model: "test@immutable",
          transcribeSegment: async () => ({
            text: "should not run",
            segments: [],
          }),
        };
      },
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128));
        controller.close();
      },
    });
    const request = new Request("http://localhost/assistant/dictation", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=bounded" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await routes.request(request);

    expect(response.status).toBe(413);
    expect(providerCalls).toBe(0);
  });

  test("holds the per-owner admission slot until transcription completes", async () => {
    let release!: () => void;
    let started!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const providerReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    const routes = createAssistantDictationRoutes({
      authenticate: async () => ({ id: "concurrent-owner" }),
      resolveProvider: async () => ({
        id: "node-local",
        model: "test@immutable",
        transcribeSegment: async () => {
          started();
          await providerReleased;
          return { text: "bonjour", segments: [] };
        },
      }),
    });

    const first = routes.request("http://localhost/assistant/dictation", {
      method: "POST",
      body: audioForm(),
    });
    await providerStarted;
    const second = await routes.request(
      "http://localhost/assistant/dictation",
      { method: "POST", body: audioForm() },
    );
    expect(second.status).toBe(429);

    release();
    const completed = await first;
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      text: "bonjour",
      provider: "node-local",
      model: "test@immutable",
    });
  });
});
