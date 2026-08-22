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
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "graph.microsoft.com" },
    ],
  },
  async redirects() {
    return [
      {
        source: "/dashboard/grades/:gradeId/:periodId",
        destination: "/grades/:gradeId",
        permanent: true,
      },
      {
        source: "/dashboard/subjects/:subjectId/:periodId",
        destination: "/subjects/:subjectId",
        permanent: true,
      },
      {
        source: "/dashboard/grades",
        destination: "/grades",
        permanent: true,
      },
      {
        source: "/dashboard/settings/grades",
        destination: "/settings/year",
        permanent: true,
      },
      {
        source: "/dashboard/settings",
        destination: "/settings/year",
        permanent: true,
      },
      {
        source: "/dashboard/admin",
        destination: "/admin",
        permanent: true,
      },
      {
        source: "/profile/account",
        destination: "/settings/account",
        permanent: true,
      },
      {
        source: "/profile/about",
        destination: "/settings/about",
        permanent: true,
      },
      {
        source: "/profile/settings/general",
        destination: "/settings/appearance",
        permanent: true,
      },
      {
        source: "/profile/settings",
        destination: "/settings/appearance",
        permanent: true,
      },
      {
        source: "/profile",
        destination: "/settings",
        permanent: true,
      },
      {
        source: "/onboarding/new",
        destination: "/onboarding/year/new",
        permanent: true,
      },
      {
        source: "/auth/verify-email",
        destination: "/auth/verify",
        permanent: true,
      },
      {
        source: "/legal/privacy-policy",
        destination: "/legal/privacy",
        permanent: true,
      },
      {
        source: "/legal/terms-of-service",
        destination: "/legal/terms",
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/vendor/pyodide/:asset*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
        ],
      },
    ]
  },
}

/*
 * No locale routing: the locale comes from a cookie (see src/i18n/request.ts).
 * `useExtracted` pulls the inline English strings into messages/en.json and
 * keeps fr.json in step, so a screen can never ship with a missing key.
 *
 * Extraction runs in development too, and it has to. It is not only a build
 * step that fills the catalogues: the same option installs the loader that
 * rewrites each `t("Some text")` call into a lookup of that message's generated
 * id — `messages/fr.json` is keyed `"y1Z3or": "Langue"`, not `"Language"`. With
 * the option off, no call site asks for an id, every string renders its inline
 * English source, and the whole app is English whatever the locale says. The
 * language setting then looks broken while doing exactly what it is told: the
 * cookie is written, the server resolves `fr`, `<html lang="fr">` is correct,
 * and the French catalogue is even shipped to the client — with nothing to read
 * it. That cost a while to find, which is the other reason this is on.
 *
 * The risk it was turned off for is real and worth naming: the extractor writes
 * the catalogues while modules compile, and overlapping Turbopack compilations
 * can leave them partially written. They are committed, so the damage is always
 * visible as `git diff -- apps/web/messages` and undone by checking them out
 * again. A blank value is also harmless at runtime — `src/i18n/request.ts`
 * falls back to the source locale for any key whose translation is empty, so a
 * half-written catalogue reads as English rather than as nothing.
 */
const withNextIntl = createNextIntlPlugin({
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
