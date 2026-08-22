"use client"

import dynamic from "next/dynamic"
import { FenceStatus } from "./fence-frame"

const loading = () => <FenceStatus>Loading embedded content…</FenceStatus>

export const LazyMermaidFence = dynamic(
  () => import("./mermaid-fence").then((module) => module.MermaidFence),
  { ssr: false, loading }
)

export const LazyVegaLiteFence = dynamic(
  () => import("./vega-lite-fence").then((module) => module.VegaLiteFence),
  { ssr: false, loading }
)

export const LazyDotFence = dynamic(
  () => import("./dot-fence").then((module) => module.DotFence),
  { ssr: false, loading }
)

export const LazyShikiFence = dynamic(
  () => import("./shiki-fence").then((module) => module.ShikiFence),
  { ssr: false, loading }
)

export const LazyDatacardFence = dynamic(
  () => import("./datacard-fence").then((module) => module.DatacardFence),
  { ssr: false, loading }
)

export const LazyPythonRunFence = dynamic(
  () => import("./python-run-fence").then((module) => module.PythonRunFence),
  { ssr: false, loading }
)
