"use client"

// Compatibility entrypoint for existing client components. Server Components
// import from `@/lib/orpc/server` so browser-only transport cannot leak in.
export * from "./orpc/client"
