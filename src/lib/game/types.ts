/* Types du GameState — Âge 1 : Cellule.
   Aucune valeur d'équilibrage ici : tout le tuning vient de src/data/economy_config.json. */

import type { BastionState } from "./bastion/types";

/** Ressources suivies par le moteur. `combat` ("Monnaie de combat") est simulée depuis
 *  l'intégration du mini-jeu Bastion-Défense (gagnée en vagues jouées, dépensée dans sa
 *  Boutique) — non plafonnée par le stockage cellulaire (cf. resourceCap), pas affichée au
 *  HUD principal. `rubis`/`age` restent hors périmètre (non simulées). */
export type ResourceId =
  | "energie"
  | "vitalite"
  | "adn"
  | "proteine"
  | "biomasse"
  | "enzyme"
  | "lipide"
  | "signaux"
  | "combat";

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

/** Un chantier en cours. Depuis la v8 la file compte plusieurs slots :
 *  slot 0 = chantier principal (accepte tout), slots 1+ = chantiers auxiliaires
 *  (limités aux chantiers courts, cf. economy_config.json → build_slots). */
export interface BuildTask {
  /** Index du slot occupé (0 = principal). */
  slot: number;
  buildingId: BuildingId;
  targetLevel: number;
  /** Timestamps réels (Date.now, ms). */
  startedAt: number;
  endsAt: number;
  /** Heures de chantier déjà rachetées en énergie (piste 4) — pour l'affichage et le plafond. */
  boostedMs: number;
}

/** Identifiants des 5 habitudes réelles (repris du prototype v1). */
export type HabitId = "calories" | "steps" | "mf" | "alilou" | "rituals";

/** Saisie d'une journée calendaire (clé YYYY-MM-DD locale). Modifiable le jour même uniquement. */
export interface HabitDayEntry {
  /** Bilan calorique du jour, en kcal (signé — négatif = déficit, positif = surplus). */
  calories: number;
  /** true dès que le bilan calorique du jour a été saisi (posé automatiquement). */
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
  /** Série en cours de jours consécutifs avec >=1 habitude validée.
   *  CACHE : la vérité est `days` (+ `graceDays`) — cf. computeStreak(). */
  streak: number;
  /** Jour (YYYY-MM-DD) pour lequel `streak` a été calculé. Le tick ne recalcule
   *  qu'au passage de minuit au lieu de rebalayer l'historique chaque seconde. */
  streakDay: string | null;
  /** Meilleure série atteinte (stat). */
  bestStreak: number;
  /** Palier de série (jours) -> date d'attribution du bonus. Un palier retombé
   *  est retiré de la table, donc redevenu gagnable (cf. settleStreakTiers). */
  streakAwards: Record<string, string>;
  /** Jours réparés par un « jour de grâce » — ils comptent comme validés pour
   *  la série mais ne rapportent aucune énergie (piste 6 : le filet de sécurité). */
  graceDays: string[];
  /** Mois calendaire (YYYY-MM) où le jour de grâce a déjà été consommé. */
  graceUsedMonth: string | null;
}

/** Profil du joueur (création simple en Phase 2, écran soigné en Phase 4). */
export interface Profile {
  portraitId: string;
  nomOrganisme: string;
  createdAt: number;
}

/* ---------- Couche militaire (Phase 5) ---------- */

/** Les 3 rôles d'unités recrutées au Noyau (tuning dans military_config.json). */
export type UnitId = "garde" | "sonde" | "phage";

/** Expédition en cours — snapshot de la destination au moment de l'envoi
 *  (les offres du jour changent, l'expédition partie reste figée). */
export interface Expedition {
  id: number;
  destId: string;
  destName: string;
  tier: number;
  /** Risque résolu (0..1) et difficulté résolue de l'offre. */
  risk: number;
  difficulty: number;
  /** Ressources ciblées par la destination. */
  rewards: string[];
  boostChance: number;
  squad: Record<UnitId, number>;
  startedAt: number;
  endsAt: number;
}

/** Entrée du journal de rapports (expéditions, vagues, événements). */
export interface Report {
  id: number;
  ts: number;
  type: "expedition" | "pathogene" | "evenement" | "chantier";
  title: string;
  lines: string[];
  success?: boolean;
}

/** Événement à choix en attente d'une décision du joueur. */
export interface PendingEvent {
  eventId: string;
  expiresAt: number;
}

/* ---------- La Mare & les cartes (Phase 6) ---------- */

/** Indices de rareté 0..5 (commune → mythique), cf. mare_config.json. */
export type RarityIndex = 0 | 1 | 2 | 3 | 4 | 5;

/** Entrée de collection d'une espèce : les doublons montent le niveau,
 *  la meilleure rareté pêchée habille la carte. */
export interface CardEntry {
  /** Nombre total de prises de cette espèce (niveaux via level_thresholds). */
  count: number;
  /** Meilleure rareté attrapée (0..5). */
  bestRarity: number;
  firstCaughtAt: number;
}

/** Affectation des cartes : passerelle pêche → couche militaire. */
export interface CardAssignments {
  defense: string[];
  expedition: string[];
}

/** Dernière prise (affichée par la modal de révélation, puis effacée). */
export interface LastCatch {
  speciesId: string;
  rarity: number;
  isNew: boolean;
  newBestRarity: boolean;
  level: number;
  leveledUp: boolean;
  /** Origine : "peche" ou "fragments". */
  source: "peche" | "fragments";
  /** Sommet atteint par le halo pendant la charge : > rarity = teasing de
   *  quasi-réussite (le halo monte trop haut puis retombe). Absent sur les
   *  sauvegardes antérieures à la piste 7 — l'UI retombe alors sur `rarity`. */
  teaseTo?: number;
}

/* ---------- La Dérive : la carte du monde (25/07/2026) ---------- */

/** État d'un foyer de la carte. Absent de `TerritoireState.foyers` = jamais touché.
 *  La DÉFINITION du foyer (nature, palier, position, bonus) vit dans
 *  src/data/territoire_config.json — ici on ne persiste que ce qui varie. */
export interface FoyerState {
  /** Horodatage de la prise (0 = jamais pris). */
  capturedAt: number;
  /** Niveau de développement, gisements uniquement (0..territoire_config.income.max_level). */
  dev: number;
  /** Nombre de passages, foyers répétables uniquement (l'abîme). */
  runs: number;
  /** ÉQUIPAGE DE RÉCOLTE (étape B) : les espèces postées à ce gisement, qui y
   *  travaillent à l'écran et augmentent son rendement. L'équipage appartient au
   *  LIEU, pas à la collection : il voyage donc avec TerritoireState, déjà persisté,
   *  et `cardAssignments` (défense / expédition) reste inchangé. Absent sur les
   *  sauvegardes < v14 — toujours lire via `crewOf()`, qui retombe sur []. */
  crew?: string[];
}

export interface TerritoireState {
  foyers: Record<string, FoyerState>;
  /** Dernier encaissement du revenu de territoire (ms) — le rattrapage est borné
   *  par territoire_config.income.offline_cap_h. */
  lastIncomeAt: number;
  /** Dernier secteur consulté (confort d'affichage, aucun effet de jeu). */
  lastSectorId: string;
}

/* ---------- Le Bilan du soir & les Percées (25/07/2026) ---------- */

/** Le rendez-vous de fin de journée. L'énergie des habitudes continue d'être créditée
 *  à la saisie (aucune régression sur la série ni sur le calibrage) : le Bilan ne
 *  redistribue rien, il TRANSFORME une bonne journée réelle en Percée. */
export interface BilanState {
  /** Dernier jour (clé YYYY-MM-DD) dont le Bilan a été validé — null = jamais. */
  lastDay: string | null;
  /** Percées en stock (plafonné par habits_config.json -> bilan.max_stock). */
  percees: number;
  /** Percées gagnées depuis le début (statistique, jamais décrémentée). */
  perceesTotal: number;
  /** Percées dépensées depuis le début (statistique). */
  perceesSpent: number;
}

/** Micro-tutoriel 3 étapes (Phase 4) :
 *  0 = valider une habitude · 1 = lancer une construction ·
 *  2 = comprendre le timer · 3 = terminé (TUTORIAL_DONE).
 *  Les sauvegardes antérieures à la Phase 4 migrent directement à 3. */
export const TUTORIAL_DONE = 3;

export interface GameState {
  /** Version du schéma de sauvegarde (migrations futures). */
  saveVersion: number;
  /** Étape du micro-tutoriel (cf. TUTORIAL_DONE). */
  tutorialStep: number;
  /** Stocks courants de ressources. */
  resources: Record<ResourceId, number>;
  /** Niveau de chaque bâtiment (0 = non construit ; noyau démarre à 1). */
  buildings: Record<BuildingId, number>;
  /** File de construction : un chantier par slot occupé (tableau vide = tout est libre). */
  buildQueue: BuildTask[];
  /** Habitudes réelles -> Points d'énergie. */
  habits: HabitsState;
  /** Dernier tick appliqué (Date.now, ms) — 0 = jamais tické. */
  lastTick: number;
  /** Date de création de la sauvegarde. */
  createdAt: number;
  /** Profil (null tant que la création n'est pas faite). */
  profile: Profile | null;

  /* ----- Couche militaire (Phase 5) ----- */
  /** Unités possédées (déployées comprises — le disponible se déduit des expéditions). */
  units: Record<UnitId, number>;
  /** Expéditions en cours (max : military_config.expeditions.max_concurrent). */
  expeditions: Expedition[];
  nextExpeditionId: number;
  /** Journal des rapports, plus récent en premier (plafonné). */
  reports: Report[];
  nextReportId: number;
  /** Dernière consultation des rapports (badge non-lus). */
  reportsSeenAt: number;
  /** Dernier jour (clé `dayKey`) où le joueur a ouvert le Noyau. Les 4 offres
   *  d'expédition sont retirées à chaque changement de jour (`dailyOffers` est
   *  seedée sur `dayKey`) mais rien ne l'annonçait — d'où un badge « nouvelles
   *  destinations » sur l'onglet NOYAU tant que la journée n'a pas été ouverte
   *  (piste 9b du diagnostic). `null` = jamais ouvert. */
  noyauSeenDay: string | null;
  /** Prochaine vague de pathogènes (ms) — 0 = à planifier au premier tick. */
  nextAttackAt: number;
  waveCount: number;
  /** Prochain événement aléatoire (ms) — 0 = à planifier au premier tick. */
  nextEventAt: number;
  pendingEvent: PendingEvent | null;
  /** Fragments de carte (8 fusionnent en une carte, rareté plancher Rare). */
  fragments: number;
  /** Graine du PRNG déterministe du moteur (avance à chaque tirage). */
  rngSeed: number;

  /* ----- La Mare & les cartes (Phase 6) ----- */
  /** Jetons de pêche (achetés en énergie, 1 par lancer). */
  jetons: number;
  /** Collection par espèce (62 espèces au 24/07, cf. mare_config.json). */
  collection: Record<string, CardEntry>;
  /** Cartes assignées en défense / expédition. */
  cardAssignments: CardAssignments;
  /** Dernière prise à révéler (null si déjà vue). */
  lastCatch: LastCatch | null;

  /* ----- Bastion-Défense jouable (intégration profonde, 24/07) ----- */
  bastion: BastionState;

  /* ----- La Dérive & le Bilan du soir (25/07) ----- */
  /** La carte du monde : foyers pris, développés, et l'horloge du revenu de territoire. */
  territoire: TerritoireState;
  /** Le rendez-vous de fin de journée et le stock de Percées. */
  bilan: BilanState;

  /* ----- Jalons & Points d'Âge (piste 3 du diagnostic UX) ----- */
  /** Ids des jalons déjà encaissés — la SEULE chose que le système persiste :
   *  chaque condition est une fonction pure de l'état, rien d'autre à compter.
   *  Voir src/data/milestones_config.json et src/lib/game/milestones.ts. */
  claimedMilestones: string[];
}
