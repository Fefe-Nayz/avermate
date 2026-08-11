/**
 * Public runtime configuration.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time, so these have to be
 * referenced literally rather than through a computed key.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/**
 * Follow the address the page was actually opened on.
 *
 * A phone loading `http://192.168.1.32:3000` would otherwise call the API at
 * `localhost:5000` — meaning the phone itself. When the configured host is
 * loopback but the page is being served from somewhere else, the browser's own
 * hostname is the right answer. A non-loopback configuration (production) is
 * always left exactly as written.
 */
function followBrowserHost(configured: string): string {
  if (typeof window === "undefined") return configured

  try {
    const target = new URL(configured)
    if (!LOOPBACK.has(target.hostname)) return configured
    if (LOOPBACK.has(window.location.hostname)) return configured

    target.hostname = window.location.hostname
    target.protocol = window.location.protocol
    return target.origin
  } catch {
    return configured
  }
}

export const env = {
  apiUrl: followBrowserHost(
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000"
  ),
  appUrl: followBrowserHost(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
} as const
