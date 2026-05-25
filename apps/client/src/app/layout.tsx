import QueryProvider from "@/providers/query-provider";
import type { Metadata } from "next";
import "./globals.css";

import { AprilFools } from "@/components/april-fools";
import { AnnouncementBanner } from "@/components/announcements/announcement-banner";
import { ThemeColorMetaTag } from "@/components/color";
// import { Toaster } from "@/components/ui/toaster";
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils";
import ThemeProvider from "@/providers/theme-provider";
import MokattamCelebrationProvider from "@/providers/mokattam-celebration-provider";
import TimelineModeSync from "@/providers/timeline-mode-sync";
import UserSettingsSync from "@/providers/user-settings-sync";
import CustomThemeSync from "@/providers/custom-theme-sync";
import { ViewportKeyboardSync } from "@/components/viewport-keyboard-sync";
import { Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import {
  DM_Sans,
  Fira_Code,
  Gabarito,
  Geist,
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
} from "next/font/google";

const gabarito = Gabarito({
  subsets: ["latin"],
  variable: "--font-gabarito",
});
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto", preload: false });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-poppins", preload: false });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", preload: false });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", preload: false });
const plusJakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta", preload: false });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", preload: false });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", preload: false });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora", preload: false });
const merriweather = Merriweather({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-merriweather", preload: false });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair", preload: false });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", preload: false });
const firaCode = Fira_Code({ subsets: ["latin"], variable: "--font-fira-code", preload: false });
const sourceCodePro = Source_Code_Pro({ subsets: ["latin"], variable: "--font-source-code-pro", preload: false });

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
  interactiveWidget: "resizes-content",
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
      <body
        className={cn(
          "font-sans",
          gabarito.variable,
          geist.variable,
          inter.variable,
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
          jetbrainsMono.variable,
          firaCode.variable,
          sourceCodePro.variable
        )}
      >
        <QueryProvider>
          <ThemeProvider>
            <UserSettingsSync />
            <CustomThemeSync />
            <ViewportKeyboardSync />
            <TimelineModeSync />
            <ThemeColorMetaTag />
            <NextIntlClientProvider locale={locale} messages={messages}>
              <MokattamCelebrationProvider />
              <AprilFools />
              <AnnouncementBanner />
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
