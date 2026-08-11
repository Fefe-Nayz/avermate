import type { Metadata, Viewport } from "next"
import { cookies } from "next/headers"
import { Geist_Mono, Inter } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getLocale } from "next-intl/server"
import { Providers } from "@/components/providers"
import { APPEARANCE_COOKIE, parseAppearance } from "@/lib/appearance"
import { cn } from "@/lib/utils"
import "./globals.css"

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata: Metadata = {
  title: {
    default: "Avermate",
    template: "%s · Avermate",
  },
  description:
    "Track your grades, understand your averages, and reach the results you are aiming for.",
  applicationName: "Avermate",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Avermate",
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The layout adapts rather than scaling, but pinch-to-zoom stays available:
  // locking it out is an accessibility failure, not a polish detail.
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [locale, store] = await Promise.all([getLocale(), cookies()])
  const appearance = parseAppearance(store.get(APPEARANCE_COOKIE)?.value)

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      data-palette={appearance.palette}
      data-season={appearance.season}
      data-motion={appearance.reduceMotion ? "reduced" : "full"}
      className={cn("antialiased", sans.variable, mono.variable, "font-sans")}
      style={{ "--radius": `${appearance.radius}rem` } as React.CSSProperties}
    >
      <head>
        {/* Round-tripped through a cookie so the user's own palette is already
            in place on the first paint instead of replacing the default one. */}
        <style
          id="avermate-custom-theme"
          dangerouslySetInnerHTML={{ __html: appearance.customCss }}
        />
      </head>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
