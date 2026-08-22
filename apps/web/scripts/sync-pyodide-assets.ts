import { createHash } from "node:crypto"
import { mkdir, rename, unlink } from "node:fs/promises"
import path from "node:path"

const PYODIDE_VERSION = "314.0.5"
const PYODIDE_PACKAGE_DIR = path.resolve(
  import.meta.dir,
  "../../../node_modules/pyodide"
)
const OUTPUT_DIR = path.resolve(
  import.meta.dir,
  `../public/vendor/pyodide/${PYODIDE_VERSION}`
)
const DISTRIBUTION_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`
const WORKER_ENTRYPOINT = path.resolve(
  import.meta.dir,
  "../src/components/documents/markdown-fences/pyodide-run.worker.ts"
)
const WORKER_ASSET_NAME = "pyodide-run.worker.mjs"

const CORE_ASSETS = {
  "pyodide.mjs":
    "1fec5d63238eff5d099c209c659b88f480c1d854856301596d64e8e6839a3f50",
  "pyodide.asm.mjs":
    "f86edbb66b925ae933ff32ecdcb738ebde2ba926b6be3e485401587de7be89ea",
  "pyodide.asm.wasm":
    "85f66436c802db3dd0caf437134f98af5c69d199c6ffba116ee2bac8be8acf09",
  "python_stdlib.zip":
    "3e7b7affd80aaf35fcff786613eebd0ce885a964dbda56714ccecb7573f57a70",
  "pyodide-lock.json":
    "3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4",
} as const

// This is the exact recursive closure required by numpy + matplotlib in the
// Pyodide 314.0.5 lockfile. Keeping filenames and digests here makes a package
// release or CDN mutation fail closed instead of silently changing the runtime.
const PACKAGE_ASSETS = {
  "contourpy-1.3.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl":
    "d1270323c10ab24141e40a854dcd407625cb4341c9b83301f1111e7db037b57f",
  "cycler-0.12.1-py3-none-any.whl":
    "70682ba25f1503dde0d9d3d98a889480b42b903a5d863b0a7118bc4173aa02c8",
  "fonttools-4.62.1-py3-none-any.whl":
    "94f246abe8cd46f0695dc9256cde3966bc637b80148fe72a1e7b0e6623d62144",
  "kiwisolver-1.5.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl":
    "f8b19816e2cf8e36fc2adfabb60ad24dad422dfaffa6087173d829d9924fcc07",
  "matplotlib-3.10.8-cp314-cp314-pyemscripten_2026_0_wasm32.whl":
    "2d127e0fbdfdd139b90c2eb487950913771846991330460fce3b183ba79d8ddb",
  "numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl":
    "32959d4137cec8143d75016d029281df3d2e80a232896ed903c2b59e1c44ee9f",
  "packaging-26.1-py3-none-any.whl":
    "f58ad9d3cde3f3051e3bc82df1db19ff0aa940439dfd5f5d470da61c5ea033bf",
  "pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl":
    "18b0c6a423b9b9ffe0b6679f8ebe9dc619d557c5647bfda449583d276d79d422",
  "pyparsing-3.3.2-py3-none-any.whl":
    "8c3e4bb64e23a66a4c9effc4a5a09a2aafc1db7d70b8451ba3ba5b7fe6d18dd2",
  "python_dateutil-2.9.0.post0-py2.py3-none-any.whl":
    "9c1d350424840e15c16450ac0b0d6007e908d266746b61d64760dd77263085af",
  "pytz-2026.1.post1-py2.py3-none-any.whl":
    "c8eaf8e55b79c2a7e765bdce5c1b84e05a43a585a16a00efadd96a0b7913914e",
  "six-1.17.0-py2.py3-none-any.whl":
    "29edb1e328c61cad6ac21a2ff92c7d274a2b662eb7c12b2d147f04917b765ad6",
} as const

async function sha256(filePath: string) {
  const digest = createHash("sha256")
  const stream = Bun.file(filePath).stream()
  for await (const chunk of stream) digest.update(chunk)
  return digest.digest("hex")
}

async function hasExpectedDigest(filePath: string, expected: string) {
  if (!(await Bun.file(filePath).exists())) return false
  return (await sha256(filePath)) === expected
}

async function replaceAtomically(destination: string, bytes: ArrayBuffer) {
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`
  try {
    await Bun.write(temporary, bytes)
    await unlink(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
    await rename(temporary, destination)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function copyVerifiedCoreAsset(name: string, expected: string) {
  const source = path.join(PYODIDE_PACKAGE_DIR, name)
  const destination = path.join(OUTPUT_DIR, name)
  if (await hasExpectedDigest(destination, expected)) return "cached" as const
  if (!(await hasExpectedDigest(source, expected))) {
    throw new Error(
      `Installed pyodide@${PYODIDE_VERSION} has an unexpected ${name} digest`
    )
  }
  await replaceAtomically(destination, await Bun.file(source).arrayBuffer())
  if (!(await hasExpectedDigest(destination, expected))) {
    throw new Error(`Copied Pyodide core asset ${name} failed verification`)
  }
  return "copied" as const
}

async function downloadVerifiedPackage(name: string, expected: string) {
  const destination = path.join(OUTPUT_DIR, name)
  if (await hasExpectedDigest(destination, expected)) return "cached" as const

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  let response: Response
  try {
    response = await fetch(new URL(name, DISTRIBUTION_URL), {
      redirect: "error",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    throw new Error(
      `Pyodide asset ${name} download failed (${response.status})`
    )
  }
  const bytes = await response.arrayBuffer()
  const digest = createHash("sha256")
    .update(new Uint8Array(bytes))
    .digest("hex")
  if (digest !== expected) {
    throw new Error(
      `Pyodide asset ${name} failed SHA-256 verification (expected ${expected}, received ${digest})`
    )
  }
  await replaceAtomically(destination, bytes)
  if (!(await hasExpectedDigest(destination, expected))) {
    throw new Error(`Stored Pyodide asset ${name} failed verification`)
  }
  return "downloaded" as const
}

async function buildWorkerAsset() {
  const build = await Bun.build({
    entrypoints: [WORKER_ENTRYPOINT],
    format: "esm",
    minify: true,
    sourcemap: "none",
    target: "browser",
  })
  if (!build.success || build.outputs.length !== 1) {
    const details = build.logs.map((log) => log.message).join("\n")
    throw new Error(`The Pyodide worker could not be built: ${details}`)
  }
  const bytes = await build.outputs[0]!.arrayBuffer()
  const expected = createHash("sha256")
    .update(new Uint8Array(bytes))
    .digest("hex")
  const destination = path.join(OUTPUT_DIR, WORKER_ASSET_NAME)
  if (await hasExpectedDigest(destination, expected)) {
    return { digest: expected, status: "cached" as const }
  }
  await replaceAtomically(destination, bytes)
  if (!(await hasExpectedDigest(destination, expected))) {
    throw new Error("The compiled Pyodide worker failed verification")
  }
  return { digest: expected, status: "compiled" as const }
}

const packageJson = await Bun.file(
  path.join(PYODIDE_PACKAGE_DIR, "package.json")
).json()
if (packageJson.version !== PYODIDE_VERSION) {
  throw new Error(
    `Expected pyodide@${PYODIDE_VERSION}, found ${String(packageJson.version)}`
  )
}

await mkdir(OUTPUT_DIR, { recursive: true })
const results: string[] = []
for (const [name, digest] of Object.entries(CORE_ASSETS)) {
  results.push(`${name}: ${await copyVerifiedCoreAsset(name, digest)}`)
}
for (const [name, digest] of Object.entries(PACKAGE_ASSETS)) {
  results.push(`${name}: ${await downloadVerifiedPackage(name, digest)}`)
}
const worker = await buildWorkerAsset()
results.push(`${WORKER_ASSET_NAME}: ${worker.status}`)

await Bun.write(
  path.join(OUTPUT_DIR, "manifest.json"),
  `${JSON.stringify(
    {
      version: PYODIDE_VERSION,
      source: DISTRIBUTION_URL,
      assets: {
        ...CORE_ASSETS,
        ...PACKAGE_ASSETS,
        [WORKER_ASSET_NAME]: worker.digest,
      },
    },
    null,
    2
  )}\n`
)

console.log(`Pyodide ${PYODIDE_VERSION} assets ready in ${OUTPUT_DIR}`)
for (const result of results) console.log(`  ${result}`)
