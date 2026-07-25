/* LE BILAN DU SOIR (25/07/2026).
   Module PUR : tout le réglage vient de src/data/habits_config.json -> bilan.

   Ce qu'il apporte, et pourquoi. L'énergie des habitudes était déjà créditée en continu, à la
   saisie — ça ne change pas d'un iota (aucune régression sur la série, le simulateur de rythme
   ou le rachat d'heures). Ce qui manquait, c'était un RENDEZ-VOUS : un geste de fin de journée
   qui transforme une bonne journée réelle en un événement de jeu. C'est le rôle du Bilan.

   La PERCÉE est la monnaie de ce rendez-vous : rare (une par journée au-dessus du seuil, stock
   plafonné) et spectaculaire (une vague hors norme, un antre, une poussée de production). Règle
   de conception non négociable : aucune option n'achète du temps de CHANTIER, parce que le
   chantier représente plus de 96 % du chemin critique des 90 jours (cf. economy_config.json ->
   pacing_validation). Les nouveaux systèmes amplifient la journée, ils ne raccourcissent jamais
   l'Âge 1.

   Ce module n'importe ni economy.ts ni military.ts : il ne lit et n'écrit que `state.bilan`,
   `state.habits` et les compteurs de sortie du Bastion. */

import {
  addDaysToKey,
  BILAN,
  bilanOptionDef,
  dayKey,
  evaluateEntry,
  STREAK_TIERS,
  type BilanOptionDef,
} from "./habits";
import type { GameState } from "./types";

/** Jour dont le Bilan est actuellement à l'ordre du jour.
 *  Avant `catchup_until_hour` le matin, c'est encore celui de la VEILLE : un coucher à 1 h du
 *  matin ne doit pas coûter le rendez-vous. */
export function bilanTargetDay(now: number): string {
  const hour = new Date(now).getHours();
  const today = dayKey(now);
  return hour < BILAN.catchup_until_hour ? addDaysToKey(today, -1) : today;
}

/** Énergie réellement gagnée sur un jour donné (0 si le jour n'a pas été saisi). */
export function bilanDayEnergy(state: GameState, day: string): number {
  const entry = state.habits.days[day];
  if (!entry) return 0;
  return evaluateEntry(entry, state.habits.calorieGoal).energy;
}

export type BilanBlockReason =
  | "trop_tot"
  | "deja_fait"
  | "seuil"
  | "stock_plein"
  | null;

export interface BilanStatus {
  /** Jour concerné par le Bilan proposé. */
  day: string;
  /** Le joueur est-il dans la fenêtre de rattrapage du matin ? */
  catchup: boolean;
  ok: boolean;
  reason: BilanBlockReason;
  energy: number;
  threshold: number;
  /** Percées qui seraient accordées (1, +1 si la journée pose un palier de série). */
  reward: number;
  percees: number;
  maxStock: number;
  bonusSorties: number;
}

/** État complet du Bilan, prêt à afficher — une seule source pour l'UI et pour l'action. */
export function bilanStatus(state: GameState, now: number): BilanStatus {
  const day = bilanTargetDay(now);
  const hour = new Date(now).getHours();
  const catchup = hour < BILAN.catchup_until_hour;
  const energy = bilanDayEnergy(state, day);
  const reward = bilanReward(state);
  const base: Omit<BilanStatus, "ok" | "reason"> = {
    day,
    catchup,
    energy,
    threshold: BILAN.threshold_energy,
    reward,
    percees: state.bilan.percees,
    maxStock: BILAN.max_stock,
    bonusSorties: BILAN.bonus_sorties_next_day,
  };
  if (state.bilan.lastDay === day) return { ...base, ok: false, reason: "deja_fait" };
  if (!catchup && hour < BILAN.min_hour) return { ...base, ok: false, reason: "trop_tot" };
  if (energy < BILAN.threshold_energy) return { ...base, ok: false, reason: "seuil" };
  if (state.bilan.percees >= BILAN.max_stock) return { ...base, ok: false, reason: "stock_plein" };
  return { ...base, ok: true, reason: null };
}

/** Percées accordées par un Bilan : une, plus une prime le jour où la série pose un palier.
 *  C'est le seul endroit où la régularité longue paie en Percées plutôt qu'en énergie. */
export function bilanReward(state: GameState): number {
  const onTier = STREAK_TIERS.some((t) => t.days === state.habits.streak);
  return 1 + (onTier ? BILAN.percee_per_streak_tier : 0);
}

/** Valide le Bilan du jour visé. Suppose `bilanStatus(...).ok` — mutation d'un draft.
 *  Renvoie le nombre de Percées effectivement créditées (0 si le plafond mordait déjà). */
export function validateBilan(state: GameState, now: number): number {
  const day = bilanTargetDay(now);
  const reward = bilanReward(state);
  const before = state.bilan.percees;
  const after = Math.min(BILAN.max_stock, before + reward);
  const gained = after - before;

  state.bilan.lastDay = day;
  state.bilan.percees = after;
  state.bilan.perceesTotal += gained;

  // Les sorties gratuites se réinitialisent tous les jours quoi qu'il arrive : ce bonus est
  // une carotte pour le lendemain, jamais un bâton pour aujourd'hui.
  state.bastion.bonusSortieDay = addDaysToKey(day, 1);
  state.bastion.bonusSorties = BILAN.bonus_sorties_next_day;

  return gained;
}

/* ---------- Dépense d'une Percée ---------- */

export function canSpendPercee(state: GameState, optionId: string): boolean {
  const opt = bilanOptionDef(optionId);
  if (!opt) return false;
  return state.bilan.percees >= opt.cost;
}

/** Débite le coût d'une option. L'EFFET de l'option est appliqué par l'appelant
 *  (store/military) : ce module ne connaît ni le Bastion ni La Dérive. */
export function spendPercee(state: GameState, optionId: string): BilanOptionDef | null {
  const opt = bilanOptionDef(optionId);
  if (!opt || state.bilan.percees < opt.cost) return null;
  state.bilan.percees -= opt.cost;
  state.bilan.perceesSpent += opt.cost;
  return opt;
}

/** Réglages de la « Vague de Percée » (option qui pilote une sortie hors norme). */
export function perceeWaveOption(): BilanOptionDef | undefined {
  return bilanOptionDef("vague_percee");
}
