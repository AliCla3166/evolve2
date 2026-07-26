/* L'OUVERTURE PROGRESSIVE & LE PROCHAIN DÉBLOCAGE (26/07/2026, améliorations n°6 et n°3).
   Module PUR : les onglets et leurs conditions vivent dans
   src/data/progression_config.json ; ici, uniquement la lecture.

   Deux clients :
   - la barre de navigation (play/page.tsx) : un onglet verrouillé s'affiche grisé
     avec SA condition en toutes lettres — la contrainte, le chiffre, la raison
     (convention bilanReasonText) — et son ouverture est un événement (badge
     « nouveau », carte d'explication à la première visite, cf. tabIntroSeen) ;
   - le bandeau d'objectifs (ObjectiveStrip) : le troisième emplacement affiche en
     permanence le PROCHAIN déblocage, le « nouveau héros à la vague 30 » de
     Grow Castle — toutes les données existaient, aucune n'était montrée. */

import rawConfig from "@/data/progression_config.json";
import { builtOrganCount, nextSlotUnlock } from "./economy";
import { STAGE_MIN_BUILT } from "./scene";
import { nextSectorUnlock } from "./territoire";
import type { GameState } from "./types";

/* ---------- Typage du JSON ---------- */

export interface TabDef {
  id: string;
  name: string;
  icon: string;
  metric: string;
  target: number;
  lock_hint: string;
  intro_title: string;
  intro: string;
}

interface ProgressionConfig {
  tabs: TabDef[];
}

export const PROGRESSION = rawConfig as unknown as ProgressionConfig;

/** Les onglets à condition, dans l'ordre d'ouverture voulu. */
export const GATED_TABS: ReadonlyArray<TabDef> = PROGRESSION.tabs;

export function tabDef(id: string): TabDef | undefined {
  return GATED_TABS.find((t) => t.id === id);
}

/* ---------- Conditions ---------- */

/** Avancement d'une condition d'onglet. Réutilise les mêmes lectures pures que
 *  les jalons ; `reports_count` est la seule métrique propre à ce module. */
export function tabProgress(state: GameState, def: TabDef): number {
  switch (def.metric) {
    case "built_organs":
      return builtOrganCount(state.buildings);
    case "reports_count":
      return state.reports.length;
    case "waves_survived":
      return state.waveCount;
    case "percees_total":
      return state.bilan?.perceesTotal ?? 0;
    default:
      return 0;
  }
}

/** Un onglet sans entrée dans la config est toujours ouvert (BASE, HABITUDES,
 *  RÉGLAGES) : la liste des verrous est le JSON, pas le code. */
export function tabUnlocked(state: GameState, id: string): boolean {
  const def = tabDef(id);
  if (!def) return true;
  return tabProgress(state, def) >= def.target;
}

/** La phrase du verrou — la contrainte, le chiffre, la raison. Les accolades
 *  {current}/{target} sont remplies ici : le texte vit en config, les nombres
 *  dans l'état, aucun des deux ne peut mentir sur l'autre. */
export function tabLockText(state: GameState, def: TabDef): string {
  const current = Math.min(tabProgress(state, def), def.target);
  return def.lock_hint
    .replace("{current}", String(current))
    .replace("{target}", String(def.target));
}

/** L'onglet fraîchement déverrouillé dont la carte d'explication n'a pas été vue
 *  (badge « ✦ nouveau » + carte à la première ouverture). Premier de l'ordre du
 *  fichier : une seule nouveauté à la fois, comme le bandeau d'objectif. */
export function unseenUnlockedTab(state: GameState): TabDef | null {
  return (
    GATED_TABS.find(
      (t) => tabUnlocked(state, t.id) && !(state.tabIntroSeen ?? []).includes(t.id),
    ) ?? null
  );
}

/* ---------- Le prochain déblocage (bandeau, 3e emplacement) ---------- */

export interface NextUnlockView {
  /** « Prochaine mue », « Récifs de silice », « Chantier auxiliaire », nom d'onglet… */
  label: string;
  /** Ce qu'il faut encore faire, en clair. */
  hint: string;
  icon: string;
  current: number;
  target: number;
  ratio: number;
}

/** Le prochain déblocage à afficher en permanence — celui dont le joueur est le
 *  PLUS PROCHE, toutes familles confondues : mue de membrane, slot de chantier,
 *  secteur de la carte, onglet. C'est le « next hero at wave 30 » de Grow Castle :
 *  aucune de ces données n'est nouvelle, seule leur mise en avant l'est. */
export function nextUnlock(state: GameState): NextUnlockView | null {
  const candidates: NextUnlockView[] = [];
  const built = builtOrganCount(state.buildings);

  // La prochaine mue de membrane — la plus belle animation du projet, enfin désirée.
  const nextStage = STAGE_MIN_BUILT.find((n) => n > built);
  if (nextStage !== undefined) {
    candidates.push({
      label: "Prochaine mue de membrane",
      hint: `${nextStage - built} organe${nextStage - built > 1 ? "s" : ""} avant la mue`,
      icon: "🧬",
      current: built,
      target: nextStage,
      ratio: built / nextStage,
    });
  }

  // Le prochain slot de chantier auxiliaire.
  const slot = nextSlotUnlock(state.buildings);
  if (slot) {
    candidates.push({
      label: slot.label,
      hint: `${slot.requiresBuilt - slot.built} organe${slot.requiresBuilt - slot.built > 1 ? "s" : ""} avant l'ouverture`,
      icon: "🏗️",
      current: slot.built,
      target: slot.requiresBuilt,
      ratio: slot.built / slot.requiresBuilt,
    });
  }

  // Le prochain secteur de La Dérive (seulement une fois la carte ouverte :
  // annoncer les Récifs à qui n'a pas encore vu la Zone photique serait du bruit).
  const sector = nextSectorUnlock(state.waveCount);
  if (sector && tabUnlocked(state, "derive")) {
    candidates.push({
      label: sector.name,
      hint: `s'ouvre au palier ${sector.unlock_palier} (vague ${state.waveCount})`,
      icon: "🧭",
      current: state.waveCount,
      target: sector.unlock_palier,
      ratio: state.waveCount / sector.unlock_palier,
    });
  }

  // Le prochain onglet verrouillé.
  const tab = GATED_TABS.find((t) => !tabUnlocked(state, t.id));
  if (tab) {
    const current = tabProgress(state, tab);
    candidates.push({
      label: `Onglet ${tab.name}`,
      hint: tabLockText(state, tab),
      icon: tab.icon,
      current,
      target: tab.target,
      ratio: current / tab.target,
    });
  }

  if (candidates.length === 0) return null;
  // Le plus proche d'aboutir gagne l'affichage ; à égalité, l'ordre ci-dessus
  // (mue avant slot avant secteur avant onglet) est l'ordre d'intérêt.
  return candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
}
