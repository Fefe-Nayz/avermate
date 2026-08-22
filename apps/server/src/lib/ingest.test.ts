import { describe, expect, test } from "bun:test";
import {
  assertPublicHttpUrl,
  extractMarkdown,
  fetchArticle,
  IngestError,
  isPublicIpAddress,
  MARKDOWN_MAX_BYTES,
  parseHttpSourceUrl,
  type DnsResolver,
  type IngestFetcher,
} from "./ingest";

const publicDns: DnsResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("link-ingestion SSRF guard", () => {
  test("recognizes globally routable IPv4 and IPv6 addresses", () => {
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  test("rejects loopback, private, link-local and documentation ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.1.2",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "198.51.100.7",
      "::1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "::ffff:192.168.1.10",
      "64:ff9b:1::a9fe:a9fe",
      "100::1",
      "2001:2::1",
      "3ffe::1",
      "3fff::1",
      "5f00::1",
    ]) {
      expect(isPublicIpAddress(address)).toBe(false);
    }
  });

  test("accepts only credential-free HTTP(S) URLs", async () => {
    expect(
      parseHttpSourceUrl("https://course.example/chapter").toString(),
    ).toBe("https://course.example/chapter");
    expect(() =>
      parseHttpSourceUrl("https://student:secret@course.example/chapter"),
    ).toThrow("cannot contain credentials");
    expect(
      (
        await assertPublicHttpUrl("https://course.example/chapter", {
          resolve: publicDns,
        })
      ).toString(),
    ).toBe("https://course.example/chapter");
    await expect(
      assertPublicHttpUrl("ftp://course.example/chapter", {
        resolve: publicDns,
      }),
    ).rejects.toThrow("Only public HTTP");
    await expect(
      assertPublicHttpUrl("https://student:secret@course.example/chapter", {
        resolve: publicDns,
      }),
    ).rejects.toThrow("cannot contain credentials");
  });

  test("rejects a hostname when any resolved address is private", async () => {
    await expect(
      assertPublicHttpUrl("https://rebinding.example", {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.2", family: 4 },
        ],
      }),
    ).rejects.toThrow("Private or local");
  });

  test("revalidates every redirect before issuing the next request", async () => {
    let calls = 0;
    const fetcher: IngestFetcher = async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/admin" },
      });
    };
    await expect(
      fetchArticle("https://course.example/chapter", {
        fetch: fetcher,
        resolve: publicDns,
      }),
    ).rejects.toThrow("Private or local");
    expect(calls).toBe(1);
  });
});

describe("bounded link fetching", () => {
  test("returns HTML with the final public URL and honest request headers", async () => {
    let seenInput: string | URL | Request | undefined;
    let seenInit: BunFetchRequestInit | undefined;
    const result = await fetchArticle("https://course.example/start", {
      resolve: publicDns,
      fetch: async (input, init) => {
        seenInput = input;
        seenInit = init;
        return new Response("<article><p>Course body</p></article>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });
    expect(result).toMatchObject({
      html: "<article><p>Course body</p></article>",
      finalUrl: "https://course.example/start",
      contentType: "text/html",
    });
    expect(seenInit?.redirect).toBe("manual");
    expect(new URL(String(seenInput)).hostname).toBe("93.184.216.34");
    expect(new Headers(seenInit?.headers).get("host")).toBe("course.example");
    expect(new Headers(seenInit?.headers).get("user-agent")).toBe(
      "avermate-ingest/1.0",
    );
    expect(seenInit?.tls?.serverName).toBe("course.example");
  });

  test("pins fetch to the validated address instead of resolving the hostname again", async () => {
    let resolutions = 0;
    let connectedHost = "";
    await fetchArticle("https://rebind.example/article", {
      resolve: async () => {
        resolutions += 1;
        return resolutions === 1
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }];
      },
      fetch: async (input) => {
        connectedHost = new URL(String(input)).hostname;
        return new Response("<article>Safe public response</article>", {
          headers: { "content-type": "text/html" },
        });
      },
    });
    expect(resolutions).toBe(1);
    expect(connectedHost).toBe("93.184.216.34");
  });

  test("includes DNS resolution in the global timeout budget", async () => {
    const startedAt = performance.now();
    await expect(
      fetchArticle("https://slow-dns.example/article", {
        resolve: () => new Promise(() => undefined),
        timeoutMs: 10,
        fetch: async () => {
          throw new Error("fetch must not run before DNS resolves");
        },
      }),
    ).rejects.toThrow("timed out");
    expect(performance.now() - startedAt).toBeLessThan(100);
  });

  test("preserves PDF bytes without interpreting them as HTML", async () => {
    const result = await fetchArticle("https://course.example/lesson.pdf", {
      resolve: publicDns,
      fetch: async () =>
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          headers: { "content-type": "application/pdf" },
        }),
    });
    expect(result.contentType).toBe("application/pdf");
    expect(result.html).toBeNull();
    expect([...result.body]).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  test("rejects an oversized declared body before reading it", async () => {
    await expect(
      fetchArticle("https://course.example/huge", {
        resolve: publicDns,
        fetch: async () =>
          new Response("small", {
            headers: {
              "content-type": "text/html",
              "content-length": String(5 * 1024 * 1024 + 1),
            },
          }),
      }),
    ).rejects.toThrow("larger than 5 MiB");
  });

  test("aborts a streamed body as soon as it crosses the byte cap", async () => {
    const chunk = new Uint8Array(3 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    await expect(
      fetchArticle("https://course.example/stream", {
        resolve: publicDns,
        fetch: async () =>
          new Response(body, { headers: { "content-type": "text/html" } }),
      }),
    ).rejects.toThrow("larger than 5 MiB");
  });

  test("classifies terminal client errors and retryable upstream errors", async () => {
    for (const [status, retryable] of [
      [404, false],
      [429, true],
      [503, true],
    ] as const) {
      try {
        await fetchArticle("https://course.example/status", {
          resolve: publicDns,
          fetch: async () => new Response(null, { status }),
        });
        throw new Error("Expected fetchArticle to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(IngestError);
        expect((error as IngestError).retryable).toBe(retryable);
      }
    }
  });
});

describe("readable Markdown extraction", () => {
  test("extracts the article, GFM table, absolute links and provenance", () => {
    const extracted = extractMarkdown(
      `<!doctype html><html><head><title>Sequences</title></head><body>
        <nav>Home · ads · unrelated links</nav>
        <article>
          <h1>Convergent sequences</h1>
          <p>A convergent sequence approaches one finite limit. This paragraph carries the central course definition.</p>
          <p><a href="/proof">Read the proof</a> before applying the result.</p>
          <table><thead><tr><th>n</th><th>u_n</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
        </article>
      </body></html>`,
      "https://course.example/chapter/limits",
      { now: new Date("2026-08-20T12:00:00.000Z") },
    );
    expect(extracted.title).toBe("Sequences");
    expect(extracted.markdown).toStartWith('---\ntitle: "Sequences"');
    expect(extracted.markdown).toContain(
      'source: "https://course.example/chapter/limits"',
    );
    expect(extracted.markdown).toContain('fetched: "2026-08-20T12:00:00.000Z"');
    expect(extracted.markdown).toContain("Convergent sequences");
    expect(extracted.markdown).toContain("https://course.example/proof");
    expect(extracted.markdown).toContain("| n |");
    expect(extracted.markdown).toContain("| --- | --- |");
    expect(extracted.markdown).not.toContain("unrelated links");
  });

  test("keeps the main content of a navigation-heavy page", () => {
    const paragraph =
      "The theorem applies to every bounded monotone sequence and the proof uses completeness of the real numbers. ";
    const extracted = extractMarkdown(
      `<html><head><title>Monotone convergence</title></head><body>
        <header>${"Menu ".repeat(100)}</header><main><article><h1>Theorem</h1><p>${paragraph.repeat(8)}</p></article></main>
        <footer>${"Legal ".repeat(100)}</footer></body></html>`,
      "https://course.example/theorem",
    );
    expect(extracted.markdown).toContain("bounded monotone sequence");
    expect(extracted.markdown).not.toContain("Legal Legal Legal");
  });

  test("fails honestly when no readable article can be extracted", () => {
    expect(() =>
      extractMarkdown(
        "<html><body><nav>Only navigation</nav></body></html>",
        "https://course.example/empty",
      ),
    ).toThrow("no extractable article");
  });

  test("bounds metadata and truncates oversized articles truthfully", () => {
    const extracted = extractMarkdown(
      `<html><head><title>${"T".repeat(20_000)}</title><meta name="author" content="${"A".repeat(20_000)}"></head><body><article><p>${"Readable course content. ".repeat(10)}</p></article></body></html>`,
      "https://course.example/bounded-metadata",
    );
    expect(Array.from(extracted.title)).toHaveLength(160);
    expect(Array.from(extracted.byline ?? "")).toHaveLength(240);

    const oversized = extractMarkdown(
      `<html><head><title>Oversized article</title></head><body><article><p>${"x ".repeat(2 * 1024 * 1024)}</p></article></body></html>`,
      "https://course.example/oversized-artifact",
    );
    expect(oversized.truncated).toBe(true);
    expect(oversized.markdown).toContain("truncated: true");
    expect(oversized.markdown).toContain("Content truncated");
    expect(
      new TextEncoder().encode(oversized.markdown).byteLength,
    ).toBeLessThan(MARKDOWN_MAX_BYTES);
  });

  test("removes tracking parameters, dangerous links and every remote image", () => {
    const extracted = extractMarkdown(
      `<html><head><title>Clean links</title></head><body><article>
        <p>This sufficiently long course paragraph describes the central result and contains enough words for extraction.</p>
        <a href="/proof?utm_source=newsletter&gclid=secret&part=2">Proof</a>
        <a href="javascript:alert(1)">Unsafe</a>
        <img src="/pixel.gif" width="1" height="1" alt="tracker">
        <picture><source srcset="http://127.0.0.1/private.png"><img src="https://tracker.example/diagram.png" alt="Convergence diagram"></picture>
        <svg><image href="http://192.168.1.1/admin.png" /></svg>
        <video poster="http://169.254.169.254/latest/meta-data"><track></video>
      </article></body></html>`,
      "https://course.example/chapter",
    );
    expect(extracted.markdown).toContain("https://course.example/proof?part=2");
    expect(extracted.markdown).not.toContain("utm_source");
    expect(extracted.markdown).not.toContain("javascript:");
    expect(extracted.markdown).not.toContain("pixel.gif");
    expect(extracted.markdown).toContain("Image: Convergence diagram");
    expect(extracted.markdown).not.toContain("tracker.example");
    expect(extracted.markdown).not.toContain("127.0.0.1");
    expect(extracted.markdown).not.toContain("192.168.1.1");
    expect(extracted.markdown).not.toContain("169.254.169.254");
    expect(extracted.markdown).not.toContain("![");
  });
});
