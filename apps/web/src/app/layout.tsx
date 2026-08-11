import type { Metadata, Viewport } from "next"
import { cookies } from "next/headers"
import {
  DM_Sans,
  Fira_Code,
  Gabarito,
  Geist,
  Geist_Mono,
  Inter,
  JetBrains_Mono,
  Lora,
  Merriweather,
  Montserrat,
  Nunito,
  Outfit,
  Playfair_Display,
  Plus_Jakarta_Sans,
  Poppins,
  Roboto,
  Source_Code_Pro,
} from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getLocale } from "next-intl/server"
import { Providers } from "@/components/providers"
import { APPEARANCE_COOKIE, parseAppearance } from "@/lib/appearance"
import { cn } from "@/lib/utils"
import { fontStack } from "@/lib/theme"
import "./globals.css"

const sans = Inter({ subsets: ["latin"], variable: "--font-inter" })
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })
const gabarito = Gabarito({ subsets: ["latin"], variable: "--font-gabarito" })
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  preload: false,
})
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  preload: false,
})
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  preload: false,
})
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  preload: false,
})
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  preload: false,
})
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  preload: false,
})
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  preload: false,
})
const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  preload: false,
})
const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-merriweather",
  preload: false,
})
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  preload: false,
})
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  preload: false,
})
const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-fira-code",
  preload: false,
})
const sourceCode = Source_Code_Pro({
  subsets: ["latin"],
  variable: "--font-source-code-pro",
  preload: false,
})

export const metadata: Metadata = {
  title: {
    default: "Avermate",
    template: "%s · Avermate",
  },
  description:
    "Track your grades, understand your averages, and reach the results you are aiming for.",
  applicationName: "Avermate",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon512_rounded.png",
  },
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
      className={cn(
        "antialiased",
        sans.variable,
        geist.variable,
        mono.variable,
        gabarito.variable,
        roboto.variable,
        poppins.variable,
        montserrat.variable,
        outfit.variable,
        plusJakarta.variable,
        dmSans.variable,
        nunito.variable,
        lora.variable,
        merriweather.variable,
        playfair.variable,
        jetbrains.variable,
        firaCode.variable,
        sourceCode.variable
      )}
      style={
        {
          "--radius": `${appearance.radius}rem`,
          "--app-font-sans": fontStack(appearance.font),
          "--app-font-heading":
            appearance.headingFont === "inherit"
              ? "var(--app-font-sans)"
              : fontStack(appearance.headingFont),
        } as React.CSSProperties
      }
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
