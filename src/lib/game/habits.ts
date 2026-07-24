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

import type { HabitDayEntry, HabitId } from "./types";

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

/** Jalons de série (jours consécutifs avec ≥1 habitude validée) → bonus d'énergie immédiat.
 *  Valeurs volontairement douces (choix Phase 2) :
 *  - 7 j  : +50 ⚡  (~une demi-journée parfaite)
 *  - 30 j : +200 ⚡ (~deux journées parfaites)
 *  - 90 j : +500 ⚡ (~une semaine parfaite — clôture de l'Âge 1) */
export const STREAK_MILESTONES: ReadonlyArray<{ days: number; energy: number }> = [
  { days: 7, energy: 50 },
  { days: 30, energy: 200 },
  { days: 90, energy: 500 },
];

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
