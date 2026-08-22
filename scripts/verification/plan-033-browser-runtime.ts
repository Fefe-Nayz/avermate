import { existsSync } from "node:fs";
import {
  browserCaptureWorkerManifestV1Schema,
  type BrowserCaptureWorkerManifestV1,
} from "@avermate/agent-contracts";
import { BrowserRenderedIngestionAdapter } from "../../apps/server/src/ingestion/browser-result";
import type { IngestionUrlUse } from "../../apps/server/src/ingestion/url-policy";
import {
  captureBrowserPage,
  installedBrowserExecutablePath,
} from "../../apps/sandbox-worker/src/browser-capture";

const executablePath = resolveExecutablePath(Bun.argv.slice(2));
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "/dynamic" },
      });
    }
    if (url.pathname === "/static") {
      return html(`<!doctype html>
        <html lang="fr"><head><title>Static lesson</title></head>
        <body><article><h1>Static fixture</h1><p data-proof="static">A checked static article.</p>
        <img src="/diagram.svg" alt="Fixture diagram"></article></body></html>`);
    }
    if (url.pathname === "/dynamic") {
      return html(`<!doctype html>
        <html lang="en"><head><title>Loading fixture</title></head>
        <body><main id="lesson">Loading</main><script>
          setTimeout(() => {
            document.title = "Dynamic lesson";
            document.querySelector("#lesson").innerHTML =
              '<article><h1>Rendered fixture</h1><p data-proof="dynamic">Playwright executed this script and produced a deterministic lesson paragraph with enough meaningful words for trusted Markdown extraction and exact citation generation.</p></article>';
          }, 25);
        </script></body></html>`);
    }
    if (url.pathname === "/malicious") {
      return html(`<!doctype html><html><head><title>Request flood</title></head>
        <body><article>Untrusted fixture</article><script>
          for (let index = 0; index < 12; index += 1) {
            fetch('/beacon?index=' + index).catch(() => undefined);
          }
        </script></body></html>`);
    }
    if (url.pathname === "/diagram.svg") {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="blue"/></svg>',
        { headers: { "content-type": "image/svg+xml" } },
      );
    }
    if (url.pathname === "/beacon") return new Response("ok");
    return new Response("not found", { status: 404 });
  },
});

const baseUrl = `http://127.0.0.1:${fixture.port}`;
try {
  const staticResult = await captureBrowserPage(
    manifest(`${baseUrl}/static`, 20),
    { executablePath },
  );
  assert(
    staticResult.title === "Static lesson",
    "PLAN033_STATIC_TITLE_MISMATCH",
  );
  assert(
    staticResult.readableHtml.includes('data-proof="static"'),
    "PLAN033_STATIC_HTML_MISSING",
  );
  assert(
    staticResult.selectedImages.some(
      (image) =>
        image.url === `${baseUrl}/diagram.svg` &&
        image.alt === "Fixture diagram",
    ),
    "PLAN033_STATIC_IMAGE_MISSING",
  );

  const dynamicResult = await captureBrowserPage(
    manifest(`${baseUrl}/redirect`, 20),
    { executablePath },
  );
  assert(
    dynamicResult.finalUrl === `${baseUrl}/dynamic`,
    "PLAN033_REDIRECT_MISMATCH",
  );
  assert(
    dynamicResult.redirectChain.includes(`${baseUrl}/redirect`),
    "PLAN033_REDIRECT_CHAIN_MISSING",
  );
  assert(
    dynamicResult.title === "Dynamic lesson",
    "PLAN033_DYNAMIC_TITLE_MISMATCH",
  );
  assert(
    dynamicResult.readableHtml.includes('data-proof="dynamic"'),
    "PLAN033_DYNAMIC_HTML_MISSING",
  );

  const normalized = await new BrowserRenderedIngestionAdapter({
    urlPolicy: fixtureUrlPolicy(baseUrl),
    rendererBuildDigest: `sha256:${"d".repeat(64)}`,
    now: () => new Date("2026-08-22T12:00:01.000Z"),
  }).adopt({
    request: {
      sourceId: "source-fixture",
      canonicalUrl: `${baseUrl}/redirect`,
      strategy: "browser-render",
      policyRef: "plan-033-local-fixture",
      language: "en",
      limits: {
        maxNavigations: 4,
        maxRequests: 20,
        maxResponseBytes: 2 * 1024 * 1024,
        maxOutputBytes: 2 * 1024 * 1024,
        deadlineMs: 5_000,
        maxOrigins: 1,
      },
    },
    workerOutput: dynamicResult,
    startedAt: "2026-08-22T12:00:00.000Z",
  });
  assert(
    normalized.markdown.includes("Playwright executed this script"),
    "PLAN033_TRUSTED_MARKDOWN_MISSING",
  );
  assert(normalized.citations.length > 0, "PLAN033_CITATIONS_MISSING");
  assert(
    normalized.diagnostics.strategy === "browser-render" &&
      normalized.diagnostics.requestCount === dynamicResult.requestCount,
    "PLAN033_DIAGNOSTICS_MISMATCH",
  );

  let maliciousFailure = "";
  try {
    await captureBrowserPage(manifest(`${baseUrl}/malicious`, 3), {
      executablePath,
    });
  } catch (cause) {
    maliciousFailure = cause instanceof Error ? cause.message : String(cause);
  }
  assert(
    maliciousFailure.includes("BROWSER_REQUEST_LIMIT_EXCEEDED"),
    `PLAN033_MALICIOUS_FIXTURE_DID_NOT_FAIL_CLOSED:${maliciousFailure || "no-error"}`,
  );

  console.log(
    JSON.stringify({
      schemaVersion: 1,
      passed: true,
      fixtureOrigin: baseUrl,
      checks: [
        "static",
        "dynamic-redirect",
        "trusted-markdown-citations",
        "malicious-request-limit",
      ],
    }),
  );
} finally {
  fixture.stop(true);
}

function manifest(
  url: string,
  maxRequests: number,
): BrowserCaptureWorkerManifestV1 {
  return browserCaptureWorkerManifestV1Schema.parse({
    schemaVersion: 1,
    worker: "browser-capture.v1",
    request: {
      schemaVersion: 1,
      url,
      wait: { kind: "dom-settled", maxMs: 5_000 },
      maxNavigations: 4,
      maxRequests,
      maxResponseBytes: 2 * 1024 * 1024,
      capture: ["readable-html", "metadata", "selected-images"],
    },
    egressPolicyDigest: `sha256:${"e".repeat(64)}`,
  });
}

function fixtureUrlPolicy(expectedOrigin: string) {
  return Object.freeze({
    async validate(value: string | URL, use: IngestionUrlUse) {
      const parsed = new URL(value.toString());
      assert(
        parsed.origin === expectedOrigin,
        `PLAN033_FIXTURE_URL_ESCAPED:${parsed.origin}`,
      );
      return Object.freeze({
        url: parsed.toString(),
        origin: parsed.origin,
        use,
      });
    },
  });
}

function resolveExecutablePath(argv: readonly string[]): string {
  if (argv.length > 0) {
    if (argv.length !== 2 || argv[0] !== "--executable-path" || !argv[1]) {
      throw new Error("PLAN033_PLAYWRIGHT_ARGUMENTS_INVALID");
    }
    if (!existsSync(argv[1])) {
      throw new Error(`PLAN033_PLAYWRIGHT_BROWSER_MISSING:${argv[1]}`);
    }
    return argv[1];
  }
  const discovered = installedBrowserExecutablePath();
  if (!existsSync(discovered)) {
    throw new Error(
      "PLAN033_PLAYWRIGHT_BROWSER_MISSING:run `bunx playwright install chromium`",
    );
  }
  return discovered;
}

function html(value: string): Response {
  return new Response(value, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
