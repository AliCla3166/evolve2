/* Page de jeu /play — mobile-first, fond océan.
   HUD ressources · file de construction · base vivante (scène Canvas,
   tap sur un bâtiment → panneau d'amélioration) · habitudes du jour ·
   nav basse (Noyau, Rapports) · événements & alerte pathogène (Phase 5). */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BastionPanel } from "@/components/game/BastionPanel";
import { BuildCompleteModal } from "@/components/game/BuildCompleteModal";
import { BuildingSheet } from "@/components/game/BuildingSheet";
import { CardReveal } from "@/components/game/CardReveal";
import { CellScene } from "@/components/game/CellScene";
import { EventModal } from "@/components/game/EventModal";
import { HabitsPanel } from "@/components/game/HabitsPanel";
import { Hud } from "@/components/game/Hud";
import { MarePanel } from "@/components/game/MarePanel";
import { NoyauHub } from "@/components/game/NoyauHub";
import { ProfileCreate, portraitSrc } from "@/components/game/ProfileCreate";
import { ObjectiveStrip } from "@/components/game/ObjectiveStrip";
import { QueueBanner } from "@/components/game/QueueBanner";
import { ReportsPanel } from "@/components/game/ReportsPanel";
import { SettingsPanel } from "@/components/game/SettingsPanel";
import { TutorialCoach } from "@/components/game/TutorialCoach";
import { WelcomeBackModal } from "@/components/game/WelcomeBackModal";
import { NavIcon, Panel } from "@/components/ui/Pixel";
import { cloudConfigured } from "@/lib/cloud/firebase";
import { useCloudSync } from "@/lib/cloud/useCloudSync";
import { fmtDuration } from "@/lib/game/format";
import { installAudio, playCue } from "@/lib/audio";
import { hydrateActiveSlot, useGame } from "@/lib/game/store";
import type { BuildingId } from "@/lib/game/types";

/** Alerte vague imminente (moins de 12 h) — visible sans ouvrir le Noyau.
 *  `onOpenBastion` permet de sauter directement dans le combat en direct. */
function WaveWarning({ onOpenBastion }: { onOpenBastion: () => void }) {
  const nextAttackAt = useGame((s) => s.nextAttackAt);
  const now = useGame((s) => s.lastTick);
  const remaining = nextAttackAt - now;
  if (nextAttackAt <= 0 || remaining <= 0 || remaining > 12 * 3_600_000) return null;
  return (
    <Panel
      variant="tooltip"
      className="flex items-center justify-between gap-2 px-3 py-1 text-center"
      style={{ background: "rgba(30, 5, 20, 0.85)" }}
    >
      <span className="text-[11px] text-red-400">
        🦠 Vague de pathogènes dans {fmtDuration(remaining)} — vérifie ta défense au Bastion.
      </span>
      <button
        onClick={onOpenBastion}
        className="shrink-0 rounded border border-red-400/50 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-400/10"
      >
        ⚔️ Défendre
      </button>
    </Panel>
  );
}

/** Panneaux plein écran montés par-dessus la base. */
type PanelId = "habits" | "noyau" | "mare" | "bastion" | "reports" | "settings" | null;

export default function PlayPage() {
  const hasHydrated = useGame((s) => s.hasHydrated);
  const profile = useGame((s) => s.profile);
  const activeSlot = useGame((s) => s.activeSlot);
  const reports = useGame((s) => s.reports);
  const reportsSeenAt = useGame((s) => s.reportsSeenAt);
  const [selected, setSelected] = useState<BuildingId | null>(null);
  const [panel, setPanelState] = useState<PanelId>(null);
  /* Tout passe par ce setter : c'est le seul point où le repère sonore de
     membrane (piste 8) est déclenché, plutôt que sur une dizaine de handlers.
     Le repère ne part que si l'état change réellement — retoucher l'onglet
     déjà ouvert ne doit rien produire. */
  const setPanel = (next: PanelId) => {
    if (next !== panel) playCue(next === null ? "panel_close" : "panel_open");
    setPanelState(next);
  };
  // Sync cloud active pendant le jeu (push périodique + arrière-plan).
  const { user: cloudUser, status: cloudStatus } = useCloudSync();

  const unseen = reports.filter((r) => r.ts > reportsSeenAt).length;

  // Recharge la sauvegarde localStorage (une seule fois, côté client).
  useEffect(() => {
    hydrateActiveSlot();
  }, []);

  /* Audio (piste 8). `installAudio` pose un unique écouteur délégué en capture :
     il débloque le contexte au tout premier geste — contrainte iOS, on ne peut
     pas créer un AudioContext hors interaction — et sonorise n'importe quel
     bouton du jeu sans qu'aucun composant n'ait à s'en occuper. */
  useEffect(() => installAudio(), []);

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
            {activeSlot === "dev" && (
              <span
                className="rounded-full border border-cell-magenta/50 px-2 py-0.5 text-[9px] tracking-widest text-cell-magenta"
                title="Mode développeur — partie de test, séparée de ta vraie sauvegarde"
              >
                🧪 DEV
              </span>
            )}
            {cloudConfigured && (
              <span
                className="text-xs"
                title={
                  !cloudUser
                    ? "Sync cloud : non connecté (écran titre)"
                    : cloudStatus === "synced"
                      ? "Sync cloud : à jour"
                      : cloudStatus === "error"
                        ? "Sync cloud : erreur — le local fait foi"
                        : "Sync cloud : en cours…"
                }
              >
                {!cloudUser ? "☁️⋯" : cloudStatus === "synced" ? "☁️✓" : cloudStatus === "error" ? "☁️✗" : "☁️…"}
              </span>
            )}
            <Link
              href="/"
              className="text-[10px] tracking-widest text-cell-teal/60 hover:text-cell-teal"
            >
              ← TITRE
            </Link>
          </div>

          {/* HUD ressources (sticky) */}
          <div className="sticky top-0 z-10 -mx-2 bg-abyss/85 px-2 py-1 backdrop-blur-sm">
            <Hud onOpenHabits={() => setPanel("habits")} />
          </div>

          {/* Objectif permanent (piste 3) — juste sous le HUD : la question
              « et après ? » doit avoir une réponse visible en permanence. */}
          <ObjectiveStrip />

          {/* Micro-tutoriel (nouveau joueur uniquement) */}
          <TutorialCoach />

          {/* Alerte pathogène imminente */}
          <WaveWarning onOpenBastion={() => setPanel("bastion")} />

          {/* File de construction (1 slot) */}
          <QueueBanner />

          {/* La base vivante — tap sur un bâtiment pour ouvrir son panneau */}
          <CellScene selected={selected} onSelect={setSelected} />
        </div>
      )}

      {/* Panneau d'amélioration (bottom sheet) */}
      {selected && (
        <BuildingSheet
          id={selected}
          onClose={() => setSelected(null)}
          onPlay={
            selected === "defense"
              ? () => {
                  setSelected(null);
                  setPanel("bastion");
                }
              : undefined
          }
        />
      )}

      {/* Overlays */}
      {panel === "habits" && <HabitsPanel onClose={() => setPanel(null)} />}
      {panel === "noyau" && <NoyauHub onClose={() => setPanel(null)} />}
      {panel === "mare" && <MarePanel onClose={() => setPanel(null)} />}
      {panel === "bastion" && <BastionPanel onClose={() => setPanel(null)} />}
      {panel === "reports" && <ReportsPanel onClose={() => setPanel(null)} />}
      {panel === "settings" && <SettingsPanel onClose={() => setPanel(null)} />}
      <EventModal />
      <CardReveal />
      {/* Comptes rendus (pistes 1 & 5) — le rapport de retour passe devant la
          célébration de chantier : il englobe déjà les chantiers terminés. */}
      <WelcomeBackModal />
      <BuildCompleteModal
        onNext={(id) => {
          setPanel(null);
          setSelected(id);
        }}
      />

      {/* Nav basse : Noyau (unités/expéditions) & Rapports */}
      {hasHydrated && profile && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-cell-cyan/20 bg-abyss/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-md items-center justify-around py-1.5 sm:max-w-2xl">
            <button
              onClick={() => {
                setPanel(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex flex-col items-center gap-0.5 px-1.5"
            >
              <NavIcon id="base" size={24} active={panel === null} />
              <span className="text-[8px] tracking-widest text-cell-teal/70">BASE</span>
            </button>
            <button
              onClick={() => setPanel(panel === "habits" ? null : "habits")}
              className="flex flex-col items-center gap-0.5 px-1.5"
            >
              <NavIcon id="habits" size={24} active={panel === "habits"} />
              <span className="text-[8px] tracking-widest text-cell-teal/70">HABITUDES</span>
            </button>
            <button
              onClick={() => setPanel(panel === "noyau" ? null : "noyau")}
              className="flex flex-col items-center gap-0.5 px-1.5"
            >
              <NavIcon id="units" size={24} active={panel === "noyau"} />
              <span className="text-[8px] tracking-widest text-cell-teal/70">NOYAU</span>
            </button>
            <button
              onClick={() => setPanel(panel === "mare" ? null : "mare")}
              className="flex flex-col items-center gap-0.5 px-1.5"
            >
              <NavIcon id="mare" size={24} active={panel === "mare"} />
              <span className="text-[8px] tracking-widest text-cell-teal/70">MARE</span>
            </button>
            <button
              onClick={() => setPanel(panel === "reports" ? null : "reports")}
              className="relative flex flex-col items-center gap-0.5 px-1.5"
            >
              <NavIcon id="reports" size={24} active={panel === "reports"} />
              {unseen > 0 && (
                <span className="absolute -top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cell-magenta px-1 text-[9px] font-bold text-abyss">
                  {unseen > 9 ? "9+" : unseen}
                </span>
              )}
              <span className="text-[8px] tracking-widest text-cell-teal/70">RAPPORTS</span>
            </button>
            <button
              onClick={() => setPanel(panel === "settings" ? null : "settings")}
              className="flex flex-col items-center gap-0.5 px-1.5"
            >
              <NavIcon id="settings" size={24} active={panel === "settings"} />
              <span className="text-[8px] tracking-widest text-cell-teal/70">RÉGLAGES</span>
            </button>
          </div>
        </nav>
      )}
    </main>
  );
}
