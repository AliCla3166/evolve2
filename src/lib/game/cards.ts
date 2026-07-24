/* La Mare & les cartes (Phase 6) — pur, données depuis mare_config.json.
   Pêche : paillette colorée = rareté (poids v1), tension à 3 taps → quality,
   quality = bonus de chance au tirage final. Les prises deviennent des cartes
   d'unités : doublons → niveaux, meilleure rareté → habillage, assignation en
   défense ou expédition (passerelle vers la couche militaire). */

import rawConfig from "@/data/mare_config.json";
import type { CardAssignments, CardEntry, GameState } from "./types";

/* ---------- Typage de la config ---------- */

export interface RarityConfig {
  id: string;
  name: string;
  weight: number;
  /** Multiplicateur de hauteur de la fenêtre de capture (1 = pleine taille, plus petit = plus dur). */
  bar_mult: number;
  /** Vitesse d'approche du poisson vers sa cible (fraction de piste / seconde). */
  fish_speed: number;
  /** Fréquence moyenne de changement de cap du poisson (Hz — plus haut = plus erratique). */
  fish_retarget_hz: number;
  /** Multiplicateur de la vitesse de vidage de la jauge de succès hors chevauchement. */
  drain_mult: number;
  color: string;
  power_mult: number;
}

export interface SpeciesConfig {
  id: string;
  name: string;
  /** Portrait PixelLab de la charte utilisé comme art de carte. */
  portrait: string;
  role: "defense" | "exploration" | "assaut";
  power_def: number;
  power_exp: number;
  power_atk: number;
}

export interface MareConfig {
  jetons: { cost_energie: number; max_stock: number };
  fragments_per_card: number;
  fragment_card_rarity_floor: number;
  rarities: RarityConfig[];
  fishing: {
    bar_height: number;
    /** Plancher d'équité de la hauteur de fenêtre (cf. $comment du JSON). */
    bar_height_min: number;
    gravity: number;
    rise_accel: number;
    drag: number;
    max_velocity: number;
    fill_rate: number;
    drain_rate: number;
    start_progress: number;
    /** Bonus de chance de rareté selon le palier de qualité (0..3). */
    quality_luck: number[];
  };
  level_thresholds: number[];
  level_power_bonus: number;
  assign_slots: { defense: number; expedition: number };
  species: SpeciesConfig[];
}

export const MARE = rawConfig as unknown as MareConfig;

export const SPECIES_IDS = MARE.species.map((s) => s.id);

export function speciesConfig(id: string): SpeciesConfig | undefined {
  return MARE.species.find((s) => s.id === id);
}

export function rarityConfig(index: number): RarityConfig {
  return MARE.rarities[Math.min(MARE.rarities.length - 1, Math.max(0, index))];
}

export function cardArt(speciesId: string): string {
  const sp = speciesConfig(speciesId);
  return `/assets/portraits/age01_cell_portrait_${sp?.portrait ?? speciesId}_v001.png`;
}

/* ---------- Niveaux (doublons) ---------- */

/** Niveau d'une carte selon son nombre de prises (level_thresholds). */
export function cardLevel(count: number): number {
  let level = 0;
  for (const t of MARE.level_thresholds) if (count >= t) level += 1;
  return Math.max(1, level);
}

export function maxCardLevel(): number {
  return MARE.level_thresholds.length;
}

/** Prises nécessaires pour le niveau suivant (null si niveau max). */
export function nextLevelAt(count: number): number | null {
  for (const t of MARE.level_thresholds) if (count < t) return t;
  return null;
}

/* ---------- Puissance des cartes ---------- */

/** Multiplicateur d'une carte : rareté × niveau. */
function cardMult(entry: CardEntry): number {
  return (
    rarityConfig(entry.bestRarity).power_mult *
    (1 + MARE.level_power_bonus * (cardLevel(entry.count) - 1))
  );
}

export function cardPowerDef(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  return sp ? Math.round(sp.power_def * cardMult(entry)) : 0;
}

export function cardPowerExp(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  return sp ? Math.round(sp.power_exp * cardMult(entry)) : 0;
}

export function cardPowerAtk(speciesId: string, entry: CardEntry): number {
  const sp = speciesConfig(speciesId);
  return sp ? Math.round(sp.power_atk * cardMult(entry)) : 0;
}

/* ---------- Bonus d'assignation (passerelle vers le militaire) ---------- */

function assignedEntries(
  state: Pick<GameState, "collection" | "cardAssignments">,
  slot: keyof CardAssignments,
): [string, CardEntry][] {
  return state.cardAssignments[slot]
    .filter((id) => state.collection[id])
    .map((id) => [id, state.collection[id]]);
}

/** Puissance défensive ajoutée par les cartes assignées en défense. */
export function cardsDefenseBonus(
  state: Pick<GameState, "collection" | "cardAssignments">,
): number {
  return assignedEntries(state, "defense").reduce(
    (sum, [id, e]) => sum + cardPowerDef(id, e),
    0,
  );
}

/** Puissance d'exploration ajoutée par les cartes assignées en expédition. */
export function cardsExpeditionExpBonus(
  state: Pick<GameState, "collection" | "cardAssignments">,
): number {
  return assignedEntries(state, "expedition").reduce(
    (sum, [id, e]) => sum + cardPowerExp(id, e),
    0,
  );
}

/** Puissance d'assaut ajoutée par les cartes assignées en expédition. */
export function cardsExpeditionAtkBonus(
  state: Pick<GameState, "collection" | "cardAssignments">,
): number {
  return assignedEntries(state, "expedition").reduce(
    (sum, [id, e]) => sum + cardPowerAtk(id, e),
    0,
  );
}

/* ---------- Tirages (utilisent le PRNG seedé du moteur) ---------- */

/** Tirage de rareté : poids v1, remontés par la chance (quality de tension).
 *  `roll` est un tirage 0..1 déjà effectué par l'appelant (PRNG seedé). */
export function rollRarity(roll: number, luck: number, floor = 0): number {
  // La chance multiplie le poids des raretés hautes : w_i × (1 + luck × i).
  const weights = MARE.rarities.map((r, i) => r.weight * (1 + luck * i * 2));
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll * total <= acc) return Math.max(floor, i);
  }
  return Math.max(floor, MARE.rarities.length - 1);
}

/** Tirage d'espèce (uniforme sur les 12). */
export function rollSpecies(roll: number): string {
  return SPECIES_IDS[Math.min(SPECIES_IDS.length - 1, Math.floor(roll * SPECIES_IDS.length))];
}

/** Ajoute une prise à la collection (mute le draft) et décrit le résultat. */
export function addCatch(
  state: GameState,
  speciesId: string,
  rarity: number,
  now: number,
  source: "peche" | "fragments",
): void {
  const prev = state.collection[speciesId];
  const prevLevel = prev ? cardLevel(prev.count) : 0;
  const entry: CardEntry = prev
    ? {
        count: prev.count + 1,
        bestRarity: Math.max(prev.bestRarity, rarity),
        firstCaughtAt: prev.firstCaughtAt,
      }
    : { count: 1, bestRarity: rarity, firstCaughtAt: now };
  state.collection = { ...state.collection, [speciesId]: entry };
  state.lastCatch = {
    speciesId,
    rarity,
    isNew: !prev,
    newBestRarity: !!prev && rarity > prev.bestRarity,
    level: cardLevel(entry.count),
    leveledUp: !!prev && cardLevel(entry.count) > prevLevel,
    source,
  };
}
