import "server-only"

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, "")
}

export const serverEnv = {
  // Production can use the private service address while the browser and the
  // native app continue to use the public API origin.
  apiUrl: withoutTrailingSlash(
    process.env.API_INTERNAL_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:5000"
  ),
} as const
