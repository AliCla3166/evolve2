import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Silkscreen } from "next/font/google";
import { InstallPrompt } from "@/components/InstallPrompt";
import { SwRegister } from "@/components/SwRegister";
import "./globals.css";

/* ===== Polices (piste 10 du diagnostic) =====
   Le jeu tournait jusqu'ici sur la pile `ui-monospace` du système : un rendu
   différent sur chaque téléphone, sous des sprites pixel art identiques
   partout. `next/font` télécharge et sert les fichiers depuis notre propre
   domaine (aucune requête vers Google chez le joueur, aucun décalage de mise
   en page au chargement) — le texte devient enfin le même sur iOS, Android et
   bureau.

   Deux familles, et pas une seule police bitmap comme le diagnostic le
   suggérait : à 9-10 px, sous du français accentué et dense (les fiches de
   bâtiment, les rapports), une bitmap est nettement MOINS lisible qu'une
   monospace dessinée pour l'écran. On garde donc une monospace de labeur
   (JetBrains Mono, très ouverte aux petites tailles, latin-ext pour nos
   accents) et on réserve la bitmap (Silkscreen) aux titres d'affichage, où
   elle fait tout le travail d'identité sans coûter en lisibilité. */
const mono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-mono",
  display: "swap",
});

const pixel = Silkscreen({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-pixel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "EVOLVE — Âge 1 : Cellule",
  description:
    "Tes bonnes habitudes du réel financent une civilisation qui évolue de la cellule au divin.",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "EVOLVE",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* `maximumScale: 1` interdisait le pinch-to-zoom. Sur une interface qui
     descend à 9-10 px, c'est un défaut d'accessibilité pur et simple : un
     joueur presbyte n'avait aucun recours. Le verrou n'a plus de raison
     d'être (il servait à contourner le zoom automatique d'iOS sur les champs
     de saisie, réglé ici en donnant 16 px aux `input` — cf. globals.css). */
  maximumScale: 5,
  userScalable: true,
  /* `black-translucent` fait passer la page SOUS la barre d'état iOS ; sans
     `cover`, les `env(safe-area-inset-*)` valent tous 0 et les marges de
     sécurité ne servent à rien. Les deux vont par paire. */
  viewportFit: "cover",
  /* Clavier virtuel : par défaut le navigateur ne redimensionne que le
     viewport VISUEL, donc la nav `fixed bottom-0` reste derrière le clavier et
     le champ de saisie d'habitude peut se retrouver caché. `resizes-content`
     rétrécit la mise en page : le champ reste visible au-dessus du clavier. */
  interactiveWidget: "resizes-content",
  themeColor: "#050b14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`h-full ${mono.variable} ${pixel.variable}`}>
      <body className="min-h-full antialiased">
        <SwRegister />
        <InstallPrompt />
        {children}
      </body>
    </html>
  );
}
