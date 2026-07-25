/* Page de jeu /play — mobile-first, fond océan.
   HUD ressources · file de construction · base vivante (scène Canvas,
   tap sur un bâtiment → panneau d'amélioration) · habitudes du jour ·
   nav basse (Habitudes, Dérive, Mare, Bastion, Rapports, Réglages) ·
   événements & alerte pathogène (Phase 5). */
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
import { TerritoirePanel } from "@/components/game/TerritoirePanel";
import { TutorialCoach } from "@/components/game/TutorialCoach";
import { WelcomeBackModal } from "@/components/game/WelcomeBackModal";
import { NavIcon, Panel } from "@/components/ui/Pixel";
import type { NavIconId } from "@/components/ui/Pixel";
import { cloudConfigured } from "@/lib/cloud/firebase";
import { useCloudSync } from "@/lib/cloud/useCloudSync";
import { WAVE_LEAD_WINDOW_MS } from "@/lib/game/bastion/config";
import { freeSortiesToday, sortiesUsedToday } from "@/lib/game/bastion/sorties";
import { fmtDuration } from "@/lib/game/format";
import { portalTarget } from "@/lib/game/scene";
import { bonusValue } from "@/lib/game/territoire";
import { installAudio, playCue } from "@/lib/audio";
import { useOverlay, scrollToTop } from "@/lib/overlay";
import { hydrateActiveSlot, useGame } from "@/lib/game/store";
import { startNotificationScheduler, subscribeNotificationOpen } from "@/lib/notifications";
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
type PanelId = "habits" | "noyau" | "mare" | "derive" | "bastion" | "reports" | "settings" | null;

/* Les rappels (piste 2) transportent leur destination sous forme de chaîne :
   elle vient du JSON de config, puis transite par une notification système et
   parfois par la barre d'adresse. Autant dire qu'elle n'est pas digne de
   confiance — on ne monte que ce qui figure dans cette liste. */
const PANEL_IDS: ReadonlyArray<Exclude<PanelId, null>> = [
  "habits",
  "noyau",
  "mare",
  "derive",
  "bastion",
  "reports",
  "settings",
];

/* Écran ouvert par le bouton d'action de la fiche d'un bâtiment. Le Noyau y est
   entré à l'étape 6c : il a quitté la barre de navigation au profit de LA DÉRIVE,
   son socle au centre de la scène est devenu sa seule porte. Le libellé de chaque
   bouton vit dans `BuildingSheet` (cf. `SHEET_ACTION`) — ici, uniquement la
   destination. */
const SHEET_PANEL: Partial<Record<BuildingId, Exclude<PanelId, null>>> = {
  defense: "bastion",
  noyau: "noyau",
};

/* ============================ Navigation basse ============================
   Piste 10 du diagnostic, trois corrections d'un coup :

   1. LE BASTION N'EXISTAIT PAS DANS LA NAV. Le plus gros morceau jouable du
      projet ne s'atteignait que par un tap sur un bâtiment de la scène, ou par
      la bannière d'alerte — laquelle ne s'affiche que dans les 12 dernières
      heures. Or la fenêtre de jeu réelle est de WAVE_LEAD_WINDOW_MS (96 h) :
      le joueur pouvait défendre pendant quatre jours sans jamais le savoir.
      D'où l'onglet, ET le badge qui s'allume dès que la vague est jouable.

   2. LES CIBLES TACTILES. Les six boutons faisaient la hauteur de leur contenu
      avec un libellé en 8 px. Ils sont maintenant à 44 px de haut (seuil
      recommandé) et le libellé grandit avec l'écran.

   3. LA ZONE SÛRE. `fixed bottom-0` posait la nav sous le home indicator iOS.
      `pb-safe` la remonte ; `--nav-h` + `pb-nav` réservent la place côté
      contenu, à la place des `pb-24` devinés un peu partout.

   ÉTAPE 6C (La Dérive) — LE NOYAU CÈDE SA PLACE. Sept onglets, c'est le maximum
   tenable sur un écran de 320 px : ajouter LA DÉRIVE imposait d'en retirer un.
   Le Noyau est le candidat évident, et pour une raison de fond, pas de place :
   il est le SEUL onglet qui doublonnait un socle de la scène — son bâtiment
   trône au centre de la base, à portée de pouce. Les six autres (Habitudes,
   Mare, Bastion, Rapports, Réglages, Base) n'ont pas cette porte, ou l'ont mais
   mènent à un écran qu'on ouvre plusieurs fois par jour. Le Noyau, lui, se
   consulte une fois par session : sa fiche de bâtiment suffit largement.
   `"noyau"` reste dans `PANEL_IDS` — un rappel système peut toujours l'ouvrir. */

/** Un onglet. Le libellé est en `clamp()` : 8 px sur un écran de 320 px (où
 *  7 onglets ne laissent que ~45 px chacun), 10 px sur un grand téléphone —
 *  plutôt qu'un 8 px illisible imposé à tout le monde. */
function NavBtn({
  icon,
  label,
  active,
  badge,
  onClick,
  title,
}: {
  icon: NavIconId;
  label: string;
  active: boolean;
  badge?: string | null;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title ?? label}
      aria-current={active ? "page" : undefined}
      className="tap-h relative flex w-full flex-col items-center justify-center gap-0.5 px-0.5"
    >
      <NavIcon id={icon} size={24} active={active} />
      {badge && (
        <span className="pointer-events-none absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-cell-magenta px-1 text-[9px] font-bold text-abyss">
          {badge}
        </span>
      )}
      <span
        className={`leading-none ${active ? "text-cell-cyan" : "text-cell-teal/70"}`}
        style={{ fontSize: "clamp(8px, 2.35vw, 10px)", letterSpacing: "0.04em" }}
      >
        {label}
      </span>
    </button>
  );
}

/** La nav est isolée dans son propre composant parce qu'elle s'abonne à
 *  `lastTick` (badge de vague) : sans ça, toute la page se re-rendrait chaque
 *  seconde. */
function BottomNav({
  panel,
  setPanel,
}: {
  panel: PanelId;
  setPanel: (p: PanelId) => void;
}) {
  const reports = useGame((s) => s.reports);
  const reportsSeenAt = useGame((s) => s.reportsSeenAt);
  const nextAttackAt = useGame((s) => s.nextAttackAt);
  const bastion = useGame((s) => s.bastion);
  const territoire = useGame((s) => s.territoire);
  const now = useGame((s) => s.lastTick);

  const unseen = reports.filter((r) => r.ts > reportsSeenAt).length;
  const waveIn = nextAttackAt - now;
  const wavePlayable = nextAttackAt > 0 && waveIn > 0 && waveIn <= WAVE_LEAD_WINDOW_MS;
  /* Sorties gratuites qu'il reste à dépenser aujourd'hui. C'est le seul chiffre
     de la barre qui dit « il y a quelque chose à faire MAINTENANT, et c'est
     gratuit » : il se remet à plein tous les jours, il s'éteint dès qu'on a tout
     joué, et il vit sur DÉRIVE parce que c'est là qu'on choisit la cible. */
  const freeLeft = Math.max(
    0,
    freeSortiesToday(bastion, now, bonusValue(territoire, "free_sortie")) -
      sortiesUsedToday(bastion, now),
  );

  const toggle = (id: Exclude<PanelId, null>) => () => setPanel(panel === id ? null : id);

  return (
    <nav className="px-safe pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-cell-cyan/20 bg-abyss/90 backdrop-blur-sm">
      <div className="mx-auto grid max-w-md grid-cols-7 items-center py-1.5 sm:max-w-2xl">
        <NavBtn
          icon="base"
          label="BASE"
          active={panel === null}
          title="Revenir à la base"
          onClick={() => {
            setPanel(null);
            scrollToTop();
          }}
        />
        <NavBtn
          icon="habits"
          label="HABITUDES"
          active={panel === "habits"}
          title="Habitudes du jour — la source de ton énergie"
          onClick={toggle("habits")}
        />
        <NavBtn
          icon="derive"
          label="DÉRIVE"
          active={panel === "derive"}
          badge={freeLeft > 0 ? String(freeLeft) : null}
          title={
            freeLeft > 0
              ? `La Dérive — la carte des eaux (${freeLeft} sortie${freeLeft > 1 ? "s" : ""} gratuite${freeLeft > 1 ? "s" : ""} à jouer aujourd'hui)`
              : "La Dérive — la carte des eaux : gisements, vestiges, antres"
          }
          onClick={toggle("derive")}
        />
        <NavBtn
          icon="mare"
          label="MARE"
          active={panel === "mare"}
          title="La Mare — pêche et collection de créatures"
          onClick={toggle("mare")}
        />
        <NavBtn
          icon="bastion"
          label="BASTION"
          active={panel === "bastion"}
          badge={wavePlayable ? "⚔" : null}
          title={
            wavePlayable
              ? `Bastion — vague jouable en direct (attaque dans ${fmtDuration(Math.max(0, waveIn))})`
              : "Bastion — défense jouable, boutique et garnison"
          }
          onClick={toggle("bastion")}
        />
        <NavBtn
          icon="reports"
          label="RAPPORTS"
          active={panel === "reports"}
          badge={unseen > 0 ? (unseen > 9 ? "9+" : String(unseen)) : null}
          title="Comptes rendus d'expéditions et de vagues"
          onClick={toggle("reports")}
        />
        <NavBtn
          icon="settings"
          label="RÉGLAGES"
          active={panel === "settings"}
          title="Réglages, sauvegarde et son"
          onClick={toggle("settings")}
        />
      </div>
    </nav>
  );
}

export default function PlayPage() {
  const hasHydrated = useGame((s) => s.hasHydrated);
  const profile = useGame((s) => s.profile);
  const activeSlot = useGame((s) => s.activeSlot);
  const [selected, setSelected] = useState<BuildingId | null>(null);
  const [panel, setPanelState] = useState<PanelId>(null);
  /* Tout passe par ce setter : c'est le seul point où le repère sonore de
     membrane (piste 8) est déclenché, plutôt que sur une dizaine de handlers.
     Le repère ne part que si l'état change réellement — retoucher l'onglet
     déjà ouvert ne doit rien produire. */
  /* Cible de sortie choisie sur la carte de La Dérive. Elle ne vit QUE le temps d'aller de
     la carte au lanceur du Bastion : tout passage par `setPanel` l'efface, sinon rouvrir le
     Bastion des semaines plus tard proposerait encore d'assaillir un foyer oublié. */
  const [sortieTarget, setSortieTarget] = useState<string | null>(null);
  const setPanel = (next: PanelId) => {
    if (next !== panel) playCue(next === null ? "panel_close" : "panel_open");
    setSortieTarget(null);
    setPanelState(next);
  };
  /* La carte choisit la CIBLE, le Bastion choisit le Péril et les Préparatifs : une seule
     décision par écran. L'ordre compte — `setPanel` remet la cible à zéro, on la repose
     donc juste après (même lot de mises à jour, donc un seul rendu). */
  const handleAssault = (foyerId: string) => {
    setPanel("bastion");
    setSortieTarget(foyerId);
  };
  /* Un tap sur un socle « portail » (Défense/Pêche/Raid) ouvre directement
     l'écran concerné au lieu d'une fiche de bâtiment vide (piste 9b) : ces
     trois-là ne sont pas des proto-organes améliorables, ce sont des portes. */
  const handleSelect = (id: BuildingId | null) => {
    const target = id ? portalTarget(id) : null;
    if (target) {
      setSelected(null);
      setPanel(target);
      return;
    }
    setSelected(id);
  };

  /* Retour système Android + verrou de défilement de l'arrière-plan, pour les
     deux overlays pilotés par cette page (cf. src/lib/overlay.ts). */
  useOverlay(panel !== null, () => setPanel(null));
  useOverlay(selected !== null, () => setSelected(null));

  // Sync cloud active pendant le jeu (push périodique + arrière-plan).
  const { user: cloudUser, status: cloudStatus } = useCloudSync();

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

  /* Rappels (piste 2). Le planificateur ne démarre qu'une fois la sauvegarde
     chargée : calculer un planning sur un état vierge produirait un rappel
     d'habitudes pour une journée qui, en base, est peut-être déjà validée. */
  useEffect(() => {
    if (!hasHydrated) return;
    return startNotificationScheduler(() => useGame.getState());
  }, [hasHydrated]);

  /* Clic sur un rappel -> le panneau concerné. Un seul abonnement absorbe les
     deux chemins (message du service worker si l'app tournait déjà, `?panel=`
     si le clic vient de la lancer). L'ouverture arrive forcément de façon
     asynchrone : poser l'état en synchrone dans le corps d'un effet romprait
     la règle `react-hooks/set-state-in-effect` du projet. */
  useEffect(() => {
    return subscribeNotificationOpen((target) => {
      const id = PANEL_IDS.find((p) => p === target) ?? null;
      setSelected(null);
      // Ce chemin court-circuite `setPanel` (règle set-state-in-effect) : on efface donc
      // la cible de sortie à la main, sinon un rappel ouvrant le Bastion rouvrirait le
      // lanceur sur un foyer choisi dans une session précédente.
      setSortieTarget(null);
      setPanelState(id);
      if (id) playCue("panel_open");
    });
  }, []);

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
        <div className="pb-nav pt-safe mx-auto max-w-md space-y-3 px-2 sm:max-w-2xl">
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
          <div className="top-safe sticky z-10 -mx-2 bg-abyss/85 px-2 py-1 backdrop-blur-sm">
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
          <CellScene selected={selected} onSelect={handleSelect} />
        </div>
      )}

      {/* Panneau d'amélioration (bottom sheet) */}
      {selected && (
        <BuildingSheet
          id={selected}
          onClose={() => setSelected(null)}
          onPlay={
            SHEET_PANEL[selected]
              ? () => {
                  setSelected(null);
                  setPanel(SHEET_PANEL[selected]!);
                }
              : undefined
          }
        />
      )}

      {/* Overlays */}
      {panel === "habits" && (
        <HabitsPanel onClose={() => setPanel(null)} onGoto={(p) => setPanel(p)} />
      )}
      {panel === "noyau" && <NoyauHub onClose={() => setPanel(null)} />}
      {panel === "mare" && <MarePanel onClose={() => setPanel(null)} />}
      {panel === "derive" && (
        <TerritoirePanel onClose={() => setPanel(null)} onAssault={handleAssault} />
      )}
      {panel === "bastion" && (
        <BastionPanel onClose={() => setPanel(null)} initialTargetId={sortieTarget} />
      )}
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

      {/* Nav basse — 7 onglets : le Bastion (piste 10) et La Dérive (étape 6c) */}
      {hasHydrated && profile && <BottomNav panel={panel} setPanel={setPanel} />}
    </main>
  );
}
