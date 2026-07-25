/* LES SORTIES — batailles lancées à la demande (25/07/2026).
   Module PUR : tout le tuning vient de src/data/bastion_config.json -> sorties.

   Ce que ça remplace : jusqu'ici une bataille ne se jouait que dans la fenêtre `lead_window_h`
   autour de la vague PLANIFIÉE (interval_h = 36..84 h). En clair : une bataille tous les deux
   jours, jamais au moment où l'on en a envie. Une sortie se lance quand on veut, contre le
   Bastion ou contre un foyer de La Dérive.

   Trois règles de conception, dans cet ordre d'importance :
   1. Le chemin AUTO ne bouge pas. `nextAttackAt`, `resolvePathogenWave` et les pénalités de
      `applyWaveOutcome` restent le filet de sécurité hors ligne. Une sortie ne touche jamais
      au calendrier : jouer beaucoup n'avance ni ne retarde la vague subie.
   2. Perdre une sortie est GRATUIT. Aucune ressource perdue, aucune garde tuée — on garde
      même une part de la monnaie de combat proportionnelle aux éliminations. C'est ce qui
      permet de retenter tout de suite, et c'est la leçon centrale de Grow Castle.
   3. Le frein n'est pas un timer, c'est la vie réelle. Au-delà du quota gratuit du jour, une
      sortie coûte de l'énergie — donc des habitudes réellement tenues. */

import { BASTION, type PerilDef, type PreparatifDef } from "./config";
import { dayKey } from "../habits";
import type { BastionState, SortieModifier } from "./types";

export const SORTIES = BASTION.sorties;

/** Les cinq crans de Péril, du plus calme au plus cataclysmique. */
export const PERILS: ReadonlyArray<PerilDef> = SORTIES.peril.levels;

/** Les préparatifs achetables en énergie juste avant de lancer. */
export const PREPARATIFS: ReadonlyArray<PreparatifDef> = SORTIES.preparatifs;

export function perilDef(level: number): PerilDef {
  return PERILS[Math.max(0, Math.min(PERILS.length - 1, Math.round(level)))];
}

export function maxPeril(): number {
  return PERILS.length - 1;
}

export function preparatifDef(id: string): PreparatifDef | undefined {
  return PREPARATIFS.find((p) => p.id === id);
}

/* ---------- Quota du jour ---------- */

/** Sorties déjà lancées aujourd'hui (0 si le compteur date d'un autre jour). */
export function sortiesUsedToday(b: BastionState, now: number): number {
  return b.sortieDay === dayKey(now) ? b.sortieCount : 0;
}

/** Sorties gratuites bonus valables aujourd'hui (accordées par le Bilan de la veille). */
export function bonusSortiesToday(b: BastionState, now: number): number {
  return b.bonusSortieDay === dayKey(now) ? Math.max(0, b.bonusSorties) : 0;
}

/** Quota gratuit du jour = quota de base + vestiges `free_sortie` + bonus du Bilan de la veille.
 *  Il se réinitialise TOUS LES JOURS, validé ou non : jamais de mur. */
export function freeSortiesToday(b: BastionState, now: number, vestigeFree = 0): number {
  return SORTIES.free_per_day + Math.max(0, vestigeFree) + bonusSortiesToday(b, now);
}

/** Coût en énergie de la prochaine sortie, 0 tant qu'il reste du gratuit.
 *  Courbe : cost_base * cost_growth^n sur les sorties payantes déjà faites (12, 19, 31, 49, 79…). */
export function nextSortieCost(b: BastionState, now: number, vestigeFree = 0): number {
  const used = sortiesUsedToday(b, now);
  const free = freeSortiesToday(b, now, vestigeFree);
  if (used < free) return 0;
  const paid = used - free;
  return Math.round(SORTIES.cost_base * Math.pow(SORTIES.cost_growth, paid));
}

/** Coût total en énergie d'une sortie : la sortie elle-même + les préparatifs choisis. */
export function totalSortieCost(
  b: BastionState,
  now: number,
  preparatifIds: string[],
  vestigeFree = 0,
): number {
  let cost = nextSortieCost(b, now, vestigeFree);
  for (const id of preparatifIds) cost += preparatifDef(id)?.cost_energie ?? 0;
  return cost;
}

export type SortieBlockReason = "quota" | "energie" | "bataille" | null;

export interface SortieAvailability {
  ok: boolean;
  reason: SortieBlockReason;
  /** Coût total en énergie (sortie + préparatifs). */
  cost: number;
  used: number;
  free: number;
  /** Sorties gratuites restantes aujourd'hui. */
  freeLeft: number;
  maxPerDay: number;
}

/** Peut-on lancer une sortie maintenant ? Réponse complète, prête pour l'affichage. */
export function sortieAvailability(
  b: BastionState,
  energie: number,
  now: number,
  preparatifIds: string[] = [],
  vestigeFree = 0,
): SortieAvailability {
  const used = sortiesUsedToday(b, now);
  const free = freeSortiesToday(b, now, vestigeFree);
  const cost = totalSortieCost(b, now, preparatifIds, vestigeFree);
  const base: Omit<SortieAvailability, "ok" | "reason"> = {
    cost,
    used,
    free,
    freeLeft: Math.max(0, free - used),
    maxPerDay: SORTIES.max_per_day,
  };
  if (b.liveBattleActive) return { ...base, ok: false, reason: "bataille" };
  if (used >= SORTIES.max_per_day) return { ...base, ok: false, reason: "quota" };
  if (energie < cost) return { ...base, ok: false, reason: "energie" };
  return { ...base, ok: true, reason: null };
}

/** Enregistre une sortie sur le compteur du jour (bascule le jour si besoin). */
export function consumeSortie(b: BastionState, now: number): void {
  const key = dayKey(now);
  if (b.sortieDay !== key) {
    b.sortieDay = key;
    b.sortieCount = 0;
  }
  b.sortieCount += 1;
}

/* ---------- Butin ---------- */

/** Multiplicateur de butin d'une sortie : Péril × préparatifs × vestiges `combat_mult`.
 *  Le Péril fait croître le butin PLUS VITE que le danger (×3,2 de butin pour ×3 de PV au
 *  cran 4) : monter le Péril est toujours le bon pari pour qui a la défense pour, et n'est
 *  jamais obligatoire pour les autres. */
export function sortieLootMult(
  peril: number,
  preparatifIds: string[] = [],
  combatBonus = 0,
  perceeMult = 1,
): number {
  let mult = perilDef(peril).loot_mult * perceeMult * (1 + Math.max(0, combatBonus));
  for (const id of preparatifIds) mult *= preparatifDef(id)?.loot_mult ?? 1;
  return mult;
}

/** Part du butin conservée sur une sortie perdue. Perdre ne coûte rien et paie quand même :
 *  c'est ce qui autorise à retenter immédiatement au lieu d'abandonner la session. */
export function defeatKeepRatio(): number {
  return SORTIES.defeat_combat_ratio;
}

/** Réapparitions offertes par les préparatifs achetés (préparatif « Renfort de garnison »). */
export function extraRespawns(preparatifIds: string[]): number {
  let n = 0;
  for (const id of preparatifIds) n += preparatifDef(id)?.extra_respawn ?? 0;
  return n;
}

/** Part des PV de la vague infligée d'entrée par la « Salve enzymatique » (0 si non achetée). */
export function openingDamageRatio(preparatifIds: string[]): number {
  let r = 0;
  for (const id of preparatifIds) r += preparatifDef(id)?.opening_damage_ratio ?? 0;
  return Math.min(0.9, r);
}

/** Chance de base de rapporter un fragment de carte sur une sortie gagnée. */
export function fragmentChance(): number {
  return SORTIES.fragment_chance;
}

/* ---------- Ce que la sortie change au COMBAT ---------- */

/** Traduit un Péril + des Préparatifs en un objet inerte consommé par le moteur
 *  (`initBattle`). C'est le seul pont entre le tuning de `bastion_config.json` et
 *  `engine.ts`, qui ne lit lui-même aucune valeur de sortie — le moteur reçoit des
 *  nombres, jamais des identifiants d'options.
 *
 *  Sans ça, le Péril ne serait qu'un multiplicateur de butin gratuit : le marché
 *  (plus de butin contre plus de danger) n'existe que si les deux moitiés sont
 *  appliquées, `sortieLootMult` pour le butin et celle-ci pour le danger. */
export function sortieModifier(peril: number, preparatifIds: string[] = []): SortieModifier {
  const p = perilDef(peril);
  return {
    hpMult: p.hp_mult,
    dmgMult: p.dmg_mult,
    extraBosses: p.extra_bosses,
    respawnWaves: extraRespawns(preparatifIds),
    openingDamageRatio: openingDamageRatio(preparatifIds),
  };
}

/** Modificateur neutre — une bataille sans sortie (défense planifiée classique). */
export function noSortieModifier(): SortieModifier {
  return { hpMult: 1, dmgMult: 1, extraBosses: 0, respawnWaves: 0, openingDamageRatio: 0 };
}

/* ---------- Réinitialisation d'une sortie ---------- */

/** Efface les paramètres de la sortie en cours (appelé après résolution ou abandon). */
export function clearSortie(b: BastionState): void {
  b.sortieTargetId = null;
  b.sortiePeril = 0;
  b.sortiePreparatifs = [];
  b.sortiePerceeId = null;
}
