import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EVOLVE — Âge 1 : Cellule",
    short_name: "EVOLVE",
    description:
      "Tes bonnes habitudes du réel financent une civilisation qui évolue de la cellule au divin.",
    start_url: "/play",
    display: "standalone",
    orientation: "portrait",
    background_color: "#050b14",
    theme_color: "#050b14",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
