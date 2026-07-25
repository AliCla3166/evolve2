/* Accesseurs typés de bastion_config.json + dérivation des stats de combat à partir
   d'une créature de La Mare (cards.ts). Aucune formule de puissance nouvelle : on
   réutilise cardHp/cardPowerDef/cardPowerAtk telles quelles, comme pour le militaire
   et les expéditions. Mirroring le style de cards.ts/military.ts (config-driven, pur). */

import rawConfig from "@/data/bastion_config.json";
import { MARE, cardHp, cardPowerAtk, cardPowerDef, rarityConfig, speciesConfig } from "../cards";
import { bonusValue } from "../territoire";
import type { CardEntry, GameState } from "../types";
import type {
  BarracksSlot,
  BastionState,
  FieldStructure,
  LiveWaveResult,
  MortarSlot,
  StaticDefs,
  SupportSlotState,
  TurretSlot,
} from "./types";

/* ---------- Typage du JSON ---------- */

export interface BuildingDef {
  id: string;
  name: string;
  category: "turret" | "wall" | "trap" | "support";
  rarity: string;
  cost: number;
  desc: string;
  dmg?: number;
  rate?: number;
  range?: number;
  chainCount?: number;
  chainRadius?: number;
  splash?: number;
  blockHp?: number;
  regenPerWave?: number;
  burst?: number;
  radius?: number;
  slowPct?: number;
  slowDur?: number;
  effect?: string;
  value?: number;
  active?: boolean;
  chargeKills?: number;
}

export interface PathogenDef {
  id: string;
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  unlock: number;
  ranged?: boolean;
  atkRange?: number;
}

/** Un cran de Péril : difficulté volontaire choisie avant la sortie (cf. bastion_config.json). */
export interface PerilDef {
  id: number;
  name: string;
  hp_mult: number;
  dmg_mult: number;
  loot_mult: number;
  extra_bosses: number;
}

/** Un préparatif achetable en énergie juste avant de lancer une sortie. */
export interface PreparatifDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  cost_energie: number;
  loot_mult?: number;
  extra_respawn?: number;
  opening_damage_ratio?: number;
}

interface BastionConfig {
  slots: {
    turret_total: number;
    vanguard_count: number;
    barracks_total: number;
    mortar_total: number;
    support_total: number;
  };
  rarity_acc: number[];
  reserve: { base_cap: number; max_cap: number; cost_base: number; cost_growth: number };
  tree_cap: { base_level: number; max_level: number; cost_base: number; cost_growth: number };
  foundations: { max_level: number; per_level_mult: number; cost_base: number; cost_growth: number };
  in_wave_respawn: { cost: number };
  slot_unlock_cost: Record<"turret" | "barracks" | "mortar", { base: number; growth: number }>;
  recruit_building_cost: { base: number; growth: number };
  buildings: BuildingDef[];
  barracks_tree: {
    a: { name: string; desc: string; mod: Record<string, number> };
    b: { name: string; desc: string; mod: Record<string, number> };
  }[];
  unit_combat: {
    barracks_rate: number;
    barracks_squad_base: number;
    barracks_squad_per_rarity: number;
    mortar_rate: number;
    mortar_range: number;
    mortar_splash_radius: number;
  };
  pathogens: { roster: PathogenDef[]; boss: PathogenDef & { value: number }; boss_every: number };
  bastion: { hp_base: number };
  wave: {
    count_base: number;
    count_per_wave: number;
    hp_mult_per_wave: number;
    dmg_mult_per_wave: number;
    spawn_gap_base: number;
    spawn_gap_per_wave: number;
    spawn_gap_min: number;
    num_types_base: number;
    num_types_max: number;
    num_types_per_waves: number;
    combat_reward_base: number;
    combat_reward_per_wave: number;
    lead_window_h: number;
  };
  sorties: {
    free_per_day: number;
    cost_base: number;
    cost_growth: number;
    max_per_day: number;
    defeat_combat_ratio: number;
    fragment_chance: number;
    peril: { levels: PerilDef[] };
    preparatifs: PreparatifDef[];
  };
  scouting: { max_level: number; cost_base: number; cost_growth: number };
}

export const BASTION = rawConfig as unknown as BastionConfig;

/* ---------- Géométrie du champ (identique au prototype autonome, cf. game.js) ---------- */

export const CANVAS_W = 700;
export const CANVAS_H = 400;
export const CASTLE = { x: 60, y: CANVAS_H / 2 };
export const CORE_RADIUS = 38;
export const BATTLE_Y_TOP = 40;
export const BATTLE_Y_BOTTOM = 360;
export const FIELD_MIN_X = 182;
export const FIELD_MAX_X = 615;
export const FIELD_MIN_Y = BATTLE_Y_TOP + 8;
export const FIELD_MAX_Y = BATTLE_Y_BOTTOM - 8;
export const SPAWN_X = 655;
export const TURRET_COL_X = 108;
export const BARRACKS_COL_X = 160;
export const CLUSTER_ROWS_Y = [80, 160, 240, 320];
export const VANGUARD_COL_X = 180;
export const VANGUARD_ROWS_Y = [120, 280];
export const MORTAR_SLOTS_XY = [
  { x: CASTLE.x, y: 70 },
  { x: CASTLE.x, y: 330 },
];

export function buildTurretSlots(): TurretSlot[] {
  const base = CLUSTER_ROWS_Y.map((y, i) => ({ id: `T${i}`, x: TURRET_COL_X, y, occupant: null }));
  const vanguard = VANGUARD_ROWS_Y.map((y, i) => ({ id: `V${i}`, x: VANGUARD_COL_X, y, occupant: null }));
  return [...base, ...vanguard];
}

export function buildBarracksSlots(): BarracksSlot[] {
  return CLUSTER_ROWS_Y.map((y, i) => ({
    id: `B${i}`,
    x: BARRACKS_COL_X,
    y,
    occupant: null,
    treeLevel: 0,
    treePath: [],
  }));
}

export function buildMortarSlots(): MortarSlot[] {
  return MORTAR_SLOTS_XY.map((p, i) => ({ id: `M${i}`, x: p.x, y: p.y, occupant: null }));
}

export function freshSupport(): (SupportSlotState | null)[] {
  return Array.from({ length: BASTION.slots.support_total }, () => null);
}

export function freshBastionState(): BastionState {
  return {
    turretSlots: buildTurretSlots(),
    turretSlotsUnlocked: 1,
    barracksSlots: buildBarracksSlots(),
    barracksSlotsUnlocked: 1,
    mortarSlots: buildMortarSlots(),
    mortarSlotsUnlocked: 0,
    fieldStructures: [],
    nextStructureUid: 1,
    support: freshSupport(),
    buildingReserve: [],
    nextBuildingUid: 1,
    reserveCap: BASTION.reserve.base_cap,
    maxTreeLevel: BASTION.tree_cap.base_level,
    slotBonusLevel: 0,
    inWaveRespawnUnlocked: false,
    scoutLevel: 0,
    liveWaveCount: 0,
    liveBattleActive: false,
    liveBattleStartedAt: 0,
    sortieDay: null,
    sortieCount: 0,
    bonusSortieDay: null,
    bonusSorties: 0,
    sortieTargetId: null,
    sortiePeril: 0,
    sortiePreparatifs: [],
    sortiePerceeId: null,
  };
}

/* ---------- Slots actifs (déblocage progressif) ---------- */

export function activeTurretSlots(state: BastionState): TurretSlot[] {
  return state.turretSlots.slice(0, state.turretSlotsUnlocked);
}
export function activeBarracksSlots(state: BastionState): BarracksSlot[] {
  return state.barracksSlots.slice(0, state.barracksSlotsUnlocked);
}
export function activeMortarSlots(state: BastionState): MortarSlot[] {
  return state.mortarSlots.slice(0, state.mortarSlotsUnlocked);
}

/* ---------- Bâtiments (tourelles/murs/pièges/support) ---------- */

export function buildingDef(id: string): BuildingDef | undefined {
  return BASTION.buildings.find((b) => b.id === id);
}

export function buildingsByCategory(category: BuildingDef["category"]): BuildingDef[] {
  return BASTION.buildings.filter((b) => b.category === category);
}

/* ---------- Dérivation des stats de combat d'une créature (La Mare -> Bastion) ---------- */

export function rarityAcc(bestRarity: number): number {
  return BASTION.rarity_acc[Math.min(BASTION.rarity_acc.length - 1, Math.max(0, bestRarity))];
}

export interface UnitCombatStats {
  hp: number;
  dmg: number;
  rate: number;
  range: number;
  acc: number;
  splashRadius: number;
}

/** Stats de combat d'une créature placée en barracks (rôle "defense", escouade mobile
 *  au corps-à-corps) ou en mortier (rôle "assaut", statique, portée + éclaboussure). */
export function unitStatsFromSpecies(
  speciesId: string,
  entry: CardEntry,
  kind: "barracks" | "mortar",
): UnitCombatStats | null {
  const sp = speciesConfig(speciesId);
  if (!sp) return null;
  const uc = BASTION.unit_combat;
  const hp = cardHp(speciesId, entry);
  if (kind === "barracks") {
    return {
      hp,
      dmg: Math.max(1, cardPowerDef(speciesId, entry)),
      rate: uc.barracks_rate,
      range: 46,
      acc: rarityAcc(entry.bestRarity),
      splashRadius: 0,
    };
  }
  return {
    hp,
    dmg: Math.max(1, cardPowerAtk(speciesId, entry)),
    rate: uc.mortar_rate,
    range: uc.mortar_range,
    acc: rarityAcc(entry.bestRarity),
    splashRadius: uc.mortar_splash_radius,
  };
}

/** Taille de l'escouade d'une barracks (nombre de troupes vivantes visées). */
export function squadSizeFor(entry: CardEntry): number {
  const uc = BASTION.unit_combat;
  const rar = rarityConfig(entry.bestRarity);
  return Math.max(1, Math.round(uc.barracks_squad_base + uc.barracks_squad_per_rarity * (rar.power_mult - 1)));
}

/* ---------- Arborescence de spécialisation des barracks ---------- */

export interface TreeMods {
  hpMult: number;
  dmgMult: number;
  rateMult: number;
}

export function computeTreeMods(slot: BarracksSlot): TreeMods {
  const mods: TreeMods = { hpMult: 1, dmgMult: 1, rateMult: 1 };
  slot.treePath.forEach((choice, level) => {
    const tier = BASTION.barracks_tree[level];
    if (!tier) return;
    const picked = tier[choice].mod;
    if (picked.hpMult) mods.hpMult *= picked.hpMult;
    if (picked.dmgMult) mods.dmgMult *= picked.dmgMult;
    if (picked.rateMult) mods.rateMult *= picked.rateMult;
  });
  return mods;
}

/** "Fondations renforcées" — bonus passif global, indépendant du niveau de chaque
 *  barracks, appliqué aux PV/dégâts de toute la garnison + tourelles + mortiers. */
export function foundationsMult(slotBonusLevel: number): number {
  return 1 + slotBonusLevel * BASTION.foundations.per_level_mult;
}

/* ---------- Coûts Boutique (courbes géométriques, cohérent avec le reste du projet) ---------- */

function geometric(base: number, growth: number, count: number): number {
  return Math.round(base * Math.pow(growth, count));
}

export function turretSlotUnlockCost(unlocked: number): number {
  const c = BASTION.slot_unlock_cost.turret;
  return geometric(c.base, c.growth, unlocked - 1);
}
export function barracksSlotUnlockCost(unlocked: number): number {
  const c = BASTION.slot_unlock_cost.barracks;
  return geometric(c.base, c.growth, unlocked - 1);
}
export function mortarSlotUnlockCost(unlocked: number): number {
  const c = BASTION.slot_unlock_cost.mortar;
  return geometric(c.base, c.growth, unlocked);
}
export function reserveCapCost(currentCap: number): number {
  const c = BASTION.reserve;
  return geometric(c.cost_base, c.cost_growth, currentCap - c.base_cap);
}
export function specCapCost(currentMax: number): number {
  const c = BASTION.tree_cap;
  return geometric(c.cost_base, c.cost_growth, currentMax - c.base_level);
}
export function foundationsCost(currentLevel: number): number {
  const c = BASTION.foundations;
  return geometric(c.cost_base, c.cost_growth, currentLevel);
}
export function scoutCost(currentLevel: number): number {
  const c = BASTION.scouting;
  return geometric(c.cost_base, c.cost_growth, currentLevel);
}
/** Fenêtre d'avance : jusqu'à quand une vague planifiée peut être jouée manuellement. */
export const WAVE_LEAD_WINDOW_MS = BASTION.wave.lead_window_h * 3_600_000;
export function recruitBuildingCost(ownedCount: number): number {
  const c = BASTION.recruit_building_cost;
  return geometric(c.base, c.growth, ownedCount);
}
export const IN_WAVE_RESPAWN_COST = BASTION.in_wave_respawn.cost;

/* ---------- Tirage pondéré d'un bâtiment (Boutique — recrutement) ---------- */

const RARITY_WEIGHT: Record<string, number> = {
  commune: 46,
  peucommune: 26,
  rare: 15,
  epique: 8,
  legendaire: 3.5,
  mythique: 1,
};

/** `rarityRoll`/`indexRoll` : deux tirages 0..1 INDÉPENDANTS du PRNG seedé de l'appelant
 *  (comme rollRarity/rollSpecies dans cards.ts — jamais réutiliser le même tirage deux fois). */
export function rollBuildingDef(rarityRoll: number, indexRoll: number): BuildingDef {
  const total = Object.values(RARITY_WEIGHT).reduce((a, b) => a + b, 0);
  let r = rarityRoll * total;
  let picked = "commune";
  for (const [rar, w] of Object.entries(RARITY_WEIGHT)) {
    r -= w;
    if (r <= 0) {
      picked = rar;
      break;
    }
  }
  const opts = BASTION.buildings.filter((b) => b.rarity === picked);
  const pool = opts.length ? opts : BASTION.buildings;
  return pool[Math.min(pool.length - 1, Math.floor(indexRoll * pool.length))];
}

/* ---------- Récompense d'une bataille jouée en direct ---------- */

/** Récompense en monnaie de combat d'une bataille jouée — proportionnelle aux
 *  éliminations, avec un bonus de victoire. Vit ici (pas dans military.ts) pour
 *  éviter un cycle d'imports : military.ts appelle cette fonction depuis
 *  resolveLiveWave, et bastion/actions.ts importe `rand` depuis military.ts. */
export function liveWaveCombatReward(outcome: LiveWaveResult): number {
  const w = BASTION.wave;
  const base = w.combat_reward_base + outcome.waveN * w.combat_reward_per_wave;
  const perKill = base / 6;
  const reward = outcome.kills * perKill + (outcome.won ? base : 0) * (outcome.bastionHpFrac || 0.2);
  return Math.max(1, Math.round(reward));
}

/* ---------- Présentation (couleurs/icônes des bâtiments — repli visuel, pas de sprite dédié) ---------- */

/** Couleur d'une rareté par SON ID (pas son index — bastion_config.json utilise les mêmes
 *  ids que mare_config.json.rarities, cf. RARITY_WEIGHT ci-dessus). */
export function buildingRarityColor(rarityId: string): string {
  return MARE.rarities.find((r) => r.id === rarityId)?.color ?? "#cfe8f2";
}

/** Icône emoji par bâtiment — repli visuel volontaire (cf. décision #2 du plan), pas de
 *  sprite dédié pour l'instant. Regroupé ici pour rester cohérent entre Scene et Panel. */
const BUILDING_ICON: Record<string, string> = {
  t_spore: "🍄",
  t_electrique: "⚡",
  t_flamme: "🔥",
  t_sniper: "🎯",
  t_chaine: "🔗",
  t_abyssale: "🌀",
  w_chitine: "🧱",
  w_regen: "🫧",
  tr_acide: "🧪",
  tr_collant: "🕸️",
  s_enzyme: "🧬",
  s_oeil: "👁️",
  s_frappe: "☄️",
  s_bouclier: "🛡️",
};

export function buildingIcon(id: string): string {
  return BUILDING_ICON[id] ?? "❖";
}

/* ---------- Contexte de combat (StaticDefs) dérivé d'un GameState complet ---------- */

/** Bonus agrégés des supports PASSIFS posés (les actifs — strikeAll/shieldBurst —
 *  se déclenchent au tap, cf. engine.applySupportActive, pas ici). */
export function resolvedSupportMods(
  support: (SupportSlotState | null)[],
): { dmgMult: number; rangeMult: number; accBonus: number } {
  let dmgMult = 1;
  let rangeMult = 1;
  const accBonus = 0;
  support.forEach((s) => {
    if (!s) return;
    const def = buildingDef(s.occupant);
    if (!def || def.active) return; // uniquement les passifs
    if (def.effect === "dmgMult") dmgMult *= 1 + (def.value ?? 0);
    if (def.effect === "rangeMult") rangeMult *= 1 + (def.value ?? 0);
  });
  return { dmgMult, rangeMult, accBonus };
}

/** Régénération partielle des murailles/pièges entre deux vagues jouées en direct
 *  (ex. w_regen) — appelée une fois au DÉBUT d'une nouvelle bataille, jamais pendant
 *  l'auto-résolution offline (qui ne simule pas de dégâts de structure). */
export function regenFieldStructures(structures: FieldStructure[]): FieldStructure[] {
  return structures.map((s) => {
    const def = buildingDef(s.occupant);
    const regen = def?.regenPerWave ?? 0;
    return regen > 0 ? { ...s, hp: Math.min(s.hpMax, s.hp + regen) } : s;
  });
}

/** Assemble le contexte statique passé à initBattle/stepBattle à partir de l'état de
 *  partie complet — slots actifs uniquement, structures déjà régénérées par l'appelant
 *  si besoin (cf. regenFieldStructures), mods de support passifs déjà résolus. */
export function buildStaticDefs(
  state: Pick<GameState, "bastion" | "collection" | "territoire">,
  structures: FieldStructure[],
): StaticDefs {
  const mods = resolvedSupportMods(state.bastion.support);
  return {
    turretSlots: activeTurretSlots(state.bastion),
    barracksSlots: activeBarracksSlots(state.bastion),
    mortarSlots: activeMortarSlots(state.bastion),
    fieldStructures: structures,
    collection: state.collection,
    slotBonusLevel: state.bastion.slotBonusLevel,
    inWaveRespawnUnlocked: state.bastion.inWaveRespawnUnlocked,
    // Les vestiges de La Dérive entrent ici, au même endroit que les supports passifs :
    // le moteur (engine.ts) reste ignorant du territoire, il ne voit qu'un multiplicateur.
    mods: {
      ...mods,
      dmgMult: mods.dmgMult * (1 + bonusValue(state.territoire, "bastion_dmg_mult")),
    },
  };
}

/* ---------- Deux plafonds que La Dérive relève ---------- */

/** PV du Bastion pour une bataille jouée : socle de config × Fondations renforcées ×
 *  vestige « Socle basaltique ». Aucune valeur en dur — cf. bastion_config.json -> bastion. */
export function bastionHpMax(state: Pick<GameState, "bastion" | "territoire">): number {
  return Math.round(
    BASTION.bastion.hp_base *
      foundationsMult(state.bastion.slotBonusLevel) *
      (1 + bonusValue(state.territoire, "bastion_hp_mult")),
  );
}

/** Places de réserve réellement disponibles : celles achetées en Boutique + celles
 *  offertes par un vestige (« Carcasse-atelier »). La Boutique, elle, continue de
 *  raisonner sur `bastion.reserveCap` seul — un vestige ne doit pas consommer le
 *  budget d'achats du joueur ni buter sur `reserve.max_cap`. */
export function effectiveReserveCap(state: Pick<GameState, "bastion" | "territoire">): number {
  return state.bastion.reserveCap + bonusValue(state.territoire, "reserve_cap");
}
