import path from "node:path"
import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

const nextConfig: NextConfig = {
  // Next blocks cross-origin dev requests unless the origin is listed. Without
  // this, opening the app on a phone at the machine's LAN address fails to
  // load the dev assets. Development only — it has no effect on a build.
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.2*.*.*",
    "172.30.*.*",
    "172.31.*.*",
    "*.local",
  ],
  output: "standalone",
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  poweredByHeader: false,
  // The domain engine ships as TypeScript source and is compiled in place: it
  // lives in this repo, so there is no build step to forget and no stale copy.
  transpilePackages: ["@avermate/core"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.ufs.sh" },
      { protocol: "https", hostname: "utfs.io" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "graph.microsoft.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ]
  },
}

// No locale routing: the locale comes from a cookie (see src/i18n/request.ts).
// `useExtracted` pulls the inline English strings into messages/en.json and
// keeps fr.json in step, so a screen can never ship with a missing key.
// The experimental extractor writes message files while modules compile.
// Running it during incremental development can leave a partial catalogue
// when several Turbopack compilations overlap, so extraction is build-only.
const withNextIntl =
  process.env.NODE_ENV === "development"
    ? createNextIntlPlugin()
    : createNextIntlPlugin({
        experimental: {
          extract: true,
          messages: {
            path: "./messages",
            format: "json",
            locales: ["en", "fr"],
            sourceLocale: "en",
          },
          srcPath: "./src",
        },
      })

export default withNextIntl(nextConfig)
