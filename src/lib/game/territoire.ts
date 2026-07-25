/* LA DÉRIVE — la carte du monde (25/07/2026).
   Module PUR : aucune valeur d'équilibrage ici, tout vient de src/data/territoire_config.json.

   Règle d'architecture volontaire : ce module n'importe NI economy.ts NI military.ts.
   Il ne calcule que des débits et des montants, à partir d'une production horaire qu'on lui
   passe en argument (`prodPerHour`). C'est ce qui permet à economy.ts d'importer
   `freshTerritoireState()` sans créer de cycle d'imports — exactement le contrat que
   bastion/config.ts respecte déjà vis-à-vis d'economy.ts. L'application des montants
   (addResource, plafonds de stockage) reste chez l'appelant (tick.ts / store.ts).

   Le principe économique tient en une phrase : le territoire AMPLIFIE la base, il ne la
   remplace jamais. Le revenu d'un gisement est un pourcentage de la production ACTUELLE de
   sa ressource — un gisement pris au jour 5 reste pertinent au jour 80 sans table de paliers,
   et un gisement d'une ressource qu'on ne produit pas encore ne rapporte rien. */

import rawConfig from "@/data/territoire_config.json";
import type { ResourceId, TerritoireState } from "./types";

/* ---------- Typage du JSON ---------- */

export type FoyerNature =
  | "gisement"
  | "expedition"
  | "vestige"
  | "cache"
  | "antre"
  | "abime";

export type TerritoireBonusId =
  | "production_mult"
  | "storage_mult"
  | "bastion_dmg_mult"
  | "bastion_hp_mult"
  | "combat_mult"
  | "expedition_speed"
  | "free_sortie"
  | "reserve_cap"
  | "jeton_max";

export interface FoyerDef {
  id: string;
  name: string;
  nature: FoyerNature;
  /** Palier (= numéro de vague) joué quand on assaille ce foyer. */
  palier: number;
  /** Position en pourcentage (0..100) dans le repère du secteur. */
  x: number;
  y: number;
  /** gisement : la ressource produite. */
  resource?: ResourceId;
  /** cache : les ressources du butin. */
  resources?: ResourceId[];
  /** expedition : l'id de destination de military_config.json. */
  dest_id?: string;
  /** vestige / antre : le bonus global accordé. */
  bonus?: TerritoireBonusId;
  value?: number;
  /** antre : nom du boss affiché. */
  boss_name?: string;
}

export interface SectorDef {
  id: string;
  name: string;
  desc: string;
  unlock_palier: number;
  tint: string;
  foyers: FoyerDef[];
}

interface NatureDef {
  name: string;
  desc: string;
  assault: boolean;
  repeatable: boolean;
  requires_percee?: boolean;
}

interface VestigeDef {
  name: string;
  desc: string;
  kind: "ratio" | "flat";
}

interface TerritoireConfig {
  map: { coord_space: number; node_radius_pct: number };
  natures: Record<string, NatureDef>;
  income: {
    base_ratio: number;
    mult_per_level: number;
    max_level: number;
    total_income_cap_ratio: number;
    offline_cap_h: number;
  };
  development: {
    cost_hours_base: number;
    cost_hours_growth: number;
    cost_combat_base: number;
    cost_combat_growth: number;
  };
  vestiges: Record<string, VestigeDef>;
  cache_loot: {
    hours_base: number;
    hours_per_palier: number;
    combat_base: number;
    combat_per_palier: number;
  };
  antres: {
    hp_mult: number;
    dmg_mult: number;
    loot_mult: number;
    fragments: number;
  };
  abime: {
    palier_offset: number;
    combat_base: number;
    combat_per_palier: number;
    fragments_every_paliers: number;
  };
  sectors: SectorDef[];
}

export const TERRITOIRE = rawConfig as unknown as TerritoireConfig;

export const SECTORS: ReadonlyArray<SectorDef> = TERRITOIRE.sectors;
export const TERRITOIRE_MAP = TERRITOIRE.map;
export const TERRITOIRE_INCOME = TERRITOIRE.income;
export const TERRITOIRE_ANTRES = TERRITOIRE.antres;
export const TERRITOIRE_ABIME = TERRITOIRE.abime;

const FOYER_INDEX: Record<string, { foyer: FoyerDef; sector: SectorDef }> = {};
for (const sector of SECTORS) {
  for (const foyer of sector.foyers) FOYER_INDEX[foyer.id] = { foyer, sector };
}

/** Tous les foyers de la carte, dans l'ordre des secteurs puis des paliers. */
export const ALL_FOYERS: ReadonlyArray<FoyerDef> = SECTORS.flatMap((s) => s.foyers);

export function foyerDef(id: string): FoyerDef | null {
  return FOYER_INDEX[id]?.foyer ?? null;
}

export function sectorOfFoyer(id: string): SectorDef | null {
  return FOYER_INDEX[id]?.sector ?? null;
}

export function natureDef(nature: FoyerNature): NatureDef {
  return TERRITOIRE.natures[nature];
}

export function vestigeDef(bonus: TerritoireBonusId): VestigeDef | undefined {
  return TERRITOIRE.vestiges[bonus];
}

/* ---------- État frais ---------- */

export function freshTerritoireState(now: number): TerritoireState {
  return {
    foyers: {},
    lastIncomeAt: now,
    lastSectorId: SECTORS[0]?.id ?? "",
  };
}

/* ---------- Lecture d'état ---------- */

export function isCaptured(t: TerritoireState, foyerId: string): boolean {
  return (t.foyers[foyerId]?.capturedAt ?? 0) > 0;
}

export function devLevel(t: TerritoireState, foyerId: string): number {
  return t.foyers[foyerId]?.dev ?? 0;
}

export function runCount(t: TerritoireState, foyerId: string): number {
  return t.foyers[foyerId]?.runs ?? 0;
}

/** Un secteur s'ouvre au palier (= waveCount) indiqué. */
export function sectorUnlocked(sector: SectorDef, palier: number): boolean {
  return palier >= sector.unlock_palier;
}

export function unlockedSectors(palier: number): SectorDef[] {
  return SECTORS.filter((s) => sectorUnlocked(s, palier));
}

/** Prochain secteur à ouvrir (pour l'affichage d'un objectif) — null si tout est ouvert. */
export function nextSectorUnlock(palier: number): SectorDef | null {
  return SECTORS.find((s) => !sectorUnlocked(s, palier)) ?? null;
}

/** Palier réellement joué quand on assaille ce foyer.
 *  L'abîme est le seul foyer indexé sur le joueur : il suit toujours son palier + offset. */
export function assaultPalier(foyer: FoyerDef, playerPalier: number): number {
  if (foyer.nature === "abime") {
    return Math.max(foyer.palier, playerPalier + TERRITOIRE_ABIME.palier_offset);
  }
  return foyer.palier;
}

/** Un foyer est-il assaillable ? (déjà pris et non répétable => non). */
export function foyerAvailable(t: TerritoireState, foyer: FoyerDef): boolean {
  if (natureDef(foyer.nature).repeatable) return true;
  return !isCaptured(t, foyer.id);
}

/* ---------- Bonus globaux ---------- */

/** Somme des bonus des vestiges (et des antres, qui en gardent un) déjà pris.
 *  Les clés absentes valent 0 : `territoireBonus(t).production_mult ?? 0`. */
export function territoireBonus(t: TerritoireState): Partial<Record<TerritoireBonusId, number>> {
  const out: Partial<Record<TerritoireBonusId, number>> = {};
  for (const foyer of ALL_FOYERS) {
    if (!foyer.bonus || !foyer.value) continue;
    if (!isCaptured(t, foyer.id)) continue;
    out[foyer.bonus] = (out[foyer.bonus] ?? 0) + foyer.value;
  }
  return out;
}

/** Raccourci typé : la valeur d'un bonus, 0 si aucun vestige correspondant n'est pris. */
export function bonusValue(t: TerritoireState, id: TerritoireBonusId): number {
  return territoireBonus(t)[id] ?? 0;
}

/* ---------- Revenu des gisements ---------- */

/** Multiplicateur de rendement d'un gisement à un niveau de développement donné. */
export function gisementRatio(dev: number): number {
  const inc = TERRITOIRE_INCOME;
  return inc.base_ratio * Math.pow(inc.mult_per_level, Math.max(0, Math.min(inc.max_level, dev)));
}

/** Revenu horaire du territoire, ressource par ressource, DÉJÀ plafonné.
 *  `prodPerHour` = production horaire de la base (economy.totalProductionPerHour).
 *  Double borne : le ratio de chaque gisement, puis total_income_cap_ratio sur la somme —
 *  le territoire ne peut jamais dépasser cette fraction de la production de base. */
export function territoireIncomePerHour(
  t: TerritoireState,
  prodPerHour: Partial<Record<ResourceId, number>>,
): Partial<Record<ResourceId, number>> {
  const out: Partial<Record<ResourceId, number>> = {};
  for (const foyer of ALL_FOYERS) {
    if (foyer.nature !== "gisement" || !foyer.resource) continue;
    if (!isCaptured(t, foyer.id)) continue;
    const base = prodPerHour[foyer.resource] ?? 0;
    if (base <= 0) continue;
    out[foyer.resource] = (out[foyer.resource] ?? 0) + base * gisementRatio(devLevel(t, foyer.id));
  }
  const cap = TERRITOIRE_INCOME.total_income_cap_ratio;
  for (const res of Object.keys(out) as ResourceId[]) {
    out[res] = Math.min(out[res] ?? 0, (prodPerHour[res] ?? 0) * cap);
  }
  return out;
}

/** Durée d'accumulation retenue au prochain encaissement, bornée par offline_cap_h.
 *  Retourne 0 si le territoire ne rapporte rien ou si aucune durée ne s'est écoulée. */
export function accrualWindowMs(t: TerritoireState, now: number): number {
  const from = t.lastIncomeAt > 0 ? t.lastIncomeAt : now;
  const elapsed = Math.max(0, now - from);
  return Math.min(elapsed, TERRITOIRE_INCOME.offline_cap_h * 3_600_000);
}

/** Montants à créditer depuis le dernier encaissement (l'appelant applique addResource). */
export function territoireAccrual(
  t: TerritoireState,
  prodPerHour: Partial<Record<ResourceId, number>>,
  now: number,
): Partial<Record<ResourceId, number>> {
  const ms = accrualWindowMs(t, now);
  if (ms <= 0) return {};
  const hours = ms / 3_600_000;
  const rates = territoireIncomePerHour(t, prodPerHour);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [res, perHour] of Object.entries(rates)) {
    const amount = (perHour ?? 0) * hours;
    if (amount > 0) out[res as ResourceId] = amount;
  }
  return out;
}

/* ---------- Développement d'un gisement ---------- */

export interface DevCost {
  /** Ressource du gisement et quantité demandée (indexée sur la production du moment). */
  resource: ResourceId;
  amount: number;
  /** Monnaie de combat : la carte se développe avec ce qu'on gagne en se battant. */
  combat: number;
}

export function maxDevLevel(): number {
  return TERRITOIRE_INCOME.max_level;
}

/** Coût du passage de `dev` à `dev + 1`. null si le gisement est déjà au maximum. */
export function devCost(
  foyer: FoyerDef,
  dev: number,
  prodPerHour: Partial<Record<ResourceId, number>>,
): DevCost | null {
  if (foyer.nature !== "gisement" || !foyer.resource) return null;
  if (dev >= maxDevLevel()) return null;
  const d = TERRITOIRE.development;
  const hours = d.cost_hours_base * Math.pow(d.cost_hours_growth, dev);
  const base = prodPerHour[foyer.resource] ?? 0;
  return {
    resource: foyer.resource,
    amount: Math.ceil(hours * base),
    combat: Math.ceil(d.cost_combat_base * Math.pow(d.cost_combat_growth, dev)),
  };
}

/* ---------- Butins ---------- */

export interface FoyerLoot {
  resources: Partial<Record<ResourceId, number>>;
  combat: number;
  fragments: number;
}

const EMPTY_LOOT: FoyerLoot = { resources: {}, combat: 0, fragments: 0 };

/** Butin d'une cache : N heures de production de chacune des ressources listées.
 *  Auto-indexé comme le revenu des gisements : une cache tardive vaut plus qu'une cache précoce. */
export function cacheLoot(
  foyer: FoyerDef,
  prodPerHour: Partial<Record<ResourceId, number>>,
): FoyerLoot {
  if (foyer.nature !== "cache") return EMPTY_LOOT;
  const c = TERRITOIRE.cache_loot;
  const hours = c.hours_base + c.hours_per_palier * foyer.palier;
  const resources: Partial<Record<ResourceId, number>> = {};
  for (const res of foyer.resources ?? []) {
    const amount = Math.round((prodPerHour[res] ?? 0) * hours);
    if (amount > 0) resources[res] = amount;
  }
  return {
    resources,
    combat: Math.round(c.combat_base + c.combat_per_palier * foyer.palier),
    fragments: 0,
  };
}

/** Butin d'un antre : la monnaie de combat de la vague est multipliée ailleurs (loot_mult),
 *  ici on ne renvoie que la prime fixe en fragments. */
export function antreLoot(): FoyerLoot {
  return { resources: {}, combat: 0, fragments: TERRITOIRE_ANTRES.fragments };
}

/** Butin d'un passage dans l'abîme, calé sur le palier réellement joué. */
export function abimeLoot(palier: number): FoyerLoot {
  const a = TERRITOIRE_ABIME;
  const frags = a.fragments_every_paliers > 0 ? Math.floor(palier / a.fragments_every_paliers) : 0;
  return {
    resources: {},
    combat: Math.round(a.combat_base + a.combat_per_palier * palier),
    fragments: Math.max(0, Math.min(3, frags)),
  };
}

/* ---------- Passerelle vers les expéditions ---------- */

/** Destinations garanties : prendre un site d'expédition ne crée AUCUN slot supplémentaire
 *  (ce serait toucher au calibrage : cf. military_config.json -> expeditions.daily_slots),
 *  il garantit simplement la présence de cette destination dans les offres du jour.
 *  On gagne de l'agentivité, pas du débit. */
export function guaranteedDestIds(t: TerritoireState): string[] {
  const out: string[] = [];
  for (const foyer of ALL_FOYERS) {
    if (foyer.nature !== "expedition" || !foyer.dest_id) continue;
    if (isCaptured(t, foyer.id)) out.push(foyer.dest_id);
  }
  return out;
}

/* ---------- Progression (affichage) ---------- */

export interface TerritoireProgress {
  captured: number;
  total: number;
  /** Foyers pris dans les secteurs actuellement ouverts. */
  capturedUnlocked: number;
  totalUnlocked: number;
}

export function territoireProgress(t: TerritoireState, palier: number): TerritoireProgress {
  let captured = 0;
  let capturedUnlocked = 0;
  let totalUnlocked = 0;
  for (const sector of SECTORS) {
    const open = sectorUnlocked(sector, palier);
    for (const foyer of sector.foyers) {
      const taken = isCaptured(t, foyer.id);
      if (taken) captured++;
      if (open) {
        totalUnlocked++;
        if (taken) capturedUnlocked++;
      }
    }
  }
  return { captured, total: ALL_FOYERS.length, capturedUnlocked, totalUnlocked };
}
