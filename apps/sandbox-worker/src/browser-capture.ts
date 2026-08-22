import {
  browserCaptureWorkerManifestV1Schema,
  browserRenderWorkerOutputSchema,
  type BrowserCaptureWorkerManifestV1,
  type BrowserRenderWorkerOutput,
} from "@avermate/agent-contracts";
import { chromium } from "playwright-core";
import {
  INPUT_MANIFEST_PATH,
  OUTPUT_ROOT,
  parseExactOptions,
  prepareWorkspace,
  readJsonManifest,
  writeJsonOutput,
} from "./runtime";

export const BROWSER_CAPTURE_VERSION = "browser-capture.v1";

export function installedBrowserExecutablePath(): string {
  return chromium.executablePath();
}

export function browserCaptureCli(
  argv: readonly string[],
): Readonly<{ input: string; output: string }> {
  const parsed = parseExactOptions(argv, ["input", "output"]);
  if (
    parsed.input !== INPUT_MANIFEST_PATH ||
    parsed.output !== `${OUTPUT_ROOT}/render.json`
  ) {
    throw new Error("BROWSER_CAPTURE_PATH_INVALID");
  }
  return Object.freeze({ input: parsed.input, output: parsed.output });
}

export async function captureBrowserPage(
  manifest: BrowserCaptureWorkerManifestV1,
  runtime: { readonly executablePath?: string } = {},
): Promise<BrowserRenderWorkerOutput> {
  const request = manifest.request;
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    executablePath: runtime.executablePath ?? "/usr/bin/chromium",
    args: [
      "--disable-background-networking",
      "--disable-breakpad",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-features=MediaRouter,OptimizationHints",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-pings",
      "--password-store=basic",
      "--use-mock-keychain",
    ],
  });
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      bypassCSP: false,
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      locale: "en-US",
      permissions: [],
      serviceWorkers: "block",
      viewport: { width: 1_280, height: 720 },
    });
    try {
      let requestCount = 0;
      let navigationCount = 0;
      let responseBytes = 0;
      let limitError: Error | null = null;
      await context.route("**/*", async (route) => {
        requestCount += 1;
        const url = route.request().url();
        if (requestCount > request.maxRequests || !/^https?:\/\//u.test(url)) {
          if (requestCount > request.maxRequests) {
            limitError = new Error("BROWSER_REQUEST_LIMIT_EXCEEDED");
          }
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      const page = await context.newPage();
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        navigationCount += 1;
        if (navigationCount > request.maxNavigations) {
          limitError = new Error("BROWSER_NAVIGATION_LIMIT_EXCEEDED");
        }
      });
      page.on("response", (response) => {
        const value = Number(response.headers()["content-length"] ?? 0);
        if (Number.isSafeInteger(value) && value > 0) responseBytes += value;
        if (responseBytes > request.maxResponseBytes) {
          limitError = new Error("BROWSER_RESPONSE_LIMIT_EXCEEDED");
        }
      });
      page.on("download", (download) => void download.cancel());

      const navigation = await page.goto(request.url, {
        waitUntil: "domcontentloaded",
        timeout: request.wait.maxMs,
      });
      await page
        .waitForLoadState("networkidle", { timeout: request.wait.maxMs })
        .catch(() => undefined);
      if (limitError) throw limitError;

      const finalUrl = page.url();
      if (!/^https?:\/\//u.test(finalUrl)) {
        throw new Error("BROWSER_FINAL_URL_INVALID");
      }
      const readableHtml = await page.content();
      const htmlBytes = new TextEncoder().encode(readableHtml).byteLength;
      responseBytes = Math.max(
        responseBytes,
        Number(navigation?.headers()["content-length"] ?? 0),
        htmlBytes,
      );
      if (
        responseBytes > request.maxResponseBytes ||
        htmlBytes > 5 * 1024 * 1024
      ) {
        throw new Error("BROWSER_RESPONSE_LIMIT_EXCEEDED");
      }
      const metadata = await page.evaluate(() => ({
        title: document.title.trim(),
        language:
          document.documentElement.lang.trim() ||
          document
            .querySelector('meta[http-equiv="content-language"]')
            ?.getAttribute("content")
            ?.trim() ||
          null,
        images: [...document.querySelectorAll("main img, article img")]
          .slice(0, 250)
          .map((image) => ({
            url:
              image instanceof HTMLImageElement
                ? image.currentSrc || image.src
                : "",
            alt: image.getAttribute("alt")?.slice(0, 500) ?? "",
          }))
          .filter((image) => /^https?:\/\//u.test(image.url)),
      }));
      const title = metadata.title || new URL(finalUrl).hostname;
      const redirectChain: string[] = [];
      let redirected = navigation?.request().redirectedFrom() ?? null;
      while (redirected && redirectChain.length < 16) {
        redirectChain.unshift(redirected.url());
        redirected = redirected.redirectedFrom();
      }
      return browserRenderWorkerOutputSchema.parse({
        schemaVersion: 1,
        finalUrl,
        redirectChain,
        title: title.slice(0, 160),
        language: metadata.language?.slice(0, 35) ?? null,
        readableHtml,
        requestCount,
        responseBytes,
        selectedImages: request.capture.includes("selected-images")
          ? metadata.images
          : [],
      });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

export async function main(argv = Bun.argv.slice(2)): Promise<void> {
  const cli = browserCaptureCli(argv);
  await prepareWorkspace();
  const manifest = await readJsonManifest(
    cli.input,
    browserCaptureWorkerManifestV1Schema,
  );
  const result = await captureBrowserPage(manifest);
  await writeJsonOutput(cli.output, result, 6 * 1024 * 1024);
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "BROWSER_CAPTURE_FAILED",
    );
    process.exitCode = 1;
  });
}
