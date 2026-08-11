import type { MetadataRoute } from "next"

/** Installable web experience; the native app complements rather than replaces it. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Avermate",
    short_name: "Avermate",
    description:
      "Track your grades, understand your averages, and reach your goals.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["education", "productivity"],
    icons: [
      {
        src: "/icon512_rounded.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/maskable_icon_x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon512_monochrome.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
  }
}
