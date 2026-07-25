/* Économie de l'Âge 1 — lecture typée de src/data/economy_config.json (SOURCE DE VÉRITÉ).
   Toutes les fonctions sont pures et dérivent chaque valeur du JSON :
   aucun nombre d'équilibrage en dur dans ce fichier. */

import rawConfig from "@/data/economy_config.json";
import { freshBastionState } from "./bastion/config";
import type { BuildingId, BuildTask, GameState, ResourceId } from "./types";

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

export interface BuildSlotConfig {
  label: string;
  /** null = aucune limite de durée (slot principal). */
  max_hours: number | null;
  /** Nombre de proto-organes construits requis pour débloquer ce slot auxiliaire. */
  requires_built?: number;
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
  build_slots: {
    main: BuildSlotConfig;
    aux: BuildSlotConfig[];
  };
  offline_report: {
    /** En dessous, aucun rapport de retour n'est montré. */
    min_absence_minutes: number;
    /** Part de production perdue au plafond déclenchant l'alerte de stockage. */
    waste_alert_ratio: number;
    /** Nombre d'événements listés avant repli. */
    max_lines: number;
  };
  energy_boost: {
    /** Part maximale de la durée TOTALE d'un chantier rachetable à l'énergie. */
    max_ratio_per_task: number;
    /** Part de la durée totale rachetée par tap. */
    step_ratio: number;
    /** Coût de base d'une heure rachetée (⚡). */
    energy_per_hour: number;
    /** Surcoût de la dernière heure du quota par rapport à la première. */
    cost_growth_at_cap: number;
    /** En dessous, on ne propose plus de rachat (micro-achats sans intérêt). */
    min_step_minutes: number;
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

/* ---------- File de construction multi-slots ---------- */

/** Nombre de proto-organes construits (tout bâtiment ≥ Nv1, Noyau exclu).
 *  Défini ici (et non dans scene.ts) parce que les déblocages de slots s'y indexent :
 *  scene.ts le réexporte pour ne pas dupliquer la règle. */
export function builtOrganCount(buildings: Record<BuildingId, number>): number {
  return BUILDING_ORDER.filter((id) => id !== "noyau" && (buildings[id] ?? 0) > 0).length;
}

/** Configuration du slot `index` (0 = principal, 1+ = auxiliaires). */
export function buildSlotConfig(index: number): BuildSlotConfig {
  if (index <= 0) return ECONOMY.build_slots.main;
  return ECONOMY.build_slots.aux[index - 1] ?? ECONOMY.build_slots.main;
}

/** Nombre total de slots ouverts pour un état de bâtiments donné (toujours ≥ 1). */
export function unlockedSlotCount(buildings: Record<BuildingId, number>): number {
  const built = builtOrganCount(buildings);
  let n = 1;
  for (const aux of ECONOMY.build_slots.aux) {
    if (built >= (aux.requires_built ?? Infinity)) n++;
  }
  return n;
}

/** Prochain slot à débloquer (pour l'affichage des objectifs) — null si tout est ouvert. */
export function nextSlotUnlock(
  buildings: Record<BuildingId, number>,
): { label: string; requiresBuilt: number; built: number } | null {
  const built = builtOrganCount(buildings);
  for (const aux of ECONOMY.build_slots.aux) {
    const need = aux.requires_built ?? Infinity;
    if (built < need) return { label: aux.label, requiresBuilt: need, built };
  }
  return null;
}

/** Réglages du rapport de retour (« pendant ton absence… »). */
export const OFFLINE_REPORT = ECONOMY.offline_report;

/** Un slot accepte-t-il un chantier de `hours` heures ? (le principal accepte tout) */
export function slotAcceptsHours(index: number, hours: number): boolean {
  const max = buildSlotConfig(index).max_hours;
  return max === null || hours <= max;
}

/** Premier slot libre acceptant ce chantier — -1 si aucun.
 *  On sert le principal en dernier : un chantier court doit préférer un slot auxiliaire,
 *  sinon il bloquerait le seul slot capable de prendre les gros chantiers. */
export function findFreeSlot(
  buildings: Record<BuildingId, number>,
  queue: BuildTask[],
  hours: number,
): number {
  const total = unlockedSlotCount(buildings);
  const busy = new Set(queue.map((t) => t.slot));
  for (let i = total - 1; i >= 0; i--) {
    if (!busy.has(i) && slotAcceptsHours(i, hours)) return i;
  }
  return -1;
}

/* ---------- L'énergie achète du temps ---------- */

/** Réglages du rachat d'heures de chantier à l'énergie (dette PLAN.md §5.4). */
export const ENERGY_BOOST = ECONOMY.energy_boost;

/** Devis d'une accélération (un tap). */
export interface BoostQuote {
  /** Temps racheté par ce tap (ms). */
  ms: number;
  /** Coût en ⚡ (entier). */
  cost: number;
  /** Quota encore rachetable APRÈS ce tap (ms). */
  leftAfterMs: number;
  /** Quota total de ce chantier (ms) — pour la jauge. */
  allowanceMs: number;
  /** Quota déjà consommé (ms) — pour la jauge. */
  usedMs: number;
}

/** Durée d'origine d'un chantier, avant tout rachat (ms).
 *  Le rachat rogne `endsAt` : sans mémoriser `boostedMs`, le quota de 25 %
 *  se recalculerait sur une durée qui rétrécit et deviendrait infini. */
function originalDurationMs(task: BuildTask): number {
  return Math.max(1, task.endsAt - task.startedAt + task.boostedMs);
}

/** Quota total rachetable sur ce chantier (ms). */
export function boostAllowanceMs(task: BuildTask): number {
  return originalDurationMs(task) * ENERGY_BOOST.max_ratio_per_task;
}

/** Combien coûte le prochain tap d'accélération — null s'il n'y a plus rien à racheter.
 *  Le coût est dégressif en rendement : la première heure rachetée est au tarif de base,
 *  la dernière du quota coûte `cost_growth_at_cap` de plus. C'est ce qui empêche
 *  l'énergie de devenir une simple monnaie « fast-forward ». */
export function boostQuote(task: BuildTask, now: number): BoostQuote | null {
  const total = originalDurationMs(task);
  const allowanceMs = total * ENERGY_BOOST.max_ratio_per_task;
  const usedMs = Math.min(task.boostedMs, allowanceMs);
  const leftAllowance = allowanceMs - usedMs;
  const remaining = task.endsAt - now;
  if (remaining <= 0 || leftAllowance <= 0) return null;
  const ms = Math.min(total * ENERGY_BOOST.step_ratio, leftAllowance, remaining);
  if (ms < ENERGY_BOOST.min_step_minutes * 60_000) return null;
  const mult = 1 + ENERGY_BOOST.cost_growth_at_cap * (usedMs / allowanceMs);
  const cost = Math.max(1, Math.ceil((ms / 3_600_000) * ENERGY_BOOST.energy_per_hour * mult));
  return { ms, cost, leftAfterMs: leftAllowance - ms, allowanceMs, usedMs };
}

/* ---------- Recommandation de chantier ---------- */

/** Un chantier proposé au joueur (« Enchaîner »). */
export interface BuildSuggestion {
  id: BuildingId;
  /** Niveau visé (niveau actuel + 1). */
  level: number;
  /** Le coût est-il payable tout de suite ? */
  affordable: boolean;
}

/** Bonus de score d'un organe encore jamais construit : au-delà de sa production,
 *  il fait avancer les mues ET les déblocages de slots — c'est structurel. */
const NEW_ORGAN_SCORE_BONUS = 0.6;

/** Quel chantier proposer maintenant ? (bouton « Enchaîner » de fin de chantier)
 *
 *  La règle : un gain de production RELATIF (pondéré par ce que la cellule produit
 *  déjà de cette ressource — +10/h d'une ressource rare vaut mieux que +10/h d'une
 *  ressource abondante) rapporté à l'heure de chantier. Les organes neufs reçoivent
 *  un bonus : ils débloquent slots et mues.
 *  On ne propose QUE des chantiers réellement lançables (slot compatible libre).
 *  Si rien n'est payable, on propose le plus proche de l'être — c'est un objectif,
 *  pas une frustration : la fiche affichera le coût manquant. */
export function recommendNextBuild(
  buildings: Record<BuildingId, number>,
  resources: Record<ResourceId, number>,
  queue: BuildTask[],
  exclude?: BuildingId,
): BuildSuggestion | null {
  const perHour = totalProductionPerHour(buildings);
  let best: BuildSuggestion | null = null;
  let bestKey: [number, number, number] | null = null; // [payable, -manque, score]

  for (const id of BUILDING_ORDER) {
    if (id === exclude) continue;
    if (!isDesigned(id)) continue;
    const level = buildings[id] ?? 0;
    const target = level + 1;
    if (target > maxLevel(id)) continue;
    if (queue.some((t) => t.buildingId === id)) continue;
    const cost = levelCost(id, target);
    if (!cost) continue;
    const hours = buildTimeHours(id, target);
    if (findFreeSlot(buildings, queue, hours) < 0) continue;

    // Gain de production relatif.
    const before = buildingProductionPerHour(id, level);
    const after = buildingProductionPerHour(id, target);
    let gain = 0;
    for (const [res, rate] of Object.entries(after)) {
      const delta = rate - (before[res as ResourceId] ?? 0);
      if (delta <= 0) continue;
      gain += delta / Math.max(1, perHour[res as ResourceId] ?? 0);
    }
    if (level === 0) gain += NEW_ORGAN_SCORE_BONUS;
    const score = gain / Math.max(0.1, hours);

    // Distance au coût : 0 si payable, sinon la pire fraction manquante.
    let shortfall = 0;
    for (const [res, amount] of Object.entries(cost)) {
      const have = resources[res as ResourceId] ?? 0;
      if (have >= amount) continue;
      shortfall = Math.max(shortfall, (amount - have) / Math.max(1, amount));
    }
    const affordable = shortfall === 0;
    const key: [number, number, number] = [affordable ? 1 : 0, -shortfall, score];

    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] &&
        (key[1] > bestKey[1] + 0.15 ||
          (Math.abs(key[1] - bestKey[1]) <= 0.15 && key[2] > bestKey[2])))) {
      // Entre deux chantiers hors budget de coût comparable (±15 %), c'est le
      // meilleur rendement qui tranche — pas le hasard de l'ordre d'affichage.
      best = { id, level: target, affordable };
      bestKey = key;
    }
  }
  return best;
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
  "combat",
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
    buildQueue: [],
    habits: {
      days: {},
      calorieGoal: 2500, // valeur par défaut, modifiable par le joueur (pas un tuning économique)
      streak: 0,
      streakDay: null,
      bestStreak: 0,
      streakAwards: {},
      graceDays: [],
      graceUsedMonth: null,
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
    noyauSeenDay: null,
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
    bastion: freshBastionState(),
    claimedMilestones: [],
  };
}
