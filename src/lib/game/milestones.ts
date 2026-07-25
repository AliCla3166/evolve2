/* Jalons de l'Âge 1 & Points d'Âge — moteur pur (piste 3 du diagnostic UX,
   dette PLAN.md §5.8).

   Le module ne contient AUCUNE valeur d'équilibrage : tout vient de
   src/data/milestones_config.json. Chaque jalon se mesure par une fonction pure
   de l'état — rien de nouveau à compter, rien de nouveau à persister à part la
   liste des jalons déjà réclamés.

   Pourquoi « réclamer » plutôt qu'attribuer automatiquement : le tap qui
   encaisse est le geste gratifiant. Un jalon qui se paie tout seul dans le dos
   du joueur ne produit aucun souvenir — et c'est justement de repères que la
   progression manquait. */

import rawConfig from "@/data/milestones_config.json";
import { BUILDING_ORDER, isDesigned, stateResourceCap } from "./economy";
import { SPECIES_IDS } from "./cards";
import { ENERGY_CAP } from "./habits";
import type { BuildingId, GameState, ResourceId } from "./types";

export interface MilestoneConfig {
  id: string;
  category: "croissance" | "collection" | "discipline" | "expansion" | "defense" | "ascension";
  label: string;
  hint: string;
  metric: string;
  /** Cible d'un bâtiment précis, pour metric === "building_level". */
  param?: string;
  target?: number;
  /** Cible dérivée d'une autre config (ex. le nombre total d'espèces). */
  target_metric?: string;
  age_points: number;
  /** Récompense : ids de ressources, plus les deux monnaies hors ressources. */
  reward: Record<string, number>;
}

interface MilestonesConfig {
  age: string;
  ui: { near_ratio: number };
  milestones: MilestoneConfig[];
}

export const MILESTONES_CFG = rawConfig as unknown as MilestonesConfig;
export const MILESTONES: MilestoneConfig[] = MILESTONES_CFG.milestones;

/** Total de Points d'Âge que vaut l'Âge 1 — l'horizon des 90 jours, chiffré. */
export const TOTAL_AGE_POINTS = MILESTONES.reduce((sum, m) => sum + m.age_points, 0);

/** Seuil du « tu y es presque » (config). */
export const NEAR_RATIO = MILESTONES_CFG.ui.near_ratio;

/** Bâtiments réellement conçus (les 3 mini-jeux ne comptent pas dans « tout Nv N »). */
const DESIGNED_BUILDINGS: BuildingId[] = BUILDING_ORDER.filter(isDesigned);

/** Cibles dérivées d'autres configs — évite qu'un jalon se désynchronise
 *  quand le contenu grandit (le bestiaire est passé de 42 à 62 espèces). */
const DERIVED_TARGETS: Record<string, () => number> = {
  species_total: () => SPECIES_IDS.length,
};

/** Valeur visée par un jalon (littérale ou dérivée). */
export function milestoneTarget(m: MilestoneConfig): number {
  if (m.target_metric) {
    const fn = DERIVED_TARGETS[m.target_metric];
    if (fn) return fn();
  }
  return m.target ?? 1;
}

/** Avancement courant d'un jalon — fonction PURE de l'état, jamais d'un compteur dédié. */
export function milestoneProgress(state: GameState, m: MilestoneConfig): number {
  switch (m.metric) {
    case "built_organs":
      return DESIGNED_BUILDINGS.filter((b) => b !== "noyau" && (state.buildings[b] ?? 0) > 0).length;
    case "min_building_level":
      return DESIGNED_BUILDINGS.reduce(
        (min, b) => Math.min(min, state.buildings[b] ?? 0),
        Number.POSITIVE_INFINITY,
      );
    case "building_level":
      return state.buildings[(m.param ?? "noyau") as BuildingId] ?? 0;
    case "species_collected":
      return Object.keys(state.collection).length;
    case "cards_caught":
      return Object.values(state.collection).reduce((n, e) => n + e.count, 0);
    case "mythic_species":
      return Object.values(state.collection).filter((e) => e.bestRarity >= 5).length;
    case "streak":
      return state.habits.streak;
    case "expeditions_sent":
      // nextExpeditionId est monotone : c'est déjà le compteur d'expéditions
      // jamais remis à zéro (les expéditions terminées quittent le tableau).
      return Math.max(0, state.nextExpeditionId - 1);
    case "waves_survived":
      return state.waveCount;
    case "bastion_waves":
      // liveWaveCount = vagues JOUÉES en direct (waveCount, côté militaire,
      // compte aussi les auto-résolutions offline — ce jalon récompense le fait
      // de venir défendre soi-même, pas de laisser le moteur trancher).
      return state.bastion?.liveWaveCount ?? 0;
    default:
      return 0;
  }
}

export interface MilestoneView {
  cfg: MilestoneConfig;
  current: number;
  target: number;
  /** 0..1, borné. */
  ratio: number;
  achieved: boolean;
  claimed: boolean;
}

export function milestoneView(state: GameState, m: MilestoneConfig): MilestoneView {
  const target = milestoneTarget(m);
  const raw = milestoneProgress(state, m);
  const current = Number.isFinite(raw) ? raw : 0;
  return {
    cfg: m,
    current,
    target,
    ratio: Math.max(0, Math.min(1, current / Math.max(1, target))),
    achieved: current >= target,
    claimed: state.claimedMilestones.includes(m.id),
  };
}

/** Tous les jalons, dans l'ordre du fichier de config. */
export function allMilestones(state: GameState): MilestoneView[] {
  return MILESTONES.map((m) => milestoneView(state, m));
}

/** Points d'Âge acquis (somme des jalons réclamés). */
export function agePoints(state: GameState): number {
  return MILESTONES.filter((m) => state.claimedMilestones.includes(m.id)).reduce(
    (sum, m) => sum + m.age_points,
    0,
  );
}

/** Nombre de jalons atteints mais pas encore réclamés (badge). */
export function claimableCount(state: GameState): number {
  return allMilestones(state).filter((v) => v.achieved && !v.claimed).length;
}

/** Quel jalon montrer dans le bandeau ? Trois règles, dans cet ordre :
 *
 *  1. Un jalon À ENCAISSER passe avant tout le reste — une récompense en attente
 *     est le meilleur appel à l'action dont dispose le jeu. Entre plusieurs, le
 *     moins richement doté d'abord : on garde le gros morceau pour la fin, la
 *     séquence monte au lieu de retomber.
 *  2. Sinon, un jalon SUR LE POINT d'aboutir (ratio >= near_ratio) : on ne cache
 *     jamais une victoire imminente derrière un objectif plus « logique ».
 *  3. Sinon, le PREMIER jalon non réclamé dans l'ordre du fichier de config —
 *     cet ordre EST la courbe de difficulté voulue.
 *
 *  Pourquoi pas simplement « le plus proche d'aboutir » : sur une partie neuve,
 *  le Noyau démarre à Nv1/5, donc « Noyau primordial achevé » affichait 20 % et
 *  raflait la mise — le tout premier objectif montré au joueur était un jalon de
 *  milieu de partie, pendant que le tutoriel lui demandait de bâtir un organe. */
export function focusMilestone(state: GameState): MilestoneView | null {
  const open = allMilestones(state).filter((v) => !v.claimed);
  if (open.length === 0) return null;

  const ready = open.filter((v) => v.achieved);
  if (ready.length > 0) {
    return ready.reduce((a, b) => (a.cfg.age_points <= b.cfg.age_points ? a : b));
  }

  const near = open.filter((v) => v.ratio >= NEAR_RATIO);
  if (near.length > 0) {
    return near.reduce((a, b) => (a.ratio >= b.ratio ? a : b));
  }

  return open[0];
}

/** Les récompenses qui ne sont pas des ressources (jetons de pêche, fragments). */
export const NON_RESOURCE_REWARDS = ["jetons", "fragments"] as const;

export function isResourceReward(key: string): key is ResourceId {
  return !(NON_RESOURCE_REWARDS as readonly string[]).includes(key);
}

/** Libellé lisible d'une récompense hors ressources. */
export function rewardLabel(key: string): string {
  if (key === "jetons") return "jeton(s) de pêche";
  if (key === "fragments") return "fragment(s) de carte";
  return key;
}

/** Applique une récompense de jalon à un DRAFT d'état (mutation en place, même
 *  contrat que les helpers de military.ts). Les ressources restent écrêtées par
 *  le stockage : un jalon ne doit jamais servir de dépassement de plafond, sinon
 *  le Noyau — qui porte tout le stockage — perdrait sa raison d'être. */
export function applyMilestoneReward(state: GameState, reward: Record<string, number>): void {
  for (const [key, amount] of Object.entries(reward)) {
    if (amount <= 0) continue;
    if (key === "jetons") {
      state.jetons += amount;
    } else if (key === "fragments") {
      state.fragments += amount;
    } else if (isResourceReward(key) && state.resources[key] !== undefined) {
      const cap = key === "energie" ? ENERGY_CAP : stateResourceCap(state, key);
      state.resources[key] = Math.min(cap, state.resources[key] + amount);
    }
  }
}
