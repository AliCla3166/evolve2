/* Économie de l'Âge 1 — lecture typée de src/data/economy_config.json (SOURCE DE VÉRITÉ).
   Toutes les fonctions sont pures et dérivent chaque valeur du JSON :
   aucun nombre d'équilibrage en dur dans ce fichier. */

import rawConfig from "@/data/economy_config.json";
import type { BuildingId, GameState, ResourceId } from "./types";

/* ---------- Typage de la structure réelle du JSON ---------- */

export interface LevelConfig {
  unlocked_at_start: boolean;
  build_time_hours: number;
  cost: Record<string, number>;
  production_per_hour?: Record<string, number>;
}

export interface BuildingConfig {
  name: string;
  family: string;
  role: "meta" | "support" | "producer" | "sink" | "minigame_gate";
  designed: boolean;
  note?: string;
  total_time_budget_hours?: number;
  cost_recipe_resources?: string[];
  sprite_levels: Record<string, string>;
  /** Clés "1".."5" — vide ({}) pour les bâtiments designed=false. */
  levels: Record<string, LevelConfig>;
}

export interface ResourceConfig {
  name: string;
  kind: string;
  spendable_on_buildings: boolean;
  producer?: string;
  note?: string;
}

export interface EconomyConfig {
  age: string;
  global_params: {
    total_target_days: number;
    total_target_hours: number;
    n_parallel_build_slots: number;
    time_ratio_per_level: number;
    production_ratio_per_level: number;
    cost_ratio_per_level: number;
    cost_scale: number;
    starting_stock_per_producible_resource: number;
    base_storage_cap: number;
  };
  buildings: Record<string, BuildingConfig>;
  resources: Record<string, ResourceConfig>;
  storage: {
    formula: string;
    base_cap: number;
    applies_to: string[];
    table_noyau_x_biomasse: Record<string, number>;
  };
}

export const ECONOMY = rawConfig as unknown as EconomyConfig;

/* ---------- Bâtiments ---------- */

/** Ordre d'affichage des 12 bâtiments (les 3 minigame_gate en avant-dernier, mutation en capstone). */
export const BUILDING_ORDER: BuildingId[] = [
  "noyau",
  "membrane",
  "adn",
  "proteine",
  "biomasse",
  "enzyme",
  "lipide",
  "signaux",
  "peche",
  "defense",
  "raid",
  "mutation",
];

export function getBuildingConfig(id: BuildingId): BuildingConfig {
  return ECONOMY.buildings[id];
}

export function isDesigned(id: BuildingId): boolean {
  return getBuildingConfig(id).designed;
}

/** Niveau max défini dans le JSON (0 pour les bâtiments non designés). */
export function maxLevel(id: BuildingId): number {
  const levels = Object.keys(getBuildingConfig(id).levels).map(Number);
  return levels.length ? Math.max(...levels) : 0;
}

function levelConfig(id: BuildingId, level: number): LevelConfig | null {
  return getBuildingConfig(id).levels[String(level)] ?? null;
}

/** Coût du passage au niveau `level` (ex. level=1 : première construction). */
export function levelCost(id: BuildingId, level: number): Record<string, number> | null {
  const lc = levelConfig(id, level);
  return lc ? lc.cost : null;
}

/** Temps de construction (heures) du niveau `level`. */
export function buildTimeHours(id: BuildingId, level: number): number {
  return levelConfig(id, level)?.build_time_hours ?? 0;
}

export function buildTimeMs(id: BuildingId, level: number): number {
  return buildTimeHours(id, level) * 3_600_000;
}

/** Production par heure d'un bâtiment à un niveau donné ({} si aucune). */
export function buildingProductionPerHour(
  id: BuildingId,
  level: number,
): Record<string, number> {
  if (level <= 0) return {};
  return levelConfig(id, level)?.production_per_hour ?? {};
}

/** Production totale par heure, toutes ressources, pour un état de bâtiments donné. */
export function totalProductionPerHour(
  buildings: Record<BuildingId, number>,
): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  for (const id of BUILDING_ORDER) {
    const prod = buildingProductionPerHour(id, buildings[id] ?? 0);
    for (const [res, perHour] of Object.entries(prod)) {
      out[res as ResourceId] = (out[res as ResourceId] ?? 0) + perHour;
    }
  }
  return out;
}

export function totalProductionPerSecond(
  buildings: Record<BuildingId, number>,
): Partial<Record<ResourceId, number>> {
  const perHour = totalProductionPerHour(buildings);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [res, v] of Object.entries(perHour)) out[res as ResourceId] = v / 3600;
  return out;
}

/* ---------- Stockage ---------- */

/** Ressources plafonnées par le stockage cellulaire (les 6 productibles, cf. storage.applies_to). */
export function cappedResources(): ResourceId[] {
  return ECONOMY.storage.applies_to as ResourceId[];
}

/** Plafond de stockage partagé — formule du JSON :
 *  cap = BASE_CAP * (1 + 0.5*(noyau_level-1) + 0.5*(biomasse_level-1)),
 *  biomasse non construite (niveau 0) => seul le bonus du Noyau s'applique
 *  (vérifié contre storage.table_noyau_x_biomasse). */
export function storageCap(buildings: Record<BuildingId, number>): number {
  const noyau = Math.max(1, buildings.noyau ?? 1);
  const biomasse = Math.max(1, buildings.biomasse ?? 0); // niveau 0 traité comme 1 (bonus nul)
  return ECONOMY.storage.base_cap * (1 + 0.5 * (noyau - 1) + 0.5 * (biomasse - 1));
}

/** Plafond effectif d'une ressource (Infinity si non plafonnée par le stockage). */
export function resourceCap(
  res: ResourceId,
  buildings: Record<BuildingId, number>,
): number {
  return cappedResources().includes(res) ? storageCap(buildings) : Infinity;
}

/* ---------- Coûts / achat ---------- */

export function canAfford(
  resources: Record<ResourceId, number>,
  cost: Record<string, number> | null,
): boolean {
  if (!cost) return false;
  return Object.entries(cost).every(
    ([res, amount]) => (resources[res as ResourceId] ?? 0) >= amount,
  );
}

/* ---------- État initial ---------- */

export const RESOURCE_IDS: ResourceId[] = [
  "energie",
  "vitalite",
  "adn",
  "proteine",
  "biomasse",
  "enzyme",
  "lipide",
  "signaux",
];

/** Stocks de départ : starting_stock_per_producible_resource pour les 6 productibles, 0 sinon. */
export function startingResources(): Record<ResourceId, number> {
  const start = ECONOMY.global_params.starting_stock_per_producible_resource;
  const producible = new Set(
    Object.entries(ECONOMY.resources)
      .filter(([, r]) => r.kind === "productible")
      .map(([id]) => id),
  );
  const out = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) out[id] = producible.has(id) ? start : 0;
  return out;
}

/** Niveaux de départ : niveau 1 pour tout bâtiment dont le niveau 1 est unlocked_at_start. */
export function startingBuildings(): Record<BuildingId, number> {
  const out = {} as Record<BuildingId, number>;
  for (const id of BUILDING_ORDER) {
    out[id] = getBuildingConfig(id).levels["1"]?.unlocked_at_start ? 1 : 0;
  }
  return out;
}

export function resourceName(res: ResourceId): string {
  return ECONOMY.resources[res]?.name ?? res;
}

export function freshGameState(now: number): GameState {
  return {
    saveVersion: 4,
    tutorialStep: 0, // nouveau joueur : micro-tutoriel actif après création du profil
    resources: startingResources(),
    buildings: startingBuildings(),
    buildQueue: null,
    habits: {
      days: {},
      calorieGoal: 2500, // valeur par défaut, modifiable par le joueur (pas un tuning économique)
      streak: 0,
      lastStreakDate: null,
      bestStreak: 0,
      milestoneAwards: {},
    },
    lastTick: now,
    createdAt: now,
    profile: null,
    // ----- Couche militaire (Phase 5) — tuning dans military_config.json -----
    units: { garde: 0, sonde: 0, phage: 0 },
    expeditions: [],
    nextExpeditionId: 1,
    reports: [],
    nextReportId: 1,
    reportsSeenAt: now,
    nextAttackAt: 0, // planifiée au premier tick
    waveCount: 0,
    nextEventAt: 0, // planifié au premier tick
    pendingEvent: null,
    fragments: 0,
    rngSeed: (now % 2147483647) | 1,
    // ----- La Mare & les cartes (Phase 6) — tuning dans mare_config.json -----
    jetons: 0,
    collection: {},
    cardAssignments: { defense: [], expedition: [] },
    lastCatch: null,
  };
}
