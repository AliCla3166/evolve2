/* Page de jeu /play — mobile-first, fond océan.
   HUD ressources · file de construction · habitudes du jour · 12 bâtiments. */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BuildingList } from "@/components/game/BuildingList";
import { HabitsPanel } from "@/components/game/HabitsPanel";
import { Hud } from "@/components/game/Hud";
import { ProfileCreate, portraitSrc } from "@/components/game/ProfileCreate";
import { QueueBanner } from "@/components/game/QueueBanner";
import { useGame } from "@/lib/game/store";

export default function PlayPage() {
  const hasHydrated = useGame((s) => s.hasHydrated);
  const profile = useGame((s) => s.profile);

  // Recharge la sauvegarde localStorage (une seule fois, côté client).
  useEffect(() => {
    useGame.persist.rehydrate();
  }, []);

  // Un seul gros tick de rattrapage offline au chargement, puis tick 1 s.
  useEffect(() => {
    if (!hasHydrated) return;
    useGame.getState().collectTick(Date.now());
    const id = setInterval(() => useGame.getState().collectTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasHydrated]);

  return (
    <main
      className="min-h-screen"
      style={{
        backgroundImage: "url(/assets/ui/age01_cell_ui_bg_ocean_v001.png)",
        backgroundSize: "512px",
        backgroundAttachment: "fixed",
        imageRendering: "pixelated",
      }}
    >
      {!hasHydrated ? (
        <div className="flex min-h-screen items-center justify-center">
          <p className="animate-pulse text-xs tracking-[0.4em] text-cell-cyan">
            RÉVEIL DE LA CELLULE…
          </p>
        </div>
      ) : !profile ? (
        <ProfileCreate />
      ) : (
        <div className="mx-auto max-w-md space-y-3 px-2 pb-10 pt-2 sm:max-w-2xl">
          {/* En-tête : profil + retour titre */}
          <div className="flex items-center gap-2 px-1">
            <img
              src={portraitSrc(profile.portraitId)}
              alt={profile.portraitId}
              width={32}
              height={32}
              className="pixelated rounded-md border border-cell-cyan/40"
              draggable={false}
            />
            <span className="flex-1 truncate text-xs tracking-widest text-cell-cyan">
              {profile.nomOrganisme}
            </span>
            <Link
              href="/"
              className="text-[10px] tracking-widest text-cell-teal/60 hover:text-cell-teal"
            >
              ← TITRE
            </Link>
          </div>

          {/* HUD ressources (sticky) */}
          <div className="sticky top-0 z-10 -mx-2 bg-abyss/85 px-2 py-1 backdrop-blur-sm">
            <Hud />
          </div>

          {/* File de construction (1 slot) */}
          <QueueBanner />

          {/* Habitudes du jour */}
          <HabitsPanel />

          {/* Les 12 bâtiments */}
          <BuildingList />
        </div>
      )}
    </main>
  );
}
