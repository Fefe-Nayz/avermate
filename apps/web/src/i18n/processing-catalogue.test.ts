import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import en from "../../messages/en.json"
import fr from "../../messages/fr.json"

type ExtractionResult = {
  code: string
  messages: Array<{ id: string; message: string }>
}

type MessageExtractorConstructor = new (options: {
  projectRoot: string
  isDevelopment: boolean
}) => {
  extract(filePath: string, source: string): Promise<ExtractionResult>
}

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dir, "../..")
const processingDirectory = join(
  projectRoot,
  "src/app/(app)/settings/processing"
)

// Resolve the installed package instead of assuming a hoisted node_modules.
// The public extractor also persists catalogues; its internal compiler is the
// same SWC transform used by the build, without those write side effects.
const extractorPath = join(
  dirname(require.resolve("next-intl/extractor")),
  "extractor/extractor/MessageExtractor.js"
)
const { default: MessageExtractor } = (await import(
  pathToFileURL(extractorPath).href
)) as { default: MessageExtractorConstructor }
const extractor = new MessageExtractor({
  projectRoot,
  isDevelopment: false,
})
const sourceCatalogue = en as Record<string, string>
const frenchCatalogue = fr as Record<string, string>
const sourceFiles = [
  ...new Bun.Glob("**/*.{ts,tsx}").scanSync({
    cwd: processingDirectory,
    onlyFiles: true,
  }),
]
  .filter(
    (file) => !/(?:^|[/\\])__tests__[/\\]|\.(?:test|spec|d)\.tsx?$/.test(file)
  )
  .sort()

describe("AI & Processing production message extraction", () => {
  test("covers the processing screen sources", () => {
    expect(sourceFiles).toContain("processing-settings-client.tsx")
    expect(sourceFiles).toContain("processing-labels.ts")
    expect(sourceFiles).toContain("connection-wizard.tsx")
    expect(sourceFiles).toContain("connection-editor.tsx")
    expect(sourceFiles).toContain("policy-editor.tsx")
  })

  test("rewrites literal messages into catalogue IDs", async () => {
    const result = await extractor.extract(
      join(processingDirectory, "extraction-smoke.tsx"),
      `import {useExtracted} from "next-intl";
       export function useLabel() {
         const t = useExtracted();
         return t("AI & Processing");
       }`
    )

    expect(result.messages).toHaveLength(1)
    const message = result.messages[0]!
    expect(message.message).toBe("AI & Processing")
    expect(message.id).not.toBe(message.message)
    expect(result.code).toContain(`t("${message.id}")`)
  })

  test("compiled shared labels translate known messages and preserve provider metadata", async () => {
    const filePath = join(processingDirectory, "processing-labels.ts")
    const result = await extractor.extract(
      filePath,
      await readFile(filePath, "utf8")
    )
    expect(result.messages.length).toBeGreaterThan(0)
    const messages = Object.fromEntries(
      result.messages.map(({ id }) => [id, `translated:${id}`])
    )

    // Load only this compiled helper with an isolated translation dependency.
    // A global next-intl mock would alter other tests in the same Bun process.
    const translationModuleUrl = `data:text/javascript;base64,${Buffer.from(
      `
      const messages = ${JSON.stringify(messages)};
      export const calls = [];
      export function useTranslations() {
        return (id) => {
          calls.push(id);
          if (!messages[id]) throw new Error("Unexpected translation key: " + id);
          return messages[id];
        };
      }
    `
    ).toString("base64")}`
    const translationModule = (await import(translationModuleUrl)) as {
      calls: string[]
    }
    const javascript = new Bun.Transpiler({
      loader: "ts",
      target: "bun",
    }).transformSync(result.code)
    const isolatedCode = javascript.replace(
      /from (["'])next-intl\1/g,
      `from ${JSON.stringify(translationModuleUrl)}`
    )
    expect(isolatedCode).not.toBe(javascript)
    const { useProcessingLabels } = (await import(
      `data:text/javascript;base64,${Buffer.from(isolatedCode).toString("base64")}`
    )) as { useProcessingLabels(): (source: string) => string }
    const label = useProcessingLabels()

    for (const { id, message } of result.messages) {
      const callCount = translationModule.calls.length
      expect(label(message), message).toBe(messages[id])
      expect(translationModule.calls.slice(callCount), message).toEqual([id])
    }

    const callCount = translationModule.calls.length
    for (const metadata of [
      "Custom provider field {runtime_value}",
      "language.generate",
      "organization/model:provider",
    ]) {
      expect(label(metadata)).toBe(metadata)
    }
    expect(translationModule.calls).toHaveLength(callCount)
  })

  test.each(sourceFiles)(
    "%s compiles and has complete English/French messages",
    async (file) => {
      const filePath = join(processingDirectory, file)
      const result = await extractor.extract(
        filePath,
        await readFile(filePath, "utf8")
      )

      for (const { id, message } of result.messages) {
        const context = `${file}: ${id}: ${message}`
        expect(sourceCatalogue[id], context).toBe(message)
        expect(frenchCatalogue[id]?.trim(), context).toBeTruthy()
      }
    }
  )
})
