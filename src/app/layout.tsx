import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EVOLVE — Âge 1 : Cellule",
  description:
    "Tes bonnes habitudes du réel financent une civilisation qui évolue de la cellule au divin.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#050b14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
