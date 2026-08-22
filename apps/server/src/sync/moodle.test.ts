import { describe, expect, test } from "bun:test";
import { NonRetryableSyncError } from "./errors";
import type { OpenConnection, ProviderFile } from "./provider";
import {
  buildMoodleFolderPath,
  createMoodleProvider,
  parseMoodleToken,
  sanitizeMoodlePathComponent,
} from "./moodle";

const createTestMoodleProvider = (
  dependencies: Parameters<typeof createMoodleProvider>[0],
) =>
  createMoodleProvider({
    ...dependencies,
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
  });

const token = "01234567".repeat(4);
const siteId = "abcdef0123456789abcdef0123456789";
const privateToken =
  "PrivateTokenFixtureThatMustNeverBeForwardedOrPersisted123456789A";

function mobileEnvelope(...segments: string[]) {
  return Buffer.from(segments.join(":::"), "utf8").toString("base64");
}

const encoded = mobileEnvelope(siteId, token);
const encodedWithPrivateToken = mobileEnvelope(siteId, token, privateToken);

function connection(overrides: Partial<OpenConnection> = {}): OpenConnection {
  return {
    id: "sconn-test",
    userId: "user-test",
    yearId: "year-test",
    baseUrl: "https://moodle.example.edu",
    credentials: JSON.stringify({ version: 1, token, userId: "42" }),
    caCertPem: null,
    ...overrides,
  };
}

describe("Moodle token parsing", () => {
  test("accepts official two- and three-segment mobile envelopes", () => {
    expect(parseMoodleToken(`moodlemobile://token=${encoded}`)).toBe(token);
    expect(parseMoodleToken(encoded)).toBe(token);
    expect(
      parseMoodleToken(`moodlemobile://token=${encodedWithPrivateToken}`),
    ).toBe(token);
  });

  test("accepts a percent-encoded official envelope and a bare token", () => {
    expect(
      parseMoodleToken(
        `moodlemobile://token=${encodeURIComponent(encodedWithPrivateToken)}`,
      ),
    ).toBe(token);
    expect(parseMoodleToken(token)).toBe(token);
  });

  test("rejects empty, malformed base64, and invalid UTF-8", () => {
    expect(() => parseMoodleToken("")).toThrow("Paste the Moodle");
    expect(() => parseMoodleToken("not-a-moodle-token")).toThrow(
      "Moodle token is invalid",
    );
    expect(() => parseMoodleToken("moodlemobile://token=garbage")).toThrow(
      "redirect is invalid",
    );
    expect(() => parseMoodleToken("moodlemobile://token=YR==")).toThrow(
      "redirect is invalid",
    );
    expect(() => parseMoodleToken("moodlemobile://token=/w==")).toThrow(
      "redirect is invalid",
    );
  });

  test("rejects envelopes with missing, empty, or extra segments", () => {
    for (const envelope of [
      mobileEnvelope(siteId),
      mobileEnvelope("", token),
      mobileEnvelope(siteId, ""),
      mobileEnvelope(siteId, token, ""),
      mobileEnvelope(siteId, token, privateToken, "unexpected"),
    ]) {
      expect(() =>
        parseMoodleToken(`moodlemobile://token=${envelope}`),
      ).toThrow("redirect is invalid");
    }
  });

  test("rejects an invalid web-service token even when the private token looks valid", () => {
    const tokenLookingPrivateValue = "fedcba98".repeat(4);
    const envelope = mobileEnvelope(
      siteId,
      "not-a-web-service-token",
      tokenLookingPrivateValue,
    );

    expect(() => parseMoodleToken(`moodlemobile://token=${envelope}`)).toThrow(
      "redirect is invalid",
    );
  });

  test("returns only the web-service token from a private-token envelope", async () => {
    let requestBody = "";
    const provider = createTestMoodleProvider({
      fetch: async (_url, init) => {
        requestBody = String(init?.body ?? "");
        return Response.json({ userid: 42, fullname: "Ada" });
      },
    });

    const parsed = await provider.parseCredentialInput(
      "https://moodle.example.edu",
      `moodlemobile://token=${encodedWithPrivateToken}`,
    );

    expect(new URLSearchParams(requestBody).get("wstoken")).toBe(token);
    expect(requestBody).not.toContain(privateToken);
    expect(parsed.credentials).not.toContain(privateToken);
    expect(JSON.parse(parsed.credentials)).toMatchObject({ token });
  });
});

describe("Moodle content mapping", () => {
  test("mirrors the fixture hierarchy and sanitizes every component", () => {
    expect(
      buildMoodleFolderPath({
        section: " Chapitre 1: limites. ",
        module: " Dossier / TD ",
        moduleType: "folder",
        filePath: "/Corrigés/ Semaine   1 /fiche.pdf",
        fileName: "fiche.pdf",
      }),
    ).toEqual(["Chapitre 1_ limites", "Dossier _ TD", "Corrigés", "Semaine 1"]);
    expect(
      buildMoodleFolderPath({
        section: "Généralités",
        module: "Resource",
        moduleType: "resource",
        filePath: "/",
        fileName: "cours.pdf",
      }),
    ).toEqual([]);
    expect(sanitizeMoodlePathComponent("<>.  ")).toBe("__");
    expect(sanitizeMoodlePathComponent("a".repeat(120))).toHaveLength(100);
  });

  test("unwraps file contents, filters extensions, and de-duplicates URLs", async () => {
    const provider = createTestMoodleProvider({
      fetch: async (_url, init) => {
        const body = init?.body as URLSearchParams;
        const functionName = body.get("wsfunction");
        if (functionName === "core_enrol_get_users_courses") {
          return Response.json([{ id: 7, fullname: "Mathematics" }]);
        }
        return Response.json([
          {
            name: "Sequences",
            modules: [
              {
                name: "Worksheets",
                modname: "folder",
                contents: [
                  {
                    type: "file",
                    filename: "sheet.webp",
                    fileurl:
                      "https://moodle.example.edu/pluginfile.php/1/sheet.webp",
                    filepath: "/Week 1/sheet.webp",
                    timemodified: 1_700_000_000,
                    filesize: 123,
                    mimetype: "image/webp",
                  },
                  {
                    type: "file",
                    filename: "sheet.webp",
                    fileurl:
                      "https://moodle.example.edu/pluginfile.php/1/sheet.webp",
                  },
                  {
                    type: "file",
                    filename: "notes.txt",
                    fileurl:
                      "https://moodle.example.edu/pluginfile.php/1/notes.txt",
                  },
                ],
              },
            ],
          },
        ]);
      },
    });
    const open = connection();
    expect(await provider.listCourses(open)).toEqual([
      { externalId: "7", name: "Mathematics" },
    ]);
    const files = await provider.listFiles(open, "7");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      fileName: "sheet.webp",
      folderPath: ["Sequences", "Worksheets", "Week 1"],
      byteSize: 123,
      mimeType: "image/webp",
      courseRef: { externalId: "7", name: "Mathematics" },
    });
    expect(files[0]?.modifiedAt?.toISOString()).toBe(
      "2023-11-14T22:13:20.000Z",
    );
  });
});

describe("Moodle transport", () => {
  test("turns a 200 Moodle error envelope into a secret-free error", async () => {
    const provider = createTestMoodleProvider({
      fetch: async () =>
        Response.json({
          exception: "moodle_exception",
          errorcode: "invalidtoken",
          message: `Token ${token} is invalid at https://private.example`,
        }),
    });
    const error = await provider
      .parseCredentialInput("https://moodle.example.edu", token)
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(NonRetryableSyncError);
    expect(error).toHaveProperty(
      "message",
      "Moodle rejected the request (invalidtoken)",
    );
    expect(String(error)).not.toContain(token);
  });

  test("retries only transient responses with exponential backoff", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const provider = createTestMoodleProvider({
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) return new Response("busy", { status: 500 });
        if (attempts === 2) return new Response("slow", { status: 429 });
        return Response.json([{ id: 9, fullname: "Physics" }]);
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    await expect(provider.listCourses(connection())).resolves.toEqual([
      { externalId: "9", name: "Physics" },
    ]);
    expect(attempts).toBe(3);
    expect(delays).toEqual([1_000, 2_000]);
  });

  test("aborts a pending fetch without retrying or entering backoff", async () => {
    const controller = new AbortController();
    let attempts = 0;
    let sleeps = 0;
    let observedSignal: AbortSignal | null | undefined;
    let announceFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      announceFetch = resolve;
    });
    const provider = createTestMoodleProvider({
      fetch: async (_url, init) => {
        attempts += 1;
        observedSignal = init?.signal;
        announceFetch();
        return new Promise<Response>(() => undefined);
      },
      sleep: async () => {
        sleeps += 1;
      },
    });
    const pending = provider.listCourses(connection(), {
      signal: controller.signal,
    });

    await fetchStarted;
    controller.abort(new Error("lease lost during fetch"));

    await expect(pending).rejects.toThrow("lease lost during fetch");
    expect(observedSignal).not.toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBe(controller.signal.reason);
    expect(attempts).toBe(1);
    expect(sleeps).toBe(0);
  });

  test("cancels a response body that arrives just after abort", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const provider = createTestMoodleProvider({
      fetch: async () => {
        controller.abort(new Error("lease lost as fetch completed"));
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
        );
      },
    });

    await expect(
      provider.listCourses(connection(), { signal: controller.signal }),
    ).rejects.toThrow("lease lost as fetch completed");
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  test("aborts an in-flight retry backoff without another fetch", async () => {
    const controller = new AbortController();
    let attempts = 0;
    let sleepSignal: AbortSignal | undefined;
    let backoffStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      backoffStarted = resolve;
    });
    const provider = createTestMoodleProvider({
      fetch: async () => {
        attempts += 1;
        return new Response("busy", { status: 503 });
      },
      sleep: async (_milliseconds, signal) => {
        sleepSignal = signal;
        backoffStarted();
        return new Promise<void>(() => undefined);
      },
    });
    const pending = provider.listCourses(connection(), {
      signal: controller.signal,
    });

    await started;
    controller.abort(new Error("lease lost during backoff"));

    await expect(pending).rejects.toThrow("lease lost during backoff");
    expect(sleepSignal).toBe(controller.signal);
    expect(attempts).toBe(1);
  });

  test("uses a custom CA without disabling verification", async () => {
    let observedInit: RequestInit & { tls?: { ca: string } } = {};
    const provider = createTestMoodleProvider({
      fetch: async (_url, init) => {
        observedInit = init ?? {};
        return Response.json({ userid: 42, fullname: "Ada" });
      },
    });
    await expect(
      provider.parseCredentialInput("https://moodle.example.edu", token, {
        caCertPem:
          "-----BEGIN CERTIFICATE-----\nprivate-ca\n-----END CERTIFICATE-----",
      }),
    ).resolves.toMatchObject({ accountLabel: "Ada" });
    expect(observedInit.tls?.ca).toContain("private-ca");
    expect(JSON.stringify(observedInit)).not.toContain("rejectUnauthorized");
  });

  test("never forwards a download token to another origin", async () => {
    let calls = 0;
    const provider = createTestMoodleProvider({
      fetch: async () => {
        calls += 1;
        return new Response("unused");
      },
    });
    const file: ProviderFile = {
      externalId: "https://evil.example/file.pdf",
      fileName: "file.pdf",
      folderPath: [],
      mimeType: "application/pdf",
      byteSize: 4,
      modifiedAt: null,
      courseRef: { externalId: "1", name: "Course" },
    };
    await expect(provider.download(connection(), file)).rejects.toThrow(
      "another origin",
    );
    expect(calls).toBe(0);
  });

  test("returns the download body as a stream without buffering the response", async () => {
    let arrayBufferCalls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("part-one"));
          controller.enqueue(new TextEncoder().encode("-part-two"));
          controller.close();
        },
      }),
      { headers: { "content-length": "17" } },
    );
    Object.defineProperty(response, "arrayBuffer", {
      value: async () => {
        arrayBufferCalls += 1;
        throw new Error("the provider must not buffer downloads");
      },
    });
    const provider = createTestMoodleProvider({ fetch: async () => response });
    const file: ProviderFile = {
      externalId: "https://moodle.example.edu/pluginfile.php/file.pdf",
      fileName: "file.pdf",
      folderPath: [],
      mimeType: "application/pdf",
      byteSize: 17,
      modifiedAt: null,
      courseRef: { externalId: "1", name: "Course" },
    };

    const download = await provider.download(connection(), file);

    expect(arrayBufferCalls).toBe(0);
    expect(download.contentLength).toBe(17);
    expect(await new Response(download.body).text()).toBe("part-one-part-two");
  });
});
