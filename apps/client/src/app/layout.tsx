import QueryProvider from "@/providers/query-provider";
import type { Metadata } from "next";
import "./globals.css";

import { AprilFools } from "@/components/april-fools";
import { ThemeColorMetaTag } from "@/components/color";
// import { Toaster } from "@/components/ui/toaster";
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils";
import ThemeProvider from "@/providers/theme-provider";
import MokattamCelebrationProvider from "@/providers/mokattam-celebration-provider";
import TimelineModeSync from "@/providers/timeline-mode-sync";
import UserSettingsSync from "@/providers/user-settings-sync";
import { Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Gabarito } from "next/font/google";

const gabarito = Gabarito({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s | Avermate",
    default: "Avermate - L'app de suivi étudiant pour calculer ses moyennes (Alternative Pronote & Ecole Directe)",
  },
  description:
    "Avermate est la meilleure application de suivi étudiant pour simuler, calculer et stocker vos notes et moyennes. L'app pour stocker ses résultats de manière moderne et transparente, alternative indépendante à Pronote et École Directe.",
  keywords: [
    "suivi etudiant",
    "moyenne note",
    "calcul moyenne",
    "alternative école directe",
    "école directe",
    "alternative pronote",
    "pronote",
    "app pour stocker ses résultats",
    "suivi scolaire",
    "étudiant",
    "notes"
  ],
  authors: [{ name: "Avermate" }],
  creator: "Avermate",
  openGraph: {
    type: "website",
    locale: "fr_FR",
    title: "Avermate - L'app de suivi étudiant (Alternative Pronote & École Directe)",
    description: "Avermate est la meilleure application de suivi étudiant pour simuler, calculer et stocker vos notes et moyennes. L'alternative moderne et indépendante à Pronote et École Directe.",
    siteName: "Avermate",
  },
  twitter: {
    card: "summary_large_image",
    title: "Avermate - L'app de suivi étudiant pour vos notes et moyennes",
    description: "La meilleure alternative à Pronote et École Directe pour stocker ses résultats de manière moderne et transparente.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 2) Read the locale and messages (provided by i18n/request.ts)
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning className="scroll-smooth">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#09090b" />
        <meta name="google" content="notranslate"/>
        {/* Disable analytics */}
        {/* <Script
          defer
          src="https://umami.avermate.fr/script.js"
          data-website-id="0911750a-9051-4ad2-9296-95acd91b78a4"
        /> */}
      </head>
      <body className={cn("", gabarito.className)} >
        <QueryProvider>
          <ThemeProvider>
            <UserSettingsSync />
            <TimelineModeSync />
            <ThemeColorMetaTag />
            <NextIntlClientProvider locale={locale} messages={messages}>
              <MokattamCelebrationProvider />
              <AprilFools />
              <div data-vaul-drawer-wrapper="" className="bg-background scrollbar-hide" >
                {children}
              </div>
              <Toaster richColors/>
            </NextIntlClientProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
