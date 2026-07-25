/* Habitudes réelles -> Points d'énergie.
   Barème repris du prototype v1 (bloc HABITS de index.html) : ce sont des règles
   de gameplay "habitudes", pas du tuning économique (le JSON d'économie ne les
   couvre pas — l'énergie y est déclarée kind: "externe_habitude").

   Règles v1 conservées (retouchées sur demande utilisateur pour le bilan
  calorique — plus simple à saisir) :
   - Bilan calorique   : une seule valeur signée (négatif = déficit, positif =
     surplus), au clavier ou par crans de 100 kcal. Négatif ou nul => +5 ⚡.
     Positif => -1 ⚡ par tranche de 100 kcal de surplus.
   - Pas quotidiens    : +1 ⚡ par tranche de 1000 pas, plafonné à 15 ⚡.
   - Magic Focus       : +3 ⚡ par tâche, max 10 tâches/jour.
   - Chantier ALILOU   : +5 ⚡ par tâche, max 3/jour.
   - Rituels bien-être : +5 ⚡ par rituel, max 5/jour.
   Journée parfaite = 5/5 habitudes validées => max 10+15+30+15+25 = 95 ⚡/jour.

   Anti-triche : une saisie par jour calendaire (clé YYYY-MM-DD en timezone
   locale), modifiable uniquement le jour même — le store refuse toute écriture
   sur une autre clé que celle du jour courant. */

import rawHabitsConfig from "@/data/habits_config.json";
import type { HabitDayEntry, HabitId, HabitsState } from "./types";

/* ---------- Définition des 5 habitudes ---------- */

export interface HabitDef {
  id: HabitId;
  icon: string;
  name: string;
  desc: string;
  type: "calorie" | "rate" | "count";
  /** calorie : énergie du jour si validée. */
  energyPerDay?: number;
  /** rate : taille de tranche, énergie par tranche, plafond d'énergie. */
  per?: number;
  energyPer?: number;
  capEnergy?: number;
  step?: number;
  max?: number;
  /** count : nb max d'items par jour. */
  capItems?: number;
  unit?: string;
}

export const HABITS: HabitDef[] = [
  {
    id: "calories",
    icon: "🍽️",
    name: "Bilan calorique",
    desc: "Indique ton solde du jour (négatif = déficit). Déficit : +5 ⚡. Surplus : −1 ⚡ par 100 kcal.",
    type: "calorie",
    energyPerDay: 5,
  },
  {
    id: "steps",
    icon: "🚶",
    name: "Pas quotidiens",
    desc: "+1 ⚡ par tranche de 1000 pas (max 15 ⚡).",
    type: "rate",
    per: 1000,
    energyPer: 1,
    capEnergy: 15,
    step: 500,
    max: 30000,
    unit: "pas",
  },
  {
    id: "mf",
    icon: "💼",
    name: "Tâches Magic Focus",
    desc: "+3 ⚡ par tâche terminée (max 10/jour).",
    type: "count",
    energyPer: 3,
    capItems: 10,
    unit: "tâches",
  },
  {
    id: "alilou",
    icon: "🏗️",
    name: "Chantier ALILOU",
    desc: "+5 ⚡ par tâche de chantier (max 3/jour). Grosse valeur.",
    type: "count",
    energyPer: 5,
    capItems: 3,
    unit: "tâches",
  },
  {
    id: "rituals",
    icon: "🧘",
    name: "Rituels bien-être",
    desc: "Lire, méditer, marcher, se poser… +5 ⚡ par rituel (max 5/jour).",
    type: "count",
    energyPer: 5,
    capItems: 5,
    unit: "rituels",
  },
];

/* ---------- Constantes énergie & streaks ---------- */

/** Cap élevé de la ressource énergie : ~3 mois de journées parfaites (95 ⚡ × 90 j ≈ 8550).
 *  L'énergie n'est pas soumise au stockage cellulaire du JSON (kind externe_habitude). */
export const ENERGY_CAP = 9999;

/* ---------- Série : paliers hebdomadaires, grâce, historique ----------
   Tout le tuning vit dans src/data/habits_config.json — c'est la MÊME table que
   lit le simulateur d'équilibrage (tools/economy/simulate_full.py), donc le TS
   et le Python ne peuvent pas diverger. */

interface StreakTier {
  days: number;
  energy: number;
}

/** Une option achetable avec une Percée au Bilan du soir. Les champs optionnels
 *  ne concernent que certaines options (cf. habits_config.json -> bilan.options). */
export interface BilanOptionDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  cost: number;
  /** « Vague de Percée » : paliers ajoutés à la vague jouée. */
  palier_bonus?: number;
  /** « Vague de Percée » : cran de Péril imposé. */
  forced_peril?: number;
  /** « Vague de Percée » : multiplicateur de butin supplémentaire. */
  loot_mult?: number;
  /** « Vague de Percée » : fragments de carte garantis. */
  fragments?: number;
  /** « Poussée de croissance » : heures de production offertes d'un coup. */
  production_hours?: number;
}

interface HabitsConfig {
  streak: {
    tiers: StreakTier[];
    grace: { per_month: number; max_age_days: number };
    history_days: number;
  };
  bilan: {
    min_hour: number;
    catchup_until_hour: number;
    threshold_energy: number;
    max_stock: number;
    bonus_sorties_next_day: number;
    percee_per_streak_tier: number;
    options: BilanOptionDef[];
  };
}

export const HABITS_CFG = rawHabitsConfig as unknown as HabitsConfig;

/** Paliers de série (jours consécutifs avec ≥1 habitude validée) → bonus d'énergie.
 *  Un palier par semaine : la régularité doit accuser réception chaque semaine,
 *  pas trois fois en trois mois. */
export const STREAK_TIERS: ReadonlyArray<StreakTier> = HABITS_CFG.streak.tiers;

/** Un jour de grâce par mois calendaire, sur un oubli de moins de N jours. */
export const STREAK_GRACE = HABITS_CFG.streak.grace;

/** Nombre de cases de la grille d'historique (= durée de l'Âge 1). */
export const HISTORY_DAYS = HABITS_CFG.streak.history_days;

/** Réglages du Bilan du soir (le rendez-vous quotidien qui délivre les Percées). */
export const BILAN = HABITS_CFG.bilan;

/** Les trois emplois possibles d'une Percée. */
export const BILAN_OPTIONS: ReadonlyArray<BilanOptionDef> = HABITS_CFG.bilan.options;

export function bilanOptionDef(id: string): BilanOptionDef | undefined {
  return BILAN_OPTIONS.find((o) => o.id === id);
}

/** Énergie totale que vaut une série parfaite de 90 jours (affiché dans l'UI). */
export const TOTAL_STREAK_ENERGY = STREAK_TIERS.reduce((sum, t) => sum + t.energy, 0);

/** Prochain palier à viser (null quand tout est atteint). */
export function nextStreakTier(streak: number): StreakTier | null {
  return STREAK_TIERS.find((t) => t.days > streak) ?? null;
}

/** Palier le plus haut déjà franchi (null avant le premier). */
export function currentStreakTier(streak: number): StreakTier | null {
  let best: StreakTier | null = null;
  for (const t of STREAK_TIERS) if (streak >= t.days) best = t;
  return best;
}

/** Bornes de saisie (mêmes ordres de grandeur que le prototype v1). */
export const CALORIE_INPUT_MAX = 6000;
export const CALORIE_GOAL_MIN = 800;
export const CALORIE_GOAL_MAX = 6000;

/** Bilan calorique (retouche lisibilité) : une seule valeur signée en kcal,
 *  saisie au clavier ou par crans — négatif = déficit, positif = surplus. */
export const CALORIE_DELTA_MIN = -3000;
export const CALORIE_DELTA_MAX = 3000;
export const CALORIE_STEP = 100;

/* ---------- Clés de jour calendaire (timezone locale) ---------- */

/** Clé YYYY-MM-DD du jour local pour un timestamp donné. */
export function dayKey(nowMs: number): string {
  const d = new Date(nowMs);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Décale une clé YYYY-MM-DD de n jours (calendrier local). */
export function addDaysToKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d + n);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** Mois calendaire d'une clé de jour (« 2026-07-24 » → « 2026-07 »). */
export function monthKey(key: string): string {
  return key.slice(0, 7);
}

/** Indice du jour de la semaine, lundi = 0 (pour aligner la grille d'historique). */
export function weekdayIndex(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/* ---------- Série : moteur pur, DÉRIVÉ de l'historique ----------
   Avant la piste 6, la série était tenue en comptabilité incrémentale
   (« si hier était le dernier jour compté, alors +1 »). Ça marchait, mais ça
   rendait impossible tout ce que le diagnostic demandait : un jour de grâce
   rétroactif et une grille de 90 cases exigent de pouvoir RELIRE le passé, pas
   seulement un compteur. On recalcule donc la série à partir des jours saisis —
   la seule source de vérité — et le compteur stocké n'est plus qu'un cache. */

/** Ce jour-là compte-t-il dans la série ? (≥1 habitude validée, ou jour réparé) */
export function dayHoldsStreak(
  days: Record<string, HabitDayEntry>,
  graceDays: ReadonlySet<string>,
  key: string,
): boolean {
  return (days[key]?.validatedCount ?? 0) > 0 || graceDays.has(key);
}

/** Garde-fou : on ne remonte jamais plus loin que 10 ans d'historique. */
const MAX_STREAK_SCAN = 3660;

/** Longueur de la série au jour `todayKey`, remontée depuis l'historique.
 *
 *  Subtilité qui compte : si la journée en cours n'est pas encore validée, on
 *  part de la VEILLE. Une série ne se casse pas à 00 h 01 — le joueur a jusqu'à
 *  minuit pour saisir, donc tant que la journée court, elle ne peut pas
 *  compter comme un échec. */
export function computeStreak(
  days: Record<string, HabitDayEntry>,
  graceDays: readonly string[],
  todayKey: string,
): number {
  const grace = new Set(graceDays);
  let cursor = dayHoldsStreak(days, grace, todayKey) ? todayKey : addDaysToKey(todayKey, -1);
  let n = 0;
  while (n < MAX_STREAK_SCAN && dayHoldsStreak(days, grace, cursor)) {
    n += 1;
    cursor = addDaysToKey(cursor, -1);
  }
  return n;
}

/** Le jour de grâce est-il encore disponible ce mois-ci ? */
export function graceAvailable(habits: HabitsState, todayKey: string): boolean {
  if (STREAK_GRACE.per_month <= 0) return false;
  return habits.graceUsedMonth !== monthKey(todayKey);
}

/** Quel jour un jour de grâce pourrait-il réparer ? `null` si rien à réparer.
 *
 *  Trois conditions, toutes nécessaires : l'oubli remonte à moins de
 *  `max_age_days` jours, il ne concerne qu'UNE journée isolée, et la veille de
 *  cette journée tenait la série. Autrement dit la grâce ne sert qu'à recoller
 *  une chaîne réelle — elle ne fabrique pas une série à partir de rien, et on
 *  ne laisse pas le joueur gâcher sa seule réparation du mois sur un trou
 *  qu'elle ne bouchera pas. */
export function repairableDay(habits: HabitsState, todayKey: string): string | null {
  if (!graceAvailable(habits, todayKey)) return null;
  const grace = new Set(habits.graceDays);
  for (let age = 1; age <= STREAK_GRACE.max_age_days; age++) {
    const key = addDaysToKey(todayKey, -age);
    if (dayHoldsStreak(habits.days, grace, key)) continue; // ce jour-là tient déjà
    // Premier trou trouvé : réparable seulement s'il est isolé.
    const before = addDaysToKey(key, -1);
    return dayHoldsStreak(habits.days, grace, before) ? key : null;
  }
  return null;
}

/** Solde les paliers de série : verse ceux qui viennent d'être franchis, rouvre
 *  ceux qui sont retombés. Renvoie la nouvelle table et le delta d'énergie.
 *
 *  Un palier redevient gagnable après une rupture — c'est volontaire : le
 *  re-farm coûte alors sept jours pleins, et comme la table MONTE, casser sa
 *  série pour re-encaisser le palier 1 est toujours perdant. On ne reprend
 *  l'énergie que si le palier a été payé le jour même (le joueur annule une
 *  saisie du jour) : reprendre un bonus versé il y a trois semaines serait du
 *  vol pur et simple. */
export function settleStreakTiers(
  awards: Record<string, string>,
  streak: number,
  todayKey: string,
): { awards: Record<string, string>; energyDelta: number } {
  const next = { ...awards };
  let energyDelta = 0;
  for (const t of STREAK_TIERS) {
    const k = String(t.days);
    if (streak >= t.days) {
      if (!next[k]) {
        next[k] = todayKey;
        energyDelta += t.energy;
      }
    } else if (next[k]) {
      if (next[k] === todayKey) energyDelta -= t.energy;
      delete next[k];
    }
  }
  return { awards: next, energyDelta };
}

/* ---------- Calculs d'énergie ---------- */

export function emptyDayEntry(): HabitDayEntry {
  return {
    calories: 0,
    caloriesDone: false,
    steps: 0,
    mf: 0,
    alilou: 0,
    rituals: 0,
    energy: 0,
    validatedCount: 0,
  };
}

/** Énergie rapportée par une habitude pour une saisie donnée (barème v1,
 *  bilan calorique retouché : cf. commentaire d'en-tête). Le paramètre
 *  `calorieGoal` n'est plus utilisé par le type "calorie" (conservé dans la
 *  signature pour ne pas casser les appelants existants). */
export function habitEnergy(
  def: HabitDef,
  entry: HabitDayEntry,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- conservé pour compat d'appel
  calorieGoal: number,
): number {
  switch (def.type) {
    case "calorie": {
      // caloriesDone sert désormais de flag "saisi aujourd'hui" (posé
      // automatiquement dès que la valeur est modifiée — plus de bouton
      // "Valider" séparé) : une journée jamais touchée ne rapporte rien.
      if (!entry.caloriesDone) return 0;
      return entry.calories <= 0
        ? (def.energyPerDay ?? 5)
        : -Math.floor(entry.calories / (CALORIE_STEP || 1));
    }
    case "rate": {
      const raw = Math.floor(entry.steps / (def.per ?? 1)) * (def.energyPer ?? 0);
      return Math.min(raw, def.capEnergy ?? Infinity);
    }
    case "count": {
      const count = Math.min(entry[def.id as "mf" | "alilou" | "rituals"], def.capItems ?? Infinity);
      return count * (def.energyPer ?? 0);
    }
  }
}

/** Une habitude est "validée" si elle rapporte au moins un point (ou est cochée). */
export function habitValidated(
  def: HabitDef,
  entry: HabitDayEntry,
  calorieGoal: number,
): boolean {
  if (def.type === "calorie") return habitEnergy(def, entry, calorieGoal) > 0;
  return entry[def.id as "steps" | "mf" | "alilou" | "rituals"] > 0;
}

/** Énergie totale + nb d'habitudes validées d'une saisie. */
export function evaluateEntry(
  entry: HabitDayEntry,
  calorieGoal: number,
): { energy: number; validatedCount: number } {
  let energy = 0;
  let validatedCount = 0;
  for (const def of HABITS) {
    energy += habitEnergy(def, entry, calorieGoal);
    if (habitValidated(def, entry, calorieGoal)) validatedCount += 1;
  }
  return { energy, validatedCount };
}

/** Clamp une valeur d'habitude dans ses bornes de saisie. */
export function clampHabitValue(id: HabitId, value: number): number {
  const def = HABITS.find((h) => h.id === id)!;
  // Bilan calorique : seul type qui accepte une valeur négative (déficit).
  if (def.type === "calorie") {
    return Math.min(CALORIE_DELTA_MAX, Math.max(CALORIE_DELTA_MIN, Math.round(value)));
  }
  const v = Math.max(0, Math.round(value));
  if (def.type === "rate") return Math.min(v, def.max ?? v);
  return Math.min(v, def.capItems ?? v);
}
