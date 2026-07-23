/* Types du GameState — Âge 1 : Cellule.
   Aucune valeur d'équilibrage ici : tout le tuning vient de src/data/economy_config.json. */

/** Ressources suivies par le moteur (les ressources "hors_perimetre" du JSON — combat,
 *  rubis, age — ne sont pas encore simulées). */
export type ResourceId =
  | "energie"
  | "vitalite"
  | "adn"
  | "proteine"
  | "biomasse"
  | "enzyme"
  | "lipide"
  | "signaux";

/** Les 12 bâtiments de l'Âge 1 (peche/defense/raid : designed=false, verrouillés "À venir"). */
export type BuildingId =
  | "noyau"
  | "membrane"
  | "adn"
  | "proteine"
  | "biomasse"
  | "enzyme"
  | "lipide"
  | "signaux"
  | "mutation"
  | "peche"
  | "defense"
  | "raid";

/** Slot unique de file de construction (règle stricte : 1 seul chantier à la fois). */
export interface BuildTask {
  buildingId: BuildingId;
  targetLevel: number;
  /** Timestamps réels (Date.now, ms). */
  startedAt: number;
  endsAt: number;
}

/** Identifiants des 5 habitudes réelles (repris du prototype v1). */
export type HabitId = "calories" | "steps" | "mf" | "alilou" | "rituals";

/** Saisie d'une journée calendaire (clé YYYY-MM-DD locale). Modifiable le jour même uniquement. */
export interface HabitDayEntry {
  /** kcal mangées ce jour. */
  calories: number;
  /** Journée calorique clôturée (déclare la saisie kcal définitive). */
  caloriesDone: boolean;
  /** Pas quotidiens. */
  steps: number;
  /** Tâches Magic Focus terminées. */
  mf: number;
  /** Tâches du chantier ALILOU. */
  alilou: number;
  /** Rituels bien-être. */
  rituals: number;
  /** Énergie déjà créditée pour ce jour (recalculée à chaque édition du jour même). */
  energy: number;
  /** Nombre d'habitudes validées (>=1 valide la journée pour le streak). */
  validatedCount: number;
}

export interface HabitsState {
  /** Historique complet, clé YYYY-MM-DD (timezone locale). */
  days: Record<string, HabitDayEntry>;
  /** Objectif calorique personnel du joueur (modifiable). */
  calorieGoal: number;
  /** Série en cours de jours consécutifs avec >=1 habitude validée. */
  streak: number;
  /** Dernier jour compté dans la série (YYYY-MM-DD) — null si série vide. */
  lastStreakDate: string | null;
  /** Meilleure série atteinte (stat). */
  bestStreak: number;
  /** Jalon (7/30/90) -> date de dernière attribution du bonus (anti re-farm le même jour). */
  milestoneAwards: Record<string, string>;
}

/** Profil du joueur (création simple en Phase 2, écran soigné en Phase 4). */
export interface Profile {
  portraitId: string;
  nomOrganisme: string;
  createdAt: number;
}

export interface GameState {
  /** Version du schéma de sauvegarde (migrations futures). */
  saveVersion: number;
  /** Stocks courants de ressources. */
  resources: Record<ResourceId, number>;
  /** Niveau de chaque bâtiment (0 = non construit ; noyau démarre à 1). */
  buildings: Record<BuildingId, number>;
  /** File de construction : un seul slot, null si libre. */
  buildQueue: BuildTask | null;
  /** Habitudes réelles -> Points d'énergie. */
  habits: HabitsState;
  /** Dernier tick appliqué (Date.now, ms) — 0 = jamais tické. */
  lastTick: number;
  /** Date de création de la sauvegarde. */
  createdAt: number;
  /** Profil (null tant que la création n'est pas faite). */
  profile: Profile | null;
}
