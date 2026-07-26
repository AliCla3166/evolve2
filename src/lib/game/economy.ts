/* Économie de l'Âge 1 — lecture typée de src/data/economy_config.json (SOURCE DE VÉRITÉ).
   Toutes les fonctions sont pures et dérivent chaque valeur du JSON :
   aucun nombre d'équilibrage en dur dans ce fichier. */

import rawConfig from "@/data/economy_config.json";
import { freshBastionState } from "./bastion/config";
import { cardPowerRec, fitInSlots, speciesAffinity } from "./cards";
import { bonusValue, freshTerritoireState } from "./territoire";
import { TUTORIAL_DONE } from "./types";
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

/** Les postes de travail : cf. economy_config.json -> postes (commentaires compris). */
export interface PosteConfig {
  /** Places d'un organe = slots_base + slots_per_level * (niveau - 1), borné par slots_max. */
  slots_base: number;
  slots_per_level: number;
  slots_max: number;
  /** Apport d'une ouvrière : prime de présence + part indexée sur sa puissance de
   *  récolte + part indexée sur son niveau de travail. */
  bonus_per_worker: number;
  bonus_per_power: number;
  bonus_per_work_level: number;
  /** Facteur appliqué à l'apport quand l'espèce travaille SA ressource. */
  affinity_mult: number;
  /** Multiplicateur saturant : 1 + span * B / (B + half), donc borné par 1 + span. */
  span: number;
  half: number;
  /** XP gagnée par heure de travail : xp_per_hour + par niveau de l'organe. */
  xp_per_hour: number;
  xp_per_hour_per_building_level: number;
  /** Courbe polynomiale : XP cumulée du niveau L = level_xp_base * (L-1)^level_exponent. */
  level_xp_base: number;
  level_exponent: number;
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
  tutorial: {
    /** Durée forcée du tout premier chantier d'une sauvegarde neuve (minutes). */
    first_build_time_minutes: number;
  };
  postes: PosteConfig;
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

/* ---------- Le premier chantier scripté (amélioration n°1 du retour du 26/07) ----------
   Le plancher réel avant le premier bâtiment terminé était de 1 h 23 min (chantier le plus
   court 1,85 h, rachat plafonné à 25 %), pendant que le tutoriel promettait « Reviens le
   voir aboutir ». Sur une sauvegarde NEUVE uniquement, le premier chantier lancé dure
   first_build_time_minutes : le joueur voit sa première mue avant de fermer l'application.
   Aucune durée générale ne change — la lenteur savoureuse reste un pilier. */

/** Durée forcée du premier chantier d'une partie neuve (minutes, config). */
export const FIRST_BUILD_MINUTES = ECONOMY.tutorial.first_build_time_minutes;

/** Le prochain chantier lancé sera-t-il LE chantier scripté du tutoriel ?
 *  Trois conditions, toutes nécessaires : le tutoriel n'est pas terminé (les
 *  sauvegardes migrées l'ont d'office terminé — elles ne sont jamais concernées),
 *  aucun organe n'a encore été bâti, et la file est vide. Dès que le premier
 *  chantier tourne ou qu'un organe existe, la condition tombe pour toujours. */
export function isScriptedFirstBuild(
  state: Pick<GameState, "tutorialStep" | "buildings" | "buildQueue">,
): boolean {
  return (
    state.tutorialStep < TUTORIAL_DONE &&
    builtOrganCount(state.buildings) === 0 &&
    state.buildQueue.length === 0
  );
}

/** Durée effective d'un chantier pour CET état : la durée de config, sauf pour le
 *  premier chantier d'une partie neuve, scripté à FIRST_BUILD_MINUTES. Utilisée par
 *  le lancement (store.startUpgrade) ET par l'affichage (BuildingSheet) — un devis
 *  qui annoncerait 1 h 51 pour un chantier qui durera 4 min serait un mensonge. */
export function effectiveBuildTimeMs(
  state: Pick<GameState, "tutorialStep" | "buildings" | "buildQueue">,
  id: BuildingId,
  level: number,
): number {
  if (isScriptedFirstBuild(state)) return FIRST_BUILD_MINUTES * 60_000;
  return buildTimeMs(id, level);
}

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

/* ---------- Les bonus de La Dérive appliqués à l'économie ----------
   Trois fonctions « state-aware » doublent les trois fonctions « buildings-aware »
   ci-dessus. Les anciennes restent la vérité des BÂTIMENTS (elles servent à afficher
   ce qu'un chantier apportera, indépendamment de la carte) ; les nouvelles sont la
   vérité du JOUEUR et doivent être utilisées partout où on produit, plafonne ou affiche.

   Note d'équilibrage : ces multiplicateurs restent volontairement modestes (quelques
   pour-cent par vestige) et ne touchent QUE la production et le stockage. Le temps de
   chantier — plus de 96 % du chemin critique des 90 jours, cf. economy_config.json ->
   pacing_validation — n'est jamais accéléré par La Dérive. */

/* ---------- Les postes de travail (26/07) ----------

   Le pendant, côté base, de l'équipage de récolte de La Dérive : on poste une créature
   pêchée dans un organe producteur, elle y travaille à l'écran, l'organe produit
   davantage, et elle gagne un niveau de travail qui n'a pas de plafond.

   La jointure collection × organes vit ICI plutôt que dans cards.ts, à l'inverse de
   l'équipage des gisements, et pour une raison symétrique : c'est economy_config.json
   qui porte le tuning, et economy.ts dépend déjà de cards.ts (via bastion/config.ts).
   L'inverse — cards.ts important economy.ts — créerait le cycle. */

export const POSTES = ECONOMY.postes;

/** Un organe accepte des ouvrières s'il PRODUIT quelque chose : c'est le seul endroit
 *  où un bonus de production a un sens. La liste n'est écrite nulle part, elle se lit
 *  dans buildings[].role — tout organe producteur ajouté plus tard suivra tout seul. */
export function acceptsPostes(id: BuildingId): boolean {
  return getBuildingConfig(id).role === "producer";
}

/** La ressource travaillée par un organe (celle qu'il produit), ou null. Lue au niveau 1
 *  et non au niveau courant : un organe pas encore construit doit quand même pouvoir
 *  annoncer sa ressource dans l'UI d'affectation. */
export function posteResource(id: BuildingId): ResourceId | null {
  const prod = getBuildingConfig(id).levels["1"]?.production_per_hour;
  const first = prod ? Object.keys(prod)[0] : undefined;
  return (first as ResourceId | undefined) ?? null;
}

/** Places d'un organe à un niveau donné. 0 si non construit ou non producteur —
 *  la première place s'ouvre donc exactement à la construction. */
export function posteSlots(id: BuildingId, level: number): number {
  if (level <= 0 || !acceptsPostes(id)) return 0;
  const p = POSTES;
  return Math.min(p.slots_max, p.slots_base + p.slots_per_level * (level - 1));
}

/** Ouvrières postées dans un organe. Accesseur à repli : `postes` est absent des
 *  sauvegardes < v15 et une entrée manquante vaut « personne », jamais undefined. */
export function posteOf(state: Pick<GameState, "postes">, id: BuildingId): string[] {
  return state.postes?.[id] ?? [];
}

/** L'organe où cette espèce travaille, ou null. Le pendant exact de
 *  `foyerOfCrewSpecies` pour La Dérive, et il existe pour la même raison : sans lui,
 *  retrouver une ouvrière obligerait à ouvrir les six organes un par un. La Mare peut
 *  ainsi l'écrire sur la carte elle-même. L'exclusivité d'emploi (cf. store.togglePoste)
 *  garantit qu'il n'y a jamais qu'une seule réponse. */
export function buildingOfPostedSpecies(
  state: Pick<GameState, "postes">,
  speciesId: string,
): BuildingId | null {
  for (const [id, crew] of Object.entries(state.postes ?? {})) {
    if (crew?.includes(speciesId)) return id as BuildingId;
  }
  return null;
}

/** Niveau de travail correspondant à une ancienneté. Inversion FERMÉE de la courbe
 *  polynomiale (XP cumulée du niveau L = level_xp_base * (L-1)^level_exponent), donc
 *  O(1) et sans table : il n'existe aucun dernier niveau à borner. */
export function workLevel(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  const p = POSTES;
  return 1 + Math.floor(Math.pow(xp / p.level_xp_base, 1 / p.level_exponent));
}

/** Ancienneté nécessaire pour atteindre un niveau donné (l'aller de workLevel).
 *  Sert à afficher « prochain palier dans … » sans jamais annoncer une fin. */
export function workXpForLevel(level: number): number {
  if (level <= 1) return 0;
  return POSTES.level_xp_base * Math.pow(level - 1, POSTES.level_exponent);
}

/** XP gagnée par heure de travail dans un organe d'un niveau donné : un organe
 *  développé forme plus vite, donc y poster une jeune recrue est un vrai choix. */
export function posteXpPerHour(buildingLevel: number): number {
  if (buildingLevel <= 0) return 0;
  return POSTES.xp_per_hour + POSTES.xp_per_hour_per_building_level * buildingLevel;
}

/** Niveau de travail d'une espèce (cache `fauneLevel`, repli sur 1). */
export function workLevelOf(state: Pick<GameState, "fauneLevel">, speciesId: string): number {
  return Math.max(1, state.fauneLevel?.[speciesId] ?? 1);
}

/** Apport d'UNE ouvrière au rendement de son organe : une prime de présence, une part
 *  indexée sur sa puissance de récolte (la MÊME stat qu'aux gisements — une seule à
 *  expliquer au joueur), une part indexée sur son ancienneté, le tout amplifié quand
 *  elle travaille sa ressource d'affinité. L'affinité est un bonus, jamais un péage :
 *  n'importe quelle espèce peut tenir n'importe quel poste. */
export function workerBonus(
  state: Pick<GameState, "collection" | "fauneLevel">,
  speciesId: string,
  resource: ResourceId | null,
): number {
  const entry = state.collection[speciesId];
  if (!entry) return 0;
  const p = POSTES;
  const raw =
    p.bonus_per_worker +
    p.bonus_per_power * cardPowerRec(speciesId, entry) +
    p.bonus_per_work_level * (workLevelOf(state, speciesId) - 1);
  const matches = resource !== null && speciesAffinity(speciesId) === resource;
  return matches ? raw * p.affinity_mult : raw;
}

/** Somme des apports des ouvrières effectivement postées dans un organe. */
export function posteBonus(state: PosteStateView, id: BuildingId): number {
  const crew = posteOf(state, id);
  if (crew.length === 0) return 0;
  const res = posteResource(id);
  const cap = posteSlots(id, state.buildings[id] ?? 0);
  let sum = 0;
  /* On ne compte que les places réellement ouvertes : rétrograder n'est pas possible
     aujourd'hui, mais une sauvegarde bricolée ne doit pas pouvoir dépasser le plafond.
     `fitInSlots` et non `.slice(0, cap)` : le plafond compte les PLACES, et une
     ouvrière négative n'en occupe aucune (cf. cards.slotCost). */
  for (const speciesId of fitInSlots(crew, state.collection, cap))
    sum += workerBonus(state, speciesId, res);
  return sum;
}

/** Multiplicateur SATURANT d'un organe : 1 + span * B / (B + half). Borné par
 *  1 + span quelle que soit la somme des apports — chaque niveau d'ouvrière fait
 *  monter le chiffre affiché, aucun ne peut faire exploser le calibrage. */
export function posteMult(bonus: number): number {
  if (bonus <= 0) return 1;
  return 1 + (POSTES.span * bonus) / (bonus + POSTES.half);
}

export function buildingPosteMult(state: PosteStateView, id: BuildingId): number {
  return posteMult(posteBonus(state, id));
}

/** Le strict minimum dont ces fonctions ont besoin. Volontairement plus étroit que
 *  GameState : un composant React peut ainsi ne s'abonner qu'à cinq références
 *  STABLES au lieu de l'état entier. `fauneXp` en est délibérément absent — c'est le
 *  seul champ des postes qui bouge à chaque tick, et la production ne dépend que du
 *  niveau, qui ne bouge qu'aux paliers. */
export type PosteStateView = Pick<GameState, "buildings" | "postes" | "collection" | "fauneLevel">;

/** Ce dont dépend le STOCKAGE : le bâti et les vestiges, rien d'autre. Délibérément
 *  plus étroit que EconomyStateView — aucune ouvrière n'agrandit une cuve, et un écran
 *  qui n'affiche qu'un plafond n'a aucune raison de se réveiller parce qu'une créature
 *  a changé de poste. */
export type StorageStateView = Pick<GameState, "buildings" | "territoire">;

export type EconomyStateView = PosteStateView & StorageStateView;

/** Multiplicateur de production accordé par les vestiges déjà pris (1 = aucun). */
export function territoireProductionMult(state: Pick<GameState, "territoire">): number {
  return 1 + bonusValue(state.territoire, "production_mult");
}

/** Production horaire de la BASE, postes ET vestiges compris (hors revenu des gisements,
 *  qui est encaissé séparément par le tick — cf. territoire.territoireAccrual).
 *
 *  Le bonus des ouvrières s'applique organe PAR organe : une créature ne fait avancer
 *  que la cuve où elle travaille. Il passe donc AVANT le multiplicateur global des
 *  vestiges, qui lui s'applique à tout.
 *
 *  `totalProductionPerHour` reste volontairement nue : c'est la capacité brute du bâti,
 *  ce qu'on veut quand on chiffre un coût de développement ou l'aperçu d'un chantier —
 *  pas ce que le joueur encaisse vraiment. Les deux fonctions ont chacune leur usage,
 *  et les confondre ferait dériver le calibrage.
 *
 *  Quand aucune ouvrière n'est postée et aucun vestige pris, les deux multiplicateurs
 *  valent exactement 1 : le résultat est bit-à-bit celui d'avant les postes. */
export function stateProductionPerHour(
  state: EconomyStateView,
): Partial<Record<ResourceId, number>> {
  const mult = territoireProductionMult(state);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const id of BUILDING_ORDER) {
    const prod = buildingProductionPerHour(id, state.buildings[id] ?? 0);
    const boost = buildingPosteMult(state, id);
    for (const [res, perHour] of Object.entries(prod)) {
      out[res as ResourceId] = (out[res as ResourceId] ?? 0) + perHour * boost * mult;
    }
  }
  return out;
}

/** Capacité de stockage effective, vestiges `storage_mult` compris. */
export function stateStorageCap(state: StorageStateView): number {
  return storageCap(state.buildings) * (1 + bonusValue(state.territoire, "storage_mult"));
}

/** Plafond effectif d'une ressource pour CE joueur (Infinity si non plafonnée). */
export function stateResourceCap(state: StorageStateView, res: ResourceId): number {
  return cappedResources().includes(res) ? stateStorageCap(state) : Infinity;
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

/** Version du format de sauvegarde. Elle vit ICI, et non dans `store.ts` où se trouve la
 *  chaîne de migrations, pour une raison de dépendances : c'est `freshGameState` qui estampille
 *  une partie neuve, et `economy.ts` ne peut pas importer `store.ts` (qui l'importe déjà).
 *  `store.ts` la réexporte, donc rien ne change pour ses consommateurs.
 *
 *  Elle était figée à 4 en dur ici pendant que la chaîne de migrations montait jusqu'à 13 :
 *  une partie neuve se déclarait donc en v4 dans son export de sauvegarde et dans la sync
 *  cloud, alors que ses données étaient bien au format courant. Un seul point de vérité
 *  supprime la dérive : à chaque nouvelle migration, on incrémente cette constante. */
export const SAVE_VERSION = 20;

export function freshGameState(now: number): GameState {
  return {
    saveVersion: SAVE_VERSION,
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
    // ----- Les postes de travail (26/07) — tuning dans economy_config.json -> postes -----
    postes: {},
    fauneXp: {},
    fauneLevel: {},
    bastion: freshBastionState(),
    // ----- La Dérive & le Bilan (25/07) — tuning dans territoire_config.json / habits_config.json -----
    territoire: freshTerritoireState(now),
    bilan: { lastDay: null, percees: 0, perceesTotal: 0, perceesSpent: 0 },
    claimedMilestones: [],
    // ----- Objectifs du jour & ouverture progressive (26/07) -----
    dailyClaimed: { day: "", ids: [] },
    tabIntroSeen: [],
  };
}
