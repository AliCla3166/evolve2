/* Page de jeu /play — mobile-first, fond océan.
   HUD ressources · file de construction · base vivante (scène Canvas,
   tap sur un bâtiment → panneau d'amélioration) · habitudes du jour ·
   nav basse (Noyau, Rapports) · événements & alerte pathogène (Phase 5). */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BuildingSheet } from "@/components/game/BuildingSheet";
import { CellScene } from "@/components/game/CellScene";
import { EventModal } from "@/components/game/EventModal";
import { HabitsPanel } from "@/components/game/HabitsPanel";
import { Hud } from "@/components/game/Hud";
import { NoyauHub } from "@/components/game/NoyauHub";
import { ProfileCreate, portraitSrc } from "@/components/game/ProfileCreate";
import { QueueBanner } from "@/components/game/QueueBanner";
import { ReportsPanel } from "@/components/game/ReportsPanel";
import { TutorialCoach } from "@/components/game/TutorialCoach";
import { NavIcon, Panel } from "@/components/ui/Pixel";
import { fmtDuration } from "@/lib/game/format";
import { useGame } from "@/lib/game/store";
import type { BuildingId } from "@/lib/game/types";

/** Alerte vague imminente (moins de 12 h) — visible sans ouvrir le Noyau. */
function WaveWarning() {
  const nextAttackAt = useGame((s) => s.nextAttackAt);
  const now = useGame((s) => s.lastTick);
  const remaining = nextAttackAt - now;
  if (nextAttackAt <= 0 || remaining <= 0 || remaining > 12 * 3_600_000) return null;
  return (
    <Panel variant="tooltip" className="px-3 py-1 text-center" style={{ background: "rgba(30, 5, 20, 0.85)" }}>
      <span className="text-[11px] text-red-400">
        🦠 Vague de pathogènes dans {fmtDuration(remaining)} — vérifie ta défense au Noyau.
      </span>
    </Panel>
  );
}

export default function PlayPage() {
  const hasHydrated = useGame((s) => s.hasHydrated);
  const profile = useGame((s) => s.profile);
  const reports = useGame((s) => s.reports);
  const reportsSeenAt = useGame((s) => s.reportsSeenAt);
  const [selected, setSelected] = useState<BuildingId | null>(null);
  const [panel, setPanel] = useState<"noyau" | "reports" | null>(null);

  const unseen = reports.filter((r) => r.ts > reportsSeenAt).length;

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
        <div className="mx-auto max-w-md space-y-3 px-2 pb-24 pt-2 sm:max-w-2xl">
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

          {/* Micro-tutoriel (nouveau joueur uniquement) */}
          <TutorialCoach />

          {/* Alerte pathogène imminente */}
          <WaveWarning />

          {/* File de construction (1 slot) */}
          <QueueBanner />

          {/* La base vivante — tap sur un bâtiment pour ouvrir son panneau */}
          <CellScene selected={selected} onSelect={setSelected} />

          {/* Habitudes du jour */}
          <HabitsPanel />
        </div>
      )}

      {/* Panneau d'amélioration (bottom sheet) */}
      {selected && <BuildingSheet id={selected} onClose={() => setSelected(null)} />}

      {/* Overlays Phase 5 */}
      {panel === "noyau" && <NoyauHub onClose={() => setPanel(null)} />}
      {panel === "reports" && <ReportsPanel onClose={() => setPanel(null)} />}
      <EventModal />

      {/* Nav basse : Noyau (unités/expéditions) & Rapports */}
      {hasHydrated && profile && (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-cell-cyan/20 bg-abyss/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-md items-center justify-around py-1.5 sm:max-w-2xl">
            <button
              onClick={() => {
                setPanel(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex flex-col items-center gap-0.5 px-4"
            >
              <NavIcon id="base" size={26} active={panel === null} />
              <span className="text-[9px] tracking-widest text-cell-teal/70">BASE</span>
            </button>
            <button
              onClick={() => setPanel(panel === "noyau" ? null : "noyau")}
              className="flex flex-col items-center gap-0.5 px-4"
            >
              <NavIcon id="units" size={26} active={panel === "noyau"} />
              <span className="text-[9px] tracking-widest text-cell-teal/70">NOYAU</span>
            </button>
            <button
              onClick={() => setPanel(panel === "reports" ? null : "reports")}
              className="relative flex flex-col items-center gap-0.5 px-4"
            >
              <NavIcon id="reports" size={26} active={panel === "reports"} />
              {unseen > 0 && (
                <span className="absolute -top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cell-magenta px-1 text-[9px] font-bold text-abyss">
                  {unseen > 9 ? "9+" : unseen}
                </span>
              )}
              <span className="text-[9px] tracking-widest text-cell-teal/70">RAPPORTS</span>
            </button>
          </div>
        </nav>
      )}
    </main>
  );
}
