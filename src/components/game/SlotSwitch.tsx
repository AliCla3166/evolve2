/* Sélecteur de slot de sauvegarde — demande utilisateur : choisir entre la
   partie "perso" (réelle) et une partie "dev" isolée pour tester le jeu (avec
   ressources ajoutables librement, cf. DevPanel). Affiché à l'écran titre ET
   dans Réglages (le PWA démarre directement sur /play, donc l'écran titre
   n'est pas toujours vu). */
"use client";

import { useGame } from "@/lib/game/store";

export function SlotSwitch({ compact = false }: { compact?: boolean }) {
  const activeSlot = useGame((s) => s.activeSlot);
  const switchSlot = useGame((s) => s.switchSlot);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1 rounded-full border border-cell-cyan/25 bg-black/30 p-1 text-[10px] tracking-widest">
        <button
          onClick={() => switchSlot("perso")}
          className={`rounded-full px-3 py-1 transition ${
            activeSlot === "perso" ? "bg-cell-cyan/20 text-cell-cyan" : "text-cell-teal/50"
          }`}
        >
          PERSO
        </button>
        <button
          onClick={() => switchSlot("dev")}
          className={`rounded-full px-3 py-1 transition ${
            activeSlot === "dev" ? "bg-cell-magenta/25 text-cell-magenta" : "text-cell-teal/50"
          }`}
        >
          🧪 DEV
        </button>
      </div>
      {activeSlot === "dev" && !compact && (
        <span className="max-w-[240px] text-center text-[10px] leading-snug text-cell-magenta/80">
          Mode développeur actif — partie de test, séparée de ta vraie sauvegarde.
        </span>
      )}
    </div>
  );
}
