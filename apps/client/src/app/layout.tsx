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
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto" });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-poppins" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const plusJakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
const lora = Lora({ subsets: ["latin"], variable: "--font-lora" });
const merriweather = Merriweather({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-merriweather" });
const playfair = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });
const firaCode = Fira_Code({ subsets: ["latin"], variable: "--font-fira-code" });
const sourceCodePro = Source_Code_Pro({ subsets: ["latin"], variable: "--font-source-code-pro" });

export const metadata: Metadata = {
  title: "Avermate",
  description:
    "Obtenez un aperçu instantané et précis de vos notes et de vos moyennes. Suivez votre progression en temps réel pour atteindre vos objectifs.",
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
